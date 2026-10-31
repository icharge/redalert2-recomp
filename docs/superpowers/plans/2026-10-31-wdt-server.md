# World Domination Tour (WDT) Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this
> plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make World Domination Tour playable end to end: the game loads a WDT cycle, a player
chooses a side, a WDT match starts, the result is reported, and the next state reflects territory
control, points and history.

**Architecture:** A new WDT module in the sibling `ra2web/server` owns the cycle/territory model
and speaks the legacy WDT TCP protocol. It runs in the **same Bun process and deployment as the
WOL lobby**, sharing accounts, sessions, storage, logging and admin. It is a separate *listener*
because the client opens a separate raw TCP socket, not because it is a separate server. Native
clients connect to it directly (`WDTHost`/`WDTPort` in the game's registry key). Browser clients
reach the same listener through a TCP-over-WebSocket bridge in `win32hle`/the page, because a
browser cannot open the raw TCP socket the game uses. The WOL lobby handles `MatchWDT`/`WDT=`
match requests and the existing native relay/game-result path supplies identity and completion;
the WDT module does not duplicate them.

## Why not just implement it in the WOL lobby?

The WOL lobby is a **text, line-oriented WebSocket protocol** (`/wol`, `WolServer.ts`): the game
sends `LOGIN`, `JOIN`, `CREATE`, `GAMEOPT`, `MATCH`, and similar lines, and the server answers in
the same framing. The WDT state fetch is not one of those lines. The client's `wonline.cpp` WDT
code (`sub_00797800`) reads `WDTHost`/`WDTPort` from the registry and opens a **raw TCP socket**
itself, then exchanges a small binary/tagged packet. It never sends that request over the WOL
socket, and the WOLAPI `WolChannel::RequestWDTState` stub is not the path the WDT screen uses.

So the split is:

| Concern | WOL lobby | WDT listener |
| --- | --- | --- |
| Transport | WebSocket, text lines | TCP (native) / WebSocket bridge (browser), binary tagged packet |
| Address | `/wol`, advertised by the server list | `WDTHost`/`WDTPort`, configured in the game's registry |
| Game code | `wolapi` / WOL line handlers | `wonline.cpp` WDT fetch, `OnWDTState`, `WDTState` parser |
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

**Why not multiplex one port?** The WOL endpoint is already a WebSocket upgrade; the WDT client
starts with its own binary header. Protocol sniffing on one port is possible but fragile, and the
game reads a dedicated `WDTPort` anyway. A separate port (native) plus a separate WS path
(browser) is simpler and testable.

**Why the registry is the hard part.** The lobby cannot tell the client where the WDT listener is:
the client reads `WDTHost`/`WDTPort` from `SOFTWARE\Westwood\<game>` before it talks to the
lobby. Native installs need a registry setup script; the browser needs the HLE to map that
virtual connection to the `/wdt` WebSocket. This is configuration, not a reason to put the state
in the lobby protocol.

**Tech stack:** TypeScript/Bun in `../ra2web/server`, Vitest, SQLite and memory storage; C/Emscripten
in this repo and `../pcrecomp` for the web transport; RA2/YR lifted C for protocol evidence; a
Python/TypeScript fake TCP server for packet capture.

**Status:** planning only. No server or transport code exists yet.

## Task breakdown and progress

| ID | Task | State | Depends on | Acceptance |
| --- | --- | --- | --- | --- |
| WDT-0a | Capture the browser request shape | **done** | — | The faction click reaches `WolChannel::RequestWDTState`; args recorded (`0C058240 00B269AC 0 3`, sink `0BF5B910`). |
| WDT-0b | Capture the native/server-list path | pending | — | Native `sub_00797800` request bytes and the `MGL` server-list fields are understood. |
| WDT-1 | Packet codec and state model | pending | WDT-0a/b | Golden state fixtures round-trip; the client parses a minimal state. |
| WDT-2 | Browser `RequestWDTState` bridge | **started** | WDT-1 | The bridge logs the call and returns a state event instead of `E_NOTIMPL`; the faction screen stays open. |
| WDT-2a | Server-side WDT state endpoint | pending | WDT-1 | RA2Web serves current/previous cycle JSON or a packet; the bridge can fetch it. |
| WDT-3 | Native TCP WDT listener | pending | WDT-0b | Native client loads the faction screen without a registry hack. |
| WDT-4 | Match assignment and result ingestion | pending | WDT-2/3 | `MatchWDT`/`WDT=` assign a conflict; `WDTT` updates it. |
| WDT-5 | Cycles, history, admin | pending | WDT-4 | Cycle rollover and previous-cycle view work. |
| WDT-6 | Persistence, tests, docs | pending | all | SQLite/memory tables, golden tests, two-client e2e, regression. |

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

- WDT is a **separate TCP service**, not the WOL lobby. `Get_WDT_State_Silent` reads
  `SOFTWARE\Westwood\Yuri's Revenge` / `SOFTWARE\Westwood\Red Alert 2` (`WDTHost`, `WDTPort`) and
  logs `WDTHost is %s, port is %d`.
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
- The browser transport must be bounded, authenticated, timeout-aware and must not block the
  game thread while waiting for the server.
- Changes in `../pcrecomp` are separate commits with their own selftests.
- Generated lift output is never committed; protocol fixes belong in `run_lift.py` and its tests.
- Record captured packets as derived evidence under `work/`, never commit retail payloads.

## Milestones

### WDT-0: Capture the protocol (go/no-go)

**Files:** `work/wdt/` capture scripts and logs; no product code yet.

The original servers are gone, so the only trustworthy reference is the client. Point a native
build at a local listener by writing the game's registry key (`WDTHost=127.0.0.1`,
`WDTPort=<port>`); for Wine/Linux use a `.reg` file, for Windows a `reg add` script.

