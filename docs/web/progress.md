# Browser implementation and verification, 23 October 2026

The active scope is W9.1–W9.6, W10, and the parked W4.17–W4.18. This is a
working verification ledger; an implementation without its runtime check is
still open. `tasks.md` records completed acceptance checks.

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

Still requiring evidence or fixes:

- W4.17–W4.18 remain open. `ComboDropWin` is created as a child without a border;
  its custom procedure handles `WM_PAINT` at `0x0060D846`, while `WM_ERASEBKGND`
  returns 0 without drawing. The paint branch calls `FUN_006208F0` twice with a
  two-pixel edge thickness. Its `DAT_00887310` target is the game's AlternateSurface
  created by `FUN_00533FD0`; the `+0x30` vtable slot is `FUN_007BA610` (line rasterizer),
  and `+0x24` is `FUN_007BAEB0` (pixel write). Both use the surface's lock/unlock slots
  (`+0x5c`/`+0x60`). The game's lock helper `FUN_004BAD80` returns null unless
  `DAT_0089F978` or `DAT_00A8ED80` is set. Passing the retail `-WIN` switch sets the first
  flag but changes the menu surface to 640x480 and still leaves the dropdown frame incomplete.
  The browser now sets that lock gate at the pump boundary, preserving the 800x600 menu; the
  gate probe and rebuilt capture confirm this path, but the color list still lacks the native
  side and bottom frame (`work/web-dropdown-lock-gate/`, compared with
  `work/ui-reference/native-open-dropdown.png`). W4.17 remains open because the drawn
  offscreen frame is not visible in the browser capture. A filtered replay of the matching
  top-row color list shows the game draws all four edges at the native coordinates
  (x=421–468, y=78–288) into its
  800x600 `AlternateSurface`; the lock returns a valid pixel pointer, but HLE identifies that
  surface as offscreen (`primary=0`). No DirectDraw `Blt` or `BltFast` from that surface follows
  the child paint in the replay (`work/web-lobby-alt-line-trace/`). The remaining likely gap is
  composing the child-painted offscreen frame into the displayed primary surface. The native
  captures used for the earlier button comparison were lossy; W4.18 is now
  verified and fixed as recorded above.
  W4.19 passes on the current build: the right-panel/minimap/title-tab
  crop after 40 seconds idle is pixel-identical after opening and closing a dropdown.
  Screenshots are under `work/web-lobby-idle-40/`; Windows references remain under
  `work/ui-reference/`.

Do not use a development page for a long check while editing its sources:
hot reload can invalidate the run. Integration runs use immutable page/WASM
snapshots in `work/`, served by `vite preview --outDir ...`.
