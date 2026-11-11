# Shared ranked server: WOL (recomp) and Vera20k

The ranked ladder, season leaderboard, match history and replays live in the
sibling RA2Web server (`C:\Users\Norrapat\projects\ra2web`, `server/`). That
server is the single writer for both this build's WOL client and Vera20k's
protocol-4 lobby.

## What this build uses

This release changes nothing in the recomp client's ladder or score screens
(see "Native client scope" below). The existing WOL contract already points
at the server through `servers.ini`:

```
wladderUrl = <base>/ladder
wgameresUrl = <base>/wgameres
```

Ranked quick matches now also use the same standings for pairing: the server
pairs the closest-rated two entries instead of taking the first two in queue
order. Native (1.006) and web (0.83.x) clients are never paired together.

## New shared reads

| Endpoint | Purpose |
|---|---|
| `GET /leaderboard/{sku}/{ladderType}/{season}?start&count` | one season's canonical order with WOL Elo and Vera OS/badge |
| `GET /players/{name}?sku&ladderType` | profile, newest 20 rated games, 200-game OS trend, seasons |
| `GET /matches/{gameId}` | archived match, source and replay URL |
| `GET /replays/{gameId}` | existing replay download |

The WOL score screen still uses the `730` report and the existing
`/ladder/...` calls. These additions are for history pages, the admin console
and Vera20k.

## Native client scope

There is **no native in-game ladder or score-gain UI in this release**
(decision 5 in `shared-ranked-server-gap-analysis.md`, "Decisions taken"). The
native ladder COM calls stay stubs and the native client shows no rating gain;
standings come from the HTTP leaderboard and profile endpoints above. Native
ladder screens are planned for a later release.

## Ladder SKU

Rating is keyed per SKU: RA2 is `16640`, Yuri's Revenge is `18688`. Vera20k is
Yuri's Revenge, so `VERA_SKU` defaults to `18688` and Vera shares the YR ladder
with native and web YR. `RANKED_SEASON_GRACE_SECONDS` (default `1800`) is how
long past a season's end a match that started inside it may still be rated into
it.

## How Vera20k shares the data

Vera20k's lobby is served by the same Bun process under `/v1/*` (protocol 4):
sessions, channels, quick match, room start, relay admission and `finish`.
Results from Vera20k are recorded in the same `ladder_matches` ledger with
`source: "vera20k"`; Vera's OS is a projection of the canonical Elo, so both
leaderboards have the same player order.

The Vera client is pointed at the server with its existing build/runtime
setting:

```
VERA20K_LOBBY_URL=https://<host>
```

Vera requires an HTTPS origin. Its match relay remains a separate Vera
service; the lobby only signs relay grants. Set `VERA_RELAY_ADDRESS` and
`VERA_RELAY_TICKET_KEY` on the server to the same values the relay uses.

The full implementation plan and server configuration are in
`ra2web/docs/superpowers/plans/2026-11-11-shared-ranked-wol-vera.md`.

## Limits

- The results are client-reported. The server still applies the existing
  authenticated roster, rank-type, duration and one-time game-ID checks.
- Vera map upload/library, translation and federated relays are not provided
  by this lobby pass.
- Vera account registration is immediate in this deployment; the emailed
  verification code is accepted but not delivered.
