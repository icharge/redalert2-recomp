# Handoff: WOLAPI bridge and Internet play, 25 October 2026

## Native Custom Match result reporting (25 October, evening)

Approved design: `docs/superpowers/specs/2026-10-25-native-match-results-design.md`.
Plan/evidence: `docs/superpowers/plans/2026-10-25-native-match-results.md`.
This addition is recorded in the native result-reporting commits. The companion
RA2Web server commit is `9752731` (`feat(server): archive native custom match results`).
The user selected **match history only**, with no ladder/MMR/point changes,
and still owns real gameplay testing. No new gameplay or public probes were run.

- `INetUtil::RequestGameresSend` (slot 3, host/port/data/length) copies the native
  packet synchronously to `Module.ra2WolReport`. Original host/port are ignored;
  HTTP uses only the trusted operator settings. Capture checks pointer/size,
  packet boundaries and numeric IDNO. Limit: 32 KiB and eight pending callbacks.
- Completion is `INetUtilEvent::OnGameresSent` at **absolute vtable slot 5**,
  delivered by the game-thread message pump after explicit server storage
  acknowledgement. A replacement sink, new login or STARTG invalidates stale
  callbacks. `RequestGameEnd` now succeeds without erasing the result/session.
- Pump draining uses a snapshot. A native failed-send callback can synchronously
  request another send, and immediate failures otherwise keep one pump spinning.
  A regression demonstrated this before the fix and passes for RA2 and YR.
- Browser match contexts survive PART, lobby return and relay shutdown; a late
  HTTP completion cannot notify a new login or match. HTTP timeout is 10 seconds
  (the WolClient configured timeout); failures log and deliver a failure HRESULT.
- Server route: **POST `/native-results/{full-game-id}`**, Bearer session, raw
  `application/octet-stream` native packet. It validates authenticated roster
  membership, full/numeric ID association, edition, field bounds and report window.
  Native channel types 33/41 bind new instances to SKU 16640/18688. Existing
  instances created by the old running server do not have that metadata: restart
  the updated backend and create a new match before manual validation.
- Native FieldClass differs from the web report: flags are type 2 / one byte,
  signed/unsigned 32-bit fields use types 5/6, C strings type 7, binary tallies
  type 20; payloads have four-byte padding. Headers/numeric values are big endian.
  Native IDs use numeric **IDNO**, not the web client's string GMID. Native player
  suffixes start at 0. The report builder is RA2 0x698d00 / YR 0x6c6f50; previous
  `wol-yr-finish-final` logs already contain "Sending game results" on both clients.
- Sanitized packets and decoded flags, duration, map, outcomes and statistics are
  stored in the existing unscored match payload's `nativeReports`. Account/IP and
  unknown fields are removed, including uninitialized padding. Provenance is
  `source: native-client` and authenticated reporter. Duplicates are idempotent;
  up to four distinct reports per reporter are retained. Incomplete reports cannot
  replace terminal summaries; conflicting terminal outcomes set `disputed: true`
  and unknown summary outcomes. AI counts bound extra house records; human
  membership must match the server's STARTG roster.
- Existing admin match reads expose the report payload; player history rows use
  season 0 and zero ranking gains. Scored rows are protected. No schema migration
  is needed. SQLite history rows now upsert like the memory backend.
- Native relay instances become active once the roster connects and retire after
  the last peer leaves, retaining their metadata for the configured report window
  (default 600 seconds). Long games no longer expire as never-started instances.

