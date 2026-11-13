# Shared Ranked Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the shared WOL (web + native recomp) and Vera20k ranked server trustworthy enough to enable 1v1 quick-match ranking for RA2 and YR.

**Architecture:** Fix the four P0 scoring defects in `ra2web/server`, then route both result paths through one durable settlement module that binds each match to the admitted season, SKU and roster and ends in an explicit scored or unscored state. Native ranked queueing, Vera auto-upload and the real-client gate build on that module. Ranked expansion stays disabled until its dependencies pass.

**Tech Stack:** Bun + TypeScript (`ra2web/server`, tests with `bun:test`, SQLite and memory storage), C/WASM + TypeScript (`redalert2-recomp/web`), Rust (`vera20k`, replay upload hook only).

**Spec:** [shared-ranked-server-gap-analysis.md](../../wol/shared-ranked-server-gap-analysis.md) (see "Decisions taken (T0)"), [handoff-shared-ranked-server.md](../../web/handoff-shared-ranked-server.md) and `ra2web/docs/superpowers/plans/2026-11-11-shared-ranked-wol-vera.md`.

**Repos:** `RA2WEB` = `C:\Users\Norrapat\projects\ra2web` (paths `server/...`). `RECOMP` = this repo. `VERA` = `C:\Users\Norrapat\projects\vera20k`. Run server commands from `RA2WEB\server`. Commit in the repo that owns the changed files; stage only the files a task names, because other work shares each tree.

## Global Constraints

- Competition key is `(account, canonical SKU, season, ladder type)`; canonical SKUs are `16640` (RA2) and `18688` (YR). Vera is YR, so `VERA_SKU` defaults to `18688`. Client source (`wol-web`, `wol-native`, `vera20k`) is provenance only.
- First release ranks only authenticated 1v1 quick match, paired per client family. No AI, co-op, custom-room or Vera team/FFA ranking. Existing WOL 2v2 behavior is unchanged.
- A match with a missing, conflicting, OOS or too-short report is archived unscored with a reason. One report never awards a win. Operators can adjudicate disputed or incomplete matches, with an audit record.
- The season is bound at admitted start. Settlement is allowed until `(season.closedAt || season.endTime) + RANKED_SEASON_GRACE_SECONDS` (default `1800`). Later reports are archived unscored. New ranked starts need a running season.
- Native in-game ladder/score-gain UI is out of scope (T11 excluded). Native ACK handling must not display a gain.
- Elo stays canonical: 1000 start, 10 placement games, K=60/24, streak bonus. Vera OS stays the projection `16.67 + (rating - 1000) * 0.02666`.
- Season status values are `"current"` and `"closed"`. Native GSKU on the wire is `8960`, `16640` or `18688`; it is validated separately from the canonical SKU.
- Never log `VERA_RELAY_TICKET_KEY`. Keep generated game files, retail data and binary dumps out of Git (`CONTRIBUTING.md`).
- Baseline to compare against: full `bun test` in `RA2WEB\server` is 334 pass / 5 fail (three Windows replay colon-name tests, two native WDT/TCP tests). TypeScript check: `bun --bun tsc -p tsconfig.json`.

## Review Focus

1. Account `Alice` (mixed case) and `alice` rate as one player across WOL, native and Vera, in the right SKU only.
2. A guest, banned, or renamed-mid-match reporter never settles a result.
3. Both reports arrive in either order, twice, or after a server restart, and the match settles exactly once.
4. Players who dodge the report (disconnect, withhold) leave an explicit expired state, not a hung "pending".
5. A season closing or rolling over while a match is running, and a report landing after the grace window.

Each is pinned by a named test in the owning task (T1, T2, T6, T3/T6 respectively; case 2 in T1 and T5).

## File Structure

| File | Responsibility |
|---|---|
| `RA2WEB server/src/ladder/Settlement.ts` (new) | Admission records, report collection, consensus, deadlines, adjudication; the only caller of `LadderService.recordMatch` for ranked play |
| `RA2WEB server/src/ladder/LadderService.ts` | Scoped reads/writes, running-season predicate, atomic `recordMatch` |
| `RA2WEB server/src/storage/{Storage,MemoryStorage,SqliteStorage}.ts` | `sku` on standings/matches/history, `closedAt`, `transaction`, admission + report tables |
| `RA2WEB server/src/vera/VeraLobby.ts` | Vera admission checks and thin adapters onto `Settlement` |
| `RA2WEB server/src/http/bodyLimit.ts` (new) | Bounded body reader for `/v1/*` |
| `RA2WEB server/src/http/{veraRoutes,nativeResults,adminRoutes}.ts` | Route wiring, adjudication endpoint, replay metadata |
| `RECOMP web/src/game/wol.ts` | Native result ACK shapes |
| `VERA` replay upload hook | Posts the finished replay to the lobby (located in T12) |

