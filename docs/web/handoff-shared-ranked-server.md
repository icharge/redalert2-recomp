# Handoff: shared ranked server for WOL (recomp) and Vera20k

Date: 11 November 2026.

Status: the shared ranked server core is implemented in the `ra2web` working
tree, but the review below found ranked-release blockers outside the passing
test coverage. No recomp client code was changed. Fix shared scoring and
admission before enabling the still-open native/recomp-WOL ranking path.

Related documents:

- `ra2web/docs/superpowers/plans/2026-11-11-shared-ranked-wol-vera.md` — the
  implementation plan and design decisions.
- [shared-ranked-server.md](shared-ranked-server.md) — the short player/operator
  view of the shared data.
- [shared-ranked-server-gap-analysis.md](shared-ranked-server-gap-analysis.md) —
  11 November review, evidence, open decisions and T0–T14 task cards with files,
  dependencies and acceptance criteria.

## Review update: blockers and task breakdown

The 11 November review checked the local server/recomp implementation and Vera's
protocol/client contracts. This update supersedes the earlier native-first
follow-up order. Findings are recorded; no product fixes have been implemented.

Confirmed with temporary, memory-only probes against the actual services:

- **Nonparticipant Vera reports can score a match.** `VeraLobby.finish()` uses
  `matchById()` without the roster check in `requireMatch()`. Alice's report
  followed by an unrelated guest's matching winner claim scored Alice +12 and
  Bob -12 without Bob reporting.
- **RA2 ratings leak into YR.** Seasons use `(id, sku)`, but standings use
  `(username_key, season_id, ladder_type)` without SKU. A RA2-only win appeared
  as rating 1012 in both editions.
- **Closed seasons still score.** Current-season lookup selects the newest
  season without checking status/time. A match scored after season closure.
- **Vera starts bypass readiness.** A start succeeded without readiness/map
  acknowledgement exchange; current revision/version/digests are not enforced.

Source inspection also found nontransactional rating/history writes, missing
restart/incomplete-report policy, client-controlled Vera ranked eligibility,
unbounded request reads before validation, incomplete event/relay compatibility
coverage and replay delivery gaps. See the detailed review for evidence and limits.

The six T0 decisions were taken on 12 November 2026 and are recorded in the gap
analysis ("Decisions taken"): per-SKU competition with Vera as YR (18688),
1v1 quick match only, unscored incomplete/disputed archives with operator
adjudication, season bound at start with a grace window, no native ladder UI
(T11 excluded), and replay download plus Vera auto-upload (needs a `vera20k`
client hook). The implementation plan is
[2026-11-12-shared-ranked-release.md](../superpowers/plans/2026-11-12-shared-ranked-release.md);
next is T0 (baseline commit approval) and then T1.

| Task | Deliverable | Dependencies |
|---|---|---|
| T0 | Freeze release decisions and inventory cross-repo working changes | None |
| T1 | Reject nonparticipant Vera finishes; require the exact reporter roster | None; immediate blocker |
| T2 | Isolate competition storage, scoped reads and migration | T0 competition decision |
| T3 | Enforce running seasons and bind matches to the agreed season | T0 boundary decision, T2 |
| T4 | Settle ratings, ledger and player history atomically | T2, T3 |
| T5 | Enforce Vera readiness/content agreement and ranked eligibility | T0 scope, T3 |
| T6 | Persist report collection and define pending/scored/disputed/expired states | T0 result policy, T2–T4; T1 for Vera |
| T7 | Bound Vera request ingestion and enforce auth/rate-limit controls | T0 account/replay contract |
| T8 | Enable family-safe native ranked queues and periodic Vera queue checks | T0, T3 |
| T9 | Add native ranked report consensus and settlement | T2–T4, T6, T8 |
| T10 | Handle native stored/pending/scored acknowledgements and stale callbacks | T6 contract, T9 |
| T11 | Implement native ladder/score presentation if included | T0 UI decision, T2/T3; T10 for score delivery |
| T12 | Verify Vera event/retry/relay interoperability | T5, T7; T6 if resume is included |
| T13 | Deliver format-aware replay/history reads and approved upload behavior | T0 replay decision, T2, T6, T7 |
| T14 | Run real-client integration and document rollout/rollback | Required T1–T13 scope |

