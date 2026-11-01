# World Domination Tour (WDT) Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this
> plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make World Domination Tour playable end to end: the game loads a WDT cycle, a player
chooses a side, a WDT match starts, the result is reported, and the next state reflects territory
control, points and history.

**Architecture:** A new WDT module in the sibling `ra2web/server` owns the cycle/territory model.
It runs in the **same Bun process and deployment as the WOL lobby**, sharing accounts, sessions,
storage, logging and admin. The two client paths differ:

- **Browser:** the faction click calls `WolChannel::RequestWDTState` in the WOLAPI COM bridge
  (`src/web/wolapi.c`), so the bridge fetches the state from the same RA2Web server and delivers
  `OnWDTState`. No raw TCP listener or TCP-over-WebSocket bridge is needed for the web client.
- **Native:** `wonline.cpp` opens the server-list TCP endpoint (`MGL entry in server list`, host
  at `0xB73B34`, port at `0xB76B0C`), so a native TCP listener is still required.

The WOL lobby handles `MatchWDT`/`WDT=` match requests and the existing native relay/game-result
path supplies identity and completion; the WDT module does not duplicate them.

## Why not just implement it in the WOL lobby?

The WOL lobby is a **text, line-oriented WebSocket protocol** (`/wol`, `WolServer.ts`): the game
sends `LOGIN`, `JOIN`, `CREATE`, `GAMEOPT`, `MATCH`, and similar lines, and the server answers in
the same framing. The **native** WDT state fetch is not one of those lines: `wonline.cpp`
(`sub_00797800`) opens the server-list TCP endpoint and exchanges a binary/tagged packet. The
**browser** is different: its faction click calls the WOLAPI COM method
`WolChannel::RequestWDTState`, which is the bridge already used for WOL. That is why the web path
can be implemented in the same WOL process without a new transport.

So the split is:

| Concern | WOL lobby / bridge | Native WDT listener |
| --- | --- | --- |
| Transport | WebSocket, text lines; browser WDT via WOLAPI COM | TCP, binary tagged packet |
| Address | `/wol`; the bridge is already connected | server-list `MGL` endpoint (`0xB73B34` / `0xB76B0C`) |
| Game code | `wolapi.c` (`RequestWDTState`) / WOL line handlers | `wonline.cpp` fetch, `OnWDTState`, `WDTState` parser |
| Match request | `MatchWDT `, `, WDS=0|1`, `, WDT=` lines | supplies the conflict/territory assignment |
| Results | normal native game-res path | reads the `WDTT`/WDT fields from the same report |

**Same process, separate endpoint — except the browser.** The browser’s faction click does not
use the raw TCP path at all: it calls `WolChannel::RequestWDTState` in the WOLAPI COM bridge
(`src/web/wolapi.c`). That bridge is already the WOL path, so the web WDT state can be served
there directly, with no TCP listener and no TCP-over-WebSocket bridge. The native client still
opens the server-list TCP socket, so a native listener is still required for native builds.
Running both in one process is the recommended deployment: the WDT service is started beside
`WolServer` in `server/src/index.ts`, uses the same `SessionManager` and `AccountStore`, and
persists through the same storage. Only the socket/codec path differs.

**Why not multiplex one port?** The native WDT client opens its own TCP endpoint from the
server-list entry; the endpoint is effectively dedicated. The browser never opens it, because it
uses the WOLAPI bridge. No protocol sniffing is needed.

**Why native still needs an endpoint.** Native `wonline.cpp` reads the WDT host/port from the
server-list `MGL` entry (`0xB73B34`/`0xB76B0C`), not from a WOL line. The WOL bridge can advertise
that entry, but the native client still opens a TCP connection to it. The browser avoids this
entirely by using the WOLAPI method. That is the only reason the native listener remains in the
plan after the browser finding.

**Tech stack:** TypeScript/Bun in `../ra2web/server`, Vitest, SQLite and memory storage; C/Emscripten
in this repo and `../pcrecomp` for the web transport; RA2/YR lifted C for protocol evidence; a
Python/TypeScript fake TCP server for packet capture.

**Status:** WDT-0a done (browser request shape captured); WDT-2 started (bridge method logs the
call). No state codec or server model exists yet.

## Task breakdown and progress

