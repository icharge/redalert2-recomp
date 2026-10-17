# Architecture

How the native Linux build maps onto a browser. The lifted C and `win32hle`
stay what they are. What changes is underneath them: threads, the screen,
sound, files and faults.

```
┌──────────── Main thread: the page (web/, React) ──────────────────────┐
│  Import, Library, Play, Settings                                      │
│  ra2.js (Emscripten's loader): starts the game thread, proxies the    │
│  calls that must run here (DOM events, canvas transfer)               │
└───────────────┬──────────────────────────────────────────▲───────────┘
   canvas transferred (OffscreenCanvas)       events (protocol.md)
┌───────────────▼─────────── Game thread (pthread) ─────────┴───────────┐
│  main() in src/web/main.c                                             │
│  lifted C ─► win32hle ─► SDL2 (Emscripten port) ─► WebGL2              │
│  files: WasmFS, OPFS backend (/game read-only, /save read-write)      │
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

`win32hle/screen.c` draws with `SDL_Renderer`. It uploads the game's
surface to a streaming texture, prescales it for sharp-bilinear, and draws
it letterboxed. Emscripten's SDL2 renders that through WebGL. Nothing in
`screen.c` needs to know it's in a browser, apart from these points:

- The canvas is transferred to the game thread (`-sOFFSCREENCANVAS_SUPPORT`)
  so SDL's GL context lives where the game draws. If a browser can't do
  that, `-sOFFSCREEN_FRAMEBUFFER` draws on the game thread and presents on
  the main one, at the cost of a copy.
- `SDL_RENDERER_PRESENTVSYNC` maps to `requestAnimationFrame` timing on the
  main thread. The game paces itself, so present without vsync and let the
  browser composite.
- Fullscreen and window size come from the page (Fullscreen API, a
  `ResizeObserver` on the canvas), not from SDL's window calls. The page
  tells the game the new size ([protocol.md](protocol.md)).

## Input

SDL's Emscripten port listens for DOM events on the canvas and queues SDL
events, and `win32hle` turns those into window messages, as on Linux. Two
things are browser-only:

- **Keys the browser keeps.** F5, F11, Ctrl+W, Ctrl+T and Esc (in
  fullscreen) don't reach a page by default. In fullscreen, the page calls
  `navigator.keyboard.lock()` (Chromium) so they do. Outside fullscreen, F5
  and F11 are `preventDefault`ed on the canvas, and Ctrl+W is left alone.
- **Edge scrolling.** The game scrolls when the cursor is at the edge. In a
  window, the cursor leaves the canvas instead. The Play screen offers
  Pointer Lock. When it's locked, the page draws no cursor and the game
  draws its own, as it does fullscreen on Windows.

If SDL's event path doesn't work with the game on a pthread, the page
forwards events itself ([protocol.md](protocol.md), `input` messages) into
`win32hle`'s input queue.

## Sound

`win32hle/dsound.c` mixes the game's DirectSound buffers in SDL's audio
callback. In the browser, SDL's audio runs on the main thread through a
deprecated ScriptProcessorNode, and calling into the mixer from there would
mean the main thread waiting on the game's locks.

Instead, the mixer runs on the game side and writes into a lock-free ring
buffer in shared memory. A Wasm Audio Worklet (`-sAUDIO_WORKLET
-sWASM_WORKERS`) reads the ring on the audio thread. This is a small backend
in `dsound.c` under `__EMSCRIPTEN__`, with the same mixer.

Browsers start audio only after a user gesture. The Play screen resumes the
`AudioContext` on the first click or key. Until then the game runs silently,
and the ring drops what isn't read.

## Movies

Bink goes through ffmpeg (`HLE_WITH_FFMPEG`, `win32hle/bink.c`). For the
browser, build ffmpeg's `bink` and `binkaudio` decoders alone with emcc, with
no demuxers or encoders beyond what `bink.c` uses. Until that's done, build
without `HLE_WITH_FFMPEG`, and the game skips its movies as it does when the
files are missing.

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
- The page shows the report with a "copy" button, like the Linux log.
- Accesses to low memory (address 0 and up) don't fault in wasm. The game's
  own null checks still work, but a lift bug that faults on Windows reads
  zeros here. The Windows suite stays the reference for lift bugs.

## Networking (later)

`win32hle/wsock32.c` emulates IPX over UDP. Browsers have no UDP. The plan,
if multiplayer is worth doing: replace the UDP socket with a WebRTC data
channel (unreliable, unordered, which is what IPX was), with a small
signalling server to pair two tabs. The game's lockstep protocol is
unchanged.

## What doesn't come over

| Linux host feature | In the browser |
|---|---|
| `--record` (ffmpeg through `popen`) | `MediaRecorder` on the canvas from the page, later |
| `--watchdog` | the page's own timer, for tests only |
| `--dump-frames` | the test hook reads the canvas ([testing.md](testing.md)) |
| `ra2.ini` next to the exe | IndexedDB ([storage.md](storage.md)) |
| `--args FILE`, the command line | URL query parameters, passed as `Module.arguments` |
