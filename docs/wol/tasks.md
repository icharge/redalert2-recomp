# WOL shared server: task breakdown

Status of 14 Nov 2026. [plan.md](plan.md) is the phase order and the decisions; this page breaks each phase into
tasks one session can finish. Paths under `server/` and `admin/` are in the sibling repo `../ra2web` (branch
`feat/shared-ranked-release`); `src/`, `web/` and `docs/` are this repo. Branches stay local: nothing is pushed.

**Columns.** *Files*: what the task writes (two tasks that share a file never run at the same time, see
"File ownership"). *Tests*: server tasks run on both storages, `MemoryStorage` and `SqliteStorage` (the `describe.each` pattern of
`settings.test.ts`), plus Postgres in the DB track when `TEST_POSTGRES_URL` is set. Web tasks use Vitest in `web/`. Every server task
ends with `cd ../ra2web/server && bun test` and `bunx tsc --noEmit -p .` green. *Client*: **no** = tests and a local server are
enough; **browser** = one browser against a local server; **2 clients** = a person playing two game clients. Effort: S under an
hour, M about a day, L several days.

## Start here

1. **F6-1 + F6-2**: a green suite to build on.
2. **F2-1**: audit every admin change.
3. **REG-1**: registration switch; count only accounts created.
4. **F4-1**: the scheduled backup, before anything migrates real data.
5. **F5A-1**: tickets and redeem on today's accounts.

1, 2 and 4 share no files and can run in parallel. 3 and 5 both write `routes.ts`, so 5 starts after 3. **LW-1** and **LW-2**
(welcome page, install guide) are web-only and can run beside all of them. Book **R1** (the real-client session) as soon as a person
with two clients is free; most of its rows need nothing from this list.

---

## Phase 0: foundations