---

### Task 0: Baseline, SKU default and inventory

**Files:**
- Modify: `RA2WEB server/src/config.ts:292`, `RA2WEB server/.env.example`, `RA2WEB server/README.md`, `RECOMP docs/wol/shared-ranked-server.md`
- Test: `RA2WEB server/test/veraLobby.test.ts`

**Interfaces:**
- Produces: `loadConfig({}).veraSku === 18688`; `config.rankedSeasonGraceSeconds: number` (env `RANKED_SEASON_GRACE_SECONDS`, default `1800`), used by T3.

- [ ] **Step 1: Ask the user to approve a baseline commit of the reviewed, uncommitted `ra2web` working tree** (files listed in the handoff), so later task commits are reviewable diffs. Do not commit without the yes. Record the resulting revision of all three repos in the handoff.
- [ ] **Step 2: Write failing test `defaults Vera to the Yuri's Revenge ladder`** in `veraLobby.test.ts`: `expect(loadConfig({}).veraSku).toBe(18688)` and `expect(loadConfig({}).rankedSeasonGraceSeconds).toBe(1800)`.
- [ ] **Step 3: Run** `bun test test/veraLobby.test.ts -t "Yuri"`. Expected: FAIL (16640, undefined).
- [ ] **Step 4: Implement** the default change and the new config field; update `.env.example`, `README.md` and the recomp short doc's SKU claims. Reconcile that doc's "nothing changes" and score-screen wording with decision 5.
- [ ] **Step 5: Run** `bun test test/veraLobby.test.ts` and `bun --bun tsc -p tsconfig.json`. Expected: PASS; existing tests that pass `veraSku` explicitly are unaffected.
- [ ] **Step 6: Commit** (RA2WEB) `config: default Vera to the YR ladder and add the season grace window`; (RECOMP) `docs: record shared-ranked baseline and SKU decision`.

### Task 1: Reject nonparticipant Vera results (P0, immediate)

**Files:**
- Modify: `RA2WEB server/src/vera/VeraLobby.ts:1057-1075` (`finish`), `:1122` (`scoreMatch`)
- Test: `RA2WEB server/test/veraLobby.test.ts`

**Interfaces:**
- Consumes: `requireMatch(session, matchId): VeraMatch` (already throws `not_in_match`).
- Produces: `finish` mutates nothing for a non-roster session.

- [ ] **Step 1: Write failing tests** in a new `describe("Vera finish authentication")`:
  - `rejects a nonparticipant finish without mutating the match`: after a started ranked match, an unrelated guest's `finish` returns code `not_in_match`, `match.reports.size === 0`.
  - `one real report plus an outsider cannot score`: alice reports `won`, outsider `finish` fails, standings for bob unchanged (rating 1000).
  - `two matching reports score once`: alice `won` + bob `lost` → alice 1012, bob 988 (placement 0 config); a repeated bob `finish` leaves ratings unchanged.
  - `conflicting winner claims never score`: both claim `won` → no rating change, match archived unscored.