| ID | Task | State | Depends on | Acceptance |
| --- | --- | --- | --- | --- |
| WDT-0a | Capture the browser request shape | **done** | — | The faction click reaches `WolChannel::RequestWDTState`; args recorded (`0C058240 00B269AC 0 3`, sink `0BF5B910`). |
| WDT-0b | Capture the native/server-list path | pending | — | Native `sub_00797800` request bytes and the `MGL` server-list fields are understood. |
| WDT-1 | Packet codec and state model | **done** | WDT-0a/b | `src/wdt/codec.ts` + `service.ts`: container/tag round-trip, 30×44-byte records, 2-bit owner map, current/previous packets; 14 tests. |
| WDT-2 | Browser `RequestWDTState` bridge | **done** | WDT-1 | Bridge signals the client's event array (index 0xB), fetches `/wdt/state` through the page (`MAIN_THREAD_EM_ASM`), delivers `OnWDTState` (current/previous). The event argument list is now `(this, unused, packet, length)`, so the client parses `MPVC`/`HSVC` (30x3) and shows owner colours, icons and territory names. |
| WDT-2a | Server-side WDT state endpoint | **done** | WDT-1 | `/wdt/state?cycle=current|previous` and `/wdt/status`; live smoke returns 1556/216-byte packets. |
| WDT-3 | Native TCP WDT listener | **started** | WDT-0b | `WdtTcpServer` answers `WDT CURRENT`/`PREVIOUS` on `WDT_PORT`; native client capture still pending. |
| WDT-4 | Match assignment and result ingestion | **started** | WDT-2/3 | Server assignment and settlement verified (live WOL test, duplicate→409). The UI now selects a white territory and a second click starts the match, which stops at the WOL game-list (type 33) lookup: no WDT matching game -> `0xD0`. |
| WDT-5 | Cycles, history, admin | **done** | WDT-4 | `advanceCycle` freezes the current map as previous; authenticated `/wdt/admin/{rollover,reset,enable,status}`; `/wdt/status` exposes conflicts/history. |
| WDT-6 | Persistence, tests, docs | **done** | all | SQLite `wdt_state` snapshot, Memory store, 16 WDT tests, regenerated RA2 lift (`--check` exit 0), 51 lift-patch tests. |

### Progress note (2026-10-31)

- **Server** `ra2web@9645e87`: codec/service/TCP/HTTP, WOL assignment (`WDS=`/`WDT=` at
  STARTG and `MatchWDT` queue tags), native-result settlement, `scripts/wdt-lobby.ts`,
  `scripts/wdt-smoke.ts`.
- **Client** `7592c20`: the WOLAPI bridge signals the 18-event array at index `0xB`, returns
  `S_OK`, and delivers the page-cached `/wdt/state` current/previous packets through
  `OnWDTState`. Live log evidence: `server state current 1556 bytes`, `previous 216 bytes`.
- **Verification**:
  - `bun test src/wdt` → 16 pass, 0 fail (72 assertions), `tsc --noEmit` exit 0.
  - `WDT LOBBY TEST PASSED`: two real WOL sockets, `GAMEOPT` with `WDS=0,WDT=11`,
    `STARTG`, then `/wdt/status` shows the conflict for that game id.
  - `wdt-smoke`: HTTP 200, 1556-byte current packet (`CRTK=2`, `MPVC=1320`, `HSVC=23`);
    TCP previous packet 216 bytes (`TOTK=2`).
  - `WDT ADMIN TEST PASSED`: 401 without a token, rollover 1→2, disable makes
    `/wdt/state` 503, enable restores 200, reset starts cycle 3.
  - `WDT ADMIN PERSISTENCE PASSED`: after stopping and restarting on the same
    `DB_PATH`, `/wdt/status` still reports cycle 3 and `enabled=true`.
  - **Browser e2e** (`wdt-capture`, test mode, one uninterrupted run): server
    current + previous packets delivered, **no `0xD0`**, `[dialog] open 0x125`
    after the Allied click, game still `running` 60 s later. Screenshot:
    `work/wdt-e2e-final/wdt-screen.png`.
  - **Lift**: `python run_lift.py --target game --all` lifted 23,125 functions
    (0 errors). The later concurrent page-cursor feature has landed: `--check` exits 0
    again and `tools/test_lift_patches.py` reports `Ran 51 tests - OK`.
- **Instrumentation (WDTProps.cpp)**: `WDTState+8/+0xC` are read as `char*` but point at
  heap objects, not the parsed description text — the server strings are freed/reused by the
  time the campaign properties are built. Forcing the client's fallback to the **unquoted** CSF
  keys (`WDT:DefaultShortDescription` / `WDT:DefaultLongDescription`) removes the
  `***NO_STRING***` log entirely; the exe's own fallback literals include quote characters and
  fail the lookup. The server now sends the unquoted keys and places territories on the map
  grid instead of `-1,-1`, but the **map art is still blank**, so the client state lifetime
  (or map-data loading) remains the open blocker.
- **Buffer test**: skipping the `WDTState` destructor's frees keeps the description strings alive. With the
  unquoted server keys that removes `***NO_STRING***` completely, but the map is still
  black. So the blank map is **not** caused by the description-buffer lifetime.
- **WDTMap.ini decoded** (plaintext inside `wdt.mix`): sections `[NorthAmerica]`, `[Europe]`,
  `[Asia]` select an art set; each set has `Art_640`/`Art_800`, `Background=*_WorldDom_*.pcx`,
  `ClickMap=*_ClikMap*.pcx`, `OverlayPrefix=AsTerr`/`NaTerr`, and `Territory00..29`.
  The 44-byte record ids are 0..29 matching those keys; the two trailing ints are not map
  coordinates.