| Id | Task and sketch | Files | Tests | Verify | Deps | Effort | Client |
|---|---|---|---|---|---|---|---|
| F6-1 | **Green suite.** Two full runs on 14 Nov gave 661/1 and 659/3 fails. (1) S12, in both runs: `POST /errorreport > two desync reports for the same gameId are diffed and both persisted`. Each `errorReport.test.ts` case gets its own `mkdtempSync` folder instead of the shared `test/tmp-error-reports*`, removed in `afterEach`. (2) In the second run only, `native Quick Match sides and colours > a random country becomes a real one, and the colours differ` and `> a Red Alert 2 record carries concrete sides, limited to its nine countries` hit the 5 s timeout (5016 ms). Find what they wait on (a real timer?) and inject the clock instead of raising the timeout | `server/test/errorReport.test.ts`, `server/test/nativeQuickMatch.test.ts` | the suite itself, three full runs | 0 fail three times | | S-M | no |
| F6-2 | **`LadderService.updateSettings` applies live**: a test that changes `ladder.startingRating` through `SettingsService` and reads a new player's rating | `server/test/ladderService.test.ts` | memory + SQLite | the test fails without the `onApplied` hook | | S | no |
| F2-1 | **Audit every admin change.** One wrapper in `adminRoutes.ts`: after a non-GET under `/admin/` returns below 400, `storage.insertAudit({at, actor, action: "http.<METHOD> /admin/<path>", target, detail: {ip, status}})`. Handlers that know old and new values add their own richer row | `server/src/http/adminRoutes.ts` | each mutation (ban, season edit, adjudicate, map delete, replay delete) then `GET /admin/audit`; memory + SQLite | rows appear with actor and IP | | S | no |
| F2-2 | **Admin-user routes.** `GET/POST /admin/users`, `POST /admin/users/{name}/role\|disable\|enable\|password`, owner-only. `AdminAuth.setRole(name, role, actor)` revokes live sessions as `setDisabled` does; refuse to demote or disable the last active owner | `server/src/auth/adminAuth.ts`, `server/src/http/adminAuthRoutes.ts` | role gates, last-owner rule, sessions revoked; memory + SQLite | curl with an owner and an admin bearer | | S-M | no |
| F2-3 | **Origin check.** A cookie session's non-GET must carry `Origin` equal to `EXTERNAL_URL`'s origin or `ADMIN_ORIGIN`; Bearer unaffected | `server/src/http/adminAuthRoutes.ts`, `server/src/config.ts` | forged, missing and right `Origin` with a cookie; bearer without one | | F2-2 (same file) | S | no |
| F2-4 | **Console onto cookie and CSRF** (= AW-1). `admin/src/api.ts` keeps nothing in `localStorage`: login sets the cookie, the CSRF token is held in memory and sent as `X-CSRF-Token`, `GET /admin/auth/me` restores the session on reload | `admin/src/api.ts`, the login screen | `bun run admin:typecheck` | browser: sign in, reload, sign out; `localStorage` empty | F2-3 | M | browser |
| F2-5 | **TOTP for owners** (decision D7). `admin_users.totp_secret` (new column, so it needs DB1), encrypted with `ADMIN_TOTP_KEY`; RFC 6238 SHA-1, 30 s, one step of drift, `node:crypto` HMAC; ten hashed single-use recovery codes; login in two steps (`{needTotp, pending}` then `POST /admin/auth/totp`) | `server/src/auth/adminAuth.ts`, `server/src/auth/totp.ts`, `adminAuthRoutes.ts`, a migration | RFC 6238 vectors, wrong, replayed and drifted codes, recovery code once; memory + SQLite | sign in with an authenticator app | DB1, F2-3 | M | browser |
| F2-6 | **Separate admin listener** (decision D7). `ADMIN_LISTEN=127.0.0.1:9091` serves only `/admin/*` from a second `Bun.serve`; the public listener answers 404 for `/admin/*` while it is set | `server/src/index.ts`, `server/src/config.ts` | both handlers with and without the variable | curl both ports | F4-1 (`index.ts`) | S-M | no |
| F2-7 | **Cut-over** (operator step): create real owner accounts, confirm the console works, set `ADMIN_LEGACY_AUTH=false`, remove `ADMIN_USERNAMES`; then delete the legacy fallback in `admin/src/api.ts`. The console stays off the public internet until F2-3 and F2-4 are in, plus F2-5 if it is ever public | `admin/src/api.ts`, `docs/wol/operations.md` | typecheck | a game account can no longer reach `/admin` | F2-4 | S | browser |
| F4-1 | **Scheduled backup.** `server/src/ops/backupScheduler.ts`: `startBackupSchedule({dir, keep, at: "HH:MM", now, log, onResult})`, a once-a-minute check that runs `backupDatabase` once per local day after `at`. `BACKUP_DIR` (off when unset), `BACKUP_AT` (04:00), `BACKUP_KEEP` (14); live setting `backup.keep`. The last result (time, file, bytes, ok, error) in memory, an audit row `backup.run`, and in `/health` | `server/src/ops/backupScheduler.ts`, `server/src/index.ts`, `server/src/config.ts`, `server/src/http/routes.ts` (`/health`), `SettingsService.ts` | injected clock: once a day, off without `BACKUP_DIR`, a failure is reported and older backups stay; SQLite (memory: the scheduler reports "not applicable") | a backup file appears in a scratch `BACKUP_DIR` | | M | no |
| F4-2 | **Restore script.** `bun scripts/restore.ts <file> [--db PATH]` refuses while a server answers on `SERVER_PORT`, runs `integrity_check` on the file, moves the database and its `-wal`/`-shm` aside as `*.before-restore`, copies the backup in | `server/scripts/restore.ts`, `server/test/restore.test.ts`, `docs/wol/operations.md` | restore into a scratch folder and read an account back | restore a real backup into a scratch folder, read the leaderboard | | S | no |
| REG-1 | **Registration switch.** Live setting `auth.registrationOpen` (default true): `/register` answers `{errorCode: "registration_closed"}`, and `/login` keeps working (the web client tries `/register` first, `web/src/game/wol.ts:110`). Count only accounts actually created against `limits.registerMaxPerHour`, so every web login stops eating the per-IP budget | `server/src/http/routes.ts`, `server/src/settings/SettingsService.ts`, `server/src/config.ts` | closed: new name refused, existing name logs in through the client's fallback; 25 logins from one IP leave registration open; memory + SQLite | the web client logs in with registration closed | | S | no |
| DB1 | **Ordered migrations (F3), dialect-aware.** `server/src/storage/migrations.ts`: `interface Migration { version: number; name: string; up(tx: MigrationTx, dialect: "sqlite" \| "postgres" \| "mysql"): void \| Promise<void> }` and an ordered list. Table `schema_version(version PRIMARY KEY, name, applied_at)`. Version 1 is today's schema (the existing `CREATE TABLE IF NOT EXISTS` blocks and `migrateSkuColumns`, still idempotent); a database with tables and no `schema_version` is checked and baselined to 1. Each pending migration: on SQLite `backupDatabase` to `<data>/backups/pre-<version>.sqlite` first, then one transaction that also writes the version row; a failure rolls back and stops the server naming the migration. A database newer than the code refuses to start. Version in the start log and `/health`. New tables can still be added as `IF NOT EXISTS` without a migration | `server/src/storage/migrations.ts`, `server/src/storage/SqliteStorage.ts`, `server/test/migrations.test.ts` | fresh → latest; old-shape fixtures (with and without SKU columns) upgrade with rows intact; newer refuses; failing migration leaves data and version and the pre-backup exists; twice is a no-op | start against a copy of `data/ra2web.sqlite`, compare `GET /leaderboard/...` before and after | F4-1 (so real data has a backup first) | M | no |
| DB2 | **Auto-migrate tool.** `bun scripts/migrate.ts status\|plan\|up [--db PATH\|URL]` (`plan` lists the pending ones and changes nothing). `AUTO_MIGRATE` (default `true`: apply on start; `false`: refuse to start while any is pending and print the command). On a networked engine take a lock first (`pg_advisory_lock`, MySQL `GET_LOCK`) so two servers never migrate at once | `server/scripts/migrate.ts`, `server/src/index.ts`, `server/src/config.ts` | status/plan/up on a scratch file; `AUTO_MIGRATE=false` with one pending refuses | run `plan` then `up` on a copy of the real database | DB1 | S-M | no |
| F5A-1 | **Tickets on today's accounts.** Table `launch_tickets(ticket_hash PRIMARY KEY, username_key, edition, created_at, expires_at, used_at)` (additive, no migration). `server/src/auth/tickets.ts`: `TicketService.mint(username, edition): string` (32 random bytes, stored as SHA-256, 60 s, single use) and `redeem(ticket, edition): {user, sessionToken} \| undefined` (used, expired, banned, unknown and wrong edition give one generic result; success creates the session through `SessionManager.create`). `POST /v1/auth/redeem {ticket, edition}` with a per-IP limiter like `/login`. `bun scripts/ticket.ts mint <nick> [--edition yr]` for testing | `server/src/auth/tickets.ts`, `Storage.ts`, `MemoryStorage.ts`, `SqliteStorage.ts`, `server/src/http/routes.ts`, `server/scripts/ticket.ts` | single use, expiry (injected clock), banned, wrong edition, replay after redeem, limiter; memory + SQLite | mint with the script, redeem with curl, `session <token>` over the socket | REG-1 (`routes.ts`) | M | no |
| F5A-2 | **Web loader redeems** (= LW-5). `loader.ts` at boot reads `#ticket=` from `location.hash`, removes it with `history.replaceState` before any request, calls `redeemTicket(httpUrl, ticket, edition, fetcher)` (new, `wol.ts`), keeps `{user, sessionToken}`; `WolClient` takes an optional `sessionToken` and then skips `/register` and `/login` | `web/src/game/loader.ts`, `web/src/game/wol.ts`, their tests | `wol.test.ts`/`loader.test.ts` with a fake fetcher: fragment removed before the first request, no `/register` with a ticket, bad ticket reports an error | | F5A-1 | M | no |
| F5A-3 | **The game uses the redeemed nick** (= LW-6). New export `ra2_wolapi_set_launch_login(const char *nick)` in `src/web/wolapi.c`, called by the loader once the module is up: fills `g_saved_nicks[0]` (shown by `WolChat::GetNick`, `wolapi.c:1426`) and sets `g_launch_nick`; `m_chat_request_connection` (`wolapi.c:1118`) uses it for `g_login`, `g_nick` and `virtual_ip`, whatever was typed. First check how many characters the dialog field holds (`nick[10]`: 9 or 10) and write it down: it caps the nick rule (decision D12) | `src/web/wolapi.c`, `src/web/wolapi.h`, `web/src/game/loader.ts` | Vitest for the call order; a web fast build of both editions (`build-web.cmd --mode fast --edition ra2`, then `ra2md`) | browser: ticket for X, type Y in the dialog, the server log and the lobby list both show X | F5A-2 | S-M | browser |