- [ ] **Step 2: Run** `bun test test/veraLobby.test.ts -t "finish authentication"`. Expected: the first two FAIL.
- [ ] **Step 3: Replace `matchById` with `requireMatch` in `finish`**, keeping the existing `unknown_match` behavior, and make `scoreMatch` require `match.reports` keys to equal the roster set exactly (not a count).
- [ ] **Step 4: Run** the new tests plus `bun test test/veraLobby.test.ts test/veraRoutes.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** (RA2WEB) `vera: only roster members may finish a match`.

### Task 2: Isolate competition storage and migrate

**Files:**
- Modify: `RA2WEB server/src/storage/{Storage,MemoryStorage,SqliteStorage}.ts`, `RA2WEB server/src/ladder/LadderService.ts`, `RA2WEB server/src/config.ts`
- Test: `RA2WEB server/test/ladderService.test.ts`, `RA2WEB server/test/leaderboardRoutes.test.ts`, new `RA2WEB server/test/storageMigration.test.ts`

**Interfaces:**
- Produces (storage): `sku: number` on `LadderStandingRecord`, `LadderMatchRecord`, `LadderMatchPlayerRecord`; `getLadderStanding(sku, usernameKey, seasonId, ladderType)`, `getLadderStandings(sku, seasonId, ladderType)`, `getLadderMatchPlayers(sku, usernameKey, seasonId, ladderType, limit)`, `countLadderMatchesForSeason(sku, seasonId, ladderType)`. `sku === 0` means "unassigned legacy row"; reads never return it.
- Produces (config): `LADDER_LEGACY_SKU` (optional `16640|18688`); when set, startup assigns every `sku = 0` row to it, otherwise leaves them and logs a warning with the row counts.
- Produces (service): `LadderService.assignLegacyRows(sku: number): { standings: number; matches: number; players: number }`.

- [ ] **Step 1: Write failing tests**:
  - `ladderService.test.ts` `keeps the same account independent across SKUs`: a RA2 (16640) win leaves the same account's YR (18688) `getMatchRating` at 1000, and `getSharedPlayerProfile` games/seasons for YR are empty. Run against both `MemoryStorage` and a temp-file `SqliteStorage` (loop over a storage factory).
  - `leaderboardRoutes.test.ts` `leaderboard rows are scoped by SKU`.
  - `storageMigration.test.ts`: create an old-schema SQLite file with one standing, one match and one history row; reopen with the new code → rows have `sku = 0` and are hidden from reads; with `LADDER_LEGACY_SKU=16640` they become visible under 16640 only; reopening twice is idempotent.
- [ ] **Step 2: Run** `bun test test/ladderService.test.ts test/leaderboardRoutes.test.ts test/storageMigration.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the schema change (`ALTER TABLE ... ADD COLUMN sku INTEGER NOT NULL DEFAULT 0`, new indexes starting with `sku`), both backends, and thread `sku` through every `LadderService` read/write, including admin reads (`getPlayerHistory`, `getRecentMatches`, `resetPlayerStats`, `getDashboard` counts) and the shared profile's history and seasons.
- [ ] **Step 4: Back up first.** In `SqliteStorage`, before migrating an existing database file, copy it to `<path>.pre-sku-<timestamp>.bak` (once, only when a migration will run). Test that the backup exists. Document rollback (stop server, restore the backup) in `RA2WEB server/README.md`.
- [ ] **Step 5: Run** the three test files plus `bun --bun tsc -p tsconfig.json`. Expected: PASS.
- [ ] **Step 6: Commit** (RA2WEB) `ladder: scope standings, matches and history by SKU, with migration`.

### Task 3: Running seasons and match attribution

**Files:**
- Modify: `RA2WEB server/src/storage/*` (`closedAt` on `LadderSeasonRecord`, 0 = open), `RA2WEB server/src/ladder/LadderService.ts` (`closeSeason`, `getCurrentSeason`), `RA2WEB server/src/matchmaking/MatchmakingBot.ts`, `RA2WEB server/src/gserv/GservManager.ts`, `RA2WEB server/src/vera/VeraLobby.ts`
- Test: `RA2WEB server/test/ladderService.test.ts`, `RA2WEB server/test/matchbotVersion.test.ts`, `RA2WEB server/test/veraLobby.test.ts`

**Interfaces:**
- Produces: `LadderService.getRunningSeason(sku: number, now: number): LadderSeasonRecord | undefined` (status `"current"`, `startTime <= now < endTime`); `LadderService.canSettle(season: LadderSeasonRecord, now: number): boolean` (`now <= (closedAt || endTime) + graceSeconds*1000`, or season still running); `getCurrentSeason` is kept for reads only.
- Consumes: `config.rankedSeasonGraceSeconds` (T0).

- [ ] **Step 1: Write failing tests**:
  - `getRunningSeason returns undefined for closed, future and expired seasons`.
  - `closeSeason records closedAt`.
  - `canSettle accepts a report 29 minutes after closure and rejects it at 31 minutes` (fake clock).
  - `a Vera quick-match start is unranked when no season is running` (close season, start match, `ranked` false).
  - `a WOL ranked instance is not created when no season is running` in `matchbotVersion.test.ts` (queue is accepted as unranked).
- [ ] **Step 2: Run** the three files. Expected: FAIL.
- [ ] **Step 3: Implement** the predicate and `closedAt`, and replace the `getCurrentSeason(...) !== undefined` checks in `VeraLobby.start` and the matchmaker's ranked decision with `getRunningSeason`.
- [ ] **Step 4: Run** the three files plus `tsc`. Expected: PASS. Existing season/admin tests unchanged.
- [ ] **Step 5: Commit** (RA2WEB) `ladder: require a running season for ranked starts; record closedAt`.

### Task 4: Atomic settlement

**Files:**
- Modify: `RA2WEB server/src/storage/{Storage,MemoryStorage,SqliteStorage}.ts`, `RA2WEB server/src/ladder/LadderService.ts:228-348`
- Test: `RA2WEB server/test/ladderService.test.ts`

**Interfaces:**
- Produces: `Storage.transaction<T>(work: () => T): T` — all writes inside commit together or not at all (SQLite `db.transaction`; memory backend snapshots its maps and restores on throw). `LadderService.recordMatch` runs the dedupe check, all standings, the scored match row and every history row inside one `transaction`, and preserves an attached `replayPath`.