Recommended sequence: T0 plus the immediate T1 fix; shared correctness T2–T4;
Vera admission/lifecycle/HTTP T5–T7 with queue work T8 after its contracts settle;
native ranked T9/T10; required presentation, interoperability and replays
T11–T13; then T14. Keep ranked expansion disabled until its dependencies pass.

Review verification: **64 pass, 0 fail, 270 assertions across 7 files**, running
`veraLobby`, `veraRoutes`, `leaderboardRoutes`, `ladderService`, `nativeResults`,
`matchmakingTeamAllocation` and `matchbotVersion` tests. The probes used zero
minimum duration/placement count to isolate the checks and touched no persistent
data or running service. No full-suite rerun, TypeScript check, WASM build or
real-client/relay test was performed during this review.

## Execution status (subagent-driven run, 12 November 2026)

Plan: [2026-11-12-shared-ranked-release.md](../superpowers/plans/2026-11-12-shared-ranked-release.md).
Code lives in `ra2web` on branch `feat/shared-ranked-release` (baseline `c8e43b7`).
Each task was reviewed (spec + quality); findings and rulings are in the run's
ledger (`ra2web/.superpowers/sdd/2026-11-12-shared-ranked-release/progress.md`,
git-ignored scratch). Full suite after each task: only the 5 baseline failures.

| Task | State | ra2web commits |
|---|---|---|
| T0 baseline, YR SKU default | complete | a696a0c (recomp db802124) |
| T1 roster-only Vera finish | complete | e425437 |
| T2 SKU-scoped storage + migration | complete | f15cec2, 223add1 |
| T3 running seasons, closedAt | complete | f22c3b8 |
| T4 atomic settlement | complete | 44cc49b, 978bf55 |
| T5 Vera admission + eligibility | complete | 8fd49ad |
| T6 durable Settlement + adjudication | complete | 94a1eb0, 4b8bb1a |
| T7 bounded `/v1/*` + limits + bans | complete | 8d0af0e |
| T8 family-safe queues | complete | be57dc6, 14b2baf |
| T9 native ranked settlement | complete | 8664f72, 2a11733, 1a87368, 7cba005 |
| T10, T12, T13, T14 | not started | |

Open carry-overs: **YR native wire GSKU 18688 is an unconfirmed assumption that blocks the T14 real-client run** (see `ra2web/docs/ranked-ladder.md`);  T13 must strip `nativeReports` from public `GET /matches/{id}`
and authenticate the replay bearer before reading the body; T14 documents the
known limitations (client-controlled `ended_ago`, 3-rated-games-per-24h limit
not implemented, adjudication `winner` required for win/loss).

## Repositories and working state

| Repo | Change |
|---|---|
| `ra2web` (`C:\Users\Norrapat\projects\ra2web`) | Server implementation, tests, config and docs. All uncommitted. |
| `redalert2-recomp` | Documentation only. |
| `vera20k` | No code change. It can point `VERA20K_LOBBY_URL` at the shared server. |

The `ra2web` changes are uncommitted. `git status` there shows modified
server files, plus new `server/src/vera/`, `server/src/ladder/os.ts`,
`server/src/http/veraRoutes.ts`, three new test files, and the untracked plan
under `docs/superpowers/`.

## What was requested and decided

The request was WOL matchmaking (quick match), season ranking/leaderboard,
match history, scoring and replays, shared by recomp's WOL client and Vera20k.
The decisions taken:

1. **Elo is canonical.** The existing WOL ladder rules (1000 start, 10
   placement games, K=60/24, streak bonus, rank types 1–10) are the only
   ratings a match updates.
