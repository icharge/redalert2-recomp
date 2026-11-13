# Seasons and the public leaderboard

Status of 14 Nov 2026. What exists is audited from the code (ra2web `server/src/ladder/LadderService.ts`,
`http/adminRoutes.ts`, `http/routes.ts`); the rest is a design for your decisions.

## What exists

| Piece | State |
|---|---|
| Season record | `ladder_seasons(id, sku, name, start_time, end_time, status, closed_at)`; one **current** season per SKU (16640 Red Alert 2, 18688 Yuri's Revenge); a season "1" is created on first boot |
| Per-season ratings | `ladder_standings` is keyed by `(sku, player, season_id, ladder_type)`, history rows carry the season, so each season has its own ratings, W/L, placement and streak |
| Ladder types | `1v1` and `2v2-random` per SKU. World Domination has its own service (`wdt/`) and no rating; co-op is unranked |
| Season bound at admission | A ranked match scores into the season it was admitted in, even if the season ends while it runs; a grace window after the end still accepts late reports (`ladder.seasonGraceSeconds`) |
| Admin | create (`POST /admin/seasons`), edit name/dates, close (records `closedAt` once so the grace cannot be extended); list per SKU |
| Public read | `GET /leaderboard/{sku}/{type}/{season}` (season is `current`, `prev` or an id), `GET /players/{name}?sku=&ladderType=`, `GET /matches/{id}`; the web client's `/ladder` pages |
| Reset | None. A new season starts every player at the starting rating with placements again |

## What is missing

| # | Gap | Why it matters |
|---|---|---|
| SE1 | **Soft reset.** A new season restarts everyone at 1000, so a long-time top player and a newcomer tie on day one | Seasons feel like wipes; players quit |
| SE2 | **Season rewards and badges.** No record of who finished where | Nothing to play for; no history after the season |
| SE3 | **Archived season page.** A closed season's final table is only reachable by its id; nothing freezes it | A later rescore or adjudication silently changes an old "final" |
| SE4 | **Public season list and API.** No `GET /seasons`; the client has to know ids | A leaderboard page cannot list seasons |
| SE5 | **Per-mode boards.** One board per (SKU, ladder type). Quick Match and a lobby-made ranked 1v1 share `1v1`; WDT and co-op have none | Modes with different pace cannot be compared |
| SE6 | **A leaderboard web page.** The data is public; there is no page in the web client or the admin | Players cannot see the ladder without the API |
| SE7 | **Scheduled start and end.** Seasons start when an admin creates them and end when closed or past `end_time` | Operators want "ends 1 Jan 00:00" without being awake |

## Design

### Season lifecycle

```
scheduled --(start_time)--> current --(end_time or admin close)--> grace --(+grace)--> archived
```

`status` becomes `scheduled | current | closing | archived`. `archived` freezes the final table: a snapshot of the
standings is written to `season_results(season_id, sku, ladder_type, rank, player, rating, wins, losses, placed)` at the
moment the grace ends, so a later rescore touches the live tables but never the archived result (an adjudication after that
moment is recorded and shown as a note on the archived season). A scheduler (the settlement timer already runs every few
seconds) moves seasons through the states, so no operator has to be awake at midnight.

### Reset rules (decision)

At the start of a new season each player who finished the previous one with at least N rated games gets
`rating = start + (previous - start) * factor` (a soft reset) and keeps no placement games; everyone else starts at `start`.
Recommended defaults: `factor = 0.5`, `N = 5`, placements restart at 3 (not 10) for carried players. Three alternatives:

| Rule | Effect |
|---|---|
| Hard reset | Everyone starts at the starting rating (today). Simple, fair, punishes veterans |
| Soft reset (recommended) | Halves the distance from the start; veterans stay above newcomers, the board compresses |
| Carry over | No reset; a "season" is only a reporting window. No fresh start, but no churn either |

The rule is a season setting (`reset_policy`: `hard`, `soft:<factor>`, `carry`) chosen when the season is created.

### Rewards and badges (optional)

`season_awards(season_id, sku, ladder_type, player, kind, rank)`; `kind` = `champion`, `top10`, `top100`, `placed`. Written
with the archive snapshot. The public profile lists them. No in-game effect: the retail game cannot show a badge, so this is
a web-page feature. Decision: wanted, or leave seasons as tables only.

### Public API (additions)

| Route | Returns |
|---|---|
| `GET /seasons?sku=` | `[{id, name, status, startTime, endTime, ladderTypes}]`, newest first |
| `GET /seasons/{sku}/{id}` | one season with its final table once archived |
| `GET /leaderboard/{sku}/{type}/{season}` | exists; gains `archived: true` and `snapshotAt` for archived seasons |
| `GET /players/{name}/awards` | badges across seasons |

### Modes

The leaderboard key is `(sku, ladder_type)`. Add ladder types, not tables: `1v1` stays the default; `qm-1v1` (Quick Match only)
and `coop` if co-op is ever ranked ([co-op.md](co-op.md)). A match carries its queue (`wol-native` source already says so), so
the rating service picks the type from the admission. Whether Quick Match and lobby-made ranked 1v1 should be one board or two is
a decision; recommended: one board per edition (as today), and a separate unranked "co-op" counter if wanted.

### Page

A read-only leaderboard page in the web client (`web/`) and the admin: season picker, edition and mode tabs, search by name,
the player's season history. It reads only the public routes above. The admin console adds: create season (with reset policy and
dates), start/close now, view the archive and the awards.

### Implementation order

1. `GET /seasons` and `archived` on the leaderboard (read-only, small).
2. Season states, the scheduler and the archive snapshot (migration: new table, status values).
3. Reset policy applied at season start; tests on both storages.
4. Awards.
5. The page.

## Decisions that are yours

1. Reset rule and factor (recommended: soft, 0.5, at least 5 games).
2. Badges and awards: wanted or not.
3. One board for Quick Match and lobby ranked, or separate.
4. Season length (today 365 days by default; a quarter is common for an active ladder).