- [ ] Write a minimal TCP listener that accepts one connection, logs every byte in both
      directions with timestamps, and can reply with a candidate packet from a file.
- [ ] Run the recompiled YR and RA2 clients against it, once for the current cycle and once for
      the previous cycle, and save the request bytes and the client log lines.
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

### WDT-2: TCP WDT service

**Files:** `../ra2web/server/src/wdt/server.ts`, `service.ts`, `config.ts`, `index.ts`, tests.

- [ ] Add `WDT_ENABLED`, `WDT_PORT` (default a free port), `WDT_HOST` and
      `WDT_SOCKET_PATH` configuration; do not disturb the WOL/gserv ports.
- [ ] Start `WdtServer` beside `WolServer` in the same `server/src/index.ts` process; pass the
      existing `SessionManager`, `AccountStore`, `Storage` and logger, so no second login or
      database is introduced.
- [ ] Serve the current and previous cycle state from one in-memory `WdtService`; answer `NACK`
      with a bounded reason when no state exists.
- [ ] Bound every read (header, body, fields), time out idle clients and close cleanly on
      shutdown.
- [ ] Add a native-client setup helper (`reg add` / `.reg`) and document the exact keys.
- [ ] Integration test: a fake client sends the captured request and receives a decodable
      response; unknown clients get a clean close.
- [ ] Run the actual native client against the service; acceptance is the faction screen opening
      without `TXT_WDT_NET_ERR` and a side click being accepted.

### WDT-3: Browser transport

**Files:** `../pcrecomp/runtime/win32hle/wsock32.c`, its selftests; `web/src/game/wdt.ts` and
tests; `../ra2web/server/src/wdt/ws.ts`.

The game's WDT client calls Winsock `connect`/`send`/`recv` directly, so `WolChannel::RequestWDTState`
is not the path to implement. The browser needs a TCP substitute.

- [ ] Decide the seam: a `wtcp_*` transport in `wsock32.c` for the WDT host/port, or a page-level
      interception of the socket pair. Prefer the HLE transport so the guest code is unchanged.
- [ ] Add a WebSocket endpoint (`/wdt`) that carries length-prefixed TCP frames both ways.
- [ ] Implement connect/send/recv readiness, partial reads, backpressure, reconnect policy and
      `WSAEWOULDBLOCK` semantics; no busy-wait on the game thread.
- [ ] Selftest: a paired in-memory socket echoes a frame, returns `WSAEWOULDBLOCK` when empty,
      and recovers from a closed peer.
- [ ] Browser e2e: launch the imported game, open World Domination, verify the faction screen and
      a side click reach the server.
- [ ] Document the transport in `docs/web/protocol.md` and the server endpoint in
      `docs/web/deploy.md`.

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