2. **Vera OS is a projection.** Vera20k's OS is derived from the same Elo with
   `os = 16.67 + (rating - 1000) * 0.02666`, so both leaderboards have the
   same ordering. No second rating is stored.
3. **One match ledger.** `ladder_matches` and `ladder_match_players` record
   WOL web, WOL native and Vera20k games. The payload carries the source
   (`wol-web`, `wol-native`, `vera20k`).
4. **One account namespace.** WOL and Vera20k accounts are the same
   `accounts` rows. Vera names may be 1–24 characters; names beyond the
   retail WOL limit still own the same ranked identity.
5. **Vera's relay remains separate.** The lobby signs Vera relay admission
   grants but does not proxy gameplay.

## Implemented server pieces

### Shared ranked core

- `server/src/ladder/os.ts`
  - `osFromRating()`, `badgeFromOs()`, badge points and `scanProfile()`.
  - The OS range is 16.67 (1000 Elo) to 46 (2100 Elo).

- `server/src/ladder/LadderService.ts`
  - `RecordMatchInput.source` and the match payload’s `source`.
  - `getCurrentSeason(sku)`.
  - `getMatchRating(name, sku, ladderType)` for the matchmaker.
  - `getLeaderboard(sku, ladderType, season, start, count)` — Elo, WOL
    points, Vera OS/badge, shared rank.
  - `getSharedPlayerProfile(name, sku, ladderType)` — profile, newest 20 rated
    games, 200-game OS trend and season history.
  - `recordNativeReport()` and `archivePublicMatch()` now mark their source.

### HTTP surfaces

Shared, protocol-neutral:

| Route | Purpose |
|---|---|
| `GET /leaderboard/{sku}/{ladderType}/{season}?start&count` | canonical leaderboard |
| `GET /players/{name}?sku&ladderType` | shared profile, games, trend, seasons |
| `GET /matches/{gameId}` | archive row, source and `replayUrl` |
| `GET /replays/{gameId}` | existing `.rpl` download |
| `GET /ladder/...`, `POST /wgameres/{sku}` | unchanged WOL contract |
| `POST /native-results/{gameId}` | unchanged native result archive (still unscored) |

Vera20k protocol 4:

| Route | Notes |
|---|---|
| `POST /v1/sessions` | guest/account sign-in; remembers a sign-in token |
| `POST /v1/commands` | join/create/leave/logout/options/choices/ready/map_status/advertise/start/relay_ready/latency_ready/renew_relay/finish/chat/ping/ladder/locales/buddies/locate/kick |
| `GET /v1/events`, `WS /v1/events/stream` | per-session sequence/cursor and idempotent request IDs |
| `GET /v1/channels?kind=0\|41` | public, quick-match and game rooms |
| `GET /v1/stats`, `GET /v1/players/{name}` | public counts and profile |
| `POST /v1/accounts/register\|verify\|forgot\|forget` | shared accounts |
| `POST /v1/matches/{gameId}/replay` | optional Vera JSON replay upload |
| `POST /v1/translate` | 503, not configured |

### WOL quick match

`server/src/matchmaking/MatchmakingBot.ts`:

- Ranked entries pair by rating: closest pair inside a window that starts at
  120 and widens with wait time; after a minute any compatible pair matches.
- Unranked entries keep FIFO.
- Native (`1.006`) and web (`0.83.x`) clients never pair with each other.
- A periodic recheck lets the window widen without requiring a new queue join.

### Vera20k server side

- `server/src/vera/relayGrant.ts` — signs the 98-byte Vera relay v2 ticket,
  derives the packet key and signs the 66-byte `VO1C` ordering certificate.
- `server/src/vera/VeraLobby.ts` — protocol-4 sessions, channels, quick match,
  rooms, options/readiness/start, relay admission barriers, finish/result
  ingestion, ladder/profile reads and optional replay storage.
