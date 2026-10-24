# Architecture

How the native Linux build maps onto a browser. The lifted C and `win32hle`
stay what they are. What changes is underneath them: threads, the screen,
sound, files and faults.

```
┌──────────── Main thread: the page (web/, React) ──────────────────────┐
│  Import, Library, Play, Settings                                      │
│  presenter.ts: draws the shared picture on a 2D canvas, each frame    │
│  input.ts: mouse and keys in, as calls on the game's exports          │
└───────────────┬──────────────────────────────────────────▲───────────┘
   input ring, ra2_* calls            picture, cursor (shared memory)
                                       events (protocol.md)
┌───────────────▼─────────── Game thread (pthread) ─────────┴───────────┐
│  main() in src/web/main.c                                             │
│  lifted C ─► win32hle ─► presenter.c (RGBA frame, cursor, input ring)  │
│  files: the file system (/game, later OPFS; /save read-write)         │
│  more pthreads: the game's CreateThread, multimedia timers, script    │
└───────────────┬──────────────────────────────────────────────────────┘
   shared memory (SharedArrayBuffer), ring buffer
┌───────────────▼─────────── Audio worklet ─────────────────────────────┐
│  Wasm Audio Worklet: reads the mixed ring, writes to the speakers     │
└──────────────────────────────────────────────────────────────────────┘
┌──────────── Service worker ──────────────────────────────────────────┐
│  COOP/COEP headers, offline cache of the page and ra2.wasm            │
└──────────────────────────────────────────────────────────────────────┘
```

## Threads and the main loop

The game runs its own loop and never returns to the browser. With
`-sPROXY_TO_PTHREAD`, Emscripten runs `main()` on a pthread, not the
browser's main thread, so the game can block (in `GetMessageA`, `Sleep`, a
frame wait) exactly as on Linux, and the page stays responsive.

`win32hle` already uses real threads: `CreateThread` in `kernel32_crt.c`,
multimedia timers in `winmm.c`, and the script thread in `src/linux/script.c`.
All of them become Emscripten pthreads (Web Workers sharing the wasm memory).
Size the pool upfront with `-sPTHREAD_POOL_SIZE`, because a pthread created
while the main thread is busy waits for a new worker to start.

The machine lock (`mach_enter`) works unchanged. Atomics and futexes are
real in wasm with shared memory.

The fallback is Asyncify: the game on the main thread, yielding to the
browser in `PeekMessageA`, `GetMessageA` and `Sleep`. It instruments every
function that can reach a yield, which for the lifted code is most of them,
so it is the last resort, not the plan ([decisions.md](decisions.md), D4).

## Rendering

The game thread never touches a canvas. `win32hle/screen.c` runs headless (no
SDL window): it builds each frame from the game's primary surface and calls
`hle_screen_frame_hook`. `src/web/presenter.c` is that hook. It converts the
frame (RGB565, 8-bit with a palette, or 32-bit) to RGBA in one of two buffers
in shared memory and publishes it in `ra2_shared_t` (picture pointer, size, a
sequence number; [protocol.md](protocol.md)). The page's `presenter.ts` reads
the struct once per animation frame and, when the sequence moved, copies the
pixels into an `ImageData` and draws them on a 2D canvas. The canvas is the
picture's size, and CSS fits it to the window (`object-fit: contain`), so a
resize costs the game nothing and the bars are the page's.

Why not SDL's renderer, as on Linux ([decisions.md](decisions.md), D10): the
game's loop never returns to the browser, and a GL context made on that thread
never presents (an OffscreenCanvas commits when its thread yields), or, with
`OFFSCREEN_FRAMEBUFFER`, needs a context shared between threads that SDL does
not set up. Both were tried in a small program first.

What the Linux presenter does that is not here yet: its scaling modes (sharp,
smooth, CRT: F12), the blurred bars, the HD-vehicle layer's 2x picture. The
page scales with the browser's own filter. They come back as page settings
(stage 9).

