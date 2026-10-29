# Toolchain

## What it needs

| Tool               | Version                                              | Why                                                     |
| ------------------ | ---------------------------------------------------- | ------------------------------------------------------- |
| emsdk (Emscripten) | 6.0.12, pinned in `build-web.sh` and `build-web.cmd` | `emcc`, wasm-ld, the SDL2 ports, WasmFS, audio worklets |
| CMake and Ninja    | as for the other builds                              | the same `CMakeLists.txt`                               |
| Python 3.10+       | as for the other builds                              | the lift (`run_lift.py`)                                |
| Node.js            | 20 or later                                          | the headless runs in stage 3, and the page's build      |
| pnpm               | 9 or later                                           | the page's packages (`web/`)                            |

## FFmpeg, for the movies

The Bink decoder is FFmpeg's, built with the same emcc (stage 8). The source goes beside the repository:
download `ffmpeg-7.1.1.tar.xz` from https://ffmpeg.org/releases/ (11 MB) and unpack it into `../ffmpeg-src`,
then run `tools/build-ffmpeg-web.sh` (`tools\build-ffmpeg-web.cmd` on Windows, which needs Git for Windows' `sh`).
It writes `../ffmpeg-src/build`, and the next `build-web` picks it up (`-DFFMPEG_WEB_DIR=<dir>` names
another). Without it the build still works, and movies are skipped.

## Installing it

emsdk is a sibling checkout, as `pcrecomp` is (`build-web.sh` finds it through
`$EMSDK`, else `../emsdk`):

```
git clone https://github.com/emscripten-core/emsdk.git ../emsdk
cd ../emsdk && ./emsdk install 6.0.12 && ./emsdk activate 6.0.12
```

On Windows, call `python emsdk.py ...` (or `emsdk.bat`) rather than the `emsdk`
shell script, which finds the Microsoft Store's `python3` shim first. CMake
and Ninja come from the system (`winget install Kitware.CMake`); emsdk's
own CMake is a release candidate. `build-web.cmd` puts CMake on the `PATH`.

The lift is the same as for Windows and Linux. `src/recomp/gen/` from
`run_lift.py --all` is what emcc compiles. `setup.sh` and `Setup.cmd` gain a
`--web` step later, once the build works by hand.

## Files

| File                                                        | What it is                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cmake/emscripten.cmake`                                    | toolchain file: wraps emsdk's `Emscripten.cmake` and sets the flags below                                                                                                                                                                                                          |
| `CMakeLists.txt`                                            | an `if(EMSCRIPTEN)` branch beside the Linux one: `src/web/*.c`, `win32hle`, the generated C                                                                                                                                                                                        |
| `build-web.sh`, `build-web.cmd`                             | configure and build into `build-web/` (Yuri's Revenge) or `build-web-game/` (Red Alert 2); copy both edition-specific module sets into the flat `web/public/game/` directory and update the shared `build.json` (post-build steps in `CMakeLists.txt`; `WEB_OUT` changes the root) |
| `tools/build-ffmpeg-web.sh`, `.cmd`, `tools/ffmpeg-web.mjs` | configure FFmpeg for the Bink decoder and list the files to compile (no GNU make here)                                                                                                                                                                                             |
| `src/web/main.c`                                            | the browser host: `src/linux/main.c` without signals, `popen` or the watchdog, plus the exported functions in [protocol.md](protocol.md)                                                                                                                                           |

Build Yuri's Revenge with the default target. To build the separate Red Alert 2
module as well, run `RA2_TARGET=game ./build-web.sh` on Linux/macOS, or set
`RA2_TARGET=game` and run `build-web.cmd` from Command Prompt on Windows. Each
target has its own CMake directory and lifted sources (`src/recomp/gen/` for
Yuri's Revenge, `src/recomp/gen_game/` for Red Alert 2); building one does not
replace the other. The page loads the matching module for each imported game.

After linking, CMake copies `ra2.js/.wasm/.data` for Red Alert 2 and
`ra2md.js/.wasm/.data` for Yuri's Revenge into `web/public/game/`. It runs
`tools/compress-wasm.mjs` to add matching Brotli quality 9 and gzip level 9
sidecars. The loader selects the edition-specific JS and maps its Wasm/data
requests to the matching names. `build.json` hashes the original, uncompressed
files. These generated game files stay in the ignored local build output and
must not be copied into a public deployment.

## Compile flags

Same as Linux for the generated C: `-w -O2 -fno-strict-aliasing -fwrapv`,
and `RECOMP_RETADDR=0u RECOMP_FLAT_MEMORY RECOMP_LOCAL_REGS`. Plus:

| Flag                                              | Why                                                                                                                                                        |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-pthread`                                        | shared memory, so the game's threads work                                                                                                                  |
| `-sSUPPORT_LONGJMP=wasm` with `-fwasm-exceptions` | `recomp_types.h` uses `setjmp` for the game's exception frames and for `setjmp` returns. Wasm's own exception handling is much faster than the JS fallback |
| `-msimd128`                                       | lets clang vectorise the `memcpy`/`memset` loops and the HD voxel code                                                                                     |

## Link flags

As `CMakeLists.txt` has them for the web build, and why:

| Flag                                                                                  | Why                                                                                                                                                              |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-pthread -sPROXY_TO_PTHREAD`                                                         | `main()` on a pthread, so the game may block ([architecture.md](architecture.md))                                                                                |
| `-sPTHREAD_POOL_SIZE=8`                                                               | workers made at startup: the game's threads, timers, the script thread                                                                                           |
| `-fwasm-exceptions -sSUPPORT_LONGJMP=wasm`                                            | the lift's `setjmp` for the game's exception frames, on wasm's own exception handling                                                                            |
| `-sUSE_SDL=2 -sUSE_SDL_TTF=2`                                                         | the SDL2 and SDL2_ttf ports: GDI text, and (stage 7) audio. No SDL video is used                                                                                 |
| `-sGLOBAL_BASE=16MB`                                                                  | keeps the guest image's range free ([memory.md](memory.md)). Emscripten takes a size suffix here, not `0x01000000`                                               |
| `-sINITIAL_MEMORY=640MB -sALLOW_MEMORY_GROWTH -sMAXIMUM_MEMORY=768MB`                 | [memory.md](memory.md), based on the measured 627.5 MiB menu peak and 4K soak peak                                                                                 |
| `-sSTACK_SIZE=8MB -sDEFAULT_PTHREAD_STACK_SIZE=8MB`                                   | deep call chains in the lifted code                                                                                                                              |
| `-sEXIT_RUNTIME=1 -sENVIRONMENT=web,worker,node`                                      | the runtime ends with `exit`; node for the headless runs                                                                                                         |
| `-sFORCE_FILESYSTEM -sWASMFS`                                                         | WasmFS: the file system the game and the page share, with the OPFS backend the page's imported archives are read through, and the Node backend for the Node runs |
| `--js-library src/web/opfs_read.js`                                                   | replaces the read half of WasmFS's OPFS backend: read-only sync access handles, and a block cache where there are none ([decisions.md](decisions.md), D11)       |
| `-sEXPORTED_RUNTIME_METHODS=ccall,cwrap,FS,callMain,HEAP8,HEAPU8,HEAP32,HEAPU32`      | what the page uses: calling exports, putting files in, starting `main()` once they are, reading the shared memory                                                |
| `--preload-file web/fonts/LiberationSans-*.ttf@/usr/share/fonts/truetype/liberation/` | `ra2.data`: the fonts `gdidc.c` looks for. A browser has none                                                                                                    |
| `--pre-js src/web/pre.js`                                                             | the crash report, the Node game-folder path                                                                                                                      |
| `--extern-pre-js src/web/extern-pre.js`                                               | ahead of everything: under Node, where `ra2.data` is (the data loader runs before `pre.js`)                                                                      |

Sound (stage 7) adds `-sAUDIO_WORKLET -sWASM_WORKERS`. The output is the classic script, not an ES
module (`-sMODULARIZE`), so `node ra2.js` works too and the page reads
`window.Module` ([protocol.md](protocol.md)). There is no `-gseparate-dwarf` yet:
the release build has no debug info, and `-g` on this much code makes `wasm-opt`
crash.

The `wasm-opt` pass at `-O3` takes about ten minutes of the link. To try a change
quickly, configure with `-DWEB_LINK_OPT=-O1` (a link takes seconds), and without
it for a release.

The game's `printf` and `fprintf(stderr)` go to `Module.print` and
`Module.printErr`. The page keeps the last few thousand lines for the crash
report, and tests read them ([testing.md](testing.md)).

## Build size and time

There are 67 generated files of about 400 functions each, about 270 MB of C
per game. Expectations to check in stage 3:

- **Compile.** Parallel, as on Linux. No LTO at first, because wasm-ld with
  LTO over 24,954 functions would need a lot of memory.
- **The `.wasm`.** Probably tens of MB. Brotli usually takes wasm to a
  quarter or less. Record both sizes here.
- **One function.** V8 refuses a function body over about 7.6 MB or with over
  50,000 locals. The largest lifted function is `sub_00618C58`, about 16,700
  lines. Check that it compiles in the browser, and if not, have the lifter
  split it.
- `wasm-opt` (run by emcc at `-O2` and up) may be slow on this size. If it
  is, link with `-O1` and run `wasm-opt -O2` once for release builds.

Measured on Windows 11, 12 logical cores, Release, no LTO (Yuri's Revenge). The rest after stages 5 and 11:

|                             | Yuri's Revenge                                                         | Red Alert 2 |
| --------------------------- | ---------------------------------------------------------------------- | ----------- |
| clean build time (12 cores) | 16 minutes (`build-web.cmd` into an empty folder: compile, link, copy) |             |
| `ra2md.wasm`                | 105.1 MB                                                               |             |
| `ra2md.wasm.br`             | 11.7 MB (quality 9)                                                    |             |
| to the main menu under Node | 12.8 s                                                                 |             |
| peak memory in a skirmish   |                                                                        |             |

Compression was also measured on the existing `-O1` local build outputs in
October 2026. The different link settings and inputs make these a separate
measurement from the release row above:

|                | Yuri's Revenge             | Red Alert 2              |
| -------------- | -------------------------- | ------------------------ |
| Wasm file      | `ra2md.wasm`: 135.15 MiB   | `ra2.wasm`: 137.51 MiB   |
| Brotli sidecar | `ra2md.wasm.br`: 14.22 MiB | `ra2.wasm.br`: 12.90 MiB |
| gzip sidecar   | `ra2md.wasm.gz`: 20.66 MiB | `ra2.wasm.gz`: 19.66 MiB |

## Running without a browser

```
./build-web.sh
node build-web/ra2.js --run --game /path/to/game --headless --mute
```

Under Node the game folder is a WasmFS Node-backend mount at `/game` (`src/web/main.c`; `Module.ra2MountGame` in
`src/web/pre.js` only resolves the path), so no import is needed. `--memfs` lays `/game` out the way the
page does: only the import allowlist, files of 1 MiB or more linked to the folder and read in place, the
small ones copied into memory. This is the stage 3 check, and the quickest way to tell a lift or host bug
from a browser bug.
