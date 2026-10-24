# Tasks

The stages in [plan.md](plan.md), broken into tasks small enough to do and
check one at a time. Each task is one pull request, or one commit in a
series.

- **Repo**: `here` is this repo. `pcrecomp` is the toolkit (the change goes
  there behind `__EMSCRIPTEN__`, CONTRIBUTING "Where a fix belongs").
- **Size**: S is under a day, M is a few days, L is about a week or more, or
  unknown until the task before it is done.
- **Needs**: tasks that must be done first. Tasks with no dependency between
  them can be done in parallel. The page (W4, W6) doesn't need the game to
  boot.

Tick a task off here in the same pull request that finishes it.

## Stage 1: toolchain

| ID | Task | Repo | Needs | Size | Done when |
|---|---|---|---|---|---|
| ~~W1.1~~ | Install emsdk, pick a version, record it in `build-web.sh` and [toolchain.md](toolchain.md) | here | | S | `emcc --version` matches the pinned version |
| ~~W1.2~~ | `cmake/emscripten.cmake` and an `if(EMSCRIPTEN)` branch in `CMakeLists.txt`, with the compile flags from toolchain.md | here | W1.1 | S | `cmake -B build-web` configures |
| ~~W1.3~~ | `build-web.sh` and `build-web.cmd`: configure, build, copy output to `web/public/game/` | here | W1.2 | S | both run end to end on an empty target |
| ~~W1.4~~ | Compile `recomp_0000.c` alone; fix or list what fails | here | W1.2 | S | it compiles, or every error kind is listed in toolchain.md |
| ~~W1.5~~ | Compile all 67 generated files; record the time | here | W1.4 | M | all compile; the time is in toolchain.md |
| ~~W1.6~~ | Compile `win32hle`; list the errors by kind (signals, `mmap`, sockets, `popen`, ...) | pcrecomp | W1.2 | S | the list is in toolchain.md |
| ~~W1.7~~ | `__EMSCRIPTEN__` guards in `win32hle` for everything in W1.6 except memory (that's W2) | pcrecomp | W1.6 | M | `win32hle` compiles with emcc |

## Stage 2: memory

| ID | Task | Repo | Needs | Size | Done when |
|---|---|---|---|---|---|
| ~~W2.1~~ | `pe_loader.c`: the fixed-base map below `GLOBAL_BASE`, `aligned_alloc` for DLLs ([memory.md](memory.md)) | pcrecomp | W1.7 | S | `pe_loader_selftest` passes under Node |
| ~~W2.2~~ | `kernel32.c`: `VirtualAlloc`, `VirtualFree` and `VirtualQuery` on aligned allocations; log fixed-address requests once | pcrecomp | W1.7 | S | `kernel32_ext_selftest` passes under Node |
| ~~W2.3~~ | Build the other `win32hle` selftests with emcc and run them under Node | pcrecomp | W2.1, W2.2 | M | all pass, or the failures are filed as tasks here |

| ~~W2.4~~ | `present_selftest`: it opens an SDL window, and neither Node nor Emscripten's SDL has a display or a dummy video driver. Run it as a page in headless Chrome | pcrecomp | W2.3 | S | it passes in headless Chrome (`build_selftests_web.py --chrome`) |

## Stage 3: headless boot

| ID | Task | Repo | Needs | Size | Done when |
|---|---|---|---|---|---|
| ~~W3.1~~ | `src/web/main.c` from `src/linux/main.c`: no signals, recorder or watchdog; NODEFS mount under Node | here | W1.7 | S | it compiles |
| ~~W3.2~~ | Link the whole game with the flags in toolchain.md; record the link time and `.wasm` size | here | W1.5, W2.2, W3.1 | M | `ra2.wasm` exists; the numbers are in toolchain.md |
| ~~W3.3~~ | Dry run under Node: map and bind the exe | here | W3.2 | S | the log prints `mapped C:\gamemd.exe: 0x00400000-0x00B93000` |
| ~~W3.4~~ | `--run` under Node with SDL's dummy drivers, to the main menu, from NODEFS and from MEMFS (`--memfs`); each wall goes in `docs/bringup.md` | here | W3.3 | L | the log reaches the main menu's dialog (0xE2) |
| ~~W3.5~~ | Trap reports: `ra2_crash_report()` and `onAbort` printing it | here | W3.2 | S | a forced trap prints the lifted function and the indirect-call ring |
| ~~W3.6~~ | `tools/conformance.py --host web` | here | W3.4 | S | 8/8 boot milestones under Node |
| ~~W3.7~~ | Check the largest lifted functions compile in V8 (`sub_00618C58` and the next four) | here | W3.2 | S | Chromium instantiates `ra2.wasm`, or the lifter splits the function (a pcrecomp task) |

## Stage 4: the page

| ID | Task | Repo | Needs | Size | Done when |
|---|---|---|---|---|---|
| ~~W4.1~~ | Scaffold `web/`: Vite, React 18, TypeScript strict, Radix Themes, ESLint, Prettier, Vitest, pnpm | here | | S | `pnpm dev`, `pnpm build`, `pnpm test` work; the dev server sends COOP/COEP |
| ~~W4.2~~ | `App` with `<Theme>` and the screen switch; the Browser check screen | here | W4.1 | S | it shows what a browser without `SharedArrayBuffer` lacks |
| ~~W4.3~~ | `game/protocol.ts` and `src/web/web_api.h`: the types and `RA2_WEB_PROTOCOL` ([protocol.md](protocol.md)) | here | W4.1 | S | both exist and agree |
| ~~W4.4~~ | `game/store.ts`: phases, `@ra2` line parsing, `useSyncExternalStore` | here | W4.3 | S | Vitest covers every phase change |
| ~~W4.5~~ | `game/loader.ts`: set `window.Module`, load `ra2.js`, pass the arguments (the canvas is not handed over: D10) | here | W4.4 | S | with no build present, Play says the game isn't built |
| ~~W4.6~~ | The `@ra2` events and exported functions in `src/web/main.c` | here | W3.4, W4.3 | M | the events show in a Node run's log |
| ~~W4.7~~ | Play screen: the canvas created once, full window, drawn by `presenter.ts`, `ResizeObserver` calling `ra2_resize` | here | W4.5, W4.6 | M | the main menu shows in the page (with the dev-only local folder, W4.8) |
| ~~W4.8~~ | Dev-only "load from a local folder": the page mounts a folder served by Vite | here | W4.5 | S | the game finds its files without an import |
| ~~W4.9~~ | Input works: menus by mouse, the keyboard in game | here | W4.7 | M | a skirmish starts by clicking |

### Found playing it (details in [issues.md](issues.md))

| ID | Task | Repo | Needs | Size | Done when |
|---|---|---|---|---|---|
| ~~W4.10~~ | Reproduce the issues in `web/e2e/` (a timeline through a load, a dropdown, a right-drag, the in-game menu and Save) | here | W4.9 | S | `timeline.mjs`, `drive.mjs` (`rdrag`, `LOG_GREP`), `save.mjs` |
| ~~W4.11~~ | Publish frames from the primary's Unlock, so the game's loading screens show | here, pcrecomp | W4.10 | S | a skirmish load's frames change through the 15 s |
| ~~W4.12~~ | The page's loading screen: byte progress for the copy, then "starting" | here | W4.10 | S | `LoadingScreen`, with tests |
| ~~W4.13~~ | Right-drag panning | pcrecomp | W4.10 | S | `SM_CXDRAG` answered; the battle map pans (Pointer Lock is W9.5) |
| ~~W4.14~~ | Dropdowns draw correctly | pcrecomp | W4.10 | S | a closed list repaints what it covered; the minimap shows |
| ~~W4.15~~ | The dialog box that is never drawn (after Save): draw it | pcrecomp | W4.10 | M | a dialog is not painted over by the older dialog under it; `save.mjs`: the confirmation shows and OK closes it ([issues.md](issues.md), 6) |
| ~~W4.16~~ | A combo box with no room for its list: the opponent and resolution drop-downs | pcrecomp | W4.15 | S | the opponent list opens with its four entries; Options, Set Game Resolution lists the modes |
| ~~W4.17~~ | Drop-down lists draw their border | here | W4.16 | M | the colour and resolution lists show the two-pixel frame; see [issues.md](issues.md), 8, and the captures in `work/web-dropdown-current/` and `work/resolution-frame-first/` |
| ~~W4.18~~ | Sidebar button states match the Windows game | pcrecomp, here | W4.16 | M | `e2e/lobby.mjs`: raw hover pixels equal idle (as in the lossless native reference); held changes only the selected button, dragging out/in clears/restores it, and release restores idle |
| ~~W4.19~~ | The lobby's right panel finishes (title tab, minimap) without a repaint | pcrecomp, here | W4.16 | M | `work/web-lobby-idle-40/`: after 40 s idle, the right-panel/minimap/title-tab pixels are identical after opening and closing a drop-down |

## Stage 5: the main loop

| ID | Task | Repo | Needs | Size | Done when |
|---|---|---|---|---|---|
| ~~W5.1~~ | Frame-time overlay (the `fps` event) | here | W4.7 | S | Alt+Shift+F or `?stats`: game fps, worst gap, late frames, publish cost, page frames |
| ~~W5.2~~ | Measure a skirmish at 800x600 and 1080p | here | W4.9, W5.1 | S | `e2e/measure.mjs`; the numbers are in [testing.md](testing.md) |
| W5.3 | Only if W4.7 or W4.9 fail: the fallbacks in order (`OFFSCREEN_FRAMEBUFFER`, the page's own input path, Asyncify); record which in decisions.md | here | W4.9 | L | a skirmish plays |

## Stage 6: files

| ID | Task | Repo | Needs | Size | Done when |
|---|---|---|---|---|---|
| ~~W6.1~~ | `storage/install.ts`: the allowlist, finding which game, the PE stamp check, `build.json` from `build-web.sh` | here | W4.1 | M | Vitest covers a recorded file list and synthetic headers |
| ~~W6.2~~ | `storage/manifest.ts`: IndexedDB `ra2-web`, resumable state, shared files | here | W4.1 | S | Vitest (`fake-indexeddb`) covers resume, mismatch and removal |
| ~~W6.3~~ | `storage/opfs.ts`: streamed copy, cancel, resume, remove | here | W6.2 | M | a 280 MB file copies without the tab's memory growing by that much |
| ~~W6.4~~ | Import screen: picker, drop zone, checks, quota, `persist()`, progress | here | W6.1, W6.3 | M | `e2e/import.mjs`: a real install imports in Chrome through the file input (Firefox and Safari: not yet tried) |
| ~~W6.5~~ | Library screen: cards, storage meter, remove with confirmation | here | W6.2 | S | `e2e/import.mjs` removes a game; the manifest tests cover a file the other game still needs |
| ~~W6.6~~ | The game starts from OPFS (copied into the in-memory file system at start), and what it writes is kept in OPFS | here | W3.4, W6.3 | M | `e2e/import.mjs`: it reaches the main menu from the copy, and a file written before a reload is back ([decisions.md](decisions.md), D11) |
| ~~W6.7~~ | The service worker: precache, wasm cache by build hash, COOP/COEP, update prompt, manifest | here | W4.1 | M | `e2e/offline.mjs`: with no headers from the host the page isolates itself, a new build is offered and swaps the kept game files, and with the server gone the page and the game still start |
| ~~W6.8~~ | Download saves as a zip; import saves | here | W6.6 | S | `e2e/import.mjs` downloads the zip; its paths are `Saved Games/<name>`, as the Windows build keeps them |

## Stage 7: sound

| ID | Task | Repo | Needs | Size | Done when |
|---|---|---|---|---|---|
| ~~W7.1~~ | `dsound.c`: the lock-free ring and an `__EMSCRIPTEN__` mixer thread; the worklet is plain JavaScript (D5) | pcrecomp | W1.7 | M | `e2e/audio.mjs`: a test tone plays through the worklet in a page with no game |
| ~~W7.2~~ | `audio.ts`: resume on the first gesture; the "click to start sound" bar | here | W4.7 | S | Vitest: the context is resumed from a gesture and not before; `e2e/audio.mjs`: the game's sound runs after a click |
| ~~W7.3~~ | Volume: a slider on the Play screen to `ra2_set_volume`, kept in the manifest's settings | here | W7.1, W7.2 | S | `e2e/audio.mjs`: volume 0 is silent in the ring and it comes back |
| ~~W7.4~~ | 5 minutes of skirmish | here | W7.1, W7.2 | S | `e2e/audio.mjs --skirmish --minutes 5`: 300 s of battle in two skirmishes, no underrun, the game at 62 fps |

## Stage 8: movies

| ID | Task | Repo | Needs | Size | Done when |
|---|---|---|---|---|---|
| ~~W8.1~~ | Build ffmpeg's `bink` and `binkaudio` decoders alone with emcc; a script for it | here | W1.1 | M | `tools/build-ffmpeg-web.sh` configures it and `CMakeLists.txt` builds the static library: 173 files, LGPL |
| ~~W8.2~~ | Link with `HLE_WITH_FFMPEG` | here | W8.1, W3.4 | S | `e2e/movies.mjs`: the menu’s two movies decode (640x480 with sound, 632x570) and the sidebar animates; the intro movies are not in the author’s install, so they are untried |

## Stage 9: remaster features

| ID | Task | Repo | Needs | Size | Done when |
|---|---|---|---|---|---|
| ~~W9.1~~ | The F10 menu in the browser: opens, and its settings stick (`ra2.ini` under `/save`) | here | W6.6 | S | `e2e/remaster.mjs`: scaling, resolution, HD and controls survive a reload from OPFS |
| ~~W9.2~~ | Resolutions 720p to 1440p | here | W9.1 | S | each starts a skirmish |
| ~~W9.3~~ | HD vehicles; record the frame time | here | W9.1 | S | `e2e/measure.mjs` compares the same live battle with HD off/on and records the frame time |
| ~~W9.4~~ | Modern controls and Queue Five | here | W4.9 | S | the `skirmish-build` orders work by mouse |
| ~~W9.5~~ | Fullscreen, `keyboard.lock()`, Pointer Lock for edge scrolling | here | W4.9 | edge scrolling works fullscreen and in a locked window |
| ~~W9.6~~ | Mods: a second folder import into `/game/<id>/mods` | here | W6.4 | M | `e2e/remaster.mjs`: a data mod imports, F9 flushes saves and restarts with its overlay; mod saves have separate paths |

## Stage 10: the suite in a browser

| ID | Task | Repo | Needs | Size | Done when |
|---|---|---|---|---|---|
| ~~W10.1~~ | `?test=1` and `arg=` in the page; the console collected to a log | here | W4.8 | S | `tools/playtest.py --web`: existing dialog scripts reach `script.c`, full output is kept in each case's `run.log` |
| ~~W10.2~~ | `tools/playtest.py --web` with Playwright: start, log, screenshots, exit, `--jobs` | here | W10.1 | M | `menu-*` passes |
| ~~W10.3~~ | The rest of the cases | here | W10.2, W9.4 | M | `back-*`, `sp-*`, `skirmish-*` pass |
| ~~W10.4~~ | CI for the page: lint, typecheck, Vitest, build | here | W4.1 | S | `.github/workflows/web.yml` runs those checks on pushes and pull requests, without proprietary files |

## Stage 11: Red Alert 2

| ID | Task | Repo | Needs | Size | Done when |
|---|---|---|---|---|---|
| ~~W11.1~~ | `RA2_TARGET=game` in the web build (`build-web-game/`), a second module the page can load | here | W3.4 | S | the build publishes `/game/ra2/ra2.js` and `.wasm`, and adds RA2 to `build.json` |
| ~~W11.2~~ | Import and Library with both games, shared files stored once | here | W6.5, W11.1 | S | `e2e/import.mjs --both`: both play from one import and the shared `ra2.mix` is stored once |
| W11.3 | The suite on Red Alert 2 | here | W10.3, W11.2 | S | `RA2_TARGET=game` with `tools/playtest.py --web`: the same cases pass |
| ~~W11.4~~ | Browse game files with [js-fileexplorer](https://github.com/cubiclesoft/js-fileexplorer), backed by the import or live VFS | here | W11.1, W11.2 | M | `e2e/import.mjs --both`: Library browses imported OPFS and Play browses live `/game`; text opens read-only and no write/export tools are available |
| ~~W11.5~~ | Manage an installation's imported files: upload, replace, delete, add a game by its exe; an edition picker on the card; saves as `.sav` beside the exe | here | W11.4 | M | `file-manager.test.ts` and `FileExplorer.test.tsx`; `e2e/import.mjs` finds one Delete tool and an Upload button in the Library browser and none in Play's; Download saves has `SAVE0001.sav` ([storage.md](storage.md#managing-files)) |

## Stage 12: LAN multiplayer (optional)

| ID | Task | Repo | Needs | Size | Done when |
|---|---|---|---|---|---|
| ~~W12.1~~ | Decide scope for browser LAN play and peer discovery | here | | S | [D13](decisions.md#d13-browser-lan-play-one-peer-over-webrtc-manual-sdp-exchange): one peer, manual offer/answer exchange, WebRTC data channels carry IPX |
| ~~W12.2~~ | `wsock32.c`: carry IPX datagrams over a WebRTC data channel | pcrecomp | W12.1 | L | connected peers exchange IPX datagrams over WebRTC, routed by source/destination socket |
| ~~W12.3~~ | Manual SDP offer/answer exchange in the Play screen, with a generated WOL identity per HLE runtime | here | W12.2 | M | `e2e/lan.mjs` confirms two distinct 128-digit keys, then both clients connect and render the same LAN match without a hosted signaling service |

## Stage 13: internet multiplayer through WOLAPI (optional)

| ID | Task | Repo | Needs | Size | Done when |
|---|---|---|---|---|---|
| ~~W13.1~~ | Identify the WOLAPI client surface, compatible service, and browser/network constraints | here | W12.1 | M | `decisions.md` records the target service, required lobby/session operations, and how game traffic reaches peers; original WOL servers are not assumed available |
| W13.2 | Adapt the WOLAPI client surface to the RA2Web lobby/session service | here | W13.1 | L | a browser client authenticates to RA2Web, lists/joins lobbies and game rooms, exchanges options, and receives the start handoff |
| W13.3 | Trace and bridge the native WOL Internet gameplay packet path | here, pcrecomp | W13.1, W13.2 | L | RA2/YR online socket and packet flow is traced past `STARTG`, then clients on separate networks complete a match through a browser-compatible transport; include a relayed case if WebRTC is selected |

## Open, before the page ships to a public host

| ID | Task | Needs | Done when |
|---|---|---|---|
| W0.1 | Decide D9: how players get `ra2.wasm` without it being published ([decisions.md](decisions.md)) | | the decision is in decisions.md, and [deploy.md](deploy.md) matches |

## Where to start

The longest chain is W1.1 → W1.2 → W1.6 → W1.7 → W2.2 → W3.2 → W3.4. W3.4
(the first boot) is the biggest unknown. The page can be built alongside it,
starting with W4.1 → W4.2 → W4.3 → W4.4 → W4.5 and W6.1 → W6.2 → W6.3, none
of which need the game.
