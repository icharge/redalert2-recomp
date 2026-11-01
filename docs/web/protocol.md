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
  print: (line) => store.line(line), // the game's stdout: events and log
  printErr: (line) => store.line(line),
  onAbort: (what) => store.crashed(what),
  locateFile: (path) => gameModuleFile(game, "/game/", path), // maps Yuri's ra2.* names to ra2md.*
  preRun: [/* put the game's files in /game, below */],
  onRuntimeInitialized: () => resolve(handle),
};
document.head.append(
  Object.assign(document.createElement("script"), { src: gameScript(game) }),
);
```

The module is built with `noInitialRun`: once the runtime is up the page puts the game's files in
place (WasmFS's calls into the file system abort in `preRun`) and then calls `callMain` itself.
`main()` runs on the game's thread (`PROXY_TO_PTHREAD`).
The game folder is passed with `--game`, as on Linux; each `arg=` in the page
URL query is passed to the web host (`?arg=--hd-voxels`, for tests and
debugging). The game's legacy `?arg=-SPEEDCONTROL` switch is translated into
the host's `--speedcontrol` option and added to the Windows game's command
line. Other arguments must be recognized by the web host. The canvas is not
handed over: the picture comes back through shared memory.

Where `/game` comes from: the import in OPFS (big files linked and read in place from the
`/opfs` mount, small ones copied into memory; [storage.md](storage.md), "How the game reads its
files"), or, in development, the dev server's `/dev-game/` (a local game folder, filtered to the
import allowlist), fetched whole into the in-memory file system once the runtime is up.

## Shared memory: the picture and the cursor

`ra2_shared()` returns the address of a struct of 32-bit words (`ra2_shared_t`
in `src/web/web_api.h`, `Shared` in `protocol.ts`). The game thread writes it
and the page reads it each animation frame.

| Word       | Field                                  | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0          | `protocol`                             | `RA2_WEB_PROTOCOL`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 1          | `frame_seq`                            | a seqlock: odd while the game publishes a picture, even when it is whole. The 2D page (`presenter.ts`) takes a picture only at an even value that changed since its last one. A raw page follows the read order at 1047                                                                                                                                                                                                                                                                                                                                                                        |
| 2          | `frame_ptr`                            | address of the picture: `frame_w * frame_h * 4` bytes of RGBA with `presentMode` 0 (the default), or `frame_h` rows of `framePitch` bytes in `format` with 1                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 3, 4       | `frame_w`, `frame_h`                   | the picture's size, which is the game's display mode                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 5          | `cursor_seq`                           | goes up whenever the cursor changes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 6          | `cursor_kind`                          | 0 hide the system cursor (the game draws its own), 1 the image below, 2 the system arrow, 3 draw the image above the full game/sidebar                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 7, 8       | `cursor_hot_x`, `cursor_hot_y`         | the image's hot spot                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 9, 10, 11  | `view_w`, `view_h`, `view_dpr`         | what `ra2_resize` last said                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| byte 52    | `cursor_rgba`                          | 32x32 RGBA                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 1042, 1043 | `pointer_x`, `pointer_y`               | pointer position in game pixels, used by the pause cursor overlay                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 1044       | `format`                               | raw picture: `PixelFormat` (0 RGBA, 1 RGB565, 2 PAL8, 3 BGRX as the game's 32-bit screen stores them)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 1045       | `framePitch`                           | raw picture: bytes per row                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 1046       | `palettePtr`                           | PAL8: 256 words, `r \| g << 8 \| b << 16`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 1047       | `readIndex`                            | written by the page with `Atomics.store`: the buffer (0 to 2) it is reading, -1 for none. The page's read: read `frame_seq` s1 and retry while it is odd; read the metadata, `frame_ptr` and `frameIndex`; `Atomics.store` `readIndex` = `frameIndex`; read `frame_seq` s2 and retry if s2 != s1; copy the pixels and, for PAL8, the 256 palette words; read `frame_seq` s3 and retry if s3 != s1; store -1 (or the next index) when done. The game never writes the buffer `readIndex` names. Set to -1 at start-up. Both 2D and WebGL presenters announce reads, regardless of `presentMode` |
| 1048       | `frameIndex`                           | the buffer `frame_ptr` is in (0 to 2), -1 before the first picture. The game stores it between the odd and even `frame_seq` stores; the page reads it with `Atomics.load`                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 1049, 1050 | `hdLayer1x`, `hdLayer2x`               | the HD vehicle layers; filled by the GPU path, 0 until then                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 1051, 1052 | `hdRects`, `hdRectCount`               | the HD layers' rectangles; the same                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 1053       | `hdSeq`                                | goes up when the HD layers change; the same                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 1054       | `republish`                            | the page sets 1 (`Atomics.store`) to ask for a full picture; the game takes it with an exchange to 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 1055       | `presentMode`                          | written by the page with `Atomics.store`: 0 publishes RGBA as before (the default), 1 publishes the game's format unconverted. Read at each publish. The page finishes any picture read before it stores `presentMode`. With 1 and HD vehicles on, the 1x frame goes out and the HD layers stay 0. Replaced buffers are collected once neither `readIndex` nor `frameIndex` refers to them in either mode                                                                                                                                                                                      |
| 1056       | `pageCursorSeq`                        | protocol 10: the in-match cursor (`docs/web/cursor-layer.md`). A seqlock like `frame_seq`: odd while the game publishes a frame; the page takes a frame only at an even value that did not change while reading                                                                                                                                                                                                                                                                                                                                                                                |
| 1057       | `pageCursorKind`                       | 0 no frame (or the game stopped drawing the cursor), 1 the frame below                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 1058, 1059 | `pageCursorHotX`, `pageCursorHotY`     | the hot spot the game itself would subtract (per cursor, already resolved)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 1060, 1061 | `pageCursorW`, `pageCursorH`           | the frame's size                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 1062       | `pageCursorRequest`                    | written by the page with `Atomics.store`: 1 while it draws the cursor itself, 0 otherwise. While it holds and a frame is published, the game skips its own cursor blit                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 1063, 1064 | `pageCursorSheetW`, `pageCursorSheetH` | the SHP's largest frame: the sheet the frame is placed in                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 1065, 1066 | `pageCursorX`, `pageCursorY`           | the frame's offset inside that sheet                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 1067       | `pageCursorPaletteSeq`                 | goes up whenever the palette below is copied (a seqlock too)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| byte 4272  | `pageCursorPalette`                    | 768 bytes of r, g, b, each 0..63 (the game scales by 4): MOUSEPAL.PAL                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| byte 5040  | `pageCursorIndices`                    | the frame: `pageCursorW * pageCursorH` palette indices, top-down; index 0 is transparent                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

The cursor is published as palette indices, not colours, because the game's
cursor has its own palette (MOUSEPAL.PAL), not the theatre's. The art is the
game's own loaded MOUSE.SHA, so a mod that replaces it is covered. The page
draws the frame at `pointer - hot` in its own animation frame, which is what
makes the cursor move at display rate instead of the game's frame rate.

The game keeps three buffers for the picture. It writes into the one that is
neither the newest published nor `readIndex`. After acquiring that writable
buffer, the game makes `frame_seq` odd before writing any pixels, then writes
the published metadata and makes `frame_seq` even. At the next publish, a
replaced buffer is freed once its slot is neither the newest published nor
named by `readIndex`; this applies in both presenter modes because both page
presenters announce reads (`src/web/frame_buffers.c`). The published words
(`format`, `framePitch`, the frame and game sizes, `palettePtr`), then
`framePtr` and `frameIndex` are stored, each with an atomic store. The page
verifies the sequence again after copying the pixels, so a buffer recycled
during the copy is discarded.

## Page to game: exported functions

Called with `cwrap`. They are plain exports and run on the main thread, so each
only sets a value or pushes into a ring the game thread empties in its pump
hook (`hle_set_pump_hook`).

| Function                      | Arguments                               | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ra2_shared`                  | none → address                          | where `ra2_shared_t` is                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `ra2_net_buffer`              | none → address                          | scratch buffer for the page's WebRTC/IPX datagram bridge                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `ra2_net_pop`                 | `int capacity` → `int`                  | copies one outbound IPX datagram (source socket, destination socket, then payload) to the scratch buffer; 0 means empty                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `ra2_net_push`                | `int length` → `int`                    | queues one inbound prefixed datagram from the scratch buffer for the game's IPX socket                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `ra2_input_pointer`           | `int kind, int x, int y, int button`    | kind 0 move, 1 down, 2 up; `x`, `y` in the picture's pixels; button as the DOM numbers it (0 left, 1 middle, 2 right)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `ra2_input_key`               | `int down, int vk, int scan`            | a Windows virtual key and set-1 scan code                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `ra2_input_text`              | `const char *text`                      | committed UTF-8 text; supported CP874 characters become `WM_CHAR` messages for the game's focused window                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `ra2_resize`                  | `int w, int h, float dpr`               | the canvas's CSS size; stored for the game's use (stage 9: a resolution to match the window)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `ra2_set_volume`              | `float v` (0 to 1)                      | `hle_dsound_set_master(v)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `ra2_audio`                   | none                                    | the address of the sound ring (`hle_audio_ring_t`); `AudioRing` and `AUDIO_PCM_OFFSET` in protocol.ts say where its words are                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `ra2_audio_live`              | `int live`                              | 1 while the page's audio context runs and the worklet reads the ring (the ring is emptied first); 0 and the game's mixer drops what it mixes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `ra2_focus`                   | `int focused`                           | the window gained or lost focus: the game's window always gets `WM_ACTIVATEAPP` active (as in the native build: a game told it lost focus idles and half-repaints on return); losing focus during a match (the game's frame count moved in the last second, its own cursor, no pause menu yet) presses Escape for the game, which opens its menu (so does opening Settings, F10, in a match; the page also sends 0 when the game area loses focus to anything but the text box); gaining focus also does what the game's own `Focus_Restore` ends with (`GScreenClass::Flag_To_Redraw(2)`, a complete redraw), has every showing window paint in full and a new picture published at once |
| `ra2_set_menu_music`          | `int allowed`                           | 1 (the default) lets the game's music play anywhere; 0 keeps it for matches: the mixer silences the buffer the host marked as music (`hle_dsound_mark_music`, called when the game prints `Theme::PlaySong`) unless the game's frames are moving or its pause menu is up. The song goes on playing, so nothing in the game waits                                                                                                                                                                                                                                                                                                                                                          |
| `ra2_quit`                    | none                                    | ends the runtime with `hle_exit(0)` (the page has already flushed settings and saves)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `ra2_exit_confirmation_reply` | `uint32 request, int exit_game` → `int` | replies to the intercepted Exit confirmation; 0 means Stay, 1 means Exit; returns 1 if the pending request matched. Exit ends the runtime after the reply, without the guest's save-and-teardown path                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `ra2_crash_report`            | `const char *why`                       | prints the lifted function, the registers, the indirect-call ring and the guest stack to stderr. Safe after the game thread has died, because it only reads memory                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

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

| Event           | Fields                                           | When                                                                                                                                                                                                                                                           |
| --------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `boot`          | `title`, `exe`, `stamp`                          | the exe is mapped and bound                                                                                                                                                                                                                                    |
| `menu`          | none                                             | the main menu's dialog (0xE2) opened: `phase` becomes `running`                                                                                                                                                                                                |
| `mode`          | `w`, `h`                                         | the picture's size changed (the game set a display mode)                                                                                                                                                                                                       |
| `fps`           | `fps`, `ms`, and `worst`, `late`, `pub`, `pubms` | once a second: the game's own frames per second, the longest gap between two game frames (ms), how many came more than 25 ms after the one before, how many pictures were published and the mean ms to make one. The page shows them only if the overlay is on |
| `exit`          | `code`                                           | the game's entry returned                                                                                                                                                                                                                                      |
| `exitConfirm`   | `request`                                        | the main menu's Exit confirmation call was intercepted before native dialog creation; reply using `ra2_exit_confirmation_reply`                                                                                                                                |
| `open`          | `url`, `ask`, `seq`, optional `page`             | the game asked the system browser to open a WOL-era link; `url` is the game's own string, unchanged, or "" when the game named a WOL page (`page`). The page shows its link dialog instead (below)                                                              |
| `settingsSaved` | `path`                                           | the game closed or rewrote a settings file; the page flushes its waiting settings copy                                                                                                                                                                         |
| `error`         | `message`                                        | something the player should see that isn't a crash (a missing file)                                                                                                                                                                                            |

Example: `@ra2 {"e":"mode","w":1280,"h":720}`.

## Web links

The game has no embedded HTML renderer for the system-browser path: a
WOL-era link writes a probe `.html`, finds the default browser with
`FindExecutableA` and starts it with `CreateProcessA`. `run_lift.py`'s
`web_url_patches` intercepts the three routines that do it (RA2 `0x0073C580`;
YR `0x0077DC90` and `0x00551630`) at their entry, calls
`ra2_open_url(url, ask)` and returns. YR also has an embedded WOL browser:
`DoWebPageDialog` (`0x00773E90`) takes a page key (`"Ladder"`, `"Manage"`,
`"Battleclans"`, ...), reads the registry URL and wraps it in
`HTML\frame.htm`. The same lift patch intercepts it and calls
`ra2_open_wol_page(key)`, which returns before the embedded browser is
created. That path has no URL from the game: the host logs the key
(`[page] <key>`) and emits `open` with `page` set and `url` empty. The
registry is still seeded with `https://ra2web.invalid/<path>` values, but that
is only the embedded browser's fallback; it is never reported as an original
URL. On Linux the hooks only log (`[url]` / `[page]`); the Windows native32
build keeps the system browser and the embedded browser.

