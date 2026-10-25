# In the browser

Red Alert 2 and Yuri's Revenge in a browser tab. The game is the same lifted
C the Windows and Linux builds run, compiled to WebAssembly with Emscripten,
and played from the player's own install, which they pick in the page.

**Status: stages 1 to 4 done.** The host builds with Emscripten and runs in a
browser: the page (React, Radix) loads the game, draws it on a canvas and sends
it the mouse and keys. In a local Chrome the main menu comes up, and a skirmish
starts by clicking and runs at 60 frames a second. The player's own folder is
imported into the browser (6), the game has sound (7) and plays its Bink movies
(8). Not done yet: the remaster options (9), the browser test suite (10), Red
Alert 2 (11) and multiplayer (12). These pages are the design and the plan, and change as the stages
answer the open questions.

## The one rule, in the browser

Game content archives are imported into the user's own browser storage
(OPFS) and stay there. A local build also stages the matching executable and
Blowfish DLL from that user's licensed install for runtime use. Neither those
files nor the generated `.wasm` are committed or published by this project.
See [deploy.md](deploy.md) for the hosting constraint.

## Pages

| Page | What it covers |
|---|---|
| [plan.md](plan.md) | The stages, from a first `emcc` compile to both games in a tab, each with its check |
| [tasks.md](tasks.md) | The stages broken into tasks: repo, dependencies, size, and when each is done |
| [runtime-bundle.md](runtime-bundle.md) | Planned local runtime bundles and per-edition content readiness checks |
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
