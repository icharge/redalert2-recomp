# Browser frame-performance update, 29 October 2026

The target remains a busy match at 720p–1440p with HD vehicles off. Task 5 is
deferred. Task 8 is skipped because the measured wait margin is `M = 16 ms`.
Task 9 is skipped because its entry gate requires a second with at least 1,000
clock reads and both sleep counters at zero; every observed second had at least
91 `Sleep(n)` calls. A later profile found `wait_ms` polling
`clock_gettime`, a separate wait path that the proposed QPC shim would not
affect.

- Task 6 is committed as `df45ca4`: the WebGL2 presenter has five scaling
  modes and shader-rendered blurred bars. Unit and type checks pass. A live
  pixel comparison matches both the 800×600 menu and active skirmish for YR
  and RA2 through both WebGL and the 2D fallback. Every capture has zero
  differing pixels; the YR skirmish is 1920×1080 and the RA2 skirmish is
  1280×720. Each menu movie produced 24 changing captures.
- Task 7's current YR busy HD-off matrix reports 62/60 fps at 720p, 61/44 at
  1080p, 50/34 at 1440p, and 38/23 at 4K (median/1% low). Worst frame gaps
  are 33, 127, 57, and 68 ms. The 720p median/low bars pass; 1080p misses the
  low bar; 1440p misses both FPS bars. The 33 ms gap bar passes only at 720p.
  4K is record-only. Idle-menu CPU remains 4.2% below baseline, short of its
  40% target.
- Task 10's futex candidate failed the repeated browser keep gate and was
  reverted. The mixer used 13.3% of one core (3.24% in `mix`); its wake was
  changed from 5 ms to 10 ms and the five-minute audio/skirmish check passed
  with zero underruns. A high-uptime FPS deadline sentinel bug was fixed; the
  current YR browser now emits FPS telemetry. Main-thread traces measured
  0.789 ms/task frame at 1080p and 1.067 ms at 1440p, under the 4 ms bar.
- Task 11's HD-off 1440p ten-minute soak now passes the Wasm growth gate after
  the 640 MiB initial-memory rebuild: 640 MiB peak, zero Wasm growth after
  60 seconds, 2,571,580 bytes JS heap growth, and no seconds without a published
  picture. The earlier 4K soak peaked at 442.5 MiB with zero post-minute Wasm
  growth. The current 4K soak is still outstanding.
- Task 12 remains incomplete. The current YR busy matrix and 1440p soak were
  run using the sole imported profile, `work/perf/profile-fresh`, at its
  original 5173 origin. RA2 menu and skirmish pixel captures pass with zero
  differing pixels on the retained RA2 build; a current-source RA2 link has
  not completed. The full current release matrix for both editions, 4K soaks,
  final full presenter suite, final docs, and final branch review remain open.
  No additional game import was made. After measurements, 380,258,388 bytes of
  regenerable caches were cleared from the retained profile while preserving
  its IndexedDB/OPFS. A mistakenly created empty 77,537,983-byte profile was
  removed; it contained no game import.

Before/after comparison (baseline values are from the 26 October Release run):

| Case | Before | After current changes | Evidence state |
|---|---:|---:|---|
| 1280×720 busy save, HD off | 23 fps median / 22 1% low; 82 ms worst gap; 256.15% CPU | 62 / 60; 33 ms; 256.99% CPU | FPS and gap bars pass; CPU is 0.3% above baseline. |
| 1920×1080 busy save, HD off | 20 / 18; 83 ms; 276.98% CPU | 61 / 44; 127 ms; 257.65% CPU | Median passes; 1% low and gap bars fail. |
| 2560×1440 busy save, HD off | 18 / 15; 99 ms; 306.07% CPU | 50 / 34; 57 ms; 258.13% CPU | FPS and gap bars fail; CPU is lower. |
| Idle main menu | 247% CPU | 236.15% CPU | 4.2% lower; misses the 40% reduction target. |
| 2560×1440, 10-minute busy soak, HD off | 768 MiB peak; 137.7 MiB growth after 60 s | 50 / 28 fps; 86 ms worst gap; 640 MiB peak; 0 Wasm growth after 60 s; 2,571,580 bytes JS heap growth | Wasm growth gate passes; FPS is recorded without a soak target. |
| 3840×2160 busy, HD off | Could not be selected | 38 / 23 fps; 68 ms worst gap; 640 MiB peak | Record-only current 60 s case. |
| 3840×2160 soak, HD off | Could not be selected | Earlier run: 442.5 MiB peak; zero Wasm growth after 60 s | Previous-build record only; repeat on the current build. |