## R: the real-client sessions

**R1** needs a person with two clients (one YR pair, one RA2 pair; a retail install for row 9). Rows 1-9 need nothing from
phase 0, so R1 can run as soon as someone is free. Keep the `server.log` of the sitting and record the result of each row in the
row's topic page.

| Row | Check | Closes |
|---|---|---|
| 1 | YR Quick Match on each pool map in turn (pool narrowed to one map), past the first frame: `XMP31S2`, `XMP21S2` | M2 |
| 2 | Same for RA2: `MP21S2`, `MP29U2`, `MP31S2` | M2 |
| 3 | RA2 Quick Match over two minutes, both report | M1 (first scored RA2 match) |
| 4 | A match left early by one player (no report): record today's outcome | baseline for G1-M3 |
| 5 | A match ended by a disconnect, keep the report | M5 (`FINI=0`) |
| 6 | Pick Soviet in the dialog, compare the log's side line with the game | S2 |
| 7 | Frame counter against log timestamps in YR | S3 |
| 8 | Quick Co-op (`YR_COOP_ENABLED=true`): press "Next Mission" after the score screen; type a chat line on each side of the score screen and compare `server.log` (`new datagram length`) with the other side | C-2, C-3 |
| 9 | A retail install connects to the TCP gateway: does it log in at all? (the server accepts only `session <token>` before login; see N1) | M4, N1 |

**R2** (browser only, after F5A-3 and LW-7b): the web client with `#ticket=` reaches the lobby as the ticket's nick, then with
auto-login reaches the welcome screen with no typing.

## Track DB: Postgres or MySQL, and the migration tool

DB1 and DB2 are in phase 0. The rest makes the storage engine pluggable. SQLite stays the default.

