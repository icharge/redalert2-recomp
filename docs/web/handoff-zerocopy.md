# Handoff: game start from mounted files, and start-up time, 25 October 2026

Nothing in this file is committed. This replaces the earlier spike handoff; the
spike's results are in "Background" and in [decisions.md](decisions.md), D11.

## State

**Done and working** (both Yuri's Revenge and Red Alert 2 mount their files and reach the menu in Chrome):

- The game's big files (1 MiB or more) are read in place from OPFS through a WasmFS mount; small ones are
  copied into memory. JS heap about 17 MB, wasm memory 256 MB at the menu and 307 MB in a skirmish.
  See D11 and [storage.md](storage.md), "How the game reads its files".
- Pieces: `src/web/opfs_read.js` (read-only sync handles kept open between opens, Blob fallback with a
  block cache, read counters), `src/web/read_cache.c` (`ReadFile` shim, 1 MiB blocks for small repeated
  reads; from Codex), `src/web/main.c` (mounts `/opfs`; Node backend; `--memfs`; the skips below),
  `web/src/game/loader.ts` (`noInitialRun`, files, then `callMain`), `web/src/storage/saves.ts`
  (`replaceFile`, link-aware scan, WasmFS `stat`), `mods.ts` (big mod files linked).
- **Start-up is under 5 s in Chrome at release `-O3`: Yuri's Revenge reaches its menu 3.4 s after a warm
  reload** (five reloads, 3.39 to 3.46 s; 4.0 s right after a fresh import) **and Red Alert 2 in 2.35 to
  2.63 s** (five reloads; its menu renders). The first load of a newly built wasm took 11 s for Red Alert 2.
  Steps and numbers are in D11. Earlier first loads of Yuri's Revenge took a minute or more, but those
  were with the browser pane hidden (throttled) and before the handle pool; it did not reproduce with
  the pane in front.
- The start-up skips (`src/web/main.c`, `presenter.c`, `web_api.h`): `ra2_BinkOpen` opens a movie as 2
  frames at 15 fps until the menu has opened once (`web_menu_seen`); `ra2_QueryPerformanceCounter`
  moves the clock 1 s ahead when 20,000 polls land inside 20 ms, which ends the game's 5000 ms splash
  wait. `--intro` (`?arg=--intro`) turns both off.
- Memory cap 256 MB initial and 768 MB maximum (`CMakeLists.txt`, `tools/test_web_memory_budget.py`).
- Tests: 267 web tests, `tsc` clean, `tools/test_web_mount.py` and `test_web_memory_budget.py` pass.

## What is left

1. **Red Alert 2 was rebuilt from a copy of `../pcrecomp`.** `../pcrecomp/runtime/win32hle/user32.c`
   line 1781 holds another session's `[dbg-move]` debug `fprintf` (marked `/* TEMP */`) whose string is
   split over two lines, so the sibling does not compile. It was left alone: the build used a scratch copy
   with that one line joined (`PCRECOMP=<copy>`; 10:09 build, now published in `web/public/game/ra2/`).
   Once the sibling is fixed, a normal build gives the same result.
2. Optional: serve `ra2.wasm` so the browser keeps its compiled code (cache headers on the deploy), and
   look at the first-load cost above.
3. Optional: the remaining 3.4 s is about 1 s to get the wasm up, 1.2 s to the movie skip, then the file
   scan (`sub_0065CBF0`, `CreateFileA` and `CloseHandle`) and the menu. Counters are in `opfs_read.js`
   (`[opfs-read]` lines), and `?arg=--heartbeat&arg=1` names the function the game is in each second.

## Builds and files

- **Published state right now:** `web/public/game/ra2.js` and `.wasm` are a release `-O3` build of
  Yuri's Revenge with everything above (09:48). `web/public/game/ra2/` (Red Alert 2) is the same, built at
  10:09 from the scratch copy of pcrecomp (see above).
- Build commands (PowerShell, repo root): `$env:CMAKE_ARGS='-DWEB_LINK_OPT=-O1'; cmd /c .uild-web.cmd`
  for a quick link; `-DWEB_LINK_OPT=` (empty) for the release link, about 20 minutes with other builds
  running and several GB of RAM; `$env:RA2_TARGET='game'` first for Red Alert 2. The `-O1` link is not a
  measure of the release: it was 1.5 s slower to the menu.
- To test in a browser: `cd web; $env:RA2_GAME_DIR='E:\Games\Westwood\RA2'; node node_modulesiteinite.js --port 5199 --strictPort`,
  then seed the install into OPFS through the app's importer from the page console (`prepareImport`
  and `runImport` from `/src/storage/importer.ts` over a source built from `/dev-game/index.json`,
  `Manifest.open()`, `opfsTarget()`, `loadBuildInfo()`; options `{movies:false, saves:true}`; run it on
  `/?test=1`, not on a game page). Open `/game/<slot>?edition=ra2md`. Time the menu by polling
  `window.ra2Store.getLog()` for `"e":"menu"` and reading `performance.now()`. Keep the browser tab
  fronted: a hidden pane throttles the page, and the numbers stop meaning anything.
- The in-app browser's OPFS was wiped once during this work (slot 1 came back empty with the manifest
  still listing it); clear OPFS (`game`, `save`) and `indexedDB.deleteDatabase('ra2-web')` before
  re-seeding. It currently holds the 1.1 GB seeded install.

## Other sessions in the same tree

The "WOLAPI work" session is editing `src/web/wolapi.c`, `web/src/game/loader.ts` (the UDP relay),
`wol.ts` and `../pcrecomp` files, and building `build-web-udp/`. Codex last worked at 20:49 and is idle.
Both write to `web/public/game/`. Agree who publishes what before relinking, and give any other build
directory `-DWEB_LINK_OPT=-O1` (or empty) so it does not carry the 1 GB / 4 GB memory override.

## Not committed

The tree holds this mount and start-up work, the WOL/UDP work, Thai font, LAN, input, resolution and
the other earlier changes, all uncommitted and mixed. The files for this work are: `CMakeLists.txt`,
`src/web/{main.c,pre.js,presenter.c,web_api.h,opfs_read.js}`, `web/src/game/{loader.ts,loader.test.ts}`,
`web/src/storage/{saves,mods,file-browser,opfs}.ts` and their tests, `web/src/screens/LoadingScreen.*`,
`tools/test_web_mount.py`, `tools/test_web_memory_budget.py`, and docs (`decisions.md`, `storage.md`,
`memory.md`, `toolchain.md`, `testing.md`, `protocol.md`, `plan.md`, `tasks.md`, this file). `loader.ts`
and `main.c` also contain the other sessions' edits.

## Background

A spike on 24 October linked 987 MB of a real 1,073 MB Yuri's Revenge install from OPFS through WasmFS
instead of copying it, and kept the JS heap near 19 MB. Findings that still matter: OPFS can only be
mounted from the game thread (in `main()`); WasmFS file calls abort in `preRun`, so files are put in place
in `onRuntimeInitialized` and `main()` is started with `callMain`; `opendir` fails on OPFS directories, so
files are linked by name from the manifest; WasmFS has no NODEFS (headless uses its Node backend); a
write through a link would change the imported file. Codex's later runs linked every file with a bounded
read cache and reached the menu 15.4 s after `callMain` on an optimised build, which is what pointed at
the read path, and then at the intro movie, as the places to look for time.
