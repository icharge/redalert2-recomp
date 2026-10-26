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
  locateFile: (path) => gameModuleFile(game, "/game/", path), // maps Yuri's ra2.* names to ra2md.*
  preRun: [ /* put the game's files in /game, below */ ],
  onRuntimeInitialized: () => resolve(handle),
};
document.head.append(Object.assign(document.createElement("script"), { src: gameScript(game) }));
```

The module is built with `noInitialRun`: once the runtime is up the page puts the game's files in
place (WasmFS's calls into the file system abort in `preRun`) and then calls `callMain` itself.
`main()` runs on the game's thread (`PROXY_TO_PTHREAD`).
The game folder is passed with `--game`, as on Linux; any `arg=` in the page's
URL query (`?arg=--hd-voxels`, for tests and debugging) is appended. The
canvas is not handed over: the picture comes back through shared memory.

Where `/game` comes from: the import in OPFS (big files linked and read in place from the
`/opfs` mount, small ones copied into memory; [storage.md](storage.md), "How the game reads its
files"), or, in development, the dev server's `/dev-game/` (a local game folder, filtered to the
import allowlist), fetched whole into the in-memory file system once the runtime is up.

## Shared memory: the picture and the cursor

`ra2_shared()` returns the address of a struct of 32-bit words (`ra2_shared_t`
in `src/web/web_api.h`, `Shared` in `protocol.ts`). The game thread writes it
and the page reads it each animation frame.

| Word | Field | Meaning |
|---|---|---|
| 0 | `protocol` | `RA2_WEB_PROTOCOL` |
| 1 | `frame_seq` | goes up after each frame is written; redraw when it moves |
| 2 | `frame_ptr` | address of the picture: `frame_w * frame_h * 4` bytes of RGBA with `presentMode` 0 (the default), or `frame_h` rows of `framePitch` bytes in `format` with 1 |
| 3, 4 | `frame_w`, `frame_h` | the picture's size, which is the game's display mode |
| 5 | `cursor_seq` | goes up whenever the cursor changes |
| 6 | `cursor_kind` | 0 hide the system cursor (the game draws its own), 1 the image below, 2 the system arrow, 3 draw the image above the full game/sidebar |
| 7, 8 | `cursor_hot_x`, `cursor_hot_y` | the image's hot spot |
| 9, 10, 11 | `view_w`, `view_h`, `view_dpr` | what `ra2_resize` last said |
| byte 52 | `cursor_rgba` | 32x32 RGBA |
| 1042, 1043 | `pointer_x`, `pointer_y` | pointer position in game pixels, used by the pause cursor overlay |
| 1044 | `format` | raw picture: `PixelFormat` (0 RGBA, 1 RGB565, 2 PAL8, 3 BGRX as the game's 32-bit screen stores them) |
| 1045 | `framePitch` | raw picture: bytes per row |
| 1046 | `palettePtr` | PAL8: 256 words, `r \| g << 8 \| b << 16` |
| 1047 | `readIndex` | written by the page: the buffer (0 to 2) it is reading, -1 for none; the game never writes that buffer. Set to -1 at start-up |
| 1048 | `frameIndex` | the buffer `frame_ptr` is in (0 to 2), -1 before the first picture |
| 1049, 1050 | `hdLayer1x`, `hdLayer2x` | the HD vehicle layers; filled by the GPU path, 0 until then |
| 1051, 1052 | `hdRects`, `hdRectCount` | the HD layers' rectangles; the same |
| 1053 | `hdSeq` | goes up when the HD layers change; the same |
| 1054 | `republish` | the page sets 1 to ask for a full picture; the game clears it |
| 1055 | `presentMode` | written by the page: 0 publishes RGBA as before (the default), 1 publishes the game's format unconverted. Read at each publish. With 1 and HD vehicles on, the 1x frame goes out and the HD layers stay 0 |

The game keeps three buffers for the picture. It writes into the one that is
neither the newest published nor `readIndex`, and a buffer it has outgrown is
freed once no slot reads or publishes it (`src/web/frame_buffers.c`).

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
| `ra2_input_text` | `const char *text` | committed UTF-8 text; supported CP874 characters become `WM_CHAR` messages for the game's focused window |
| `ra2_resize` | `int w, int h, float dpr` | the canvas's CSS size; stored for the game's use (stage 9: a resolution to match the window) |
| `ra2_set_volume` | `float v` (0 to 1) | `hle_dsound_set_master(v)` |
| `ra2_audio` | none | the address of the sound ring (`hle_audio_ring_t`); `AudioRing` and `AUDIO_PCM_OFFSET` in protocol.ts say where its words are |
| `ra2_audio_live` | `int live` | 1 while the page's audio context runs and the worklet reads the ring (the ring is emptied first); 0 and the game's mixer drops what it mixes |
| `ra2_focus` | `int focused` | the window gained or lost focus: the game's window always gets `WM_ACTIVATEAPP` active (as in the native build: a game told it lost focus idles and half-repaints on return); losing focus during a match (the game's frame count moved in the last second, its own cursor, no pause menu yet) presses Escape for the game, which opens its menu (so does opening Settings, F10, in a match; the page also sends 0 when the game area loses focus to anything but the text box); gaining focus also does what the game's own `Focus_Restore` ends with (`GScreenClass::Flag_To_Redraw(2)`, a complete redraw), has every showing window paint in full and a new picture published at once |
| `ra2_set_menu_music` | `int allowed` | 1 (the default) lets the game's music play anywhere; 0 keeps it for matches: the mixer silences the buffer the host marked as music (`hle_dsound_mark_music`, called when the game prints `Theme::PlaySong`) unless the game's frames are moving or its pause menu is up. The song goes on playing, so nothing in the game waits |
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