| Id | Task and sketch | Files | Tests | Verify | Deps | Effort | Client |
|---|---|---|---|---|---|---|---|
| DB3 | **Async `Storage`.** Every method of `Storage` (`server/src/storage/Storage.ts`, about 61, all synchronous today) returns a `Promise`; `MemoryStorage` and `SqliteStorage` wrap their results; every caller awaits (124 call sites in `accountStore.ts`, `adminAuth.ts`, `session.ts`, `index.ts`, `LadderService.ts`, `Settlement.ts`, `SettingsService.ts`, and their callers `WolServer.ts`, `routes.ts`, `adminRoutes.ts`, `nativeResults.ts`). **Care:** one connection's WOL lines must stay in order, so `WolServer.handleMessage` awaits each line before the next; `sessions.validate` (every `session` line) reads through an in-memory cache. Mechanical but wide: run it while no other server task is open | all of the above | the whole suite on memory + SQLite; a new test that two lines sent together are handled in order | the smoke scripts (`bun run smoke`) | phase 0 merged; a single-writer window | L | no |
| DB4 | **`PostgresStorage`.** `STORAGE_ENGINE=postgres` and `DATABASE_URL` in `config.ts` and `storage/index.ts`; the class over `Bun.SQL` (first step: confirm Bun 1.3.13's `Bun.SQL` Postgres client covers transactions and prepared statements as needed; **Assumed** until then). Migrations run their `postgres` branch. Plus `server/test/storageContract.test.ts`: one suite over every `Storage` method, run on memory, SQLite and, when `TEST_POSTGRES_URL` is set, Postgres | `server/src/storage/PostgresStorage.ts`, `storage/index.ts`, `config.ts`, `migrations.ts`, `server/test/storageContract.test.ts` | the contract suite on three engines | start the server on a local Postgres, play the smoke scripts, read the leaderboard | DB3, DB2 | L | no |
| DB5 | **`db-copy` tool.** `bun scripts/db-copy.ts --from sqlite:PATH --to postgres://...`: refuses a non-empty target, migrates the target to the source's version, copies tables in dependency order in batches, compares row counts and the top of each leaderboard | `server/scripts/db-copy.ts`, a test | copy a fixture database SQLite → SQLite and (with `TEST_POSTGRES_URL`) → Postgres | copy a real database to a local Postgres, compare `GET /leaderboard/...` | DB4 | M | no |
| DB6 | **Backups on a networked engine.** The scheduler (F4-1) and `/health` say "external" for Postgres/MySQL instead of running `VACUUM INTO`; `operations.md` documents `pg_dump`/`pg_restore` (and `mysqldump`) and the upgrade order | `server/src/ops/backupScheduler.ts`, `docs/wol/operations.md` | the scheduler skips on a non-SQLite engine | | DB4, F4-1 | S | no |
| DB7 | **`MysqlStorage`** (only if decision D3 says so). Same class shape over `Bun.SQL`'s MySQL client; dialect differences (upsert syntax, `AUTO_INCREMENT`, key lengths on text keys, case-insensitive collation) live in the migrations' `mysql` branch and the class | `server/src/storage/MysqlStorage.ts`, `migrations.ts`, `storage/index.ts` | the contract suite with `TEST_MYSQL_URL` | as DB4 | DB4 | M-L | no |

## N1: a native WOL path (investigation, then a decision)

**Seen:** `src/web/wolapi.c` is compiled only into the Emscripten target (`CMakeLists.txt:111`); the Linux target (`:94`) and the
Windows build have no WOL shim, and `src/runtime/host.c` has no WOL code (its "launcher emulation" is the mutex check). The server
accepts only `cvers`, `setlocale`, `getlocale` and `session` before login (`WolServer.handleLine`). So no native build reaches this
server today, and the accepted `RA2_LAUNCH_TICKET` delivery has nothing to plug into yet.

| Id | Task | Files | Effort | Client |
|---|---|---|---|---|
| N1-a | Find out what a native build's game does on Internet today (the Windows build loads the install's `wolapi.dll`? the Linux build?), and what a retail `wolapi.dll` sends to log in. Write it into [handoff-wolapi.md](handoff-wolapi.md) | docs | S-M | 1 client (R1 row 9) |
| N1-b | Options for the decision: (1) `wolapi.c` in the native builds with a C HTTP and TCP bridge in place of the JS one, then `host.c` reads and clears `RA2_LAUNCH_TICKET`; (2) the server learns the classic login lines, which retail installs (M4) need anyway. Recommendation after N1-a | docs | S | |

## Phase 1: pool, seasons and ranked integrity

| Id | Task and sketch | Files | Tests | Verify | Deps | Effort | Client |
|---|---|---|---|---|---|---|---|
| SE-1 | **Season states, scheduler, archive.** `ladder_seasons.status`: `scheduled \| current \| closing \| archived`; new table `season_results(season_id, sku, ladder_type, rank, player, rating, wins, losses, placed)` (additive). `LadderService.advanceSeasons(now)` moves scheduled → current at `start_time`, current → closing at `end_time` or admin close, closing → archived after the grace, writing the snapshot in one transaction; called once a minute from the settlement timer in `index.ts`. **Care:** "current" today is the newest by `start_time`, so a future scheduled season must not become current early (`getRunningSeason`, `getLeaderboard`) | `server/src/ladder/LadderService.ts`, `Storage*.ts`, `server/src/index.ts` | injected clock: each transition; snapshot frozen against a later rescore; late report inside the grace counts, after it not; a scheduled season is not current; memory + SQLite | create a season that starts in two minutes on a scratch server | DB1 (status values on old rows), DB3 if it is scheduled first | M | no |
| SE-2 | **Reset policy** (decision D8). `ladder_seasons.reset_policy` (`hard`, `soft:<factor>`, `carry`), a column change, so a migration. Applied lazily: a player with no standing in the new season starts at `start + (prev - start) * factor` if they had at least N rated games, else `start`; placements restart at 3. Settings `ladder.softResetFactor`, `ladder.softResetMinGames` | `LadderService.ts`, `migrations.ts`, `Storage*.ts`, `SettingsService.ts` | veteran, newcomer, one game short of N, carry, hard; memory + SQLite | | SE-1, DB1 | M | no |
| SE-3 | **Awards** (decision D9): `season_awards(season_id, sku, ladder_type, player, kind, rank)` written with the snapshot (`champion`, `top10`, `top100`, `placed`); `GET /players/{name}/awards` | `LadderService.ts`, `Storage*.ts`, `server/src/http/routes.ts` | written once at archive; route shape; memory + SQLite | | SE-1 | S-M | no |
| SE-4 | **Season routes**: `GET /seasons/{sku}/{id}` (with the final table once archived), `archived` and `snapshotAt` on `GET /leaderboard/{sku}/{type}/{season}` | `server/src/http/routes.ts` | `seasonsApi.test.ts` cases; memory + SQLite | curl | SE-1 | S | no |
| SE-5 | **Leaderboard page**: first find the existing `/ladder` pages seasons.md mentions; then a season picker from `GET /seasons`, edition and mode tabs, search by name, the player's season history; read-only over public routes | the web client that holds `/ladder` (locate first) | that client's unit tests | browser | SE-4 | M | browser |
| SE-6 | **Per-mode boards** (decision D10): ladder types, not tables (`qm-1v1`, later `coop`), chosen from the admission's source | `LadderService.ts`, `Settlement.ts` | a Quick Match result lands on `qm-1v1`; memory + SQLite | | SE-1, decision | S | no |
| G1-M3 | **Quitter rule** (decision D5, option c) behind `ranked.quitterWin` (default off): score a win when one player reports a win, the other left before the end and never reported, **and** gserv saw the drop. Change `Settlement.expire` (`one_report`/`no_reports` paths) and `docs/ranked-ladder.md` in ra2web | `server/src/ladder/Settlement.ts`, `SettingsService.ts`, `../ra2web/docs/ranked-ladder.md` | winner reports, loser disconnects (gserv drop recorded), grace passes → scored; without the drop → unscored; off → unchanged; memory + SQLite | R1 row 4 recorded the baseline | R1 row 4 helps, not required | M | no |
| G1-M6 | **Web 2v2 agreement** (decision D6) behind `ranked.web2v2Agreement`: web 2v2 through `Settlement` with a roster-wide rule (every reporter agrees on the winning team) | `Settlement.ts`, the web 2v2 report path in `routes.ts` | a lone winner report is not scored; agreeing reports are; memory + SQLite | | G1-M3 (same file) | M | no |
| G1-S8 | **Adjudication and the season grace**: enforce the grace, or record an explicit override reason in the audit | `server/src/http/adminRoutes.ts`, `LadderService.ts` | inside and outside the grace, with and without a reason | | F2-1 (same file) | S | no |