- [ ] **Step 1: Write failing tests** (both backends): `a failure writing history leaves no standing changes` (wrap storage so `insertLadderMatchPlayer` throws on the second player; ratings unchanged, match not scored); `retrying after a failure scores once`; `the same gameId through the Vera and native paths cannot score twice`.
- [ ] **Step 2: Run** `bun test test/ladderService.test.ts -t "atomic|retry|twice"`. Expected: FAIL.
- [ ] **Step 3: Implement** `transaction` on both backends and wrap `recordMatch`.
- [ ] **Step 4: Run** `bun test test/ladderService.test.ts test/wgameres.test.ts` and `tsc`. Expected: PASS (WOL web scoring unchanged).
- [ ] **Step 5: Commit** (RA2WEB) `ladder: settle a match in one storage transaction`.

### Task 5: Vera admission and ranked eligibility

**Files:**
- Modify: `RA2WEB server/src/vera/VeraLobby.ts:895-975` (`start`), `:866` (`ready`), `:831` (`setOptions`), `:697` (`create`)
- Test: `RA2WEB server/test/veraLobby.test.ts`
- Reference: `VERA docs/lobby-protocol.md` (ready/map_status/options payloads)

**Interfaces:**
- Produces: `start` throws `VeraError(409, "not_ready", ...)` unless every human has a `ready` entry whose `revision === room.revision` and whose `version`, `rules_digest`, `map_digest`, `effective_map_digest` and `staging_digest` equal the host's, and a `mapStatus` entry marked ready. Admitted options are frozen: `setOptions` after start throws `already_started`.
- Produces: `VeraMatch.unrankedReason?: "not_quick_match" | "guest" | "not_1v1" | "no_running_season" | "has_ai" | "client_unranked"`, readable from `GET /v1/matches/{gameId}`; the wire `game_started` payload is unchanged.
- Ranked rule: room created by quick-match pairing (`room.pairGuest` set), roster exactly `[host, pairGuest]`, both signed-in accounts, no AI slots in the options, running season. The client `tournament` flag is no longer consulted.

- [ ] **Step 1: Write failing tests**: `start without any readiness exchange is rejected`; `start with stale revision or a different rules digest is rejected`; `a manually created two-player room with tournament=1 is unranked (not_quick_match)`; `a guest in a quick-match room is unranked (guest)`; `AI slots make the match unranked (has_ai)`; `a third user cannot be substituted into the roster after pairing`.
- [ ] **Step 2: Run** `bun test test/veraLobby.test.ts -t "readiness|unranked|roster"`. Expected: FAIL.
- [ ] **Step 3: Implement** the checks and the eligibility function `rankedEligibility(room, users, season): { ranked: boolean; reason?: string }`; update the existing happy-path tests to send the ready/map_status exchange.
- [ ] **Step 4: Run** `bun test test/veraLobby.test.ts test/veraRoutes.test.ts` and `tsc`. Expected: PASS.
- [ ] **Step 5: Commit** (RA2WEB) `vera: enforce readiness agreement and the 1v1 quick-match ranked policy`.

### Task 6: Durable settlement, terminal states and adjudication

**Files:**
- Create: `RA2WEB server/src/ladder/Settlement.ts`
- Modify: storage backends (tables `ladder_admissions`, `ladder_reports`, `ladder_adjudications`; `ladder_matches.state` and `.reason`), `RA2WEB server/src/vera/VeraLobby.ts` (`finish`, `scoreMatch` become adapters), `RA2WEB server/src/http/adminRoutes.ts`, `RA2WEB server/src/index.ts` (periodic `expireDue`)
- Test: new `RA2WEB server/test/settlement.test.ts`, `RA2WEB server/test/adminRoutes.test.ts`