- `server/src/http/veraRoutes.ts` — `/v1/*` HTTP routes.
- `server/src/index.ts` — `/v1/events/stream` WebSocket target and lobby
  construction.
- `server/src/config.ts`, `server/src/auth/accountStore.ts`,
  `server/src/http/cors.ts` — Vera config, shared account creation and native
  no-Origin WebSocket upgrades.

Vera quick match flow implemented: `Lob_40_0` and matchbot, `Working`/`Pool`/
`Start`, host room `<host>'s_game`, guest join, options/readiness, `game_started`
with per-player relay grants, `relay_ready` → `start_confirmed`,
`latency_ready` → `timing_confirmed`, and `finish` scoring once every player’s
report agrees.

Intended scoring trust: a Vera match should be rated only after all roster
players report and their winner claims agree. **The review above disproved the
current enforcement:** a nonparticipant can substitute for a missing reporter.
T1 must fix this before relying on the consensus check.

## Recomp WOL side: audit and remaining gaps

The existing recomp WOL line protocol and HTTP contract need **no change** for
the server work above. The new leaderboard/profile endpoints are additive, and
quick-match pairing is entirely server-side.

However, the native/recomp client does **not** yet participate in ranked
scoring or display the new season leaderboard:

1. **Native results are deliberately unscored.**
   - `ra2web/server/src/http/nativeResults.ts` states that native history
     ingestion cannot enter the ranked scoring path and returns
     `{ranked:false}`.
   - `redalert2-recomp/web/src/game/wol.ts`, `submitNativeResult()`, rejects
     any acknowledgement whose `ranked` is not `false`.
   - The native packet has the data needed to score: `FINI`, `OOSY`, `DURA`,
     `SCEN`, `CMP*`, `GSKU` in
     `ra2web/server/src/ladder/nativeGameRes.ts`.

2. **The native in-game ladder/leaderboard COM calls are stubs.**
   - `redalert2-recomp/src/web/wolapi.c` maps `RequestLadderSearch`,
     `RequestLadderList`, `RequestLocaleLadderList` and
     `RequestLocaleLadderSearch` to `m_stub_*`.
   - Until those are implemented, the native ladder screen cannot read the
     shared season standings.

3. **Native ranked quick match is not accepted by the server.**
   - Ranked `versionOk` currently accepts only the RA2Web web version.
   - Native quick-match instances only receive `nativeSku` in the WDT path.
   - A native `RKD=1` queue therefore cannot become a ranked native instance.

The browser WOL client in `ra2web` is fully covered by the existing HTTP
ladder and `wgameres` path. The gaps above are specific to the recomp/native
WOLAPI route.

### Recommended order for the follow-up

The shared blockers and T0–T14 order above take precedence. Once shared scoring
and admission are ready, the native integration work is:

1. Server: allow native ranked quick match, keep native/native and
   web/web pairing separated, set the correct native SKU, and score
   `/native-results` only when all roster reports agree.
2. Recomp: accept `ranked: true` in `submitNativeResult()`, and handle the
   `730` game report if the native score screen should show the gain.
3. Native ladder screen: out of scope for this release (decision 5, no native
   in-game ladder or score-gain UI); use the web/admin/API leaderboard. The
   `RequestLadderSearch`/`RequestLadderList` COM methods stay stubs.
4. Add WOLAPI selftests and web unit tests for both the `ranked:true` ack and
   the ladder replies.

## Verification already run

From `ra2web/server`:

```powershell
bun --bun tsc -p tsconfig.json
bun test test/veraLobby.test.ts test/veraRoutes.test.ts test/leaderboardRoutes.test.ts
bun test test/matchmakingTeamAllocation.test.ts test/ladderRoutes.test.ts test/ladderService.test.ts
bun test
```

Results:

- TypeScript passes.
- 55 focused tests pass across the ladder, leaderboard, matchmaking and Vera
  suites.
