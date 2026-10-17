# The browser port: plan

The work is done in stages, in this order. Each stage is finished when its
check passes, and the check goes in the suite or on these pages. Stages 4 and
6 (the page) don't need the game to boot, so they can run in parallel with
stages 1 to 3.

| # | Stage | Done when | Pages |
|---|---|---|---|
| 1 | **Toolchain** | `recomp_0000.c` and all of `win32hle` compile with `emcc`; the errors left are listed in [toolchain.md](toolchain.md) | toolchain |
| 2 | **Memory** | `pe_loader_selftest` and `kernel32_ext_selftest` pass as wasm under Node | memory |
| 3 | **Headless boot** | the whole game links; under Node with the files in MEMFS, the log reaches the main menu (the boot milestones in `conformance.json`) | toolchain, testing |
| 4 | **The page** | `web/` scaffolded; the Play screen shows the main menu, and a skirmish starts by clicking | frontend, protocol |
| 5 | **The main loop** | a skirmish holds a steady frame rate with the game on its own thread. Asyncify only if this fails | architecture |
| 6 | **Files** | Import and Library screens, OPFS, saves, the service worker; a fresh browser profile goes from "pick your folder" to the main menu, and a save survives a reload | storage, deploy |
| 7 | **Sound** | a skirmish has sound for 5 minutes with no deadlock or underrun | architecture |
| 8 | **Movies** | the intro plays: Bink through ffmpeg built for wasm | architecture |
| 9 | **Remaster features** | resolution picker, HD vehicles, modern controls, mods; frame time with HD vehicles on is recorded | architecture |
| 10 | **The suite in a browser** | `tools/playtest.py --web` passes the `menu-*`, `back-*`, `sp-*` and `skirmish-*` cases | testing |
| 11 | **Red Alert 2** | `RA2_TARGET=game` builds and passes the same cases | toolchain |
| 12 | **Multiplayer** (optional) | two tabs play a LAN-style match over WebRTC | architecture |

## Stage 1: toolchain

- Install emsdk, pinned to one version (see [toolchain.md](toolchain.md)).
- Add `cmake/emscripten.cmake` and an `EMSCRIPTEN` branch in
  `CMakeLists.txt` beside the Linux one. Add `build-web.sh` and
  `build-web.cmd`.
- Compile one generated file, then `win32hle`, then `src/linux/*.c` as the
  starting point for `src/web/`. List each kind of error once.
- Expected: `sigaction` and `sigaltstack` (no signals in wasm), `mmap` at
  fixed addresses, `MAP_FIXED_NOREPLACE`, `madvise`, BSD sockets for UDP,
  `popen` for the ffmpeg recorder.

## Stage 2: memory

The pcrecomp change in [memory.md](memory.md): an `__EMSCRIPTEN__` path in
`pe_loader.c` and `kernel32.c`. Small and testable alone, which is why it
comes before linking the whole game.

## Stage 3: headless boot

`src/web/main.c`, a copy of `src/linux/main.c` without the signal handlers,
the recorder and the watchdog thread. Linked with `-sPROXY_TO_PTHREAD` and
SDL's dummy video and audio drivers. Run under Node with `--game` pointing at
a NODEFS mount of the local `game/` folder. Faults show up as wasm traps;
[architecture.md](architecture.md) covers how to report them.

## Stage 4: the page

Scaffold `web/` per [frontend.md](frontend.md). The Play screen loads
`ra2.js`, hands over the canvas, and forwards input. During development the
files come from a dev-only "load from a local folder" path, so stage 4 does
not wait for stage 6.

## Stage 5: the main loop

The game's own loop runs on an Emscripten pthread (`PROXY_TO_PTHREAD`), so it
may block. Measure frame time in a skirmish at 800x600 and 1080p. If SDL's
event or GL path doesn't work from a pthread, the fallbacks in order are:
`OFFSCREEN_FRAMEBUFFER`, then our own input path ([protocol.md](protocol.md)),
then Asyncify.

## Stage 6: files

[storage.md](storage.md) in full: the folder picker, the allowlist and the PE
stamp check, the copy into OPFS, the manifest, saves. Then the service worker
from [deploy.md](deploy.md).

## Stage 7: sound

`win32hle/dsound.c` mixes into SDL's audio callback. In the browser this
moves to a Wasm Audio Worklet ([architecture.md](architecture.md)). The check
is 5 minutes of skirmish, because the earlier sound-thread bug
(bringup.md, "loops that never let the sound thread run") only showed up
over time.

## Stages 8 to 12

Movies, then the remaster features, which are game-side and should carry
over. Then the suite in a browser, Red Alert 2, and multiplayer if it is
worth it.

## Risks

| Risk | What it would cost | What we would do |
|---|---|---|
| SDL2's GL or event path doesn't work from a pthread | the main-loop design | the fallbacks in stage 5 |
| Speed: flag emulation and register spills, plus wasm's 1.5 to 2 times slowdown | 4K and HD vehicles may be too slow | lower defaults in the browser; profile the hot lifted functions; `-O3` on the hottest files |
| Binary size: about 270 MB of C per game | a long first load | brotli, streaming compilation, cached by the service worker |
| wasm-ld memory and time for 24,954 functions | slow builds | no LTO; split debug info; build one game at a time |
| Browser limits on a single function (V8: about 7.6 MB of code, 50,000 locals) | a function that won't compile | the largest lifted function is about 16,700 lines (`sub_00618C58`); measure in stage 3 and split if needed |
| A null-pointer read in the game doesn't fault in wasm, it reads zeros | a lift bug that faults on Windows hides | the playtest suite on Windows stays the reference |
| Safari and Firefox lack the folder picker, or have smaller storage quotas | fewer browsers | drag and drop; a quota check before import ([storage.md](storage.md)) |
