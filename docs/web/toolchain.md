# Toolchain

For build reuse and the lifecycle of test outputs and findings, follow
[the development workflow](../development-workflow.md). Reuse the edition's
web/Wasm production cache directly in `build/ra2/` or `build/ra2md/`.
The approved fast caches are `build/ra2-fast/` and `build/ra2md-fast/`.
Create only the edition/mode needed, then reuse it for subsequent work.
Both modes publish the complete runnable edition to `web/public/game/`,
with its absolute path as `WEB_OUT`. Ask the user before creating any
other build folder. If the needed cache is busy, ask whether to wait or
create a separate build. Coordinate publication between modes of the same
edition; the last successfully published mode is what the page serves.

## Build commands

Run from the repository root (PowerShell or cmd):

```powershell
.\build-web.cmd --mode prod --edition ra2
.\build-web.cmd --mode prod --edition ra2md
.\build-web.cmd --mode fast --edition ra2
.\build-web.cmd --mode fast --edition ra2md
.\build-web.cmd --mode prod --edition both
.\build-web.cmd --mode fast --edition both
.\build-web.cmd --mode all --edition both
```

On macOS/Linux, use `./build-web.sh` with the same arguments. With no
arguments, build both editions in production mode; `RA2_TARGET=game` or
`gamemd` can set the default edition. `--mode all` builds both fast caches
first, then production, so the page ends with production modules. Each
edition builds sequentially into its own reusable cache. `--jobs 12`
limits parallel compiler jobs; `--verbose` shows the underlying build.
Use `--dry-run` to inspect commands without creating outputs or activating
emsdk, or `--help` for options. The wrappers use `python` on Windows and
`python3` on Unix; `PYTHON` can name another Python executable.

The commands take an OS-held lock per edition across both modes. A busy
edition fails immediately with its owning PID/mode; the command does not
wait, stop it or create a fallback folder. The agent must ask the user
what to do. The command also stops on Ninja activity markers in the
selected, standard and same-edition legacy caches. A marker can mean a
running or interrupted build; it is not deleted automatically. Direct
CMake/Ninja invocations do not acquire the wrapper's lock, and marker
checks cannot detect every external configure/build or prevent one
starting afterward. Inspect direct processes separately before building.

For a compatible legacy cache, or a user-approved exception, pass
`--build-dir PATH` with exactly one edition and one mode. `BUILD_DIR`
is also accepted under that restriction. Use
`--cmake-arg=-DNAME=VALUE` for additional configuration; `CMAKE_ARGS`
accepts a list of `-D` settings using the platform's quoting rules.
The command owns the edition, Release build type, mode's link option,
toolchain and `WEB_OUT`. A cached `PCRECOMP` runtime path is preserved
unless explicitly overridden by the environment or a `-DPCRECOMP` setting.
New caches discover the sibling runtime. Caches belonging to
another checkout, edition or toolchain are rejected. Custom cached
`WEB_LINK_OPT` memory/profiling settings are rejected rather than silently
discarded; preserve that configuration when arranging its reuse.

Every successful selection builds its `ra2_publish` or `ra2md_publish`
target. These targets republish even if no link is needed, so selecting
cached production after fast restores production files to the page.
Compressed sidecars are reused inside the build cache when the Wasm and
compressor are unchanged. Publication follows the target's actual output
directory and also copies emitted worker, source-map, debug-Wasm and
symbol sidecars. Existing legacy folders are not moved or
deleted by these commands; see the workflow's existing-folder transition.

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

