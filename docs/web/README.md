# In the browser

Red Alert 2 and Yuri's Revenge in a browser tab. The game is the same lifted
C the Windows and Linux builds run, compiled to WebAssembly with Emscripten,
and played from the player's own install, which they pick in the page.

**Status: stages 1 to 3 done.** The host builds with Emscripten and, under
Node, the lifted game boots to the main menu in about 13 seconds. The page
(stages 4 and 6), the main loop in a browser, sound and movies are still to
do. These pages are the design and the plan, and change as the stages answer
the open questions. When a page and the
code disagree, the code wins, and the page gets fixed.

## The one rule, in the browser

Nothing from the game is served, uploaded or sent anywhere. The site serves
only our wasm and our page. The player's files go from their disk into their
own browser's storage (OPFS) and stay there. The lifted C is compiled on the
developer's machine like every other build, and the `.wasm` it makes is
generated from `gamemd.exe`, so it is not committed or published either. See
[deploy.md](deploy.md) for what that means for hosting.

## Pages

| Page | What it covers |
|---|---|
| [plan.md](plan.md) | The stages, from a first `emcc` compile to both games in a tab, each with its check |
| [tasks.md](tasks.md) | The stages broken into tasks: repo, dependencies, size, and when each is done |
| [architecture.md](architecture.md) | Threads, rendering, audio, input, files and crashes: how the native Linux build maps onto a browser |
| [memory.md](memory.md) | The guest's address space in wasm linear memory: the pcrecomp change, which is the first risk |
| [toolchain.md](toolchain.md) | Emscripten, `build-web.sh`, `cmake/emscripten.cmake`, the link flags and why |
| [frontend.md](frontend.md) | The page: React, TypeScript and Radix; screens, state, styling, conventions |
| [protocol.md](protocol.md) | What the page and the game say to each other: messages, exported C functions, events |
| [storage.md](storage.md) | Importing the install, checking it, the OPFS layout, saves and settings |
| [testing.md](testing.md) | Unit tests for the page, the playtest suite in a headless browser, the conformance milestones |
| [deploy.md](deploy.md) | Hosting, the cross-origin headers, the service worker, caching, browser support |
| [decisions.md](decisions.md) | Each decision made so far, with the reason and what would change it |

## Where it starts

The native Linux build (`build-linux.sh`, `src/linux/`, pcrecomp's
`runtime/win32hle`) already runs the lifted C with no Windows underneath,
on SDL2 and ffmpeg. The browser build is that build retargeted: Emscripten
in place of gcc `-m32`, Emscripten's SDL2 port in place of the system's, and
a page in place of a desktop window. The Windows host (`runtime/native32`,
`src/runtime/host.c`, `present.c`) is MSVC inline assembly and Direct3D 11,
and none of it carries over.

## Where the work goes

The usual rule from [CONTRIBUTING.md](../../CONTRIBUTING.md) holds. A change
to `win32hle` or the lifter for wasm goes in
[pcrecomp](https://github.com/sp00nznet/pcrecomp), behind `__EMSCRIPTEN__`,
so every game on the toolkit gets it. What is specific to this game (the
host's `main`, its shims, the page) goes here: the host in `src/web/`, the
page in `web/`. A wall you got past goes in `docs/bringup.md`, as for the
other platforms.