The menu cursor: in the menus the game uses the Windows cursor from its
resources, and in a battle it draws its own. `presenter.c` turns the cursor
image (32x32, AND and XOR masks) into RGBA and the page makes a CSS cursor
from it, or hides the system one when the game draws its own.

## Input

The page listens, not SDL. `input.ts` takes the canvas's mouse events and the
window's key events, maps the pointer into the picture's own pixels (allowing
for the letterbox) and the key to a Windows virtual key and scan code, and
calls `ra2_input_pointer` and `ra2_input_key` on the main thread. Those push
into a ring (one producer, one consumer) that the game thread empties in its
pump hook and turns into window messages with `hle_input_mouse` and
`hle_input_key`, as `screen.c` does for SDL's events on Linux. Two things are
browser-only:

- **Keys the browser keeps.** F5, F11, Ctrl+W, Ctrl+T and Esc (in
  fullscreen) don't reach a page by default. In fullscreen, the page calls
  `navigator.keyboard.lock()` (Chromium) so they do. Outside fullscreen, F5
  and F11 are `preventDefault`ed on the canvas, and Ctrl+W is left alone.
- **Edge scrolling.** The game scrolls when the cursor is at the edge. In a
  window, the cursor leaves the canvas instead. The Play screen offers
  Pointer Lock. When it's locked, the page draws no cursor and the game
  draws its own, as it does fullscreen on Windows.

## Sound

`win32hle/dsound.c` mixes the game's DirectSound buffers in SDL's audio
callback. In the browser, SDL's audio runs on the main thread through a
deprecated ScriptProcessorNode, and calling into the mixer from there would
mean the main thread waiting on the game's locks.

Instead, a mixer thread of the game's own calls the same `mix()` and writes
into a lock-free ring buffer in shared memory (`hle_audio_ring_t`, in
`win32hle.h`: 16384 frames of 16-bit stereo at 44.1 kHz, and the read and
write counts). This is a small backend in `dsound.c` under `__EMSCRIPTEN__`;
SDL's audio is not opened. The mixer wakes every 5 ms and keeps about 90 ms queued; each time the worklet
reports an underrun it keeps 46 ms more, up to 280 ms, because a short sleep,
or a busy machine, can hold a thread for longer than that in a browser.

The page's end is `public/audio-worklet.js`, an ordinary audio worklet in
JavaScript, not the Emscripten one: it reads the ring through the wasm memory,
which is a `SharedArrayBuffer`, with `Atomics`, and needs nothing else from
the game. It takes 128 frames a quantum and counts the quanta that found the
ring short (`underruns`). `src/game/audio.ts` makes an `AudioContext` at
44100 Hz (so nothing is resampled) and the worklet.

Browsers start audio only after a user gesture. While the context is held the
page shows "Click to start sound", and the first key or click resumes it.
Until the ring is `live` the mixer keeps real time on its own clock and drops
what it mixes, so the game's sound buffers' play cursors move and nothing in the
game waits for the page.

## Movies