M1 (the pool proof on real clients) is R1 rows 1-3.

## Phase 2: Quick Co-op, finish and decide

Built behind `queues.yrCoop.enabled` (see [co-op.md](co-op.md)); two clients played `C1A01MD` to the score screen.

| Id | Task | Files | Tests | Deps | Effort | Client |
|---|---|---|---|---|---|---|
| C-1 | **Cooperative campaign line.** Not sent today and not needed for `C1A01MD`. Trial: send the VERA20K form `C0,...,-1,<host b64>,<guest b64>` behind a debug flag, play once with and once without, compare | `server/src/matchmaking/MatchmakingBot.ts`, `nativeGameOpts.ts`, `test/yrCoop.test.ts` | record shape with the flag; memory + SQLite | | S-M | 2 clients |
| C-2 | **"Next Mission"** after the score screen (R1 row 8): record what the game asks the server for, and whether the server must answer | docs, maybe `WolServer.ts` | | R1 | S | 2 clients |
| C-3 | **Score-screen chat**: read the logging already added (relay `new datagram length`, `wolapi.c` `chat sent`) from R1 row 8; fix where it is dropped | `server/src/gserv/NativeRelay.ts` or `src/web/wolapi.c` | a relay test for the found case | R1 | S-M | 2 clients |
| C-4 | **More co-op missions**: add each further mission to the pool with `mode: "coop"` (size and digest from the file), one client run each | `server/src/matchmaking/quickMatchMaps.ts` | `quickMatchMaps.test.ts` | C-2 | S each | 2 clients |
| C-5 | **Enable decision** (D4) and docs: switch on by default or keep it opt-in; `co-op.md` and `server/README.md` | docs, `config.ts` default | | C-1..C-3 | S | |

## Web admin and configuration

The operator's console (`ra2web/admin`, React) over `/admin/*`. Exists (Seen): dashboard, seasons, matches, replays, players and
maps screens in `admin/src/main.tsx`; the settings, map pool, audit and admin-login APIs. Console tasks are checked with
`bun run admin:typecheck` and a browser pass with a viewer, a moderator, an admin and an owner account against a local server.

