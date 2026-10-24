# Browser implementation and verification, 23 October 2026

This is a working verification ledger; an implementation without its runtime
check is still open. `tasks.md` records completed acceptance checks.

- F10 is an accessible browser view of settings owned by the C host. Commands
  cross the input queue; settings events acknowledge the host's saved state.
  There is no second copy of game settings in IndexedDB.
- HD rendering now calls the existing voxel compositor. Input uses separate
  game dimensions, independent of the doubled picture and page scaling.
- Windows and the browser share `src/runtime/modern_controls.inc`; browser
  adapters latch input on the game thread. The Windows build compiles.
- Imported data mods live in OPFS at `game/<id>/mods/<name>`. F9 at the main
  menu saves the selection, flushes OPFS and reloads into the same game. Mod
  saves and settings live below their own mod directory. Executable-patch
  mods are refused because their runtime is not available.
- The browser runner uses the same cases and result checks as native
  `tools/playtest.py`. Large archives are streamed from an ephemeral loopback
  server using the import's allowlist. They are never part of the page build.
- The frontend workflow runs lint, TypeScript, Vitest and the page build on
  pushes and pull requests. It does not need a game install or lifted code.

Verified locally:

- Frontend lint and type checking pass; 137 tests pass (23 files).
- Browser C/WASM build passes, using the existing Emscripten SDK. A sandboxed
  link can wait forever for a cache lock it cannot create; SDK cache access
  is required. `WEB_LINK_OPT=-O1` was used for integration builds.
- `e2e/remaster.mjs` passes F10, scaling/resolution/HD/control persistence after
  a reload, fullscreen entry/exit, Pointer Lock entry/exit, real mod-folder
  import, and F9 restart into the persisted overlay. Artifacts are in the
  ignored `work/web-remaster-next/` directory.
- The first browser suite batch passed 15 of 17 cases: ordinary menus, return
  paths, single-player screens, a live skirmish, and building/training by
  mouse (3 production and 10 placement events). The two network menu failures
  were reproduced and fixed, as recorded below.
- The traced cause of those network failures was false UDP read readiness in
  Emscripten SOCKFS. The HLE now peeks without consuming to check for a queued
  datagram (including zero-length packets). After rebuilding, both
  `menu-wwonline` and `back-network` pass; together with the earlier menu
  batch this clears the `menu-*` acceptance gate.
- The remaining campaign and resolution batch passed 9/9: Allied and Soviet
  campaigns, plus skirmishes at 1280x720, 1920x1080, 2560x1440, and 3840x2160.
- `e2e/measure.mjs` now samples a 1280x720 skirmish with HD off and on. In this
  headless run, game rate was 62 fps / 16 ms with HD off, and 47 fps / 21 ms
  with HD on; publish cost rose from 0.33 ms to 1.59 ms. This completes the
  required live HD measurement.
- `e2e/edge-scroll.mjs` enters Pointer Lock in a live skirmish and compares
  TacticalClass camera coordinates before and after movement to opposite
  battlefield edges. Both windowed and fullscreen passes moved the camera;
  the second pass uses the other edge so reaching the map boundary in the
  first pass cannot mask a working fullscreen path. The run is recorded in
  `work/web-edge-scroll-retry/edge-report.json`.
- `e2e/battle-controls.mjs` now verifies Modern right-click with game state:
  the selection stays intact, one contextual order enters the command queue,
  and the selected MCV moves. In a fresh skirmish it deploys the MCV, builds
  and places a power plant and barracks, then Shift-clicks infantry production;
  the queue index advances by exactly five. The complete browser run also
  passes live HD sampling and edge scrolling in both display modes. Evidence
  is in `work/web-battle-controls-verified-3/report.json`.
- The remaining nine browser cases pass, including both campaigns and all
  tested resolutions. The two original menu failures now pass after the UDP
  fix, so the back, single-player, skirmish, campaign and resolution cases in
  the current suite have all been covered successfully.

- W4.18 passes against a fresh lossless native reference. The original game
  has no sidebar hover highlight; holding selects an orange/yellow frame.
  USER32 now delivers owner-draw selection/focus notifications even when the
  guest consumes paint. The button, hover and paint selftests pass;
  `e2e/lobby.mjs` passes raw-pixel idle/hover/held, captured drag-out/in and
  release checks (`work/lobby-button-acceptance/`).