**Interfaces:**
- Produces:
  - `type MatchState = "pending" | "scored" | "unscored" | "disputed" | "incomplete" | "expired"`.
  - `interface Admission { gameId: string; sku: number; seasonId: number; ladderType: "1v1"; roster: string[]; source: "wol-web" | "wol-native" | "vera20k"; admittedAt: number; deadline: number }`.
  - `interface RankedReport { reporter: string; result: "won" | "lost" | "draw" | "disconnected" | "oos"; durationSeconds: number }`.
  - `class Settlement { constructor(storage: Storage, ladder: LadderService, log: Logger, config: { minReportDurationSeconds: number; reportWindowSeconds: number; graceSeconds: number }, now?: () => number) }`
  - `admit(input: Omit<Admission, "deadline">): Admission` (persisted; rejects when `ladder.getRunningSeason` is undefined).
  - `submitReport(gameId: string, report: RankedReport): { state: MatchState; reason?: string }` — rejects a reporter not in `roster`; ignores a repeat from the same reporter; scores once when both roster reports are present and complementary (`won`+`lost`/`disconnected`), the duration is at least `minReportDurationSeconds`, and `ladder.canSettle(season, now)`; any `oos`, two `won`, or two `lost` → `disputed`; a draw → `unscored`.
  - `expireDue(now: number): number` — pending games past `deadline` become `incomplete` (no reports or one report) with a reason; never scores.
  - `adjudicate(gameId: string, decision: { outcome: "win" | "loss" | "draw" | "void"; winner?: string; operator: string; note: string }): MatchState` — allowed only from `disputed`, `incomplete` or `expired`; `win`/`loss`/`draw` score through `LadderService.recordMatch` (atomic, T4) into the admitted season; `void` stays unscored; every call writes `ladder_adjudications`.
  - Route `POST /admin/matches/{gameId}/adjudicate` body `{ outcome, winner?, note }` (operator from the admin credential) → `200 { state }`, `409` when not adjudicable.
- Consumes: T2 (`sku`-scoped storage), T3 (`getRunningSeason`, `canSettle`), T4 (`transaction`).

- [ ] **Step 1: Write failing tests in `settlement.test.ts`** (both storage backends): `scores once for won+lost in either arrival order`; `a repeated report changes nothing`; `an outsider report is rejected without mutation`; `two won reports are disputed and unscored`; `oos is disputed`; `a draw is unscored`; `one report then deadline expires as incomplete and never scores`; `a report after the grace window is archived unscored`; `a report after a season rollover scores into the admitted season`; `reopening storage mid-match keeps admission and reports, and a late second report settles once`; `a storage failure during settlement leaves the match pending and a retry settles it`.
- [ ] **Step 2: Write failing tests in `adminRoutes.test.ts`**: `adjudicate scores a disputed match and records the operator and note`; `adjudicate rejects a scored match with 409`; `adjudicate requires admin auth`.
- [ ] **Step 3: Run** both files. Expected: FAIL.
- [ ] **Step 4: Implement** `Settlement`, the storage tables (with migrations that default `state` from the existing `scored` flag), and the admin route; run `expireDue` on a 60 s timer in `index.ts`.
- [ ] **Step 5: Rewire `VeraLobby`**: `start` calls `admit` for ranked matches; `finish` maps the wire report (`result`, `winners`) to `RankedReport` and calls `submitReport`; a host leaving or a session expiring during a ranked match leaves it to `expireDue`. Delete the in-memory scoring and `/v1/match/resume` stays `unknown_match` (resume is out of scope; restart now resolves by deadline).
- [ ] **Step 6: Run** `bun test test/settlement.test.ts test/adminRoutes.test.ts test/veraLobby.test.ts test/ladderService.test.ts` and `tsc`. Expected: PASS (T1 tests still pass through the adapter).
- [ ] **Step 7: Commit** (RA2WEB) `ladder: add durable settlement with terminal states and adjudication`.

### Task 7: Bound and protect `/v1/*`

**Files:**
- Create: `RA2WEB server/src/http/bodyLimit.ts`
- Modify: `RA2WEB server/src/http/veraRoutes.ts:45-60`, `RA2WEB server/src/index.ts`, `RA2WEB server/src/vera/VeraLobby.ts` (`openSession`)
- Test: `RA2WEB server/test/veraRoutes.test.ts`, `RA2WEB server/test/rateLimit.test.ts`

**Interfaces:**
- Produces: `readBoundedBody(req: Request, maxBytes: number, deadlineMs: number): Promise<Uint8Array>`; throws `BodyLimitError` with `status` 413 (too large, checked from `Content-Length` and while streaming) or 408 (deadline). JSON bodies use 65536 bytes; replay uploads use 16 MiB (`16 * 1024 * 1024`). Sign-in and register use the existing `FixedWindowLimiter` from `src/util/rateLimit.ts`, with the same limits as the WOL login path. A banned account is refused at `openSession` in guest, account and remember-token modes.

