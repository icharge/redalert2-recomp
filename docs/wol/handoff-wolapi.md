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
  The ladder SKU of a native instance comes from the lobby channel type (ranked
  quick match: 50/51 RA2 = 16640, 60/61 YR = 18688), and the report's wire GSKU
  is mapped separately (RA2 retail sends 8960, confirmed; YR 18688 is unconfirmed;
  see `ra2web/docs/ranked-ladder.md`). Existing instances created by an older
  running server do not have that metadata: restart the updated backend and
  create a new match before manual validation.
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
until its own leave or a new room/lobby request.

The same race has a second form (found 2026-11-09 with two tabs of one
browser). Once the host leaves the started room, RA2Web parts **everyone**
from it, the guest included. When that own PART reached the guest while its
game still waited for NET_GO, the bridge completed it, the game logged
"Local user leaving channel after game start", abandoned the start
(`Negotiate_Scenario_Transfer failed`) and went back to the lobby. It happened
only when the host was quicker than the guest: in passing runs the guest had
already logged "Got NET_GO from host". The bridge now holds an own PART of the
started room that the game did not ask for (`[wol] holding the server's PART of
#room until the game leaves it`). When the game leaves by itself
(RequestChannelLeave), the held PART completes from the next pump, and no second
`part` goes to the server. A leave the game asked for completes at once, as
before. Selftest: the STARTG block in `wolapi_selftest.c`. Own PART still completes; a new
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

### Three or more players: one roster per join (2026-11-09)

RA2Web sends every member a room's NAMES list after anyone joins or leaves. A
stock WOL server sends it only to the player who joined, and the game expects
OnUserList only then, or after its own RequestUserList. A guest's game adds each
OnUserList entry to its session players (`0xA3FA80`, count `0xA3FA8C`) without
clearing them. With three players the first guest saw guest 3's JOINGAME
(OnChannelJoin) and then a full roster, and its count went 2 -> 5 while the host
and guest 3 had 3. At the start `User_List_To_Session_Players` (0x74D7D0) built
10 connection pairs instead of 3, its third pair (woltst2 & woltst1) did not
match the others' (woltst3 & woltst1), and it probed the host until
`Negotiate_Scenario_Transfer failed`. Two-player rooms never showed it: the only
guest never sees another join.

The bridge now hands the game a NAMES list only when it is owed one (after its
own JOIN/JOINGAME, or after RequestUserList). Any other list still refreshes the
bridge's user table, so addresses and pings stay current, and logs
`[wol] users(refresh)`. Selftest: `third_join_sends_no_roster` in
`wolapi_selftest.c`. End to end: `e2e/wol.mjs --three --play` (testing.md).

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
- `docs/wol/handoff-wolapi.md` (this file).

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

## The game's own WOL auto-login (LW-7a, 15 November)

Both editions can skip the login dialog by themselves. No shim or lift change is
needed for the mechanism; the launcher only has to set it up (task LW-7b).

**Where the game keeps it.** `wolinfo.ini` (RA2) / `wolinfoMD.ini` (YR) in the
game folder, through the `PlayerProfile` code (`WOLPersonaInformation.cpp`):