- **Bink opening**: the map screen's `Opening=*Animation_*.bik` fails in the page
  (`Bink Error:`), which closed the screen in a loop. `wdt_patches` now skips creating that
  movie object. After the skip the screen stays up and draws its **"World Domination Tour"**
  title and logo, with no Bink error; the background/overlays are still blank.
- **Map renders**: the loader builds `Art_<width>` (falling back to `Art_800` above 800 px), but
  only the 640 art set is shipped — the 800 background/opening/overlay assets are absent, so the
  map drew blank and the Bink opening failed. Forcing the key to `Art_640` (`edx = 0x280` in
  `wdt_patches`) makes the North America map, territory outlines, sidebar and
  "Click on a white territory to engage in battle" render at 1280x720:
  `work/wdt-art640/tick19.png` (848 KB). The 640 layout is drawn at 472x448 inside the wider
  window; scaling it is a later polish item.
- **Map input (corrected)**: dialog `0x125` is the **side-select overlay**, not the map. Its
  Allied click is delivered to the dialog and tears it down; the map is drawn afterwards by the
  main window through the WDT screen update (`sub_0072FFC0` → `sub_0072F5A0` +
  `sub_0072E050`). Page clicks do reach it: HLE trace shows `WM_LBUTTONDOWN` on the main window,
  the WWMouse WndProc (`0x532A60`) queues it, and `sub_0072E050` receives
  `map msg=1` then `map msg=0x801`. At map (200,250) the territory lookup (`0x72A660`) returns
  **id 18**; the select panel (`0x72ED80`) is skipped because the id equals the previous value
  (`pick id=18 previous=18`). So the click reaches the map and picks a territory; the missing
  piece is the commit/challenge transition, not input routing.
- **WDT screen object**: `sub_0072FFC0`’s `ecx` is not a persistent screen — its `+0x454`/
  `+0x45C` fields are per-frame stack scratch, and `+0x45C` is the **Back button**
  (rect 570,475 136x25 at 1280x720), which is why direct injection from the host is useless.
- **Bridge argument fix (root cause)**: `OnWDTState` is
  `(this, unused, packet, length)`. The browser bridge pushed an extra zero
  (`{sink,0,0,packet,len}` / count 5), so the client parsed a null packet: every tag
  lookup missed, `MPVC`/`HSVC` lengths were 0, the sidebar showed `MISSING*` and the map
  had no owner fill. With `{sink,0,packet,len}` / count 4 the client parses the real
  packet: `MPVC parse len=1320`, `state width=30 rows=3`, owner colours (Soviet red,
  neutral white), territory icons, and real names (`Grand Canyon`, `Black Hills`).