- [ ] **Step 1: Write failing tests**: `rejects a 70 KiB JSON command with 413 before parsing`; `rejects a replay upload over 16 MiB without buffering it` (stream that errors if read past the limit); `a slow body past the deadline returns 408`; `sign-in is rate limited after N bad passwords` (N from the WOL limiter config); `a banned account cannot sign in with a remember token`.
- [ ] **Step 2: Run** `bun test test/veraRoutes.test.ts test/rateLimit.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `bodyLimit.ts`, replace `req.json()` and `req.arrayBuffer()` in `veraRoutes.ts`, add the limiter and ban checks.
- [ ] **Step 4: Run** the two files, `test/auth.test.ts` and `tsc`. Expected: PASS (WOL account rules unchanged).
- [ ] **Step 5: Commit** (RA2WEB) `vera: bound request bodies and apply sign-in rate limits and bans`.

### Task 8: Family-safe queues and periodic Vera pairing

**Files:**
- Modify: `RA2WEB server/src/matchmaking/MatchmakingBot.ts:200-360,622`, `RA2WEB server/src/vera/VeraLobby.ts:1370` (`tryPairQuickMatch`), `RA2WEB server/src/index.ts`
- Test: `RA2WEB server/test/matchbotVersion.test.ts`, `RA2WEB server/test/matchmakingTeamAllocation.test.ts`, `RA2WEB server/test/veraLobby.test.ts`

**Interfaces:**
- Produces: `versionOk(version, ranked)` accepts the native ranked version (`1.006`) and the web version, per family; a missing version is its own family `"unknown"` that pairs with nothing ranked; `sameClientFamily` never treats a missing version as a wildcard. `VeraLobby.tick(): void` re-evaluates the quick-match queue (called every 5 s from `index.ts`), using the same rating-window rule as WOL (start 120, widen with wait, any compatible pair after 60 s); ties break by earliest wait.
- Native ranked pairing creates an instance with `ranked: true` and the canonical SKU for the pair's edition, but native settlement stays disabled until T9 (feature flag `NATIVE_RANKED_ENABLED`, default `false`; with it off, native `RKD=1` queues pair as unranked).

- [ ] **Step 1: Write failing tests**: `native ranked entries pair with each other only` (with the flag on); `native and web never pair, including an entry with no version`; `a party with mixed families is rejected`; `with the flag off a native RKD=1 queue is unranked`; `Vera queue pairs two idle players after the window widens, with no new join` (fake clock, call `tick`); `cancelling leaves no pending pairing`; `the lowest-rated waiter eventually pairs after 60 s`.
- [ ] **Step 2: Run** the three files. Expected: FAIL.
- [ ] **Step 3: Implement** the changes and the flag in `config.ts` and `.env.example`.
- [ ] **Step 4: Run** the three files and `tsc`. Expected: PASS.
- [ ] **Step 5: Commit** (RA2WEB) `matchmaking: keep client families apart and re-evaluate the Vera queue on a timer`.

### Task 9: Native ranked settlement

**Files:**
- Modify: `RA2WEB server/src/http/nativeResults.ts`, `RA2WEB server/src/gserv/GservManager.ts`, `RA2WEB server/src/ladder/nativeGameRes.ts`, `RA2WEB server/src/matchmaking/MatchmakingBot.ts`
- Test: `RA2WEB server/test/nativeResults.test.ts`, `RA2WEB server/test/ladderService.test.ts`

**Interfaces:**
- Produces: `canonicalSkuForWire(gsku: number): 16640 | 18688` — `8960 → 16640`, `16640 → 16640`, `18688 → 18688`. This is a proposed mapping: confirm it against real captured RA2 and YR packets in step 1 and change the table (not the callers) if a capture disagrees.
- Produces: for a ranked native instance, `handleNativeResults` calls `settlement.admit` once at instance creation (source `wol-native`) and `settlement.submitReport` per authenticated roster reporter, mapping `nativeResultType(CMPn)` (0 win, 1 loss, 2 draw) and `OOSY`/`FINI` (`oos`, unfinished → `disconnected`). The response is `{ gameId, stored: true, ranked: true, state }` where `state` is a `MatchState`. Custom and WDT instances keep `{ ranked: false }` and their existing semantics. A packet cannot make an instance ranked; only the server-created instance can.

- [ ] **Step 1: Capture fixtures.** Take one RA2 and one YR `GameRes` packet from a real native match (or the existing `nativeResults.test.ts` builders, if they were derived from captures) and check `GSKU`; record the finding in `docs/wol/handoff-wolapi.md`.
- [ ] **Step 2: Write failing tests**: `RA2 and YR packets settle once after both players report`; `a wrong GSKU for the instance edition is rejected`; `a roster mismatch, extra human, OOS, unfinished or too-short report never scores`; `custom and WDT matches stay unscored in both storage backends`; `reporting twice does not double score`.
- [ ] **Step 3: Run** `bun test test/nativeResults.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement** the mapping, instance admission and the ranked branch of the handler, behind `NATIVE_RANKED_ENABLED`.
- [ ] **Step 5: Run** `bun test test/nativeResults.test.ts test/settlement.test.ts test/gservLifecycle.test.ts test/wolTcpGateway.test.ts` and `tsc`. Expected: PASS apart from the two known native WDT/TCP baseline failures (compare names against the baseline list).
- [ ] **Step 6: Commit** (RA2WEB) `native: settle ranked quick-match reports through Settlement`.