- Full suite: **334 pass / 5 fail**. The five failures are the pre-existing
  Windows replay-file colon-name tests (three) and native WDT/TCP tests (two);
  the baseline before this work had the same five.
- A live smoke on port 19099 returned:
  - `/health` → `{ status:"ok", protocol:4, ... }`
  - `/v1/sessions` → guest session and MOTD
  - `/v1/channels?kind=0` → public and quick-match channels
  - `/v1/stats` → online/open-game counts

Vera transport has not been exercised against a real Vera relay or a real
Vera20k client in this session.

## Configuration

Server environment:

```ini
VERA_ENABLED=true
VERA_SKU=18688   # Vera is Yuri's Revenge (was 16640 before the SKU decision)
VERA_RELAY_ADDRESS=<ipv4>:<port>
VERA_RELAY_TICKET_KEY=<32-byte hex/base64/base64url key>
VERA_ADMIN_KEY=<optional bearer>
```

- `VERA_RELAY_ADDRESS` and `VERA_RELAY_TICKET_KEY` must match the separate
  Vera relay deployment. Without them, Vera rooms can be created but cannot
  start.
- Vera clients use `VERA20K_LOBBY_URL=https://<host>` (the client requires an
  HTTPS origin outside its wasm fallback).
- WOL `/servers.ini` is unchanged.
- WOL `.rpl` recording still follows `RECORD_REPLAYS=true` and `REPLAYS_DIR`.
- Vera replay upload stores `replays/vera/vera-<gameId>.json` and links it to
  the shared match archive.

Security notes:

- Vera account registration in this pass is immediate; the six-digit
  verification shape is accepted but no email is sent.
- Vera password reset and account deletion return `accounts_unavailable`.
- Results are client-reported. WOL keeps its existing instance/roster/duration
  checks. Vera's intended all-roster agreement currently lacks reporter
  membership enforcement; see the review update and T1.
- The relay ticket key is a secret; do not log it.

## Uncommitted files to review before committing

In `ra2web`:

```
server/.env.example
server/README.md
server/src/auth/accountStore.ts
server/src/config.ts
server/src/http/cors.ts
server/src/http/routes.ts
server/src/http/veraRoutes.ts          (new)
server/src/index.ts
server/src/ladder/LadderService.ts
server/src/ladder/os.ts                (new)
server/src/matchmaking/MatchmakingBot.ts
server/src/server/WolServer.ts
server/src/vera/VeraLobby.ts           (new)
server/src/vera/relayGrant.ts          (new)
server/test/leaderboardRoutes.test.ts  (new)
server/test/matchmakingTeamAllocation.test.ts
server/test/veraLobby.test.ts          (new)
server/test/veraRoutes.test.ts         (new)
docs/superpowers/plans/2026-11-11-shared-ranked-wol-vera.md (new)
```

In `redalert2-recomp`:

```
docs/web/README.md
docs/web/handoff-wolapi.md
docs/web/shared-ranked-server.md       (new)
docs/web/handoff-shared-ranked-server.md (this file)
docs/web/shared-ranked-server-gap-analysis.md (new review/task breakdown)
```

No commits were made. The Vera lobby implementation has not been reviewed by a
second developer and has not been run against `lobby.vera20k.org` or a Vera
relay.

## Quick start for the next session

```powershell
cd C:\Users\Norrapat\projects\ra2web\server
bun install
bun --bun tsc -p tsconfig.json
bun test
```

For a local smoke without touching persistent data:

```powershell
$env:SERVER_HOST='127.0.0.1'; $env:SERVER_PORT='19099'; $env:STORAGE='memory'
$env:WOL_TCP_ENABLED='false'; $env:WDT_ENABLED='false'; $env:LOG_FILE=''
bun run src/index.ts
```

Then call `http://127.0.0.1:19099/health`, `/v1/stats` and `/v1/sessions`.