- **UI match flow**: one click on a white territory selects it (name, "Starting Units : 13,
  MCV Redeployable, Long Game, No Goodie Crates", prompt **"Click to fight in this
  territory"**). A second click starts the match: the client initialises Winsock/UDP,
  requests the lobby list (type 0), joins `Lob_33_0`, then requests the **game list
  (type 33)**. It then searches that list for the WDT matching server; with no such game
  it shows dialog `0xD0` (**"Error : Matching Server Not Found"**, CSF
  `WOL:MatchGameChannelNotFound`). Evidence: `work/wdt-final2/territory-click-game.png`
  (selected Black Hills), `work/wdt-fix5/game.log` (match start + 0xD0).
- **Match start transport (decoded)**: after the second click the client asks for the game
  list (`list 33 33`), parts the lobby and tries the **mangler** (GameSpy matchmaking)
  connection. The server-list parser (`CComObject_VCChatEventSink_ATL__virtual_3`, 0x75E000)
  recognises labelled service entries `IRC`, `GAM`, `LAD`, `WDT` (exe strings at
  0x7FDC80..0x7FDC8C). The `WDT` entry fills `WDTHost`/`WDTPort` (0xB269AC/0xB299BC), the
  address the client uses for `Get_WDT_State_Silent`; `GAM` fills the mangler list
  (0xB2AC34). The browser bridge supplies only a single `IRC` entry
  (`"TCP;127.0.0.1;19090"`), so the log shows `Got 0 mangler servers` / `CurrentManglerServer = 0`
  and `WDTHost is , port is 0`, then the client returns to login and shows `0xD0`
  ("Matching Server Not Found"). Replacing the entry with `WDT` alone breaks login, so the
  multi-service encoding of the 0xF8-byte server-list entry still has to be decoded.
- **Server-list entry decoded**: the 0xF8-byte entry already matches WOLAPI's layout —
  the service label sits at offset **0x5F** (after `gametype/chattype/timezone`,
  `longitude/latitude`, `next` and `name[71]`) and `conndata` at **0x64**. `conndata` is
  `proto;host;port`: the parser skips the first token, copies the second to `WDTHost`
  (0xB269AC) and `atoi`s the third into `WDTPort` (0xB299BC). Verified live: a `WDT` entry
  with `TCP;127.0.0.1;29094` produces `WDTHost is 127.0.0.1, port is 29094` and
  `Get_WDT_State_Silent` uses it; a bare `host;port` instead yields `WDTHost is 29094, port is 0`.
- **One service per pass**: with a chained list `IRC, IRC, LAD, GAM, WDT` the client processes
  the labels `LAD` then `GAM` and stops (WDT never seen); with `IRC, IRC, LAD, WDT, GAM` it
  processes `LAD` then `WDT` and stops. So each server-list pass registers only one of
  `GAM`/`WDT`. The mangler count stays 0 either way (observed `Got 0 mangler servers`).
- **Two-pass emission does not register the mangler**: emitting the list twice
  (`IRC,LAD,GAM` then `IRC,WDT`) still leaves `Got 0 mangler servers`. Instrumenting the client
  shows the mangler list (`0xB2AC34` count / `0xB2A700` entries) is never fed: the GAM branch
  at `0x75E5DF` is never entered even though the entry labels are visible to the list parser.
  `WDTHost`/`WDTPort` still decode correctly, and the client never opens a TCP connection to the
  WDT host on a match start, so the mangler is genuinely the remaining input.
- **Mangler label decoded (verified)**: the mangler is the server-list label **`MGL`**, not
  `GAM` (0x75E7AC tests `strstr(label, "MGL")`; `GAM` is the game service). Publishing
  `MGL` with `TCP;127.0.0.1;29094` makes the client log
  `MGL entry in server list`, `Got mangler server from servserv - address is 127.0.0.1 ; 29094`
  and `Got 1 mangler servers` (previously 0). The same list still decodes `WDT`
  (`WDTHost 127.0.0.1:29094`) and the map state stays 30x3. The client still ends at `0xD0`:
  after `LIST 33` it reconnects to the **IRC** server (not the MGL entry), requests
  `list 0 0`, gets the lobby list and fails — so the mangler *session* (its login/channel-list/
  `Start <game>` exchange) is what the bridge must now serve.
- **Next (sharpened)**: find the condition that reaches the GAM branch — the label loop at
  0x75E08F sees every entry, but GAM handling sits behind `[esp+0x20]` state and an earlier
  service branch; trace `[esp+0x20]` writes (0x75E5D2, 0x75E6C1) and the selected-server flag
  to learn which entry order/fields the client needs before it counts a mangler.
- **State-gate patch (negative)**: patching the sink gate (`0x7625B8`, `jne` removed so any
  WDT state is accepted) together with a server-issued `:RA2Web!service@local PRIVMSG <nick>
  :Start #WDTmatch` after `RPL_LISTEND` still ends at `0xD0` with `/wdt/status` conflicts 0.
  So the gate is not the only condition: the `Start` message either does not reach the sink in
  the form it expects, or the join path fails before the state machine proceeds. Both
  experiments were reverted.
- **Deterministic trace (single run)**: logging `[0xA3D2A4]` (WDT state), `[0xB2A648]`
  (client game list) and `[0xA3D298]` (screen) at the chat channel-list handler (`0x763F3D`)
  gives the same values every time it runs: **state=3, games=0, screen=4**. The `Start`/`Fail`
  sink only accepts state **1 or 2**, and the WDT state is written by the WOL menu
  (`0x752BD1=1`, `0x752C35=2`, `0x752BEF=3`, `0x752C0D=4`), not by the WDT screen. So the
  client is in state 3 (game/menu) when `LIST 33` arrives and ignores `Start <game>` entirely.
  The match flow cannot advance until the client is in state 1/2 at LIST time.
- **Correction: the 0xD0 removal is intermittent**: a later run with the same synthetic
  `LIST 33` entry showed `0xD0` again, so that result is not deterministic. Creating a real
  `#WDTmatch` channel and sending `Start #WDTmatch` after `LISTEND` (server log:
  `wdt match room #WDTmatch created`, `wdt match start sent`) also still ends at `0xD0` with
  `/wdt/status` conflicts 0. The join/start path needs a deterministic trace before it can be
  claimed as fixed.
- **Synthetic WDT room published (verified)**: `WolServer.handleList` now emits a
  `#WDTmatch` entry with `channelType 33` when a `LIST 33` request finds no such game
  (ra2web `a6291d3`). Live two-click run: the `0xD0` "Matching Server Not Found" dialog is
  **gone** (0 occurrences; previously every run), the client leaves the lobby after
  `LIST 33`/`clearing game list`, reconnects and returns to the main menu. `/wdt/status` still
  shows 0 conflicts, so the client does not join the synthetic room yet - the join
  (`joingame`/STARTG) and the `Start <game>` line are the next server-side step.
- **Root cause of 0xD0 found (server side)**: forcing the client's match loop to treat the first
  listed game as the matching server (`0x75C155 je` -> jump) changes nothing, because the loop
  never runs: its list (`0xB29990`, filled from the `LIST 33` reply) is **empty**. The WOL lobby
  has no game with `channelType 33`, so `handleList` returns only the lobby and the client retries
  then shows `0xD0`. The fix is server-side: publish a WDT game (`channelType 33`) in the
  `LIST 33` response (a synthetic matching room the client can copy and, with the loop, name-match).
- **Validator is on the send path**: `0x525AF0` is only a vtable forwarder (`[eax+0x38]`, six
  stack args); `sub_005BA0D0` builds/validates its own packet (magic `0xAA03`, length `0x2C`)
  before transmitting, so `[esp+0xe]`/`[esp+0x3c]` are locals of that builder, not datagram
  offsets. The reply layout therefore cannot be derived from that site. The `0xAA03` word is the
  netcode's global game id (`0xA3F818`), so the 76-byte frames the client sends to the mangler are
  the ordinary RA2 UDP netcode, not a dedicated matchmaker protocol.
- **Where this leaves the browser path**: the mangler may not be the WDT matchmaker at all. The
  client's actual match start is the chat-side `LIST 33` + `Start <game>` exchange, and with the
  browser bridge answering `LIST 33` from the lobby there is no matching game. The remaining
  routes are (1) a deeper decode of the WDT match-start state machine, (2) a client patch that
  creates the game channel directly, or (3) the native WOL TCP gateway.
- **44-byte AA03 reply (negative)**: sending a 44-byte payload that keeps the query header,
  magic `0xAA03` and sets the length word at payload offset 0x14 to `0x2C` is also ignored —
  the validator's success log (`Mangler is seeing packets...`) never appears and the client still
  ends at `0xD0`. Behaves as if the receive buffer layout is not the datagram payload: the
  validator reads `[esp+0xe]` (magic) and `[esp+0x3c]` (length) inside `sub_005BA0D0`, whose
  `recv` call passes buffers at `S+0x0E`/`S+0x3C`; the exact payload offset of each field still
  needs mapping before the reply can be constructed.
- **Mangler receive validator located**: the matchmaker reply is checked at `0x5BA194`:
  `cmp word [esp+0xe], 0xAA03` (magic) and `cmp dword [esp+0x3c], 0x2C` (payload length 44),
  after which it logs `Mangler is seeing packets from port %d as coming from port %d` and calls
  `0x525B30`. The captured request carries the same magic (`03 aa` = 0xAA03) and a `0x2B` (43)
  field, so the answer frame must be a 44-byte-payload packet with magic 0xAA03 — not the 76-byte
  echo (the request is a larger frame; the reply the client accepts is the short one).
- **Mangler reply opcode probe (negative)**: answering the `0xFE` probe with `0xFF` in the first
  byte (instead of an echo) is also ignored; the client keeps pinging and still ends at `0xD0`.
  So the reply is not a simple opcode flip: the 76-byte frame's matchmaker answer (probably the
  same game-net frame with specific fields rewritten — random id, ports, host list) still has to
  be decoded from the client's receive path.