### Task 10: Native ACK handling in recomp

**Files:**
- Modify: `RECOMP web/src/game/wol.ts` (`submitNativeResult`), `RECOMP web/src/game/loader.ts` only if it reads the ACK
- Test: the existing unit test file for `wol.ts` (find it with `rg -l submitNativeResult web/src`)

**Interfaces:**
- Consumes: T9's ACK `{ gameId: string, stored: true, ranked: boolean, state?: MatchState, wdt?: ... }`.
- Produces: `submitNativeResult` accepts `ranked: true` with a valid `state`, still requires `stored === true` and the matching `gameId`, keeps its bounded retries and stale-match/login guards, and never surfaces a score gain.

- [ ] **Step 1: Write failing tests**: `accepts a stored ranked ACK in state pending`; `accepts scored`; `rejects ranked true with an unknown state`; `rejects a mismatched gameId`; `a stale completion after the match changed is ignored`.
- [ ] **Step 2: Run** the web unit tests for that file (`pnpm test` from `RECOMP web`, filtered by file). Expected: FAIL.
- [ ] **Step 3: Implement** the ACK validation change.
- [ ] **Step 4: Run** the same tests and `pnpm typecheck` if present. Expected: PASS. Known unrelated failures are listed in `docs/development-workflow.md`.
- [ ] **Step 5: Commit** (RECOMP) `web: accept ranked native result acknowledgements`.

### Task 11 — excluded (decision 5)

Native ladder screens and score-gain UI are not in this release. In T14, document that standings are served by `GET /leaderboard/...` and `GET /players/...`, and that `RequestLadder*` remain stubs.

### Task 12: Vera interoperability

**Files:**
- Modify: `RA2WEB server/src/vera/VeraLobby.ts` (`push`, `drain`, `renewRelay`), `RA2WEB server/src/vera/relayGrant.ts`
- Test: `RA2WEB server/test/veraLobby.test.ts`, new `RA2WEB server/test/relayGrantVectors.test.ts`; reference `VERA services/relay-protocol` and `VERA shell_wol/live_service`

**Interfaces:**
- Produces: events are tagged critical (`game_started`, `start_confirmed`, `timing_confirmed`, `options`, `room_reopened`, `kicked`, errors) or soft (`chat`, `members`, `ladder`); the retention queue drops soft events first, so chat pressure never evicts a critical event. Test vectors for the 98-byte ticket, packet key and 66-byte `VO1C` certificate come from the Rust verifier.

- [ ] **Step 1: Generate vectors.** Add a small Rust test or example in `VERA` that signs/verifies with a fixed key and prints the ticket, key and certificate; commit the vector JSON to `RA2WEB server/test/fixtures/relay-vectors.json`. Run the Rust test in the existing way for that crate.
- [ ] **Step 2: Write failing tests**: `server grants byte-match the Rust vectors and an altered or expired ticket is rejected by the verifier`; `500 chat events do not evict an unread game_started`; `a repeated request_id returns the original reply`; `a replaced stream does not drop events after the old cursor`; `an old cursor beyond retention returns the documented resync error`.
- [ ] **Step 3: Run** the two test files. Expected: FAIL where behavior is missing.
- [ ] **Step 4: Implement** the two-class retention and any vector mismatch fixes.
- [ ] **Step 5: Run** both files and `tsc`. Expected: PASS. Real UDP relay admission and renewal are exercised in T14, not here.
- [ ] **Step 6: Commit** (RA2WEB) `vera: tag critical events and verify relay grants against Rust vectors`; (VERA) the vector generator if added.

### Task 13: Replays and Vera auto-upload

**Files:**
- Modify: `RA2WEB server/src/http/{veraRoutes,routes}.ts`, `RA2WEB server/src/vera/VeraLobby.ts:427` (`saveReplay`), storage (`ladder_matches.replay_format`, `.replay_version`), `VERA` replay recording/upload code (locate with `rg -il "replay" src/app` and the lobby client under `services/` and `src/`)
- Test: `RA2WEB server/test/veraRoutes.test.ts`, `RA2WEB server/test/gservReplay.test.ts`, a Rust test in `VERA` beside the lobby client

**Interfaces:**
- Produces: `GET /replays/{gameId}` returns the recording with `Content-Type` and `Content-Disposition` from the stored format (`.rpl` → `application/octet-stream`, `ra2-<gameId>.rpl`; Vera → `application/json`, `vera-<gameId>.json`) and `X-Replay-Format` / `X-Replay-Version`; a missing replay is `404 { "error": "no_replay" }`. `POST /v1/matches/{gameId}/replay` accepts the upload only from a roster member, only for a `vera20k` match, uses `readBoundedBody` (T7), is idempotent for identical bytes and returns `409` (no overwrite) for different bytes, and works before or after settlement and after a restart.
- Produces (client): after a match ends, the Vera client uploads its replay with its session token, retries with backoff, and is silent when no lobby session or replay exists.