| Key | Read / written by (YR; RA2) | Meaning |
|---|---|---|
| `[DefaultPersona] LastValid=` | | the nick the login dialog shows (not `WolChat::GetNick`) |
| `[DefaultPersona] AutoLogin=` | get `0x00779B50`, set `0x00779C90`; RA2 `0x007390B0` | the nick to log in as without the dialog |
| `[Ask] AutoLogin=` | get `0x00779730`, set `0x00779830`; RA2 `0x00738CB0` | whether to ask "log in automatically next time?" after a login (default yes; `no` = don't ask) |
| `[<nick>]` | | per-persona stats and locale (`Server`, `Locale`, `Wins`, ...); no password |

**The check, on entering Internet** (YR `wonline.cpp` near `0x0078710F`; RA2 near `0x007430CF`):

1. Registry gate: `HKLM\SOFTWARE\Westwood\WOLAPI\Options` (DWORD) read at
   `0x005175F0` (RA2 `0x004FF200`); `0x005176A0` (RA2 `0x004FF2B0`) returns true when bit 0
   is clear. A missing value counts as 0, so the gate is open in the browser build.
2. Read `[DefaultPersona] AutoLogin`. Empty: show the dialog as usual.
3. Otherwise call `WolChat::GetNick` (vtable `+0x90`) for **slots 1 to 32** (slot 0 is
   never asked) and compare each nick with the persona, case-insensitively
   (`0x7C8D20`). On a match the nick goes to `0xB73E40` and its password to
   `0xB7778C` (RA2 `0xB26CB8` and `0xB2A63C`), and the game connects with them, no
   dialog. No match: the dialog.

**Seen in the browser (YR, `?test=1`, local ra2web, 15 November):** log in once with
"Remember Account Information" ticked (the game stores the nick and password through
`WolChat::SetNick`, which the shim keeps in `g_saved_nicks`, and writes
`LastValid=` and a `[carol]` section); add `[DefaultPersona] AutoLogin=carol` to
`/game/wolinfomd.ini`; Main Menu, Internet: the menu (`0x10E`) went straight to the lobby
(`0x113`) without the login dialog (`0x10F`), and the server logged a fresh `/login`
for carol with the remembered password. The game did not ask about auto-login after
the first login because that folder's file has `[Ask] AutoLogin=no`.

**Limits found on the way.** The dialog's Nickname and Password fields keep 9
characters, and the nick is lowercased (`password123` was cut and refused;
`ABCDEFGHIJKL` became `abcdefghi`).

**Used for launch tickets (LW-7b, recomp `2ec3cde9`).** The loader writes `AutoLogin=` and
`LastValid=` for the launch nick into the persona file once the game's files are in place
(and removes `AutoLogin=` without one); the shim puts the nick in a `GetNick` slot from 1 up
with a placeholder password. Seen in the browser in **both editions**: Internet went to the
lobby as the ticket's nick with no login dialog. With `[Ask] AutoLogin` back at its default
the game did not ask anything after the auto-login, so the launcher leaves `[Ask]` alone.
Without a ticket the dialog shows as before.

**File writes append in the browser build.** `FS.writeFile` on an existing file adds to it
(`"AAAAAA"` then `"BB"` reads back `"AAAAAABB"`), so the launch staging removes the file
first. `replaceFile` in `web/src/storage/saves.ts` (used for `RA2.INI` / `RA2MD.INI` by
`stageWolDataKey` and `stageVideoSize`) has the same exposure for files that are not links;
that is likely where the duplicated profile INIs that `compactProfileIni` cleans up come from.

## Slash lines, chat length and a listed virtual user (LB-0)

For the lobby bot (Track LB in [tasks.md](tasks.md), decisions 15-17). **Seen in the browser,
both editions, 15 November:** fast builds of this tree, two `?test=1` clients (`lib.mjs`
`--game ../game`) in `#Lob_33_0` / `#Lob_41_0` against a local ra2web on a private port. Each
line was typed into the lobby's chat edit and read back from the shim's log, the page's
WebSocket frames, the other client's frames and screenshots. RA2 and YR behaved the same in
every case below.

`send_chat` now logs the length and a leading `/` (never the text):
`[wol] chat sent to #Lob_41_0 (public, 5 chars wide, leading /, part held 0)`.

### 1. What the chat edit does with a `/` line

The lobby edit's Enter handler runs the game's own commands before it sends. The words come from
the string table, and each one is matched as a **case-insensitive prefix with no word boundary**:

| Order | Command (CSF) | YR routine | RA2 routine | What it calls | Seen |
|---|---|---|---|---|---|
| 1 | `/page <nick> <text>` (`TXT_PAGE_COMMAND`) | `0x0078A6B0` | `0x00746480` | `IChat` `+0xF8` `RequestUnicodePage` (YR `0x0078A87A`, RA2 `0x0074664A`) | echoes `[lbzero1 > yuribot] help` locally (nick lowercased); **nothing reaches the server** |
| 2 | `/reply <text>`, `/r <text>` (`TXT_REPLY_COMMAND`, `_SHORT`) | `0x0078A8F0` | `0x007466C0` | `+0xF8` `RequestUnicodePage` (YR `0x0078AABF`, RA2 `0x0074688F`) to the last pager (YR `0xB77E30`) | with nobody to answer: "You have not been paged yet. Unable to send reply." |
| 3 | YR only: `TXT_BUDDY_FILTER`, `TXT_CLAN_FILTER` | | | | missing from retail `ra2md.csf` (`***NO_STRING***` logged on every send); no effect |
| 4 | `/on <nick>` (`TXT_ONLINE_COMMAND`, a locate) | `0x0078A470` | `0x00746240` | `+0x60` `RequestFind` (YR `0x0078A5B2`, RA2 `0x00746382`) | silent; `/On` alone: "You did not specify a valid user name." |
| 5 | anything else | | | `RequestPublicUnicodeMessage`, or `RequestPrivateUnicodeMessage` to the users selected in the player list | sent **verbatim** |

Every line that starts with `/r` or `/R` is a reply: `/rank alice`, `/Rank alice`, `/R upper`,
`/rules` and `/report bob cheat` all gave the "not been paged" line and sent nothing. `/online`
is a silent locate of a user named `line`. `/page` and `/PAGE` both page. VERA20K's
`src/ui/wol_chat.rs` describes the same order but calls the `/r` and `/on` compares
case-sensitive; in both editions `/R` and `/On` were taken.

These went to the server unchanged, as public lobby lines, in both editions:
`/help`, `/top 5`, `/season`, `/queue`, `/maps`, `/motd`, `/mute bob 5`, `/kick bob`,
`/ban bob 2 x`, `/unmute bob`, `/me waves` (`> privmsg #Lob_41_0 :/help`). Today's server
broadcasts them: the other player saw `[lbzero1] : /help`.

**Paging does not work at all in the browser build yet, for anyone.** `RequestUnicodePage`
(and `RequestPage`, `RequestFind`) are `m_stub_*` returning `E_NOTIMPL` in `wolapi.c`. The
YR Page button's dialog (`0xCF`) does the same as `/page`: it echoes
`[lbzero1] help via dialog`, sends nothing and shows no status. RA2's lobby has no Page
button.

### 2. Line length

The chat edit holds **120 characters** in both editions. Typing 300 left
`000-004-…-116-` in the box, and the shim got 120 (`public, 120 chars wide`). The game cuts
the line; the shim's limit (1024 out, 4095 in) is never reached. A received line is not cut:
a 500-character lobby line showed in full under a `[lbzero2] :` header row, wrapped at about
100 characters per row of the 800×600 lobby (digits and dashes; the font is proportional, so
wider letters fit fewer).

### 3. A listed virtual user that is not an operator

The server's `matchbot` is listed only in the Quick Match and co-op lobbies and as an operator
(`WolServer.sendChannelNames`, `entries.unshift("@matchbot,0,0,0")`). For a non-operator bot
in a chat lobby, both editions were sent the lines LB-1 would send:

- **Listing.** `:YuriBOT!YuriBOT@local JOIN :0,0 #Lob_41_0` put `YuriBOT` in the player list,
  without an operator mark. A NAMES (`353`) with `YuriBOT,0,0,0` sent while the game
  already had its list changed only the shim's roster (`users(refresh) n=3 … YuriBOT=…`). The
  shim raises `OnUserList` only for a NAMES the game asked for (`g_roster_wanted`, set by
  joining or `RequestUserList`). So the NAMES a player gets on joining should include the bot,
  and a bot that appears while players are in the lobby needs a JOIN line to them.
- **Reaching it.** Selecting `YuriBOT` in the list and typing sends a private message:
  `> privmsg YuriBOT :help` and `> privmsg YuriBOT :/help`
  (`chat sent to YuriBOT (private, 5 chars wide, leading /…)`), echoed locally as
  `[lbzero1] /help` in the private colour. Today's server answers `401 … YuriBOT :No such nick`,
  which the game ignores. The `/page YuriBOT …` path sends nothing (above).
- **Its reply.** `:YuriBOT!YuriBOT@local PRIVMSG lbzero1 :Commands: /help /rank [nick] /top [n]`
  shows in the lobby transcript as `YuriBOT : Commands: …` in the private colour, the same as a
  player's private line (`lbzero2 : selected hi`). It does **not** make the bot the `/reply`
  target: `/r thanks` afterwards still says "not been paged yet". Only an incoming page does
  that. VERA20K's notes (unverified here) say only the ANSI page sink (YR `0x007A9200`) keeps the
  sender at `0xB77E30`; the UTF-16 one (`0x007A9550`) does not.

### What LB-1 should do

- **Command names must not start with `/r`, `/on`, or `/page`, in any case.** In the planned set,
  `/rank`, `/rules`, `/report` (and `/R…`) are taken by reply, and `/online` by locate. They never
  reach the server. Rename them, e.g. `/stats [nick]` or `/ladder [nick]` for rank, `/info` for
  rules, `/flag <nick> <reason>` for report, `/who` or `/players` for online. Keep LB-3's
  `/help`, `/top`, `/season`, `/queue`, `/maps`, `/motd` and LB-6's `/mute`, `/unmute`, `/kick`,
  `/ban`: they arrive verbatim. `/me` is not a game command here either: it arrives as text.
- **Public `/` lines arrive verbatim**, so the planned interception in `handlePrivmsg` (a `/` line
  is a command and is not broadcast) works as designed.
- **The second way in is a private line to the selected bot**, which already works:
  `privmsg YuriBOT :<text>`, with or without the `/`. List the bot in each chat lobby's NAMES
  (not as `@`) and send a JOIN when it appears. Route a private message to `lobbyBot.nick`
  instead of answering 401.
- **Replies:** private `PRIVMSG <nick> :…` lines of at most about 90 characters, so each fits on
  one row (never more than the 120 a player can type), a few lines per answer.
- **Paging is a separate shim task.** `/page`, `/r` and YR's Page dialog fail silently for every
  user until `RequestUnicodePage` (and `RequestPage`) send `privmsg <nick> :<text>` and report the
  result, and an incoming page reaches the game's page sink. That is what would make `/r` answer
  the bot. LB-1 does not need it, but decision 15's "page the bot" fallback depends on it, and
  players already expect `/page` to work.

**Also seen:** in YR, the login dialog's Login button did nothing with a 7-character password
(nothing sent, no message); 8 and 9 characters logged in. Test passwords should be 8-9
characters.

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
  deployments (`wss://`). The loader defaults to `http://127.0.0.1:9090` unless
  the operator sets its trusted build configuration.
- Ranked results and the shared season ladder are now served by the RA2Web
  backend; see [shared-ranked-server.md](shared-ranked-server.md). The handoff
  here predates that work, so its "out of scope" note applies only to the
  original POC.
- Commit plan when resumed: the three repositories separately; in
  `redalert2-recomp` split the WOL files from the presenter/input/Thai-font/LAN work
  that shares `main.c`, `loader.ts` and other files.

## The Available Games list's icons (observer eye, trophy, clan; 21 November)

The lobby's game list (`0x113`; YR `0x00781480`, `WolChannel`/VERA `src/ui/wol_lobby/channels.rs`) draws
four things per room, all from the `wol_channel` record the shim builds from the server's `322` line:

| Icon | PCX | Source in the record | What carries it on the wire |
|---|---|---|---|
| game type | `gt18.pcx` | none (the plain WS logo) | |
| trophy | `woltrny.pcx` | `+0x14` tournament | `322` word 7, which RA2Web sets from the creator's `joingame` word 7 |
| clan | `wolclan.pcx` | bit `0x100` of `+0x20` (the "reserved" word) | the `WOLAPI2:<reserved>,...` topic envelope |
| lock | `wolpriv.pcx` | `+0x1C` bit `0x100` | `mode` 384 of the `322` line |
| observer eye | `wolob.pcx` (`wolrslkob.pcx` with a resolution limit) | the ex-info (`+0xE0`, `"%d,%d,%d,%d,%d,%s"`: version, INI hash, AI players, **a human on the observer row**, **an open observer row**, scenario; RA2 writes version 39, YR 25) | the `WOLAPI2` topic's ex-info |

The eye shows while the open-observer word is above zero. The count is `users - taken + ai` over
`max_users - (taken + open)`. The host opens the row from the observer row's dropdown in the room
("Open Observer", `GUI:OpenObserver`; the Create dialog's own Observe box makes the **host** the
observer, which publishes `taken` instead and shows no eye, as native does).

**What was wrong (found with two clients, `web/e2e/wol-icons.mjs`):**

1. The eye itself already came through, but a room with an open observer row listed as `1/1` on a
   two-player map and turned the second player away. The game asks for `MODE +l` of the host, each
   Open row **and the observer row** (YR `0x0078F000`, `republished_limit` in VERA), and the shim clamped
   that to the map's slot count. The clamp now adds one seat when the ex-info has an observer row, open or
   taken (`ex_info_observer_seat`), re-applies when the ex-info arrives after the `MODE` (the order the game uses
   is not fixed), and the limit may be 9 (eight players and the observer).
2. `joingame` always sent tournament 0, so no room ever showed the trophy. It now carries the Create
   dialog's tournament value (`channel->tournament`).
3. Clan: the bit already round-trips in the envelope (a clan host's game sets `0x100` in the reserved word
   plus the chat-lobby number; the BattleClan box is greyed out of a clan, so the test sets the bit on
   the wire). Nothing to fix. Clan names and tags (`+0x2E`, `+0x57` of the user record) are not part of this.

Where the game list reads the Players list's clan tag: `0x00783C80` (VERA `WolPlayerRow::clan`,
`"[%hs]"` of the user record's `+0x57` tag, tooltip `+0x2E`); the shim's `wol_user` leaves both empty
(its `squad_abbrev` / `squad_name` fields), so no `[tag]` shows.

Evidence: `web/e2e/wol-icons.mjs --kind observer|tournament|clan|normal` (RA2: `?target=game`; YR without it),
two or three clients against `node e2e/wol-server.mjs`. The selftest covers the seat and tournament word.