- **Mangler responder implemented (echo; insufficient)**: `service_mangler()` in the browser
  bridge now pops pre-STARTG frames from the HLE queue on every `PumpMessages` call and pushes a
  reply for the MGL port: source address/port become `172.29.99.1:29094`, destination is the
  game's spare port. Verified live: `[wdt] mangler reply 76 bytes to port 21357` (six probes).
  The client still ends at `0xD0`, so an echo is not the expected matchmaker answer: the reply
  payload/opcode for the `0xFE` frame still has to be decoded (the request carries a random id
  plus game-net fields, not a text query).
- **Mangler datagram captured (verified)**: a page-side `setInterval` that pops the HLE
  `ra2_udp_*` queue (ports are big-endian at frame offsets 4 and 6) logs the pre-STARTG
  matchmaker traffic. The client sends a **76-byte frame** from its spare socket (src 21357)
  to the MGL address on `29094`, repeated on a timer:
  `fe 45 4c e8 36 12 01 00 00 00 00 7f 00 00 00 00 00 00 03 aa 2b 00 00 00 57 57 00 08 02 00
  00 00 20 89 fa 2e 01 00 00 00 01 00 00 00 00 00 00 00 00 01 00 50 2b 5f 00 00 00 00 00 00 10
  00 00 00 10 00 00 a0 70 e3 03 00 6d 53 00`
  (0xFE opcode, then a random id and game-net fields). So the mangler answers in the game's own
  UDP netcode, not a text protocol; the next step is to reply through `ra2_udp_push` with the
  matching response for this frame.
- **Mangler transport is UDP (verified)**: the client sends **76-byte UDP datagrams** to the
  MGL address on a match start (`sendto 172.29.99.1 ; 29094`, `[net] sendto ... 76 bytes`).
  The browser HLE (`wudp_send`) drops loopback destinations before queueing, so the earlier
  `127.0.0.1` MGL entry never reached the page. Publishing the MGL address as a routable
  virtual IP (`172.29.99.1`) makes the datagrams queue for the relay. Serving the mangler
  therefore needs a **pre-STARTG consumer** of `ra2_udp_*` that answers the 76-byte protocol
  with `ra2_udp_push` (the current `UdpRelay` only starts after STARTG and drains the queue).
