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

## Release state and operator flags

Status (12 November 2026): T0–T13 are implemented and reviewed on `ra2web`
`feat/shared-ranked-release` and `vera20k` `feat/lobby-replay-upload`; the
real-client integration gate (T14 steps 2–4) has **not** been run.

| Flag (ra2web server) | Default | Effect |
|---|---|---|
| `VERA_ENABLED` | `true` | Serve Vera20k's `/v1/*` lobby on the shared data. `VERA_SKU` defaults to 18688 (YR). |
| `NATIVE_RANKED_ENABLED` | `false` | Ranked 1v1 for retail clients on the exact `NATIVE_GAME_VERSION`. Keep off until a real YR capture confirms the wire GSKU 18688 (`ra2web/docs/ranked-ladder.md`). |
| `RANKED_SEASON_GRACE_SECONDS` | `1800` | Reports are settled until `(closedAt \|\| endTime)` plus this; later reports are archived unscored. |
| `LADDER_LEGACY_SKU` | unset | Assigns pre-SKU legacy rows to 16640 or 18688. Unset hides them. Back up first (the migration does; see the server README). |

Rollback: turn the flags off; ranked rows stay. The README's "Ranked rollout
and rollback" section has the enable order, the log lines to watch, and the
migration backup restore.

## Known limitations

- Only authenticated 1v1 quick match ranks, paired per client family. No AI,
  co-op, custom-room or Vera team/FFA ranking.
- No native in-game ladder or score-gain UI (T11 excluded); use
  `GET /leaderboard/...` and `GET /players/{name}`. Cross-engine replay
  playback is not promised.
- A client-controlled `ended_ago` can force a non-adjudicable `too_short`.
- Adjudication skips the season grace check, and a win/loss adjudication needs
  an explicit `winner`.
- The Vera 3-rated-games-per-24h limit is not implemented.
- `GET /v1/matches/{id}` is memory-only and lasts 10 minutes.
- Rematches in the same paired Vera room rank.
- `replayPath` is still exposed in public `/matches`.
- Unconfirmed against real clients: YR wire GSKU 18688, `FINI=0` semantics,
  retail native version 1.006 and lobby channel mapping, UDP relay
  admission/renewal, and whether the recomp native client records replays.