Verification so far: 287 frontend tests / 35 files passed, then 43 focused browser
tests passed again after acknowledgement validation and timeout/failure coverage. Frontend TypeScript/scoped
ESLint and server TypeScript passed. 122 focused server tests passed, including
native results, native relay, ranked reports, ladder service, WOL creation and
gserv lifecycle. Both native COM
selftest editions passed, including the retry regression. Independent review
found no material issues, including a follow-up review of the retry/ACK changes.
The broader admin run had three pre-existing Windows replay-fixture errors from
colon-containing filenames; no result-reporting failure. Logs are ignored under
`build-web/native-results-*` and `build-web/wolapi-results-*-final.log`.
Both private module builds succeeded under `build-web-udp` and `build-web-wol-yr`;
published WASM SHA256 hashes match their build outputs. RA2 needed default
FreeType/HarfBuzz port variants prewarmed before SDL_ttf to avoid Emscripten's
nested cache lock. Their
published stems now follow current CMake: `ra2` and `ra2md`, respectively. Keep
another task's live preview bundles intact. See `testing.md` for manual checks.

## Earlier playable WOL POC

Work resumed from Claude's "WOLAPI work". **Nothing is committed**, in any of the
three checkouts (listed below). Two native Red Alert 2 clients now play through
the RA2Web relay: both receive FRAMESYNC, advance beyond frame 20,000, and accept
native MCV deploy commands. Claude's existing port-word normalization experiment
unblocks the simulation. A fresh regression then exposed a separate post-STARTG
roster race; the bridge now preserves the match roster during scenario negotiation
(details below).
Captures: `build-web/wol-udp-port-normalized/{host,guest}` (including
`deployed-unlocked.png` and `verified-play.png`). YR now also passes native
gameplay and full match completion (see below). This is a local two-browser POC;
separate-network play and the remaining relay hardening are still open.

## What works (verified in the real game, Red Alert 2 and Yuri's Revenge)

From earlier work and Codex's continuation (`e44a0d2`, `7cb4e6d` plus uncommitted
changes):

- Login joins `#Lob_33_0` (RA2) / `#Lob_41_0` (YR) with roster and MOTD; Back and
  Main Menu return without hanging on "Logging off".
- Create Game, a second client joining, option sync (GAMEOPT), Accept, Start
  Game: both clients receive the same STARTG (room, gserv URL, full game ID,
  timestamp, own ticket) and run the native OnGameStart with the server's instance
  number. Protected rooms (wrong key, native error dialog, retry), full/closed/
  banned join callbacks, public chat both ways, failed-start recovery, unexpected
  WebSocket close reporting.
- Room metadata is the `WOLAPI2:<reserved>,<min>,<max>,<flags>;<ex-info>::<topic>`
  topic envelope (still reads WOLAPI1).
- Selftests: `wolapi_selftest.c` passes; 249 frontend tests passed at the last full
  run (before the Internet-transport changes below, which add 5 + server tests).

### YR gameplay, match completion and relay cleanup (25 October)

A separate `build-web-wol-yr` module built from the current YR lift with the
1 GB / 4 GB memory override and private `WEB_OUT`. The YR connection offsets
(manager +0x28/+0x44 and peer +0x4c) were checked in IPXManagerClass::virtual_1 at
0x541820 before testing. Both clients logged `Session.ViaPacketRouter = false`,
received FRAMESYNC and sustained gameplay with the forced early host PART/NAMES
ordering. The host ran at 2580x1080 and the guest at the native 640x480 mode after
accepting its resolution prompt. Both players deployed MCVs successfully.

The manual match then completed through guest Abort Mission -> Quit, host victory,
score screen and Continue, returning both clients to Custom Match. Captures:
`build-web/wol-yr-play/{host,guest}`. This exposed a gameplay relay remaining open
after returning to the lobby. The loader now stops the old relay on a new native
join/joingame request or WOL login; PART is deliberately excluded because it
occurs during match startup. Socket close/error also clears the packet-poll timer
and closes the transport. The new lifecycle regressions failed before these fixes
and now pass.