- **Start-event probe (negative, but informative)**: trying the ASCII chat events 13/14/15
  with a `Start 0:RA2Web` payload does not reach `0x75B910` either. A probe shows the WDT
  sub-state `[0xA3D2A4]` is **3** during the `list 33 33` that follows the match start, while
  the Start/Fail sink only accepts state 1 or 2. Forcing the state to 2 at that point is unsafe:
  `list 33 33` is also sent by ordinary lobby browsing, and one run lost the WDT screen entirely.
  So `Start` handling is **downstream of the mangler session** (the client enters state 1/2 after
  connecting), not something to inject before it.
- **Start-line injection (negative)**: queueing a synthetic
  `:matchbot!mb@local PRIVMSG <nick> :Start 0:RA2Web` when the client sends `list 33 33` does
  not reach the match-start handler (`0x75B910` never logs). The bridge delivers a PRIVMSG as
  `IChatEvent::OnPrivateUnicodeMessage` (ordinal 38); the `Start`/`Fail` parser sits behind a
  different chat event (the sink virtual at 0x7625C9, gated on WDT state `[0xA3D2A4]` 1 or 2),
  so the next probe must try the ASCII notice/message ordinals or set the WDT state first.
- **Next**: detect the mangler session in the bridge (the client reconnects after `LIST 33`) and
  answer its `list 0 0` with the matching server, then deliver `Start <game>` (0x75B910 handles
  it) and a matching game in the type-33 reply. The existing `WDT=`/STARTG assignment can then
  run. WDT-0b/3 (native) still needs the WOL TCP gateway.

### First finding: the browser does not use the raw TCP path

The faction click calls `WolChannel::RequestWDTState` through the WOLAPI COM bridge. A probe
wrapper (`m_wdt_request_state` in `src/web/wolapi.c`) logged:

```text
[wdt] RequestWDTState args 0C058240 00B269AC 00000000 00000003 sink 0BF5B910
```

The bridge currently returns `E_NOTIMPL`, so the game opens its `0xD0` “Unable to connect”
dialog. This is the browser path to implement. The direct `sub_00797800` TCP fetch is the
native/server-list path (`MGL entry in server list`, host at `0xB73B34`, port at `0xB76B0C`);
it is not what the browser’s side button calls. That means the WOL lobby process can host the
WDT state and the same COM bridge can deliver it over the existing page/WebSocket link — no
browser TCP bridge is required for the web client. Native clients still need the TCP listener.

## What the client does (evidence)

- **Native** WDT state uses a separate TCP endpoint. `Get_WDT_State_Silent` parses the WOL
  server-list `MGL` entry (host copied to `0xB73B34`, port to `0xB76B0C`) and logs
  `WDTHost is %s, port is %d`; it is not a WOL text line.
- **Browser** WDT state uses `WolChannel::RequestWDTState` in the WOLAPI COM bridge. A probe
  logged the call args (`0C058240 00B269AC 0 3`) and the sink (`0BF5B910`); the current stub
  returns `E_NOTIMPL`, which produces the `0xD0` dialog.
- `wonline.cpp`'s WDT fetch (`sub_00797800`, YR `0x00797800`) connects, sends a small request,
  then reads an `0x12`-byte header. It retries while the socket reports `0x102` and logs
  `Requesting current WDT cycle` / `Requesting Previous Cycle`.
- `INetUtilEvent::OnWDTState` (`CNetUtilEventSink__virtual_8`, YR `0x007A2FE0`) receives the
  packet and logs `Previous cycle data received`, `Current cycle data received` or
  `NACK received from server`. It builds a `WDTState`.
- `WDTState` (`0x0076AC90`) parses a **tagged packet** with 4-character tags. Tags seen in the
  parser: `NACK`, `TOTK`, `CRTK`, `CYLN`, `WURL`, `SDSC`, `LDSC`, `MPVC`, `HSVC`, `CMID`,
  `CYID`, `TICC`, plus six more and per-territory records. The parser uses the same
  field lookup (`sub_00625FB0` / `sub_00625F60` / `sub_00625DB0`) as the game's packet/chunk
  tree, so the wire format is a tagged tree, not an ad-hoc text protocol.
- The faction screen is `FactionSelectDialogControl` (`WDTFSBSm.pcx` / `WDTFSAsm.pcx` /
  `WDTFSSsm.pcx`, dialog `0x125`, `WorldDom.cpp`). The side is stored in `[control+0xC]` and
  committed by `WM_LBUTTONUP`.
- WDT matches use the WOL match request path: `MatchWDT `, `, WDS=0`, `, WDS=1`, `, WDT=` in
  `wonline.cpp` (`sub_007A0690`). The WDT server and the WOL/gserv relay therefore have to
  agree on the match assignment, but gameplay remains the existing native relay.