W4.17 is fixed. The dropdown paints its two-pixel frame into `AlternateSurface`,
but its final copy previously covered only the client rectangle. The lift now
expands the source and destination copy rectangles by two pixels on each side;
the targeted pattern is unique in both shipping executables. The five
`tools/test_lift_patches.py` tests pass. Browser captures show the color and
resolution list frames in `work/web-dropdown-current/color-open.png` and
`work/resolution-frame-first/resolution-open.png`, respectively; the native
color-list reference is `work/ui-reference/native-open-dropdown.png`. Details
are in [issues.md](issues.md), 8. W4.18 is verified and fixed as recorded
above. W4.19 passes on the current build: the right-panel/minimap/title-tab
crop after 40 seconds idle is pixel-identical after opening and closing a
dropdown (`work/web-lobby-idle-40/`; Windows references in `work/ui-reference/`).

Do not use a development page for a long check while editing its sources:
hot reload can invalidate the run. Integration runs use immutable page/WASM
snapshots in `work/`, served by `vite preview --outDir ...`.

## 24 October 2026: Exit confirmation bridge POC

The original main menu's Exit Game action opens only a React confirmation.
The first POC overlaid the native dialog; protocol 6 supersedes that with
`web_exit_confirmation_patches` in `run_lift.py`. It replaces Init.CPP's
unique confirmation call on Emscripten before native dialog creation. The
web host waits on an atomic mailbox while releasing the guest machine
lock, then returns the original helper's OK/Cancel result directly to the
game's caller. Native hosts retain the original call. Escape is Cancel;
game input and pointer capture are suspended while the web prompt is open,
and focus returns to the canvas when it closes.

Both game modules were rebuilt. `web/e2e/exit-confirm.mjs` passes against
Yuri's Revenge and Red Alert 2 with real browser clicks on the production
page: invalid and stale replies are rejected, reopened prompts have unique
request IDs, Stay and Escape allow the prompt to reopen, and Exit produces
the game's exit event with code 0. Neither run creates native dialog
`0x120`. The test accounts for menus centered inside larger configured
surfaces. Reports, logs, and screenshots are in `work/exit-confirm-hook-yr/`
and `work/exit-confirm-hook-ra2/`.

Validation: 169 unit tests and 10 lift-patch tests pass, TypeScript checking
and the production page build pass, focused ESLint checks pass, and
`git diff --check` passes.
The full `pnpm lint` still reports the pre-existing undefined
`BrowserControls` reference at `web/e2e/auto-pointer.mjs:24`.

## 24 October 2026: Browser LAN multiplayer

W12.2 and W12.3 pass the two-client browser acceptance check. `web/e2e/lan.mjs`
exchanges a manual WebRTC offer and answer, verifies lobby IPX traffic, and
starts the same LAN match on both clients without hosted signaling. The test
waits for positive game frame rates and checks sampled canvas pixels before
saving the match screenshots, so reaching the start event alone cannot pass.
The verified run rendered 4,012 lit samples on the host and 4,066 on the guest
at 2580x1080. Screenshots and full logs are in
`work/web-lan-match-frames/`; see [testing.md](testing.md#lan-transport-two-real-browsers)
for the command.


## 24 October 2026: installation routes and exit cleanup

React Router 7 now serves the launcher at `/`, import at `/import`, and
installation launches at `/game/:slot`. One imported folder is one stable,
nonreused numeric slot with RA2/Yuri edition choices. `?edition=ra2` and
`?edition=ra2md` select explicitly; Yuri is the default for folders with
both. Vite's deployment base supports `/emu/` for routes, WASM and browser
assets, and service-worker navigation/caches.

Schema v2 preserves existing edition records and legacy OPFS references in
one installation. Every new import has fresh slot namespaces, including a
new slot 1 after legacy removal. Common files share storage only within an
installation. Saves, mods and preferences are isolated by slot and edition.
Planned editions are recorded before copying; cancellation, failure and a
reload between editions remain resumable from the launcher.

Normal Exit persists pending writes and replaces the game document with the
launcher. Input/presentation/audio/LAN callbacks stop without calling dead
WASM exports. Browser Back also unloads the runtime. Failed persistence
keeps a retry action; startup abort rejects the session instead of hanging
the return action. No generated game content is added to source control.

Verification: 193 web unit tests, TypeScript, root and `/emu/` production
builds, and focused ESLint pass. A real-browser test imported the same 1 GB
folder twice, launched both editions, refreshed a direct `/emu/game/1`
URL, restored saves, confirmed slot isolation, verified browser Back closes
workers and drops runtime globals, and removed installations independently
while retaining saves. Offline prefixed navigation verifies cached build
metadata. Exit tests confirm clean exit code 0, no native confirmation,
no post-exit exports, zero game workers, and launcher arrival. Artifacts
are under `work/exit-launcher-*` and `work/installation-routing/browser`.

The full lint command still has the pre-existing undefined `BrowserControls`
in `web/e2e/auto-pointer.mjs:24`; the changed files pass lint.