| Id | Task and sketch | Files | Tests | Deps | Effort | Client |
|---|---|---|---|---|---|---|
| AW-0 | **Split the console** into one file per screen plus the shared `api.ts`, no behaviour change, so later screens are separate writers | `admin/src/main.tsx` → `admin/src/screens/*.tsx` | typecheck; each existing screen still loads | | S-M | browser |
| AW-1 | = F2-4 (cookie and CSRF sign-in) | | | F2-3, AW-0 | M | browser |
| AW-2 | **Settings page**: every key from `GET /admin/settings` grouped by `group`, an editor per kind (bool, int with its range, lines, pool → link to AW-3), default / overridden / "restart required", reset to default, restart-only keys owner-only. New keys appear without console work | `admin/src/screens/Settings.tsx` | typecheck | AW-0 | M | browser |
| AW-3 | **Map pool page**: per edition and mode, upload a `.MAP` (`POST /admin/quick-match/maps`), weight, enable, remove, size and digest shown, "unproven" until a client run is noted | `admin/src/screens/MapPool.tsx` | typecheck | AW-0 | S-M | browser |
| AW-4 | **Audit view**: paged `GET /admin/audit?limit=&before=`, filter by actor and action (add the filter to the route) | `admin/src/screens/Audit.tsx`, `server/src/http/adminSettingsRoutes.ts` | filter route test; memory + SQLite | AW-0, F2-1 | S | browser |
| AW-5 | **Admin users page**: create, role, disable, password reset, sign out everywhere, last-owner guard | `admin/src/screens/AdminUsers.tsx` | typecheck | F2-2, AW-0 | S-M | browser |
| AW-6 | **Kick, mute, ban** from the players screen: `POST /admin/players/{name}/mute\|kick` through `WolServer`, audited | `server/src/http/adminRoutes.ts`, `WolServer.ts`, `admin/src/screens/Players.tsx` | mute and kick reach the socket; audit rows; memory + SQLite | F2-1 (same route file), AW-0 | M | browser |
| AW-7 | **Seasons admin**: create with dates and reset policy, start or close now, archive and awards view | `admin/src/screens/Seasons.tsx` | typecheck | SE-1, SE-2 | S-M | browser |
| AW-8 | **Disputes and adjudication** (route exists; `winner` required; grace rule from G1-S8) | `admin/src/screens/Disputes.tsx` | typecheck | G1-S8 | S-M | browser |
| AW-9 | **Live queues**: `MatchmakingBot.snapshot()` (queue, nick, seconds waiting) and `GET /admin/queues` | `MatchmakingBot.ts`, `adminRoutes.ts`, `admin/src/screens/Queues.tsx` | snapshot test | AW-6 (route file) | S-M | browser |
| AW-10 | **Announcements**: `POST /admin/announce {text}` broadcast through `WolServer`, audited; the `welcome.motd` editor | `adminRoutes.ts`, `WolServer.ts`, `admin/src/screens/Announce.tsx` | broadcast reaches connected users | AW-9 (route file) | S | browser |
| AW-11 | **Health and logs**: `/metrics` data (O1-1), last backup, schema version, `GET /admin/logs?tail=200` (owner-only, bounded) | `adminRoutes.ts`, `admin/src/screens/Health.tsx` | tail bound and role; memory + SQLite | O1-1, F4-1, DB1 | S-M | browser |
| AW-12 | **Configuration export and import**: `GET /admin/settings/export` (overrides as JSON, never secrets), `POST /admin/settings/import` with a dry-run diff first, owner-only, audited, to copy a server's setup or restore it | `server/src/http/adminSettingsRoutes.ts`, `SettingsService.ts`, `admin/src/screens/Settings.tsx` | round trip; an invalid value refuses the whole import; memory + SQLite | AW-2 | S-M | browser |
| AW-13 | **Environment view**: read-only list of env-only settings (ports, storage engine, `DB_PATH`/`DATABASE_URL` host only, `ADMIN_LISTEN`, `AUTO_MIGRATE`), secrets as "set / not set" | `adminSettingsRoutes.ts`, `admin/src/screens/Environment.tsx` | no secret value in the response | O1-2 | S | browser |

**Settings keys (K1).** Each is one entry in `SETTING_DEFS` (`server/src/settings/SettingsService.ts`), a line in the
`settings.onApplied` handler in `server/src/index.ts` if the consumer copies the value at start, and a case in
`test/settings.test.ts`. All of them write the same file, so they go in batches, one at a time:

| Batch | Keys | Effort |
|---|---|---|
| K1-a | queue pair window and rating spread, ranked on/off per queue | S-M |
| K1-b | game speed, per-channel lobby switches, minimum report length per mode | S-M |
| (with their task) | `auth.registrationOpen` (REG-1), `backup.keep` (F4-1), `ladder.softReset*` (SE-2), `ranked.quitterWin` (G1-M3), `ranked.web2v2Agreement` (G1-M6), `auth.guestEnabled` (GU-1), `members.maxGameAccounts` (MB-1) | |

Env-only by design (never runtime settings): the storage engine and its URL, ports, secrets, `AUTO_MIGRATE`.
`server/.env.example` is generated from `config.ts` (O1-2).

## Track LW: the web launcher, members and WOL auto-login

The recomp web launcher exists (`web/src`): Shell with the top bar and game rail, Play, Mods, Game and Settings screens, and the
Install screen `web/src/screens/Import.tsx` (folder, archive or installer, check, copy into OPFS; allowlist in
`web/src/storage/install.ts`). Routes are in `web/src/App.tsx`. Missing: a welcome page, an install guide, accounts, and a WOL
login that needs no typing. The design is in [members-and-sso.md](members-and-sso.md): one **member** owns game accounts (WOL nicks),
**one** for now (`members.maxGameAccounts` = 1); **guests** play offline at once and online with a generated nick, unranked.