- Native game results already carry `WDTT` (and the other WDT fields) in the game-res packet
  (`Sending game results ... WDTT`, YR `0x006C700C`). The existing unscored native-results
  endpoint is the natural ingestion point.

## Non-goals in the first cut

- Rebuilding the original Westwood ladder formula or awarding RA2Web ladder points from WDT.
  WDT points/territory are a separate record until a later decision.
- A web page for browsing WDT standings. The first cut is the in-game service.
- Anti-cheat beyond the existing authenticated native report validation.

## Global constraints

- Reuse WOL account/session identity. Do not add a second login.
- Keep normal WOL, skirmish, campaign and native-result behaviour unchanged.
- Keep the WDT wire format in one codec; the server, tests and fake clients share it.
- The browser bridge must be bounded, authenticated, timeout-aware and must not block the game
  thread while waiting for the server.
- Changes in `../pcrecomp` are separate commits with their own selftests.
- Generated lift output is never committed; protocol fixes belong in `run_lift.py` and its tests.
- Record captured packets as derived evidence under `work/`, never commit retail payloads.

## Milestones

### WDT-0: Capture the protocol (go/no-go)

**Files:** `work/wdt/` capture scripts and logs; no product code yet.

The original servers are gone, so the only trustworthy reference is the client. The browser path
is already partly captured (WDT-0a). For the native path, point the WOL server-list `MGL` entry
at a local listener and run the native client through the WOL login.

- [ ] Write a minimal TCP listener that accepts one connection, logs every byte in both
      directions with timestamps, and can reply with a candidate packet from a file.
- [ ] Run the recompiled native YR and RA2 clients against it, once for the current cycle and once
      for the previous cycle, and save the request bytes and the client log lines.
- [ ] Identify the request framing: fixed 16/18-byte header, tag, cycle selector, nickname/ticket,
      byte order and any terminator.
- [ ] Identify the response envelope: how the `0x12`-byte header relates to the tagged body,
      lengths, alignment and nesting.
- [ ] Derive the complete tag list and field types from the `WDTState` parser and the six
      unlisted tags; map each to the UI field it drives.
- [ ] Produce a minimal synthetic response that reaches
      `OnWDTState: Current cycle data received` and opens the faction screen.
- [ ] Click a side and capture the follow-up request; document what the server must answer.
- [ ] **Gate:** do not start the product server until the faction screen loads and a side click
      produces a second, understood request. If the client requires an unavailable ticket or
      encryption, stop and record the blocker.

### WDT-1: Codec and state model

**Files:** `../ra2web/server/src/wdt/codec.ts`, `model.ts`, tests under
`../ra2web/server/test/wdt*`.

- [ ] Implement `encodeWdtState(state): Uint8Array` and `decodeWdtState(bytes): WdtState` from
      the WDT-0 captures, including the tagged tree and all integer/string/string-list fields.
- [ ] Define the model: cycle (`id`, `startsAt`, `endsAt`, `state`), campaigns/theaters, factions,
      territories (`id`, `name`, `owner`, centroid, `map`/theater, conflicts), conflicts
      (`attacker`, `defender`, `territory`, `gameId`, `status`, `winner`), player statistics and
      history entries.
- [ ] Add golden tests: each captured response decodes, re-encodes to the same canonical bytes,
      and rejects truncated/unknown-tag packets without throwing.
- [ ] Add a fixture state with at least two territories per side, one neutral territory, one open
      conflict and a non-empty history.

### WDT-2: Browser `RequestWDTState` bridge (started)

**Files:** `src/web/wolapi.c`, `src/web/pre.js` or `web/src/game/wol.ts`, `web/src/game/protocol.ts`,
`../ra2web/server/src/wdt/*`, tests.

The browser does not use the raw TCP path. `WolChannel::RequestWDTState` is the seam.

- [ ] Decode the four arguments and the memory at `0x0C058240` / `0x00B269AC`; record which is the
      request object, which is a buffer/string, and what `3` selects (current/previous cycle).
- [ ] Find and verify the `OnWDTState` event ordinal/vtable slot (`CNetUtilEventSink__virtual_8`);
      send a minimal `NACK` and verify the game logs `NACK received from server`.
- [ ] Add a bounded JS bridge (`ra2WdtState`/HTTP fetch) from the page to the RA2Web server; never
      block the game thread.
- [ ] Encode a minimal current-cycle fixture and deliver it through `OnWDTState`; verify the
      faction screen stays open instead of opening `0xD0`.
- [ ] Add a browser e2e assertion on `[wdt] RequestWDTState`, `Current cycle data received`, and
      the absence of `[dialog] open 0xD0`.
- [ ] Keep the native TCP path out of this task.

### WDT-3: Native TCP WDT listener

**Files:** `../ra2web/server/src/wdt/server.ts`, `service.ts`, `config.ts`, `index.ts`, tests;
native setup helper.