The automated `--finish` YR fixture verifies play, native resignation, remote
victory, score continuation, both lobby joins, both old relay sockets closed and
both native session getters cleared. Passing capture:
`build-web/wol-yr-finish-verified`, simulation samples [354,331] -> [536,508]
before resignation. `build-web/wol-yr-finish` is an earlier failed automation run
that clicked before the native menu finished initialization; it is not a pass.
Latest checks: 265 frontend tests, TypeScript and scoped ESLint passed. The YR
module linked successfully. All new changes remain uncommitted.
The final regression also waits for both native `Joined Channel` callbacks,
not just wire acknowledgements: `build-web/wol-yr-finish-final`, samples
[413,421] -> [585,588] before native resignation. Both test browsers exited;
the Vite and local RA2Web services remain listening.

New this session, **Internet datagram relay** (all verified to carry traffic):

1. The game's WOL netcode sends plain UDP, which a browser cannot. RA2Web now has
   a relay: the page opens a WebSocket to `<gserv url>/native`, logs in with the
   STARTG ticket, and the server forwards each game datagram to the player whose
   virtual IP it is addressed to.
2. Players get deterministic virtual IPv4 addresses: FNV-1a of the lower-cased nick
   as `10.x.y.z` (last byte never 0/255). `wolapi.c virtual_ip()` and
   `NativeRelay.ts nativeVirtualIp()` are twins; the selftest pins
   `testuser` to `10.195.82.18`. The bridge puts that address in every
   `User.ipaddr`, so the game addresses peers by it (log: "Requesting ping for
   woltst2 at 10.51.128.106"). `woltst1`=10.51.126.215, `woltst2`=10.51.128.106.
3. In the HLE (pcrecomp `wsock32.c`, emscripten only), non-IPX `SOCK_DGRAM`
   sockets are fully virtual (a slot table, descriptors from 0x8000). **WasmFS has
   no socket layer**, so the old real-socket path failed with ENOSYS ("Function not
   implemented", "Async select failed ... 10038"). Datagrams go through a separate
   queue pair exported as `ra2_udp_buffer/pop/push` (main.c). LAN IPX/WebRTC code is
   untouched. Broadcast/loopback sends are dropped; unmatched destination ports are
   delivered to the primary socket (a NAT would); `getsockname`/own-host
   `gethostbyname` report the virtual IP (`hle_ws_udp_set_local_ip`, set at login);
   a peer's datagram is reported as coming from the port this side last addressed
   it on (see the blocker).
4. Verified: both clients log in to the relay, then exchange hundreds of datagrams
   (NET_PORT_PROBE, progress reports, FrameSync, global acks); the game logs
   "Connection good", NET_READY_TO_GO, loads MP32S8.MAP on both.

## Resolved frame-zero blocker (investigation and verified fix)

Before port-word normalization, after both clients load each showed "Waiting for all players to enter the game..."
with both progress bars at 100.0 (read from memory: doubles at 0xA769F0/0xA769F8)
and the game frame stays 0 (`[record] ... game frame 0`). Neither client ever logs
"Received FRAMESYNC", "Entering wait loop" or "Processing Ticks". Findings:

- The host's `Create_Connections` (sub_0066EE50, RA2) runs late and both clients end
  up with one connection object (IPXManager at 0xA40978: array at +0x28, count at
  +0x44, peer address object at conn+0x4C). Memory dumps of the connection are
  **frozen**: connections receive nothing.
- Cause, from a temporary trace on `sub_005235D0` (the address compare, mode
  `[0x7DDC70]`=2 for Internet games): it compares the IP dword at +4 **and the word
  at +0, which holds the port** (host's view of the guest: port 1380; guest's view
  of the host: 1234). An arriving datagram's address object always has +0 = 0 (its
  port travels separately), so the compare fails and the packet is never routed to
  the connection. The game's design must make these agree some other way that the
  browser run does not trigger (real traffic probably gets +0 filled in a path this
  run never takes); not found yet.
- Tried and **not enough on its own**: reporting the source port a peer was last
  addressed on in `sin_port` and `sin_zero` (the game stores peer ports in the
  `+8` sin_zero word); clearing the "router allowed" byte (below).
- **Verified on 25 October**: `ra2_wolapi_poll()` (called from
  `frame_pump` in main.c) zeroes the port word at conn+0x4C for every connection
  (`g_ipx_manager`: RA2 0xA40978, YR 0xA8E9C0, offsets assumed equal for YR) so the
  compare matches. Both clients now log "Received FRAMESYNC packet from ..." and
  growing `game frame` values, continuing beyond frame 20,000 at about 60 fps.
  Both players' MCVs deployed into construction yards using native input. No
  out-of-sync/reconnection error was observed during this run. Keep this workaround
  scoped to the browser WOL session; replacing native address words is still a
  compatibility patch, not a claim that the original UDP/NAT path is understood.

### Post-STARTG roster race

The first long run used `?udptrace=1`. A fresh run without tracing failed
`Negotiate_Scenario_Transfer`: the host proceeded alone, dropped the guest and
ended the match at frame 110. The guest's WOL capture showed the host's PART and
a NAMES reply containing only the guest while it was still waiting for NET_GO.
RA2's wait loop at 0x750B99 validates that UDP packet against the host identity
in the WOL user array (0xB2A730), which those callbacks had removed.

The bridge now ignores peer PART and NAMES updates for the committed STARTG room
until its own leave or a new room/lobby request. Own PART still completes; a new
Join/Create clears the prior session so fresh rosters are accepted and gameplay
patches stop applying. PART/NAMES for unrelated rooms are also ignored. Both COM
selftest editions passed the new ordering regression after it failed before
the fix. The rebuilt RA2 module also passed the trace-free native `--play` check:
`build-web/wol-ra2-roster-fixed/{host,guest}`. The earlier failing capture is
`build-web/wol-ra2-play-final` (do not mistake that run for a pass).
The forced early-PART regression also passed without tracing:
`build-web/wol-ra2-early-part`, simulation samples [354,405] to [519,574]. Both
test browsers closed after verification; Vite and local RA2Web remain listening.
Fresh checks: 259 frontend tests, both COM editions, six server relay tests,
TypeScript and scoped ESLint passed. The private RA2 module rebuilt successfully.

### Packet router (already handled)

For internet games the host spawns Westwood's `mph.exe` "packet router" and tells
the other player to route frame data through it (`Session.ViaPacketRouter=true` on
the guest). A browser cannot run it, so the match could not start. The bridge
therefore keeps the session's "router allowed" byte cleared once a match starts
(`ra2_wolapi_set_no_router_flag`: RA2 0xA402D0 = Session 0xA3D298 + 0x3038; YR
0xA8E2C8 = 0xA8B238 + 0x3090). Result in the logs: both clients print
`Session.ViaPacketRouter = false`. Side effect: the NAT-correction code that is
gated by the same byte (port "fiddling" alerts) no longer runs. The YR addresses
come from the lifted code and are now exercised by the passing YR gameplay runs.

## Uncommitted work, by checkout

`redalert2-recomp` (branch `web-port`):
- `src/web/wolapi.c/.h`, `wolapi_selftest.c`: everything above in the bridge, plus
  Codex's room/chat/error work.
- `src/web/main.c`: UDP mailbox exports, `ra2_net_trace`, session patches, the
  poll call. Shared file: it also carries another developer's presenter/input
  changes.
- `web/src/game/udp-relay.ts` (+ test), `wol.ts` (+ test), `loader.ts` (+ test):
  relay client, STARTG parsing, `?udptrace` flag (read at module start because the
  router drops the query).
- `web/e2e/wol.mjs` (new, Codex's; I added `--hold <s>` and an `eval` action for
  `--interactive`), `web/e2e/boot-probe.mjs` (scratch probe).
- `docs/web/handoff-wolapi.md` (this file).

`ra2web/server` (branch `feat/wol-lobby-server`, a separate repository):
- `src/gserv/NativeRelay.ts` (new), `src/index.ts` (route `<gservUrlPath>/native`,
  dispose), `test/nativeRelay.test.ts` (6 tests, pass; `bun test`, typecheck clean).
- Restart the server after pulling this (`bun run src/index.ts`, env in
  `docs/web/testing.md`).

`pcrecomp` (separate repository, also holds other uncommitted work):
- `runtime/win32hle/wsock32.c`: virtual UDP sockets and queues, trace
  (`hle_ws_set_trace`), the port reporting. Others' changes in the same file
  (IPX/WebRTC bridge, poll) are mixed in.

`src/recomp/gen_game/` is generated and gitignored. I edited
`recomp_0019.c` temporarily for a trace and **restored it from a copy**; a future
re-lift regenerates it anyway.

## Build and test recipes

- Selftest: from the repo root,
  `emcc src/web/wolapi_selftest.c -I<pcrecomp>/runtime/win32hle -I<pcrecomp>/runtime/recomp32 -DRECOMP_FLAT_MEMORY -sENVIRONMENT=node -sEXIT_RUNTIME=1 -o build-web/wolapi-selftest.js; node build-web/wolapi-selftest.js`
  (`WOLAPI COM startup ABI: PASS`; emcc is in `C:\Users\Norrapat\projects\emsdk\upstream\emscripten`).
- **Use my private build directory `build-web-udp`**: `ninja -C build-web-udp`, with
  `EMCC_DEBUG=0`. It was configured with
  `cmake -G Ninja -S . -B build-web-udp -DCMAKE_TOOLCHAIN_FILE=cmake/emscripten.cmake -DRA2_TARGET=game -DGEN_OPT=-O2 "-DWEB_LINK_OPT=-O1;-sINITIAL_MEMORY=1GB;-sMAXIMUM_MEMORY=4GB" -DFFMPEG_WEB_DIR=<repo>/../ffmpeg-src/build`.
  Why not `build-web-game`: someone else resets its cache (`WEB_LINK_OPT=-O1`), and
  the working-tree `CMakeLists.txt` now caps memory at 256/768 MB for the
  zero-copy WasmFS spike (`handoff-zerocopy.md`), which aborts the normal
  copy-into-memory loader ("crashed: unwind" at about 700 MB of files). The 1 GB /
  4 GB override avoids that without touching their file.
  Its `WEB_OUT` is now `build-web-udp/published`, so rebuilding does not replace
  another developer's live modules. If linking stalls on the known JS symbol-cache
  lock, use `EMCC_DEBUG=1` for the final `ninja -C build-web-udp ra2.js` link;
  compile large object batches with debug disabled.
- YR uses `build-web-wol-yr` with `RA2_TARGET=gamemd`, `GEN_OPT=-O2`,
  `WEB_LINK_OPT=-O1;-sINITIAL_MEMORY=1GB;-sMAXIMUM_MEMORY=4GB`, and
  `WEB_OUT=<repo>/build-web-wol-yr/published`. Quote the complete
  `-DCMAKE_TOOLCHAIN_FILE=<absolute repo path>/cmake/emscripten.cmake` argument in
  PowerShell; an unquoted relative value was split at `.cmake`. Compile objects
  with `EMCC_DEBUG=0`, then link `ninja -C build-web-wol-yr ra2.js` with
  `EMCC_DEBUG=1`. Both private build directories are gitignored.
- **The build publishes both edition bundles into the shared `web/public/game/`
  directory**, so another developer's build can replace the same edition files.
  Prefer the e2e option `--build ../build-web-udp`: it streams that build's
  js/wasm/data over a temporary loopback HTTP server, keeping shared assets
  intact. Do not fulfill the 144 MB debug WASM through CDP: Chrome closes its
  DevTools connection at its 100 MB input-buffer limit.
- **Pass `--arg --intro` to the e2e scripts.** The new start-up-movie skip in
  `main.c` (`ra2_BinkOpen`, 2 frames at 15 fps) hangs the game after "start-up movie
  ... skipped" in headless Chrome; `--intro` plays the movie and boots in about 20 s.
- Two clients through the match (from `web/`; `udptrace` logs Winsock calls to the
  game log and relay traffic to `browser.log`):

```powershell
node e2e/wol.mjs --url 'http://localhost:5173/?target=game&udptrace=1' --build ../build-web-udp --shots ../build-web/<dir> --arg --intro --play --hold 60
node e2e/wol.mjs --url 'http://localhost:5173/' --build ../build-web-wol-yr --shots ../build-web/wol-yr-finish --arg --intro --part-race --finish
```

  Interactive (keep both clients; send JSON lines, `eval` runs JS in the page):
  `tail -f actions.txt | node e2e/wol.mjs ... --start --interactive`, then append
  `{"client":"host","eval":"<js>","wait":300,"shot":"name"}`. Memory is
  `window.Module.HEAPU32[addr/4]` at the guest address. Useful reads: progress
  doubles 0xA769F0/0xA769F8, players 0xA3FA80 (count 0xA3FA8C, address object at
  player+0x28), IPXManager 0xA40978, session state 0xA3D298 (4 = Internet),
  `ViaPacketRouter` byte 0xA3FBA8, address mode 0x7DDC70.
  `--play` requires both simulations to reach frame 300 and then keep advancing
  for another five seconds, with FRAMESYNC received. `--start` alone verifies only
  the lobby handoff. `--part-race` also exercises gameplay, injecting the early
  host PART/NAMES ordering immediately after STARTG to cover scenario negotiation.
  `--finish` additionally drives the verified YR 640x480 guest quit-menu fixture
  and checks victory, lobby return, session clearing and relay closure. It waits
  for native menu initialization before clicking; do not shorten that wait.
  Binary wire captures record datagram sizes; relay login tickets
  are redacted along with WOL session tokens and STARTG tickets.
  Gameplay automatically captures the pointer; absolute-coordinate test clicks
  require exiting pointer lock first (menus are unaffected). The manual deploy
  verification disabled pointer recapture only in the test page.
- Servers: RA2Web on 127.0.0.1:19090 (restarted this session with the relay; env in
  `docs/web/testing.md`), Vite on `[::1]:5173` (use `localhost`). Test accounts
  `woltst1`/`woltst2`, password `wolpass1`.
- Kill leftovers afterwards: node processes whose command line contains
  `wol.mjs`, `boot-probe`, or `tail -f ../build-web/udp-actions.txt`.

## Reading the game without a decompiler

REA has no backend here. The lifted C is the evidence: `src/recomp/gen_game` (RA2),
`src/recomp/gen` (YR). The generated files hide conditions if you filter `_flag_`
lines; keep the `if (...) goto` lines. Key routines (RA2): Create_Connections
0x66EE50, port allocation 0x673090, IPXManager service `virtual_1` 0x525F60,
address compare 0x5235D0 / 0x523690, FrameSync receive handler near 0x626800,
OnGameStart `CChatEventSink__virtual_23` 0x761570. Native game-ID fields: 0xB2A7FC
(RA2), 0xB779D4 (YR).

## Still open after the playable RA2/YR POC

### Public endpoint checkpoint and user testing (25 October)

The tested RA2 and YR private build assets were copied into the local Vite
preview, after backing up its previous assets under
`build-web/preview-before-wol-20261025-013057`. Published WASM SHA256 hashes
matched the tested private builds. Both module routes returned HTTP 200 and
the loopback backend health returned OK. Manual launch links:

- RA2: `http://localhost:5173/?dev=1&target=game&arg=--intro`
- YR: `http://localhost:5173/?dev=1&arg=--intro`

The user said they will handle further public-server/gameplay testing. Stop
automatic public probes and gameplay runs unless they request them again.

Read-only Chrome checks confirmed `https://service.thaira2.com/health` and
`/servers.ini` return 200, including cross-origin GETs from localhost:5173.
The published metadata identifies HTTP auth at the root and WOL at `/wol`;
the WOL socket accepts `cvers`. **Native gameplay is not deployed correctly at
the public route yet:** `/gserv/native` answers `ticket invalid-probe` with
`:gserv-ra2web 103 * :invalid ticket`, while the local native relay answers
`error invalid ticket` and closes with 4001. No account credentials were sent.
Artifacts: `build-web/wol-staging-probe.mjs` and `.log`. CLI requests receive
Cloudflare 1010; that is not evidence that browser access is unavailable.

The loader now accepts trusted operator build settings `VITE_WOL_HTTP_URL` and
`VITE_WOL_SOCKET_URL`; both unset retains loopback. `WolClient` supports separate
HTTP and socket endpoints, including independent context paths. No query-driven
login destination was added. The two new regressions failed before the change;
37 focused WOL/loader tests passed afterwards. No new native build was needed.
Further suite/public gameplay runs were not performed after the user asked to
handle testing. See `deploy.md` for configuration and server deployment needs.

### Independent local re-verification and review (25 October, later)

Local only; no public probes. Rebuilt `build-web-udp` (RA2) and
`build-web-wol-yr` (YR) from the working tree.

- RA2: `--play --part-race` passed; both simulations advanced past frame 300.
- YR: `--part-race --finish` failed three times at `verifyPlaying`
  ("simulation keeps advancing with its remote peer") with frames still advancing
  but at 8-13 fps (Codex's passing capture, `wol-yr-finish-final`, shows ~50 fps
  with the same 2580x1080 setting). The machine was saturated at the time:
  `wasm-opt` from another build used ~5 of 12 cores, an orphaned Chrome renderer
  from a `ra2-resolution-load` e2e (03:52, parent gone) used ~2 cores and ~60,000
  CPU-seconds, plus another Chrome. Treat the failure as load, not a bridge
  regression. Confirmed: once the other build's `wasm-opt` had exited (an
  intermediate run then failed in login typing, "wolts" instead of "woltst1",
  another load symptom), the next `--part-race --finish` run passed end to end
  (play, resignation, victory, lobby return, relay closure; evidence in
  `build-web/verify-yr-finish5`). The orphaned `chrome.exe`
  (`--user-data-dir=...ra2-resolution-load-*`) is still running and should be
  killed by whoever owns that test.