Exact run files and baseline rows remain in the [plan results](../superpowers/plans/2026-10-26-web-frame-performance.md).

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

## 24 October 2026: RA2Web WOL lobby POC

The existing `ra2web/server/scripts/wol-smoke-client.ts` passes against a local
RA2Web server on port 19090 with account storage in memory and file logging
disabled. It registers an account, negotiates the WOL client version and
session, joins `#Lob_45_0`, receives the lobby roster, creates and lists a game,
and receives a `STARTG` gserv handoff. The host then leaves and the server
closes the game cleanly. The temporary server was stopped after the run.

This establishes the RA2Web WOL-style protocol and room-to-gserv handoff as a
working target. `web/e2e/wol-poc.html` passes in the browser using native
`fetch` and `WebSocket`: it registers/logs in, negotiates version and locale,
joins `#Lob_45_0`, creates a room, and receives the `STARTG` gserv URL and game
ID. The run used `http://localhost:5173` and the local memory-only server.
Neither POC exercises the game's WOLAPI COM calls, a second player, nor a
connection to gserv or a live match. W13.2/W13.3 remain open. A first pass over
the shipped Yuri's Revenge `GameMD.exe` (SHA-256
`7b8a068535d6af06845edf95ae829b113d00c02909330e16f197426cd7db94b6`) found
that the game has a distinct `GAME_INTERNET` mode. Entering it initializes the
multiplayer network class and reads `MultiPlayer\PortBase` (default 1250,
advanced by 7 when an existing setting is present). The shared initialization
path is labeled `IPXManagerClass::Init`, constructs two socket/channel objects,
and imports `sendto`/`recvfrom` from WSOCK32. This establishes that the Internet
mode enters the game's own network manager and that UDP socket primitives are
present; it does not yet prove which socket calls carry live match frames or
whether the manager encapsulates IPX-shaped packets. Historical RA2 online-play
notes describe WOL as matchmaking followed by peer UDP, separate from the LAN
IPX path. Next trace the Internet-mode call sites through the manager's send
and receive routines, then compare an observed match packet to the RA2Web
gserv frame format before choosing a browser relay transport.

The in-game startup failure is earlier than that transport work. The game calls
`CoCreateInstance` for three WOLAPI classes in `FUN_00785370`; the browser host
currently registers only the Blowfish class (`src/web/main.c`). If the first
Chat class is unavailable, initialization reports the shared-internet-library
error and exits before it sends any HTTP or WebSocket request. The Chat object
then uses a connection-point subscription for event callbacks and methods at
vtable byte offsets `0x10`, `0x18`, `0x24`, `0x3c`, `0x48`, `0x50`, `0x60`,
`0x68`, `0x7c`, `0x8c`, `0x90`, `0x94`, `0xa8`, `0xb0`–`0xc0`, and
`0xd0`–`0xf4`. The second object has its own callback interface and is used for
channel/game events. These offsets were observed in the shipped `GameMD.exe`
call sites; method names and argument semantics still need to be mapped before
implementing the COM adapter. The next bridge milestone is to satisfy the
startup interfaces and event subscriptions, then map login, channel listing,
game create/join, options, and start callbacks onto RA2Web commands. The
browser HTML POC remains only a server-protocol probe until the game itself can
reach those calls.

## 24 October 2026: WOLAPI bridge checkpoint

Read-only extraction of the embedded type library in the supplied
`E:\Games\Westwood\RA2\Wolapi\Wolapi.dll` established the x86 COM method order,
stdcall argument counts, connection-point identities, event signatures, and
Server/Channel/User layouts. The auxiliary classes are INetUtil and IDownload;
each has a no-argument PumpMessages method that must remain in its vtable.
The browser now registers all three compatibility classes through win32hle.

