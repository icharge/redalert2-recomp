# The browser port (plan)

The goal is the game in a browser tab: the same lifted C, compiled to
WebAssembly with Emscripten, and played from the player's own install. Nothing
on this page is built yet. It is the plan, in the order the work is meant to
be done, and each stage is finished when its check passes.

## Starting point

The browser port starts from the native Linux build, not the Windows one.

- `build-linux/ra2` already runs the lifted C on pcrecomp's `runtime/win32hle`
  with no Windows underneath. It uses SDL2 for the window, input and sound,
  and ffmpeg for Bink. Emscripten ships SDL2 as a port.
- The Windows host (`runtime/native32`, `host.c`, `present.c`) is MSVC inline
  assembly and Direct3D 11. None of it carries over.
- The guest is a 32-bit program, and wasm32 pointers are also 32 bits, so
  `RECOMP_FLAT_MEMORY` (a guest address is a host address) can stay.

## Hard problems, ranked by risk

### 1. The guest's address space (highest risk)

`win32hle` `mmap`s `gamemd.exe` at its own base (0x00400000) in
`pe_loader.c`, and `kernel32.c` implements `VirtualAlloc` reservations as
`mmap` at fixed addresses. Wasm has a single linear memory starting at 0 and
no fixed-address `mmap`.

There are two ways to handle it.

- **A. Flat, with a reserved low range (preferred).** Link with
  `-sGLOBAL_BASE` set high (for example 0x40000000), so Emscripten's data,
  stack and heap sit above the guest. The low 1 GB of linear memory becomes
  the guest's address space. In that range, `pe_loader` copies the image
  sections to their virtual addresses, and `VirtualAlloc` is a page-granular
  allocator over a bitmap. `RECOMP_FLAT_MEMORY` and the lifted C stay
  unchanged. The cost is starting with a large `INITIAL_MEMORY` (or
  `ALLOW_MEMORY_GROWTH` plus an upfront grow), which browsers allow up to
  4 GB with `MAXIMUM_MEMORY`.
- **B. Offset memory.** Drop `RECOMP_FLAT_MEMORY`, so that `ADDR(va)` adds
  `g_mem_base` (dos32 and nextstep already work this way). This is more
  invasive: every guest pointer that `win32hle` turns into a host pointer
  needs the offset too, and every access in the generated C reloads a global.

Check: a wasm build of `pe_loader_selftest.c` and `kernel32_ext_selftest.c`
passes under Node.

### 2. A main loop that never returns

The game runs its own message loop and frame loop, but a browser tab must
return to the event loop every frame. There are two options.

- **Asyncify.** `emscripten_sleep(0)` inside `PeekMessageA` / `GetMessageA`
  and the frame wait. This is the least code, but Asyncify instruments every
  function that can reach a yield, and with 24,954 lifted functions that
  could double the binary and slow it a lot. To limit that, measure with
  `ASYNCIFY_ONLY` / `ASYNCIFY_REMOVE` lists built from the call graph (the
  lift knows it).
- **A Web Worker (preferred if Asyncify is too slow).** The game runs
  unchanged on a worker thread, which may block. It draws to an
  `OffscreenCanvas`, while the page forwards input and owns audio. This needs
  pthreads (next problem), which we need anyway.

Check: the game reaches its main menu with either option, and frame time is
measured for both.

### 3. Threads

`win32hle` creates real threads for `CreateThread` (`kernel32_crt.c`) and for
multimedia timers (`winmm.c`). The sound thread already caused a bug once
(bringup.md: "loops that never let the sound thread run"). Emscripten
pthreads need `SharedArrayBuffer`, so the page must be served with
`Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp`. That works on any static host
that sets headers. GitHub Pages does not set them, so it needs a
`coi-serviceworker`.

Check: a skirmish runs for 5 minutes with sound and no deadlock.

### 4. Build size and time

The lift is about 270 MB of C per game, in 67 files of 400 functions each.
Expect a wasm binary in the tens of MB, and long compiles with wasm-ld using
a lot of memory.

- Build one game at a time, Yuri's Revenge first.
- Use `-O2` for the generated C (as on Linux), with `-sWASM_BIGINT` and no
  LTO at first.