- [ ] **Step 1: Write failing server tests**: `download sets filename and format headers per source`; `missing replay returns no_replay`; `a non-participant upload is 403`; `a cross-source upload (WOL game id) is 409`; `identical re-upload is idempotent, different bytes are 409`; `upload before finish is kept and linked once the match is archived`; `an over-limit upload is 413`.
- [ ] **Step 2: Run** the server tests. Expected: FAIL.
- [ ] **Step 3: Implement** server metadata, headers and authorization.
- [ ] **Step 4: Locate and implement the Vera client hook** (first inspect: find where the client finishes a lobby match and writes its replay file; add the upload there against the endpoint above, with a bounded retry). Add a Rust test with a fake lobby server asserting the request path, bearer token and body, and a retry after a 5xx.
- [ ] **Step 5: Run** `bun test test/veraRoutes.test.ts test/gservReplay.test.ts` and the Rust test. Expected: PASS apart from the three known Windows replay colon-name baseline failures in `gservReplay`.
- [ ] **Step 6: Verify recorder availability per source** and record the result in the handoff: WOL web `.rpl` (`RECORD_REPLAYS=true`), Vera JSON, native recomp (state honestly if no recording exists). Do not promise cross-engine playback.
- [ ] **Step 7: Commit** (RA2WEB) `replays: format-aware download and Vera upload rules`; (VERA) `lobby: upload the match replay after a lobby game`.

### Task 14: Integration gate, rollout and rollback

**Files:**
- Modify: `RA2WEB server/README.md`, `RECOMP docs/wol/handoff-shared-ranked-server.md`, `RECOMP docs/wol/shared-ranked-server.md`, `RECOMP docs/web/testing.md`

**Interfaces:**
- Produces: documented flags `NATIVE_RANKED_ENABLED`, `VERA_ENABLED`, `RANKED_SEASON_GRACE_SECONDS`, `LADDER_LEGACY_SKU`; log lines/counters for settlement state counts, rejected starts (with `unrankedReason`), queue waits and replay failures; migration backup and rollback steps from T2.

- [ ] **Step 1: Baseline the five known failures.** On the baseline commit from T0, run `bun test` and record exact failing test names. Compare after all tasks: no new failures, and the same five classified as before.
- [ ] **Step 2: Private environment.** Start a server with `STORAGE=sqlite` on a scratch file (see the handoff quick-start for the memory variant), a real Vera relay (`VERA_RELAY_ADDRESS`, `VERA_RELAY_TICKET_KEY`), HTTPS/WebSocket termination, and `NATIVE_RANKED_ENABLED=true`. Use task scratch under `work/tasks/shared-ranked/` and remove it afterwards.
- [ ] **Step 3: Real two-client runs**, each recorded as pass/fail with the game id: RA2 native 1v1; YR native 1v1; web 1v1; Vera 1v1 through the real relay. Each must go queue → admission → play → reports → one settlement → history/leaderboard → replay (where the source supports it). Verify with `GET /leaderboard/18688/1v1/current` and `GET /players/{name}`.
- [ ] **Step 4: Failure cases**, each run once: disconnect mid-match, both claim a win (disputed then adjudicated), season closed mid-match (settles inside the grace window, not after), server restart mid-match (settles once or expires, never scores twice).
- [ ] **Step 5: Docs.** Update the three docs to the final behavior, note T11 as unsupported with the API alternative, and pin the reviewed revisions of all three repos.
- [ ] **Step 6: Commit** (RECOMP) `docs: shared ranked release status and operator guide`; (RA2WEB) `docs: ranked rollout, flags and rollback`.

---

## Execution order

T0 → T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9 → T10 → T12 → T13 → T14. T5, T7 and T8 are independent of each other after T3 and can be reordered. Keep `NATIVE_RANKED_ENABLED=false` until T9 and T10 pass. Do not modify more than one repo per task except where a task names both.

## Self-review notes

- Decisions 1–6 map to T0/T2, T5/T8, T6, T3/T6, T11 exclusion/T10, and T13.
- Gap analysis P0/P1 rows map to T1, T2, T3, T5, T4, T6, T7, T8, T9, T12, T13.
- Open assumptions the executor must confirm rather than silently choose: the `8960 → 16640` wire mapping (T9 step 1), the location of the Vera client's replay-finish code (T13 step 4), and the exact WOL login limiter numbers to reuse (T7).