The page maps a URL to a `LinkTarget` (`web/src/game/link-targets.ts`):
`topic`, the original `url`, a `detail` (a support kind, a locale), `external`
(whether the original URL may be offered as an outbound link) and `embed`
(whether a configured page may be framed). A known `page` key (`Community`,
`Ladder`, `Manage`, `Battleclans`, `NetStatus`, `News`) resolves to the retail
installer's original registry URL (`src/web/wol_pages.h`, from the Windows
registry export at regfiles.net), so the event carries the real Westwood URL;
an unknown key has no URL, and the dialog names the page instead. A URL whose
host is the old `ra2web.invalid` fallback is labelled "This build's registry
target", not "The game asked for". Dead Westwood hosts are never offered
outbound. A target with
`embed` renders in a sandboxed iframe; every other one shows "The game asked
to open an external link" with the original URL. "Open in browser" is a plain
`target="_blank"` / `rel="noopener noreferrer"` anchor, and only
`http:`/`https:` URLs can become one.

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
reply returns 0; a matching reply returns 1. The page flushes settings and
saves before it replies. Stay returns 1 (Cancel/Stay) to the game and keeps
the main menu. Exit calls `hle_exit(0)` after the page's flush, skipping the
guest's save-and-teardown path; the page still receives `exit` and returns
to the launcher. The lift discards the original 20 argument bytes. Escape in
the browser is Stay, and focus returns to the canvas afterwards. Exit or
crash clears the prompt.

This is a focused game-to-web-to-game hook, not yet a general replacement
for native dialogs or the Online lobby. Protocol 5's HWND-based overlay is
superseded: the request ID is not a window handle.

## Frame-performance verification (29 October 2026)

The final current Release checks exercised protocol 8 with both YR and RA2,
using the WebGL2 presenter and the `?presenter=2d` fallback, with HD off and
on. The suite compared menu and skirmish frames and found zero different
pixels. Movie playback advanced, but no PAL8 frame was published in the capture
window, so a movie-frame pixel comparison was not made. The game's once-per-second `fps` event supplied the final
matrix and soak measurements; its fields (`fps`, `ms`, `worst`, `late`, `pub`,
`pubms`) distinguish game rate, gaps, late frames, and publication cost. The
same `RA2_WEB_PROTOCOL` value is declared in `web/src/game/protocol.ts` and
`src/web/web_api.h`.

## Versions

`protocol.ts` and `web_api.h` both carry `RA2_WEB_PROTOCOL` (an integer).
The `boot` event includes it. If the page and the loaded `ra2.wasm`
disagree (a stale cached wasm), the page says so and offers a reload,
instead of misreading events.

Protocol 9 adds the `open` event for WOL-era links. It changes no shared
memory word.