| Id | Task and sketch | Files | Tests | Deps | Effort | Client |
|---|---|---|---|---|---|---|
| LW-1 | **Welcome page** `/welcome`: what this is; bring your own game (BYOG: you use your own copy, nothing of the game is downloaded from the site); guest or member; links to the guide and to sign-in. Shown on first run and while nothing is installed, dismissible (remembered in the page settings). Adds the route stubs for LW-2, LW-3 too, so later tasks do not share `App.tsx` | `web/src/screens/launcher/WelcomeScreen.tsx`, `web/src/App.tsx` | Vitest: shown with no install, hidden after dismiss, links | | S-M | browser |
| LW-2 | **BYOG install guide** `/install/guide`: a section per source (original CDs, The First Decade, EA App/Origin, Steam) with where the folder usually is and what to pick, the archive or installer option, what is copied and where it stays (this browser's storage), what is never uploaded; ends with a button to `/import` | `web/src/screens/InstallGuide.tsx` (+ CSS module) | Vitest: every source renders, the button goes to `/import` | LW-1 (route) | S-M | browser |
| MB-1 | **Members and game accounts** (server). Additive tables `members(id, login_key UNIQUE, login, email NULL UNIQUE, password_hash, status, created_at, last_login_at)` and `member_game_accounts(member_id, username_key UNIQUE, created_at)`; `MemberService`: `register(login, password, email?)`, `login` with the lockout pattern of `AdminAuth`, `addGameAccount(member, nick, password)` that creates a WOL account (`AccountStore.register`) or claims an existing one by its password, refused past `members.maxGameAccounts` | `server/src/auth/members.ts`, `Storage*.ts`, `SettingsService.ts` | register, lockout, limit of one, claim with right and wrong password, a claimed nick cannot be claimed twice; memory + SQLite | F5A-1 (`Storage*.ts`) | M-L | no |
| MB-2 | **Launcher auth routes**: `POST /v1/members/register\|login\|logout`, `POST /v1/auth/refresh`, `GET /v1/members/me` → `{member, gameAccounts, maxGameAccounts}`. Access token 15 min (held in memory by the page); refresh token 30 days in an `HttpOnly; Secure` cookie on `/v1/auth`, rotated on each use, reuse of an old one revokes it; CORS with credentials only for `LAUNCHER_ORIGINS` | `server/src/http/memberRoutes.ts`, `server/src/config.ts`, `server/src/http/cors.ts` | rotation and reuse detection, expiry (injected clock), CORS refuses other origins; memory + SQLite | MB-1 | M | no |
| MB-3 | **Launch ticket** `POST /v1/auth/launch-ticket {gameAccount, edition}` with the access token; the game account must be the member's | `memberRoutes.ts`, `server/src/auth/tickets.ts` | someone else's game account refused; memory + SQLite | MB-2, F5A-1 | S | no |
| GU-1 | **Guest identity** `POST /v1/auth/guest {edition}` → a ticket for a generated nick (`Guest` + digits, within the dialog width); the account carries a guest flag, is never admitted to `Settlement`, is purged after idle days; per-IP limit; `auth.guestEnabled` | `tickets.ts`, `server/src/http/routes.ts`, `Settlement.ts`, `accountStore.ts`, `SettingsService.ts` | a guest result is never rated; switch off refuses; purge; memory + SQLite | F5A-1, G1-M6 (`Settlement.ts`) | M | no |
| LW-3 | **Account screen and identity**: `/account` (sign in, create a member, create or claim the one game account with "1 of 1", sign out); the Shell bar shows "Guest" or the member and their nick; client `web/src/account/api.ts` (`credentials: "include"`, server from `VITE_WOL_HTTP_URL`) | `web/src/screens/launcher/AccountScreen.tsx`, `web/src/account/api.ts`, `web/src/screens/launcher/Shell.tsx` | Vitest with a fake fetch: sign in, refresh on reload, limit shown, sign out | MB-2, LW-1 | M | browser |
| LW-4 | **PLAY hand-off**: signed in → mint a ticket and open `/game?edition=…#ticket=…`; guest → a guest ticket when the server allows guests, else the game's own login dialog as today | `web/src/screens/launcher/PlayScreen.tsx`, `web/src/account/api.ts` | Vitest: the URL carries the fragment; no ticket when offline | MB-3 or GU-1, F5A-2, LW-3 (api.ts) | S-M | browser |
| LW-5 | = F5A-2 | | | | | |
| LW-6 | = F5A-3 | | | | | |
| LW-7a | **Find the game's own auto-login** (reverse engineering): the login dialog (mode word 0, control `0x686`, the handler near `0x007986xx`), the `SOFTWARE\Westwood\WOLAPI\ Options` read (`0x004FF20B` RA2, `0x005175FB` YR), and what `WolChat::GetNick` slot 0 plus a flag would do. Use `tools/vera_lookup.py` and the names ledger ([../reverse-engineering.md](../reverse-engineering.md)); write the finding into [handoff-wolapi.md](handoff-wolapi.md) | docs | | | S-M | no |
| LW-7b | **Auto-login**: with a launch login set, the game goes from Internet to the welcome screen with no dialog. If LW-7a found the game's own path, feed it from `wolapi.c`; otherwise complete the dialog from the shim (fill the fields, send the Log in control's command) through the dialog hooks the browser build has (`src/linux/script.c` dialog-created notification, `src/web/presenter.c`; precedent `src/web/map_search.c`). Without a ticket nothing changes | `src/web/wolapi.c`, maybe `src/linux/script.c`, `src/web/presenter.c` | web fast builds of both editions | LW-7a, F5A-3 | M | browser |
| LW-8 | **End to end** for member and guest, both editions, in `web/e2e` (the WOL harness `web/e2e/wol.mjs` with `wol-server.mjs`): sign in, PLAY, Internet, the welcome screen with the right nick; then `docs/web/frontend.md` (screens) and a `web/CHANGELOG.md` section | `web/e2e/`, docs | the e2e script | LW-4, LW-7b, GU-1 | M | browser |

## Phase 3: operations and the rest

