# The page and the game

What the page (TypeScript, main thread) and the game (C, its own thread) say
to each other. Every shape here has one TypeScript type in
`web/src/game/protocol.ts` and one C declaration in `src/web/web_api.h`, and
the two are changed together.

Keep it small. Most of the game's work (drawing, input, sound, files) goes
through SDL and WasmFS without any message of ours.

## Starting the game

The build is Emscripten's classic (non-module) output, so it can also run under
Node (`node ra2.js`, [testing.md](testing.md)). The page sets `window.Module`
and then adds the script:

```ts
window.Module = {
  arguments: ["--run", "--game", "/game", ...queryArgs],
  print: (line) => store.line(line),       // the game's stdout: events and log
  printErr: (line) => store.line(line),
  onAbort: (what) => store.crashed(what),
  locateFile: (path) => `/game/${path}`,   // ra2.wasm, ra2.data (the fonts)
  preRun: [ /* put the game's files in /game, below */ ],
  onRuntimeInitialized: () => resolve(handle),
};
document.head.append(Object.assign(document.createElement("script"), { src: "/game/ra2.js" }));
```

`main()` runs on the game's thread (`PROXY_TO_PTHREAD`) once the runtime is up.
The game folder is passed with `--game`, as on Linux; any `arg=` in the page's
URL query (`?arg=--hd-voxels`, for tests and debugging) is appended. The
canvas is not handed over: the picture comes back through shared memory.

Where `/game` comes from: for now, in development only, the dev server's
`/dev-game/` (a local game folder, filtered to the import allowlist), fetched
into the in-memory file system in `preRun`. The import (stage 6) mounts OPFS.

## Shared memory: the picture and the cursor

`ra2_shared()` returns the address of a struct of 32-bit words (`ra2_shared_t`
in `src/web/web_api.h`, `Shared` in `protocol.ts`). The game thread writes it
and the page reads it each animation frame.

| Word | Field | Meaning |
|---|---|---|
| 0 | `protocol` | `RA2_WEB_PROTOCOL` |
| 1 | `frame_seq` | goes up after each frame is written; redraw when it moves |
| 2 | `frame_ptr` | address of `frame_w * frame_h * 4` bytes of RGBA |
| 3, 4 | `frame_w`, `frame_h` | the picture's size, which is the game's display mode |
| 5 | `cursor_seq` | goes up whenever the cursor changes |
| 6 | `cursor_kind` | 0 hide the system cursor (the game draws its own), 1 the image below, 2 the system arrow, 3 draw the image above the full game/sidebar |
| 7, 8 | `cursor_hot_x`, `cursor_hot_y` | the image's hot spot |
| 9, 10, 11 | `view_w`, `view_h`, `view_dpr` | what `ra2_resize` last said |
| byte 52 | `cursor_rgba` | 32x32 RGBA |
| 1042, 1043 | `pointer_x`, `pointer_y` | pointer position in game pixels, used by the pause cursor overlay |

## Page to game: exported functions

Called with `cwrap`. They are plain exports and run on the main thread, so each
only sets a value or pushes into a ring the game thread empties in its pump
hook (`hle_set_pump_hook`).

| Function | Arguments | What it does |
|---|---|---|
| `ra2_shared` | none → address | where `ra2_shared_t` is |
| `ra2_net_buffer` | none → address | scratch buffer for the page's WebRTC/IPX datagram bridge |
| `ra2_net_pop` | `int capacity` → `int` | copies one outbound IPX datagram (source socket, destination socket, then payload) to the scratch buffer; 0 means empty |
| `ra2_net_push` | `int length` → `int` | queues one inbound prefixed datagram from the scratch buffer for the game's IPX socket |
| `ra2_input_pointer` | `int kind, int x, int y, int button` | kind 0 move, 1 down, 2 up; `x`, `y` in the picture's pixels; button as the DOM numbers it (0 left, 1 middle, 2 right) |
| `ra2_input_key` | `int down, int vk, int scan` | a Windows virtual key and set-1 scan code |
| `ra2_resize` | `int w, int h, float dpr` | the canvas's CSS size; stored for the game's use (stage 9: a resolution to match the window) |
| `ra2_set_volume` | `float v` (0 to 1) | `hle_dsound_set_master(v)` |
| `ra2_audio` | none | the address of the sound ring (`hle_audio_ring_t`); `AudioRing` and `AUDIO_PCM_OFFSET` in protocol.ts say where its words are |
| `ra2_audio_live` | `int live` | 1 while the page's audio context runs and the worklet reads the ring (the ring is emptied first); 0 and the game's mixer drops what it mixes |
| `ra2_focus` | `int focused` | the window gained or lost focus: `WM_ACTIVATEAPP` to the game's window |
| `ra2_quit` | none | posts `WM_CLOSE` to the game's window |
| `ra2_exit_confirmation_reply` | `uint32 request, int exit_game` → `int` | replies to the intercepted Exit confirmation; 0 means Stay, 1 means Exit; returns 1 if the pending request matched |
| `ra2_crash_report` | `const char *why` | prints the lifted function, the registers, the indirect-call ring and the guest stack to stderr. Safe after the game thread has died, because it only reads memory |