- [ ] Add `WDT_ENABLED`, `WDT_PORT` (default a free port), `WDT_HOST` and
      `WDT_SOCKET_PATH` configuration; do not disturb the WOL/gserv ports.
- [ ] Start `WdtServer` beside `WolServer` in the same `server/src/index.ts` process; pass the
      existing `SessionManager`, `AccountStore`, `Storage` and logger.
- [ ] Advertise the endpoint in the WOL `MGL` server-list entry and document how the native
      client is pointed at it.
- [ ] Serve the current and previous cycle with the same codec; bound every read, time out idle
      clients and close cleanly.
- [ ] Capture the native request bytes (`sub_00797800`) and add a fake-client integration test.
- [ ] Run the actual native client: faction screen without `TXT_WDT_NET_ERR`, side click accepted.

### WDT-4: Match flow and results

**Files:** `../ra2web/server/src/wdt/service.ts`, `ladder/nativeGameRes.ts` (extend), the native
results route, `web/src/game/wol.ts` if the report needs WDT context, tests.

- [ ] Define the match assignment: the WDT service picks a conflict/territory, while `WolServer`
      handles the `MatchWDT ` / `, WDS=0|1` / `, WDT=` lines and the existing gserv handoff; keep
      normal Custom Match untouched.
- [ ] Carry the cycle/conflict/territory IDs through the `WDT=`/`MatchWDT` fields and the STARTG
      context so a match can be attributed to a WDT conflict.
- [ ] Extend the native game-res parser with the `WDTT`/WDT fields, validating them against the
      authenticated roster and the assigned conflict.
- [ ] Apply a terminal result: winner takes or defends the territory, both players' WDT
      wins/losses/points update, history gains an entry, the conflict closes.
- [ ] Reject reports for unknown, already-closed or mismatched conflicts; keep them auditable.
- [ ] Test with two native clients: choose sides, play, report, and verify the next state changes.

### WDT-5: Cycles, history and admin

- [ ] Advance a cycle at `endsAt` (or by an authenticated admin action); freeze the old cycle for
      the previous-view request and start a fresh current state.
- [ ] Serve previous-cycle data with the same codec; verify the client logs
      `Previous cycle data received`.
- [ ] Keep a bounded history of territory flips, conflicts and results.
- [ ] Add operator endpoints/CLI for enable/disable, cycle advance and reset, with no secrets in
      logs.

### WDT-6: Persistence, tests and docs

- [ ] Add WDT tables to the storage interface and both backends (SQLite migration + memory):
      cycles, territories, conflicts, players, history.
- [ ] Unit tests: codec golden files, cycle rollover, conflict assignment, result application,
      duplicate/late reports, both storage engines.
- [ ] Regression: WOL login/lobby, skirmish, campaign, normal native results, LAN; native Windows,
      Linux and browser.
- [ ] Docs: `docs/web/decisions.md` (WDT is a separate service), `docs/web/protocol.md` (transport),
      `docs/web/deploy.md` (ports/keys), `docs/hires.md`/README if the user-facing status changes.
- [ ] Add the WDT start-up and health line to the server log and a conformance/smoke script.

## Data model sketch

```
wdt_cycles(id, starts_at, ends_at, state)
wdt_territories(cycle_id, id, name, owner_faction, x, y, theater, map)
wdt_conflicts(cycle_id, id, territory_id, attacker, defender, game_id, status, winner)
wdt_players(cycle_id, account, faction, points, wins, losses)
wdt_history(cycle_id, at, kind, payload)
```

Use the WOL account name as the player key. Keep the WDT points separate from the RA2Web ladder
until a later decision; the existing native-results path stays unscored.

## Risks and open questions

- **Protocol framing is the main risk.** The client parser proves a tagged tree, but the wire
  envelope, byte order and the six unlisted tags are unknown until WDT-0 captures them.
- **Cycle selection.** It is not yet known whether the client asks for previous first or current
  first, or how the request names the cycle; the capture must answer this.
- **Authentication.** The WDT request may carry only a nickname, or a WOL ticket. If it needs a
  ticket, the service must validate it through the existing session store.
- **Match assignment.** The WDT server may be expected to create the WOL room itself, or only to
  return a conflict and let `MatchWDT` find a room. The capture and `sub_007A0690` must settle
  this before WDT-4.
- **Result authority.** A client can lie in the game-res report; keep the existing authenticated
  roster checks, and decide whether a disputed result holds the territory.
- **No reference server.** Every response is reconstructed from the client parser; keep golden
  captures and make the codec tolerant of extra/unknown tags.
- **Browser transport scope.** A WebSocket TCP bridge is new HLE surface area; it needs the same
  bounded-buffer and game-thread discipline as the UDP relay.

## Order and go/no-go

Do WDT-0 first; it is small and decides the rest. If the faction screen and a side click can be
served, proceed with WDT-1 and WDT-2, then the browser transport, then matches. If the client
requires a credential or cipher we cannot reproduce, stop at the captured evidence and record the
blocker rather than building a server that cannot be reached.