| Id | Task | Files | Tests | Deps | Effort |
|---|---|---|---|---|---|
| O1-1 | `GET /metrics` (Prometheus text, admin role or loopback): connected players, queued per queue, matches in progress, settlement counts by state, seconds since the last settlement tick, database size, last backup, schema version | `server/src/http/metricsRoutes.ts`, `server/src/index.ts` | counts match a fixture; memory + SQLite | F4-1, DB1 | M |
| O1-2 | `server/.env.example` generated from `config.ts` by `scripts/gen-env-example.ts`, and a test that fails when it is stale | `server/scripts/gen-env-example.ts`, `server/.env.example`, a test | the stale check | after the config-heavy tasks | S-M |
| O1-3 | `server/README.md`: the operator checklist of [operations.md](operations.md) (run, configure, back up, upgrade, restore, expose) | `server/README.md` | | F4-2, DB2 | S |
| O1-4 | Systemd unit and Windows service notes; log rotation exists (`LOG_MAX_BYTES`, `LOG_MAX_FILES`, `LOG_ROTATE_DAILY`) | `server/deploy/`, `operations.md` | | | S |
| G2-S6 | RA2 login-failure message (an RA2 web rebuild: `build-web.cmd --mode fast --edition ra2`, then production per `CLAUDE.md`) | recomp | | | M |
| G2-S10 | Matchbot countdown when both are ready; requeue when no gserv | `MatchmakingBot.ts` | memory + SQLite | not with AW-9 | S |
| G2-S9 | Vera items (3 rated games per 24 h, match lookup beyond 10 minutes): the sibling client's contract, confirm with its owner first | `server/src/vera/` | | | M |

S1, S2, S3, S4, S11 are observation rows of R1. S7 (the Connection slider) is a decision; leaving it alone is the default.

---

## File ownership

Two writers never share a file. A task listed here waits for the one before it in the same row (left to right is the suggested
order).

| File (`../ra2web/` unless noted) | Tasks |
|---|---|
| `server/src/http/routes.ts` | REG-1 → F5A-1 → F4-1 (`/health`) → SE-3 → SE-4 → GU-1 → G1-M6 |
| `server/src/config.ts` | REG-1, F2-3, F4-1, F2-6, DB2, DB4, MB-2 (one at a time) |
| `server/src/settings/SettingsService.ts` | REG-1, F4-1, K1-a, K1-b, SE-2, G1-M3, MB-1, GU-1, AW-12 |
| `server/src/index.ts` | F4-1 → F2-6 → DB2 → SE-1 → O1-1 |
| `server/src/http/adminAuthRoutes.ts`, `server/src/auth/adminAuth.ts` | F2-2 → F2-3 → F2-5 |
| `server/src/http/adminRoutes.ts` | F2-1 → G1-S8 → AW-6 → AW-9 → AW-10 → AW-11 |
| `server/src/storage/Storage.ts`, `MemoryStorage.ts`, `SqliteStorage.ts` | DB1 → F5A-1 → MB-1 → SE-1 → SE-2 → SE-3; DB3 touches every line, so nothing else runs during it |
| `server/src/ladder/LadderService.ts` | SE-1 → SE-2 → SE-3 → SE-6 → G1-S8 |
| `server/src/ladder/Settlement.ts` | G1-M3 → G1-M6 → GU-1 → SE-6 |
| `server/src/matchmaking/MatchmakingBot.ts` | C-1 → AW-9 → G2-S10 |
| `admin/src/main.tsx` | AW-0 first; after it each screen is its own file |
| recomp `web/src/App.tsx` | LW-1 (adds all route stubs), then only the screen files change |
| recomp `web/src/game/loader.ts`, `wol.ts` | F5A-2 → F5A-3 (loader call) |
| recomp `src/web/wolapi.c` | F5A-3 → LW-7b → C-3 (if the fix is in the shim) |

## Parallel groups

Groups whose tasks share no file. Start any task of a group once its dependencies are in.

- **Now:** F6-1, F6-2, F2-1, F4-1, F4-2, AW-0, LW-1 (then LW-2), LW-7a, N1-a (with R1). REG-1 too, as long as F4-1's `config.ts` and
  `SettingsService.ts` lines land first or REG-1 goes before F4-1.
- **After that:** F2-2 (then F2-3, F2-4), DB1 (then DB2), F5A-1 (then F5A-2, F5A-3), AW-2, AW-3, AW-4.
- **Single-writer window:** DB3, once phase 0 is merged. Nothing else on the server meanwhile; web and admin console tasks can continue.
- **Phase 1 lanes:** seasons (SE-1 → SE-2 → SE-3, SE-4, SE-5) beside integrity (G1-M3 → G1-M6), beside members (MB-1 → MB-2 → MB-3)
  once SE-1 and MB-1 are not both writing `Storage*.ts`. Web: LW-3 → LW-4; LW-7b after F5A-3.
- **Later:** DB4 → DB5, DB6, DB7; O1-*; AW-5..AW-13; C-*.

## Open decisions

`D<n>` in the tables above is decision n of [plan.md](plan.md), "Decisions needed from you", where each has its
recommendation. The ones that gate the next tasks:

| Decision | Gates | Recommendation |
|---|---|---|
| D2 who runs R1, when, with which installs | M1, M2, M4, C-2, C-3, N1 | as soon as someone is free |
| D3 storage engine, DB3 timing | DB3-DB7 | Postgres only; DB3 right after phase 0 |
| D4 co-op scope and enabling | C-5 | in scope, unranked, off until C-2/C-3 pass |
| D5 / D6 quitters, web 2v2 | G1-M3, G1-M6 (built behind settings either way) | option (c); agreement rule |
| D7 admin exposure | F2-5, F2-6, F2-7 | TOTP before public; loopback listener |
| D8-D10 seasons | SE-2, SE-3, SE-6 | soft 0.5 / 5 games; awards yes; one board |
| D11 guests online | GU-1 | yes, unranked |
| D12 member details, nick width | MB-1, F5A-3 | login name or email; claim counts; cap at the field |
| D13 native WOL path | N1-b, native `RA2_LAUNCH_TICKET` | park until R1 row 9 |