The original Yuri's Revenge Online → Custom Match screen was exercised in
headless Chrome against the local RA2Web server on port 19090. It accepts input
in the original nickname/password controls, authenticates through HTTP and
WebSocket, receives its user locale, joins `#Lob_41_0`, and displays the local
player in the native roster. This is beyond the separate HTML protocol probe.
The Create Game flow also leaves the lobby, creates a type-41 room on RA2Web,
receives its roster/gserv announcement, and opens the original setup screen.
The game sends GAMEOPT updates from that screen. Their byte encoding and
round-trip interpretation still need validation with a second native client.
Screenshots and redacted wire captures are under `build-web/wol-menu-shots`.
The game logs an INETMIB1.DLL lookup warning, but that lookup is nonfatal in
this flow; the missing locale callback was the actual post-login blocker.

RA2Web's string locale codes are mapped to the DLL's numeric Locale enum.
The bridge supplies a native directory entry for the configured global lobby
because RA2Web creates that channel on JOIN and lists only game rooms. Native
channel names omit `#`; wire commands include it. User records mark the local
player with bit 0x8000, and comma-separated roster metadata is not treated as
additional players. The active channel has separate storage from room lists.
Runtime-only PortNumberOverride staging skips the retired UDP mangler probe.

Both game WASM targets build. The COM self-test checks method stack cleanup,
discovery, login credentials, locale callbacks, lobby directory/join/leave,
and room-create acknowledgements. TypeScript checking and the 23 WOL/loader
tests pass. An HLE editable-combobox fix in sibling pcrecomp is required for
the native nickname control; this dependency change has not been committed.
W13.2 remains open: multi-client room listing/join/options and the native start
handoff still require validation. W13.3 gameplay transport is not established.

## 24 October 2026: distinct LAN identities in HLE

The browser loader now stages a fresh cryptographically random `woldata.key`
for each game runtime. It is 128 ASCII digits, remains in the in-memory game
folder, and is not imported or persisted, so two tabs on one browser profile
still get separate LAN identities. `e2e/lan.mjs` checks the keys differ and
then verifies both clients enter and render the same LAN match. The automated
browser test passed, and a manual retest confirmed the fix.

## 24 October 2026: native RA2 Custom Match POC through STARTG

The rebuilt Red Alert 2 module now joins its correct Lob_33_0 lobby. Its first
untyped directory request previously received the wrong edition's lobby name,
which the game rejected. The initial directory regression passes for both RA2
and Yuri's Revenge; YR uses Lob_41_0.

Two native RA2 clients were exercised against local RA2Web: login, room listing,
Create Game, Join, matching rosters/map, a host Short Game change received by the
guest, guest Accept and host Start Game. RequestGameStart now forwards the native
linked player list instead of listing only the host. Both clients receive the
same STARTG session, invoke OnGameStart, and store the server's instance number
(4 in the final run). The full gserv URL, game ID, timestamp and each client's
ticket remain in WASM memory, verified through the exported session getter.
The passing durable test is web/e2e/wol.mjs --start; captures are under
build-web/wol-ra2-start. Explicit YR login/lobby/logout also passed, with the
WebSocket closing. RA2 Back/hub/Main Menu was checked manually without a hang.

Closing a WOL client while HTTP login or WebSocket opening is pending now
cancels the connection attempt; stopped/replaced loader clients cannot deliver
late callbacks into the game. The cancellation regressions failed before the
fix and now pass. Both game modules and both COM selftest editions build.
The frontend suite passed 246 tests, TypeScript and scoped ESLint passed, and
24 lift-patch tests passed. A narrow fix to the existing RA2 resolution patch
was required to compile: its quiet clamp jumped to a C label emitted in another
function; the patch now emits those stores/save inline. Other local work was
preserved and this continuation's changes are uncommitted.

