# WOL: Internet play

Everything about Westwood Online play in this repo, in one place: how the games
talk to the server, how the browser and native builds connect, Quick Match, and
the shared ranked server. The server itself is the sibling repo
`../ra2web` (`C:\Users\Norrapat\projects\ra2web`, `server/`); this folder
documents the client side and the contract between the two.

## Start here

| You want | Read |
|---|---|
| The lines on the wire: login, lobbies, game rooms, matchbot, gserv, results | [protocol.md](protocol.md) |
| How the retail Yuri's Revenge Quick Match button works and what is verified | [quick-match.md](quick-match.md) |
| The matchbot: queues, pairing, and every message it sends | [matchbot.md](matchbot.md) |
| The WOLAPI shim in `src/web/wolapi.c`, Custom Match, what is built and open | [handoff-wolapi.md](handoff-wolapi.md) |
| The ranked ladder shared by this client and Vera20k | [shared-ranked-server.md](shared-ranked-server.md) |
| What is left to make it fully functional, ranked, with evidence | [roadmap.md](roadmap.md) |
| Where the shared ranked server stands, and the next steps | [handoff-shared-ranked-server.md](handoff-shared-ranked-server.md) |
| What was missing for it, task by task | [shared-ranked-server-gap-analysis.md](shared-ranked-server-gap-analysis.md) |
| Why a match feels slow, and the transport options | [../web/network-performance.md](../web/network-performance.md) |
| Running a server and two clients to test | [../web/testing.md](../web/testing.md) |

## Server docs (in `../ra2web/docs/`)

They describe the server's own design and link into its source, so they stay
there; read them through these paths.

| Doc | What it covers |
|---|---|
| [wol-irc-and-modernization.md](../../../ra2web/docs/wol-irc-and-modernization.md) | The original WOL IRC dialect and what the server changed |
| [networking.md](../../../ra2web/docs/networking.md) | Section 9, the WOL lobby and channel server |
| [online-play.md](../../../ra2web/docs/online-play.md) | Accounts, lobbies and play, from the player's side |
| [plan-quickmatch-queue-chat.md](../../../ra2web/docs/plan-quickmatch-queue-chat.md) | The web Quick Match queue |
| [ranked-ladder.md](../../../ra2web/docs/ranked-ladder.md) | Ranked rules, SKUs, seasons, settlement |
| [game-ladder.md](../../../ra2web/docs/game-ladder.md) | The ladder's data and API |

When the server and these pages disagree, the server code wins: the protocol
page names the file for each part.

## The pieces

```
 game (lifted C)          shim                  server (ra2web)
 WOLAPI COM calls  -->  src/web/wolapi.c  -->  WolServer.ts   (lines, ws :9090)
 datagrams         -->  winsock shim       -->  NativeRelay.ts (/gserv)
 GameRes at the end -->  host.c            -->  /native-results
```

- **Native Windows/Linux builds** emulate the retail launcher in `host.c` and
  can use the classic TCP gateway (`WolTcpGateway.ts`, port 6667).
- **The web build** uses the WebSocket and `wolapi.c` only.
- **Vera20k** (the web-native client) uses the same server through its own
  lobby code and the web queues (50/51/60/61).

## Where things are

| Thing | Path |
|---|---|
| WOLAPI shim | `src/web/wolapi.c` |
| Launcher emulation, GameRes posting | `src/runtime/host.c` |
| Test harness | `web/e2e/lib.mjs`, `web/e2e/wol-server.mjs`, `web/e2e/wol.mjs` |
| Server lines | `ra2web/server/src/server/WolServer.ts`, `protocol/*.ts` |
| Matchbot | `ra2web/server/src/matchmaking/MatchmakingBot.ts` |
| Native relay and results | `ra2web/server/src/gserv/NativeRelay.ts`, `http/nativeResults.ts` |
| Quick Match handler in the game | gamemd `0x79FC40` (`tools/vera_lookup.py`, [../reverse-engineering.md](../reverse-engineering.md)) |