There is no `ra2_script`: a test's scripted events (`--press`, `--click`, ...)
go in at startup as `arg=` values, which `src/linux/script.c` already handles.

For W12, the page treats the first four bytes in that scratch buffer as the
source and destination IPX sockets in network byte order and the remaining
bytes as one IPX datagram (maximum 576 bytes). The destination lets the HLE
deliver each packet only to the matching bound IPX socket. A WebRTC data-channel
message preserves this packet boundary. The HLE's bounded queues connect the
page thread to the game thread; the one-peer LAN channel is unreliable and
unordered. `ra2_net_push` returns 0 when queued and -1 for a malformed or full
receive queue.

## Game to page: events

The game prints one line per event to stdout, prefixed `@ra2 ` and followed
by JSON. `loader.ts` takes those lines out of the log and dispatches them to
the store. Plain text, so the same events show up in a Node run's output and
in test logs.

| Event | Fields | When |
|---|---|---|
| `boot` | `title`, `exe`, `stamp` | the exe is mapped and bound |
| `menu` | none | the main menu's dialog (0xE2) opened: `phase` becomes `running` |
| `mode` | `w`, `h` | the picture's size changed (the game set a display mode) |
| `fps` | `fps`, `ms`, and `worst`, `late`, `pub`, `pubms` | once a second: the game's own frames per second, the longest gap between two game frames (ms), how many came more than 25 ms after the one before, how many pictures were published and the mean ms to make one. The page shows them only if the overlay is on |
| `exit` | `code` | the game's entry returned |
| `exitConfirm` | `request` | the main menu's Exit confirmation call was intercepted before native dialog creation; reply using `ra2_exit_confirmation_reply` |
| `error` | `message` | something the player should see that isn't a crash (a missing file) |

Example: `@ra2 {"e":"mode","w":1280,"h":720}`.

## Exit confirmation proof of concept

Protocol 6 replaces the original main menu's Exit confirmation. The
`web_exit_confirmation_patches` matcher in `run_lift.py` finds its unique
five-argument confirmation call (YR `0x0052DE1C`, RA2 `0x00513A65`). In
Emscripten, it calls `ra2_web_exit_confirmation` instead of the game's
reusable dialog helper. Native hosts retain the original call.

The web host emits `exitConfirm` with a unique nonzero request ID, then
waits on an atomic reply mailbox while releasing the guest machine lock.
React opens its modal and blocks game input and pointer capture. No
resource `0x120` dialog or native controls are created or painted.

`ra2_exit_confirmation_reply(request, 0)` chooses Stay, and value 1 chooses
Exit. A zero, stale or unmatched request, an invalid choice, or a second
reply returns 0; a matching reply returns 1. The waiting hook returns the
game helper's original result (0 for OK/Exit, 1 for Cancel/Stay), and the
lift discards the original 20 argument bytes. The game's caller performs
its normal exit or main-menu branch. Escape in the browser is Stay, and
focus returns to the canvas afterwards. Exit or crash clears the prompt.

This is a focused game-to-web-to-game hook, not yet a general replacement
for native dialogs or the Online lobby. Protocol 5's HWND-based overlay is
superseded: the request ID is not a window handle.

## Versions

`protocol.ts` and `web_api.h` both carry `RA2_WEB_PROTOCOL` (an integer).
The `boot` event includes it. If the page and the loaded `ra2.wasm`
disagree (a stale cached wasm), the page says so and offers a reload,
instead of misreading events.