A build does not re-lift. A patch edited in `run_lift.py` (or a change to
pcrecomp's `lift32.py` or `generate.py`) reaches the game only after
`run_lift.py --target <edition> --all`. Every CMake build checks this before
compiling: `cmake/lift_check.cmake` compares each edition's
`lift_stamp.txt` with a hash of those three files and fails, naming the
command, when they differ. Any edit to `run_lift.py`, even one meant for the
other edition, makes both lifts stale; re-lift both or set `RA2_TARGET` to
build one. `-DRA2_ALLOW_STALE_LIFT=ON` builds the old lift anyway, with a
warning.

## Files

| File                                                        | What it is                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cmake/emscripten.cmake`                                    | toolchain file: wraps emsdk's `Emscripten.cmake` and sets the flags below                                                                                                                                                                                                          |
| `CMakeLists.txt`                                            | an `if(EMSCRIPTEN)` branch beside the Linux one: `src/web/*.c`, `win32hle`, the generated C                                                                                                                                                                                        |
| `build-web.sh`, `build-web.cmd`, `tools/build_web.py` | select edition/mode, reuse the workflow's cache, build and publish to `web/public/game/` |
| `cmake/web_publish.cmake`, `cmake/publish_web.cmake.in` | publication after linking and through explicit publish targets for cached builds |
| `tools/build-ffmpeg-web.sh`, `.cmd`, `tools/ffmpeg-web.mjs` | configure FFmpeg for the Bink decoder and list the files to compile (no GNU make here)                                                                                                                                                                                             |
| `src/web/main.c`                                            | the browser host: `src/linux/main.c` without signals, `popen` or the watchdog, plus the exported functions in [protocol.md](protocol.md)                                                                                                                                           |

The wrappers configure each selected edition in its own cache, using
`RA2_TARGET=game` or `gamemd` and its matching lifted sources
(`src/recomp/gen_game/` or `src/recomp/gen/`). Direct CMake still supports
`RA2_TARGET=both` in one tree for legacy configurations; the workflow's
commands use the edition/mode layout above.

After linking, each target copies its files into the flat `web/public/game/`
directory, named after the edition: `ra2md.js/.wasm/.data` for Yuri's Revenge,
`ra2.js/.wasm/.data` for Red Alert 2. `tools/compress-wasm.mjs` adds matching
Brotli quality 9 and gzip level 9 sidecars, and the build merges that edition
into the shared `build.json` (the lock lets either link publish first). The
loader selects the edition-specific JS and maps its Wasm/data requests to the
matching names. `build.json` hashes the original, uncompressed files. These
generated game files stay in the ignored local build output and must not be
copied into a public deployment.

The post-build manifest step also copies the required executable and
`Blowfish.dll` into `web/public/game/runtime/<edition>/` and writes its
`runtime.json`. Publish this complete bundle after a successful link,
including fast iteration builds. Keep the linked files in the edition's
CMake cache for incremental builds; the post-build copy makes them
available to the page without creating another private publication tree.

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

The `wasm-opt` pass at `-O3` takes about ten minutes of the link. Both
production and fast Wasm builds use `CMAKE_BUILD_TYPE=Release`, with
generated C compiled at `GEN_OPT=-O2` by default. They differ at link time:

| Mode | Cache | Link configuration |
|---|---|---|
| Production | `build/ra2/` or `build/ra2md/` | `-DCMAKE_BUILD_TYPE=Release -DWEB_LINK_OPT=`: default `-O3`, including Wasm optimization |
| Fast | `build/ra2-fast/` or `build/ra2md-fast/` | `-DCMAKE_BUILD_TYPE=Release -DWEB_LINK_OPT=-O1`: skips the expensive Wasm optimization pass for iteration |

A fast link typically takes seconds. The commands above select these
paths and settings automatically. Both modes use `WEB_OUT` pointing to
`web/public/game/`. Explicitly clear a production
cache's link override with `-DWEB_LINK_OPT=`; omitting the flag does not
clear an earlier cached value. The page's `pnpm build:prod` builds the
frontend and does not change these Wasm settings.

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
./build-web.sh --mode fast --edition ra2md
node web/public/game/ra2md.js --run --game /path/to/game --headless --mute
```

Under Node the game folder is a WasmFS Node-backend mount at `/game` (`src/web/main.c`; `Module.ra2MountGame` in
`src/web/pre.js` only resolves the path), so no import is needed. `--memfs` lays `/game` out the way the
page does: only the import allowlist, files of 1 MiB or more linked to the folder and read in place, the
small ones copied into memory. This is the stage 3 check, and the quickest way to tell a lift or host bug
from a browser bug.