- Serve the `.wasm` brotli-compressed, with `WebAssembly.instantiateStreaming`
  so it compiles while it downloads.

Check: a clean build finishes, and the size of the `.wasm` before and after
compression is recorded on this page.

## The rest

| Area | Linux has | Web plan |
|---|---|---|
| Display | SDL2 window, `win32hle/present.c` | SDL2 on WebGL through Emscripten's port: the 8-bit surface plus the palette, uploaded as a texture, with scaling in a shader (the presenter's sharp-bilinear first) |
| Input | SDL2 events | Same, plus Pointer Lock for edge scrolling in fullscreen, and a mapping for browser-reserved keys (F5, F11, Ctrl+W) |
| Sound | SDL2 audio, `win32hle/dsound.c` | Same, through Emscripten's WebAudio backend. Audio starts only after the first click (browser autoplay rule) |
| Movies | ffmpeg (`HLE_WITH_FFMPEG`) | First, no movies (skip the intro). Later, ffmpeg's Bink decoder alone, built for wasm |
| Files | the game folder on disk | The player picks their install folder with the File System Access API on Chromium, or drags it in. Files are copied into OPFS (browser origin-private storage) once and mounted with WasmFS's OPFS backend. Nothing from the game is ever served by us |
| Saves, `RA2MD.INI` | the game folder | OPFS, so they persist per browser |
| Fonts (SDL2_ttf) | system package | Emscripten's SDL2_ttf port |
| Blowfish (`src/linux/blowfish.c`) | built in | Unchanged |
| Mods | `mods/` | Second folder pick, later |
| LAN | IPX emulation over UDP | Out of scope at first. Later, a WebSocket relay or WebRTC data channels in place of the UDP socket |

## Web architecture

The page is a React app that hosts the game but does not run it. The game
runs in a dedicated worker and draws to a canvas the page handed over, so it
can block in its own loop without freezing the tab. That is the worker
option in problem 2. Asyncify is the fallback if the worker hits a blocker.

```
┌──────────── Main thread: React app (web/) ────────────────────────────┐
│  Screens: import, library, play, settings overlay                     │
│  Input:   pointer, keyboard, wheel  ──postMessage──────────┐          │
│  Audio:   AudioContext + AudioWorklet ◄── SharedArrayBuffer ring ──┐  │
└──────────────────────────────────────────────────────────────────┬─┘
   canvas.transferControlToOffscreen()                            │
┌──────────── Game worker ─────────────────────────────────────────▼───┐
│  ra2.wasm: lifted C + win32hle + SDL2                                │
│  OffscreenCanvas, WebGL2: palette to RGBA, scaling shader            │
│  WasmFS on OPFS: /game (read-only), /save (read-write)               │
└──────────────────────────────────────────────────────────────────────┘
┌──────────── Service worker ──────────────────────────────────────────┐
│  adds COOP/COEP (threads need them on any static host)               │
│  caches ra2.wasm and the page: runs offline, installable (PWA)       │
└──────────────────────────────────────────────────────────────────────┘
```

### Stack

| Concern | Choice |
|---|---|
| Language | TypeScript, strict |
| UI | React 18 and Radix: Radix Themes for the look, Radix Primitives (Dialog, DropdownMenu, Slider, Tabs, Toast, Progress) where Themes has no component |
| Icons | Radix Icons |
| Styling | Radix Themes tokens, with CSS Modules for our own components. No Tailwind |
| State | React state, plus one small store for the worker's messages read with `useSyncExternalStore`. A state library only if this outgrows it |
| Build | Vite with `vite-plugin-pwa`. The dev server sends COOP/COEP |
| Page–worker link | One typed message union (`web/src/protocol.ts`), shared by both sides |
| Game thread | Dedicated Web Worker, OffscreenCanvas, WebGL2 through SDL2 |
| Audio | AudioWorklet reading a SharedArrayBuffer ring that the game's SDL audio callback fills |
| Files in | `showDirectoryPicker` on Chromium, a dropped folder elsewhere |
| Storage | OPFS for the asset copy and saves, IndexedDB for settings and the import manifest |
| Input extras | Pointer Lock, Fullscreen API, `navigator.keyboard.lock()` so F-keys and Esc reach the game |
| Tests | Vitest for the page, Playwright for the game through the script hook |
| Hosting | Any static host. The service worker supplies the headers |