This establishes the native menu/session POC, not a live Internet match. After
STARTG the game attempts UDP NET_PORT_PROBE packets; browser delivery of that
native Internet packet path remains W13.3. W13.2 still has compatibility and
negative-path work, including YR two-client/start verification and failed room
operations. Current details and reproduction commands are in
[handoff-wolapi.md](handoff-wolapi.md) and [testing.md](testing.md#wolapi-bridge).

## 24 October 2026: room metadata, passwords and rejected joins

The bridge now carries native resolution flags, minimum/capacity, flags and
ex-info in a WOLAPI2 topic envelope, while retaining WOLAPI1 read compatibility.
Joining preserves the selected Channel record. Raw MODE +l capacity changes
are reflected in the metadata, and server password/private bits survive the
native extras. The guest now sees the actual four-player RA2 / six-player YR
room limit in these runs instead of a hardcoded eight.

Native room keys are forwarded on create/join. Rejected joins return the
specific HRESULTs used by the game's bad-password, full, closed and banned
branches; duplicate/rate-limited creation gets OnChannelCreate failure. The
pending state is cleared before callbacks so returning to the lobby or retrying
inside a native callback is retained. COM regressions cover these cases,
malformed metadata and wrong-channel errors.

Both native editions passed the extended two-player browser regression:
protected room, wrong key, native error message, acknowledge/recover to lobby,
retry the correct key, roster/options, Accept/Start, matching handoffs, native
instance IDs and full session retained in WASM memory. YR exercised its original
resolution confirmation. Captures are build-web/wol-yr-password-start (instance
6) and build-web/wol-ra2-password-start (instance 7). Both COM selftest editions,
TypeScript, scoped ESLint and all 246 frontend tests passed. Both modules were
rebuilt; no commit was made. W13.2 still needs chat and start-abort/disconnect
handling; W13.3 still needs a compatible native Internet packet transport.

## 25 October 2026: playable native RA2 relay POC

Resumed Claude's WOLAPI handoff and tested its existing connection-port
normalization. Both native RA2 clients received FRAMESYNC and continued through
more than 28,000 simulation frames through RA2Web's ticket-authenticated native
relay. Each player deployed its MCV into a construction yard using native input;
no sync error was observed during that run. Captures are in
`build-web/wol-udp-port-normalized/{host,guest}`.

A fresh trace-free gameplay check exposed another startup race: the host leaves
the WOL room before the guest consumes NET_GO, and PART/NAMES removed the host
identity needed by the game's scenario-negotiation code. The bridge now retains
the committed match roster while still completing its own leave; new room/lobby
requests clear the prior session. Unrelated-channel PART/NAMES are ignored.
The ordering regression failed before the change and passes for both COM
editions. The private RA2 module rebuilt and passed native gameplay without
network tracing (`build-web/wol-ra2-roster-fixed`).
The forced early host PART/NAMES gameplay check also passed without tracing
(`build-web/wol-ra2-early-part`): both simulations advanced from frames
[354,405] to [519,574] during the five-second observation window.

The e2e harness now supports `--build` to stream a private module without
overwriting shared assets, `--play` to require FRAMESYNC and sustained simulation
progress, and `--part-race` to force the problematic lobby-event ordering.
Relay tickets are redacted and binary captures record datagram sizes. The full
frontend suite passed 259 tests; both COM editions, TypeScript, scoped ESLint and
the six native-relay server tests passed. Changes remain uncommitted.

W13.2's native menu/session acceptance is complete. W13.3 stays open for YR
Internet gameplay, separate-network validation and relay lifecycle hardening.

## 25 October 2026: YR gameplay and completed-match lifecycle

The private `build-web-wol-yr` module compiled and linked with the bridge's
current source, keeping its generated output out of shared dev modules and Git.
The YR manager/connection offsets were checked against the lift and exercised by
two native clients. Both receive FRAMESYNC and sustain gameplay through RA2Web's
native relay, including the forced early host PART/NAMES ordering. The host ran at
2580x1080 and the guest at the game's confirmed 640x480 mode; both deployed MCVs.
Manual capture: `build-web/wol-yr-play/{host,guest}`.

The match completed via native guest Abort Mission -> Quit, remote host victory,
score continuation and return to Custom Match. This exposed the old gameplay
relay staying open on lobby return. The loader now stops it for new lobby/room
entry and WOL login while preserving it for the startup PART transition. Lost
sockets also close and release the packet-poll timer. Five new lifecycle cases
failed before the fixes and now pass. The full frontend suite passes 265 tests;
TypeScript and scoped ESLint pass.

`--finish` now verifies native YR resignation, remote defeat/victory handling,
score continuation, both native lobby callbacks, both old relay sockets closed,
and both native session getters cleared. Passing gameplay/end-of-match captures
are under `build-web/wol-yr-finish-verified`. An earlier automation run clicked
before native menu initialization; the fixture now waits for the menu to open
and settle. The remaining W13.3 gate is separate-network verification, with a
staging-endpoint question pending. No generated game build is to be published.
The final fixture additionally waits for both native lobby callbacks and passed
again (`build-web/wol-yr-finish-final`, frame samples [413,421] -> [585,588]).