Bink goes through ffmpeg (`HLE_WITH_FFMPEG`, `win32hle/bink.c`), decoded in the
game's own wasm as the game asks for frames: it opens a movie by name or by a
handle positioned inside an archive (`ra2md.mix` holds the menu's), and takes one
frame at a time. Converting the movies to another format when the game is
imported would need the same decoder, would lose their sound in a picture format,
and would multiply their size, so nothing is converted.

The browser build compiles only what the movies need, from the FFmpeg source
(`../ffmpeg-src`, not in the repository): the `bink` video decoder, the
`binkaudio_dct` and `binkaudio_rdft` decoders, the `bink` demuxer and the `file`
protocol, with libavutil and libswresample. That is 173 files, about 0.8 MB of
`ra2.wasm`, all LGPL. `tools/build-ffmpeg-web.sh` (`.cmd` on Windows) runs FFmpeg's
`configure` with emcc and `tools/ffmpeg-web.mjs` turns the Makefiles' object lists
into `ffmpeg_sources.cmake`, since there is no GNU make on the Windows machine this
is built on; `CMakeLists.txt` compiles that list into a static library and defines
`HLE_WITH_FFMPEG`. The movie's sound goes to the same mixer as the game's
(`hle_audio_stream_*`, so through the ring above).

Without `../ffmpeg-src/build` the build defines `HLE_BINK_SKIP` for `bink.c` instead:
`BinkOpen` returns a movie of two empty frames at 15 fps, so each movie plays for a
tenth of a second drawing nothing, and the main menu's looping movie loops at a steady
rate. Making `BinkOpen` fail is not enough: the game goes on with the null
handle it got, reads the frame count from address 0 (readable zeros in wasm,
a crash elsewhere) and loops forever without pumping messages.

## Files

WasmFS with its OPFS backend. The game sees `C:\` (from
`hle_set_drive('C', ...)`) mapped to `/game`, which is filled by the import
([storage.md](storage.md)). Writes the game makes (saves, `RA2MD.INI`,
`DEBUG.LOG`) go to the same tree. OPFS sync access handles are available
only off the main thread, and the game thread is off it.

## Faults

Linux catches a guest fault with `sigaction` on an alternate stack and prints
the lifted function and the recent indirect calls (`g_cur_func`,
`g_icall_trace`). Wasm has no signals. A bad access is either a trap (out of
bounds, unreachable, a bad indirect call) or, below the top of memory, no
fault at all.

- A trap becomes a JS exception that ends the game thread. Emscripten's
  `onAbort` runs on the main thread, and the page calls an exported
  `ra2_crash_report()` that formats `g_cur_func` and the indirect-call ring
  from shared memory, which outlives the thread.
- `src/web/pre.js` does this: on the main thread (under Node, `uncaughtException`;
  in a page, `window.onerror`) it calls `ra2_crash_report`. A worker's exception
  reaches the main thread, so only the main thread installs the handler.
  `--trap N` forces one, to see it ([testing.md](testing.md)).
- The page shows the report with a "copy" button, like the Linux log.
- Accesses to low memory (address 0 and up) don't fault in wasm. The game's
  own null checks still work, but a lift bug that faults on Windows reads
  zeros here. The Windows suite stays the reference for lift bugs.

## Networking (later)

`win32hle/wsock32.c` emulates IPX over UDP on native hosts. Browsers have no
UDP, so the web build bridges IPX datagrams to one unreliable, unordered
WebRTC data channel. W12 pairs two browser clients by manually exchanging
their SDP offer and answer; a broadcast reaches the one connected peer. The
game's IPX lobby and lockstep protocol are unchanged. W12 does not use STUN,
TURN, or a signaling service, and is limited to LAN ICE connectivity; see
[D13](decisions.md#d13-browser-lan-play-one-peer-over-webrtc-manual-sdp-exchange).

Internet multiplayer is a separate layer in [plan.md](plan.md), stage 13.
[D12](decisions.md#d12-preserve-the-in-game-wol-menu-with-a-browser-side-compatibility-layer)
selects the sibling RA2Web server as the first browser-oriented WOL-style
service target. The game still needs a WOLAPI adapter, and its existing gserv
turn-action relay is not known to carry the original game's WOL Internet
packets. WOL online play is distinct from the LAN IPX path: historical RA2
material describes WOL as matchmaking followed by direct host/player
communication over UDP. Trace the title-specific Internet socket and packet
path before choosing a browser transport. PvPGN-PRO is a reference for legacy
WOL behavior and ladder scoring. The original Westwood Online servers are not
assumed to be available.

## What doesn't come over

| Linux host feature | In the browser |
|---|---|
| `--record` (ffmpeg through `popen`) | `MediaRecorder` on the canvas from the page, later |
| `--watchdog` | not in the web host. `--heartbeat S` prints the machine lock's state from a non-guest thread; tests time out from outside |
| `--dump-frames` | the test hook reads the canvas ([testing.md](testing.md)) |
| `ra2.ini` next to the exe | IndexedDB ([storage.md](storage.md)) |
| `--args FILE`, the command line | URL query parameters, passed as `Module.arguments` |
