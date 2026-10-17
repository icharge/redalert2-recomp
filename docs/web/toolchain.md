# Toolchain

## What it needs

| Tool | Version | Why |
|---|---|---|
| emsdk (Emscripten) | one pinned version, recorded in `build-web.sh` | `emcc`, wasm-ld, the SDL2 ports, WasmFS, audio worklets |
| CMake and Ninja | as for the other builds | the same `CMakeLists.txt` |
| Python 3.10+ | as for the other builds | the lift (`run_lift.py`) |
| Node.js | 20 or later | the headless runs in stage 3, and the page's build |
| pnpm | 9 or later | the page's packages (`web/`) |

The lift is the same as for Windows and Linux. `src/recomp/gen/` from
`run_lift.py --all` is what emcc compiles. `setup.sh` and `Setup.cmd` gain a
`--web` step later, once the build works by hand.

## Files

| File | What it is |
|---|---|
| `cmake/emscripten.cmake` | toolchain file: wraps emsdk's `Emscripten.cmake` and sets the flags below |
| `CMakeLists.txt` | an `if(EMSCRIPTEN)` branch beside the Linux one: `src/web/*.c`, `win32hle`, the generated C |
| `build-web.sh`, `build-web.cmd` | configure and build into `build-web/` (`build-web-game/` for Red Alert 2), then copy `ra2.js`, `ra2.wasm` and the worker scripts into `web/public/game/` |
| `src/web/main.c` | the browser host: `src/linux/main.c` without signals, `popen` or the watchdog, plus the exported functions in [protocol.md](protocol.md) |

## Compile flags

Same as Linux for the generated C: `-w -O2 -fno-strict-aliasing -fwrapv`,
and `RECOMP_RETADDR=0u RECOMP_FLAT_MEMORY RECOMP_LOCAL_REGS`. Plus:

| Flag | Why |
|---|---|
| `-pthread` | shared memory, so the game's threads work |
| `-sSUPPORT_LONGJMP=wasm` with `-fwasm-exceptions` | `recomp_types.h` uses `setjmp` for the game's exception frames and for `setjmp` returns. Wasm's own exception handling is much faster than the JS fallback |
| `-msimd128` | lets clang vectorise the `memcpy`/`memset` loops and the HD voxel code |

## Link flags

| Flag | Why |
|---|---|
| `-sPROXY_TO_PTHREAD` | `main()` on a pthread, so the game may block ([architecture.md](architecture.md)) |
| `-sPTHREAD_POOL_SIZE=8` | workers made at startup: the game's threads, timers, the script thread |
| `-sOFFSCREENCANVAS_SUPPORT` | the canvas moves to the game thread, where SDL makes its GL context |
| `-sUSE_SDL=2 -sUSE_SDL_TTF=2` | Emscripten's ports, built on first use |
| `-sMAX_WEBGL_VERSION=2` | WebGL2 for SDL's renderer |
| `-sWASMFS` | WasmFS, for the OPFS backend ([storage.md](storage.md)) |
| `-sAUDIO_WORKLET -sWASM_WORKERS` | the audio backend ([architecture.md](architecture.md)) |
| `-sGLOBAL_BASE=0x01000000` | keeps the guest image's range free ([memory.md](memory.md)) |
| `-sINITIAL_MEMORY=1GB -sALLOW_MEMORY_GROWTH -sMAXIMUM_MEMORY=4GB` | [memory.md](memory.md) |
| `-sSTACK_SIZE=8MB -sDEFAULT_PTHREAD_STACK_SIZE=8MB` | deep call chains in the lifted code |
| `-sMODULARIZE -sEXPORT_ES6 -sEXPORT_NAME=createRa2` | the page imports the game as a module |
| `-sEXPORTED_FUNCTIONS=...` | the functions in [protocol.md](protocol.md) |
| `-sEXPORTED_RUNTIME_METHODS=ccall,cwrap` | calling them from TypeScript |
| `-sENVIRONMENT=web,worker,node` | node for the headless runs |
| `-gseparate-dwarf` (debug builds) | DWARF in a side file, so the main `.wasm` stays small and devtools can still map back to C |

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

Fill in after stage 3:

| | Yuri's Revenge | Red Alert 2 |
|---|---|---|
| clean build time | | |
| `ra2.wasm` | | |
| `ra2.wasm.br` | | |
| peak memory in a skirmish | | |

## Running without a browser

```
./build-web.sh
node build-web/ra2.js --run --game /path/to/game --headless --mute
```

Under Node the game folder is a NODEFS mount (`src/web/main.c` mounts it when
it runs under Node), so no import is needed. This is the stage 3 check, and
the quickest way to tell a lift or host bug from a browser bug.