### Screens

- **Import.** Pick or drop the install folder. Check that `gamemd.exe` /
  `game.exe` and the `.mix` files are there. Copy them into OPFS with a
  progress bar. This is resumable, and the manifest in IndexedDB says what is
  already copied.
- **Library.** Red Alert 2 and Yuri's Revenge, whichever the import found.
  Shows storage use and offers "remove from this browser".
- **Play.** The canvas, full window. A thin bar shows until the first click,
  because audio may only start after a user gesture.
- **Settings overlay** (Radix Dialog). Only the things that belong to the
  browser: fullscreen, pointer lock, volume, storage. Game settings stay in
  the game's own F10 menu, so there is a single copy of each.

### Rules

- React never re-renders per frame. The canvas belongs to the worker, and
  the page only hears about state changes (loading, running, crashed).
- Nothing from the game is fetched from our host or sent anywhere. It goes
  from the player's disk to the player's OPFS.
- The page works without the game loaded, so the import and library screens
  can be built and tested before stage 3.

### Layout

```
web/
  index.html
  vite.config.ts
  src/
    main.tsx, App.tsx
    protocol.ts          messages between the page and the worker
    screens/             Import, Library, Play
    components/          SettingsDialog, StorageMeter, ...
    game/
      worker.ts          loads ra2.wasm, mounts OPFS, starts the game
      audio-worklet.ts
      input.ts           DOM events to protocol messages
    storage/             OPFS copy, manifest
  public/                ra2.wasm, ra2.js (from build-web.sh)
```

## Stages

1. **Toolchain.** Add `cmake/emscripten.cmake` and an `EMSCRIPTEN` branch in
   `CMakeLists.txt` beside the Linux one, plus `build-web.sh`. Done when one
   generated file (`recomp_0000.c`) and all of `win32hle` compile with
   `emcc`, and the list of errors is written here.
2. **Memory.** Option A above, in pcrecomp: a `HLE_WASM` path in
   `pe_loader.c` and `kernel32.c`. Done when the selftests pass under Node.
3. **Headless boot.** Link the whole game with no SDL video or audio, the
   files preloaded into MEMFS from a local copy, and run it in Node or a page
   with a hidden canvas. Done when the log reaches the main menu, the same
   milestones as `conformance.json`.
4. **The page.** Scaffold `web/` (Vite, React, TypeScript, Radix Themes) with
   the Play screen, the game worker and input forwarding. Done when the
   main menu is visible in the page and a skirmish can be started by
   clicking.
5. **The main loop.** Confirm that the worker holds a steady frame rate. Fall
   back to Asyncify only if it does not.
6. **Files.** The Import and Library screens, the OPFS copy, saves, and the
   service worker (COOP/COEP, offline). Done when a fresh browser profile
   goes from "pick your folder" to the main menu, and a save survives a
   reload.
7. **Sound.** Done when a skirmish has sound for 5 minutes with no deadlock.
8. **Movies.** Bink through ffmpeg in wasm.
9. **Remaster features.** Resolution picker, HD vehicles, modern controls,
   settings menu. These are game-side and should mostly carry over. Check
   frame time with HD vehicles on.
10. **Red Alert 2.** The second target (`RA2_TARGET=game`).
11. **Multiplayer**, if it is worth it.

## Things to decide along the way

- **Browsers.** Chromium first (File System Access, OPFS, threads). Firefox
  and Safari get drag and drop instead of the folder picker, and are tested
  once stage 6 works.
- **Testing.** `tools/playtest.py` drives the game by button name through its
  script hook (`src/linux/script.c`). If the wasm build exposes the same hook
  to the page, Playwright can run the same suite in a headless browser.

## Risks

- **Speed.** The lifted C emulates flags and spills registers around every
  call, and wasm is roughly 1.5 to 2 times slower than native. 800x600
  should be fine. 4K and HD vehicles may not be.
- **Asyncify cost**, if the worker route fails.
- **Memory.** 1 GB of reserved guest space, plus the game's heap, plus the
  OPFS copy of 2.6 GB of assets on the player's disk.