- Relay review (`ra2web/server/src/gserv/NativeRelay.ts`): the source IP is
  always rewritten server-side, tickets are required, and a reconnecting nick
  replaces the old socket. Fixed: sockets that never sent a ticket stayed open
  forever (now closed after 10 s, `ticket timeout`, covered by a test); removed
  an unused constant. Not done: per-client rate limiting and a send-buffer cap,
  which a public deployment should add.

- Full/deleted/banned room failures in the real game (COM selftest covers them).
  STARTG_ABORT and private ANSI/Unicode messages are implemented, with COM
  regressions; the original in-game whisper UI and auxiliary action methods still
  need coverage. OnPublicMessage is vtable slot 16 / four args, OnPrivateMessage
  slot 17 / three args; `build-web/inspect-wolapi-messages.ps1` reproduces the type
  library read.
- Separate-network/deployment verification is required before closing W13.3;
  the successful run used two local browser processes against loopback RA2Web.
- The user answered yes to checking `service.thaira2.com`; the browser route
  findings above supersede the earlier unverified template endpoint. Keep
  generated game modules local per CONTRIBUTING.md and deploy.md. The current
  preview still uses loopback; switching needs explicit operator build settings.
- Relay hardening: server-side game-instance expiry after all native players leave,
  reconnect after a dropped
  relay socket (the page currently only reports it), per-player rate limits, TLS
  deployments (`wss://`). The loader defaults to `http://127.0.0.1:19090` unless
  the operator sets its trusted build configuration.
- Ranked results and ladder trust are out of scope for this POC.
- Commit plan when resumed: the three repositories separately; in
  `redalert2-recomp` split the WOL files from the presenter/input/Thai-font/LAN work
  that shares `main.c`, `loader.ts` and other files.
