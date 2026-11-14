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

1. ~~**F6-1 + F6-2**: a green suite to build on.~~ Done (ra2web `d5bbe6f`, 664 pass three times).
2. ~~**F2-1**: audit every admin change.~~ Done (ra2web `90fda96`).
3. ~~**REG-1**~~ done (ra2web `4e96e45`); REG-2 (the web client's message) is open. Was: registration switch; count only accounts created.
4. **F4-1**: the scheduled backup, before anything migrates real data.
5. **F5A-1**: tickets and redeem on today's accounts.

1, 2 and 4 share no files and can run in parallel. 3 and 5 both write `routes.ts`, so 5 starts after 3. Beside them:
~~**C-0**~~ (done, ra2web `4435f8e`), and **LW-1** and **LW-2** (welcome page, install guide), which are web-only.
**R1** (the real-client session) comes after phase 1 (decision 2).

---

## Phase 0: foundations

| Id | Task and sketch | Files | Tests | Verify | Deps | Effort | Client |
|---|---|---|---|---|---|---|---|
| F6-1 | **Done** (ra2web `d5bbe6f`). (1) S12, `two desync reports ... both persisted`: the folders were already per test; the cause was the 30 ms correlation window. In a busy full run report A's window expired while B's archive was still being built, so A was saved alone. The test now uses a 5 s window like its neighbours. (2) The two random "sides and colours" tests pair 20 times and registered two accounts per round (40 password hashes per test), which ran past the 5 s timeout under load; they now log in with a session only | `server/test/errorReport.test.ts`, `server/test/nativeQuickMatch.test.ts` | | three full runs: 664 pass, 0 fail; `tsc` clean | | S | no |
| F6-2 | **Done** (ra2web `d5bbe6f`): `settings.test.ts` changes `ladder.startingRating` and `ladder.placementMatches` through `SettingsService` with the `onApplied` hook of `index.ts`, and reads them back from `LadderService`; reset too; memory and SQLite | `server/test/settings.test.ts` | memory + SQLite | | | S | no |
| F2-1 | **Done** (ra2web `90fda96`). `handleAdmin` → `routeAdmin`, then `auditAdminChange`: a successful non-GET writes `http.<METHOD> /admin/<area>` with the target path and `{ip, status, role, via}`, never the body, through `SettingsService.recordAudit`. Areas that audit themselves are skipped (console logins; settings and the map pool, which keep their old/new rows) | `server/src/http/adminRoutes.ts`, `SettingsService.ts`, `server/test/adminAudit.test.ts` | memory + SQLite: five changes give five rows; reads, refused and failed changes none; a setting change keeps one row | full run 670 pass, 0 fail | | S | no |
| F2-2 | **Admin-user routes.** `GET/POST /admin/users`, `POST /admin/users/{name}/role\|disable\|enable\|password`, owner-only. `AdminAuth.setRole(name, role, actor)` revokes live sessions as `setDisabled` does; refuse to demote or disable the last active owner | `server/src/auth/adminAuth.ts`, `server/src/http/adminAuthRoutes.ts` | role gates, last-owner rule, sessions revoked; memory + SQLite | curl with an owner and an admin bearer | | S-M | no |
| F2-3 | **Origin check.** A cookie session's non-GET must carry `Origin` equal to `EXTERNAL_URL`'s origin or `ADMIN_ORIGIN`; Bearer unaffected | `server/src/http/adminAuthRoutes.ts`, `server/src/config.ts` | forged, missing and right `Origin` with a cookie; bearer without one | | F2-2 (same file) | S | no |
| F2-4 | **Console onto cookie and CSRF** (= AW-1). `admin/src/api.ts` keeps nothing in `localStorage`: login sets the cookie, the CSRF token is held in memory and sent as `X-CSRF-Token`, `GET /admin/auth/me` restores the session on reload | `admin/src/api.ts`, the login screen | `bun run admin:typecheck` | browser: sign in, reload, sign out; `localStorage` empty | F2-3 | M | browser |
| F2-5 | **TOTP for owners** (decision 6: required before the console goes public). `admin_users.totp_secret` (new column, so it needs DB1), encrypted with `ADMIN_TOTP_KEY`; RFC 6238 SHA-1, 30 s, one step of drift, `node:crypto` HMAC; ten hashed single-use recovery codes; login in two steps (`{needTotp, pending}` then `POST /admin/auth/totp`) | `server/src/auth/adminAuth.ts`, `server/src/auth/totp.ts`, `adminAuthRoutes.ts`, a migration | RFC 6238 vectors, wrong, replayed and drifted codes, recovery code once; memory + SQLite | sign in with an authenticator app | DB1, F2-3 | M | browser |
| F2-6 | ~~Separate admin listener~~: **not planned** (decision 6: the console is public, behind TLS and TOTP) | | | | | | |
| F2-7 | **Cut-over and going public** (operator step): create real owner accounts with TOTP, confirm the console works, set `ADMIN_LEGACY_AUTH=false`, remove `ADMIN_USERNAMES`, delete the legacy fallback in `admin/src/api.ts`; only then open `/admin` on the public site. Until F2-3, F2-4 and F2-5 are in, it stays behind loopback, a VPN or a proxy allow-list | `admin/src/api.ts`, `docs/wol/operations.md` | typecheck | a game account can no longer reach `/admin`; an owner without a TOTP code cannot sign in | F2-4, F2-5 | S | browser |
| F4-1 | **Scheduled backup.** `server/src/ops/backupScheduler.ts`: `startBackupSchedule({dir, keep, at: "HH:MM", now, log, onResult})`, a once-a-minute check that runs `backupDatabase` once per local day after `at`. `BACKUP_DIR` (off when unset), `BACKUP_AT` (04:00), `BACKUP_KEEP` (14); live setting `backup.keep`. The last result (time, file, bytes, ok, error) in memory, an audit row `backup.run`, and in `/health` | `server/src/ops/backupScheduler.ts`, `server/src/index.ts`, `server/src/config.ts`, `server/src/http/routes.ts` (`/health`), `SettingsService.ts` | injected clock: once a day, off without `BACKUP_DIR`, a failure is reported and older backups stay; SQLite (memory: the scheduler reports "not applicable") | a backup file appears in a scratch `BACKUP_DIR` | | M | no |
| F4-2 | **Restore script.** `bun scripts/restore.ts <file> [--db PATH]` refuses while a server answers on `SERVER_PORT`, runs `integrity_check` on the file, moves the database and its `-wal`/`-shm` aside as `*.before-restore`, copies the backup in | `server/scripts/restore.ts`, `server/test/restore.test.ts`, `docs/wol/operations.md` | restore into a scratch folder and read an account back | restore a real backup into a scratch folder, read the leaderboard | | S | no |
| REG-1 | **Done** (ra2web `4e96e45`). `REGISTRATION_OPEN` and the live setting `auth.registrationOpen` (default true): closed, `/register` answers 403 `registration_closed` and so does Vera's `/v1/accounts/register`; `/login` keeps working. `FixedWindowLimiter.wouldAllow`/`record`: `/register` checks the budget first and counts only an account it created | `server/src/http/routes.ts`, `veraRoutes.ts`, `server/src/util/rateLimit.ts`, `SettingsService.ts`, `server/src/config.ts`, `server/README.md`, `server/test/registration.test.ts` | memory + SQLite: closed refuses a new name, an existing one logs in through the client's fallback; the setting toggles live; ten logins leave a budget of two intact, the third creation is limited, another address is not | full run 679 pass, 0 fail | | S | no |
| REG-2 | **Say "registration is closed" in the web client.** With registration closed, `sessionToken()` (`web/src/game/wol.ts:103`) falls back to `/login`, and a new player then sees the login failure instead. Keep the `/register` `errorCode`; when the login fails too and it was `registration_closed`, throw `WolLoginError("Registration is closed on this server", "registration_closed")`. Web page only, no game rebuild | recomp `web/src/game/wol.ts`, `wol.test.ts` | Vitest with a fake fetcher: closed and new name gives that message; closed and existing name logs in | | REG-1 | S | no |
| DB1 | **Ordered migrations (F3), dialect-aware.** `server/src/storage/migrations.ts`: `interface Migration { version: number; name: string; up(tx: MigrationTx, dialect: "sqlite" \| "postgres" \| "mysql"): void \| Promise<void> }` and an ordered list. Table `schema_version(version PRIMARY KEY, name, applied_at)`. Version 1 is today's schema (the existing `CREATE TABLE IF NOT EXISTS` blocks and `migrateSkuColumns`, still idempotent); a database with tables and no `schema_version` is checked and baselined to 1. Each pending migration: on SQLite `backupDatabase` to `<data>/backups/pre-<version>.sqlite` first, then one transaction that also writes the version row; a failure rolls back and stops the server naming the migration. A database newer than the code refuses to start. Version in the start log and `/health`. New tables can still be added as `IF NOT EXISTS` without a migration | `server/src/storage/migrations.ts`, `server/src/storage/SqliteStorage.ts`, `server/test/migrations.test.ts` | fresh → latest; old-shape fixtures (with and without SKU columns) upgrade with rows intact; newer refuses; failing migration leaves data and version and the pre-backup exists; twice is a no-op | start against a copy of `data/ra2web.sqlite`, compare `GET /leaderboard/...` before and after | F4-1 (so real data has a backup first) | M | no |
| DB2 | **Auto-migrate tool.** `bun scripts/migrate.ts status\|plan\|up [--db PATH\|URL]` (`plan` lists the pending ones and changes nothing). `AUTO_MIGRATE` (default `true`: apply on start; `false`: refuse to start while any is pending and print the command). On a networked engine take a lock first (`pg_advisory_lock`, MySQL `GET_LOCK`) so two servers never migrate at once | `server/scripts/migrate.ts`, `server/src/index.ts`, `server/src/config.ts` | status/plan/up on a scratch file; `AUTO_MIGRATE=false` with one pending refuses | run `plan` then `up` on a copy of the real database | DB1 | S-M | no |
| F5A-1 | **Tickets on today's accounts.** Table `launch_tickets(ticket_hash PRIMARY KEY, username_key, edition, created_at, expires_at, used_at)` (additive, no migration). `server/src/auth/tickets.ts`: `TicketService.mint(username, edition): string` (32 random bytes, stored as SHA-256, 60 s, single use) and `redeem(ticket, edition): {user, sessionToken} \| undefined` (used, expired, banned, unknown and wrong edition give one generic result; success creates the session through `SessionManager.create`). `POST /v1/auth/redeem {ticket, edition}` with a per-IP limiter like `/login`. `bun scripts/ticket.ts mint <nick> [--edition yr]` for testing | `server/src/auth/tickets.ts`, `Storage.ts`, `MemoryStorage.ts`, `SqliteStorage.ts`, `server/src/http/routes.ts`, `server/scripts/ticket.ts` | single use, expiry (injected clock), banned, wrong edition, replay after redeem, limiter; memory + SQLite | mint with the script, redeem with curl, `session <token>` over the socket | REG-1 (`routes.ts`) | M | no |
| F5A-2 | **Web loader redeems** (= LW-5). `loader.ts` at boot reads `#ticket=` from `location.hash`, removes it with `history.replaceState` before any request, calls `redeemTicket(httpUrl, ticket, edition, fetcher)` (new, `wol.ts`), keeps `{user, sessionToken}`; `WolClient` takes an optional `sessionToken` and then skips `/register` and `/login` | `web/src/game/loader.ts`, `web/src/game/wol.ts`, their tests | `wol.test.ts`/`loader.test.ts` with a fake fetcher: fragment removed before the first request, no `/register` with a ticket, bad ticket reports an error | | F5A-1 | M | no |
| F5A-3 | **The game uses the redeemed nick** (= LW-6). New export `ra2_wolapi_set_launch_login(const char *nick)` in `src/web/wolapi.c`, called by the loader once the module is up: fills `g_saved_nicks[0]` (shown by `WolChat::GetNick`, `wolapi.c:1426`) and sets `g_launch_nick`; `m_chat_request_connection` (`wolapi.c:1118`) uses it for `g_login`, `g_nick` and `virtual_ip`, whatever was typed. First check how many characters the dialog field holds (`nick[10]`: 9 or 10) and write it down: it caps game account and guest names (decision 11) | `src/web/wolapi.c`, `src/web/wolapi.h`, `web/src/game/loader.ts` | Vitest for the call order; a web fast build of both editions (`build-web.cmd --mode fast --edition ra2`, then `ra2md`) | browser: ticket for X, type Y in the dialog, the server log and the lobby list both show X | F5A-2 | S-M | browser |

## R: the real-client sessions

**R1** needs a person with two clients (one YR pair, one RA2 pair). **It runs after phase 1** (decision 2), so rows 4 and 5 check
the new rules as built. Keep the `server.log` of the sitting and record the result of each row in the row's topic page.

| Row | Check | Closes |
|---|---|---|
| 1 | Spot check (not a gate, decision 14): a YR Quick Match on a few enabled maps that MP-2 still shows as unproven, past the first frame | M2 |
| 2 | Same for RA2 | M2 |
| 3 | RA2 Quick Match over two minutes, both report | M1 (first scored RA2 match) |
| 4 | A match left early by one player (no report), with `ranked.quitterWin` on: the stayer wins only when gserv saw the drop | G1-M3 on clients |
| 5 | A match ended by a disconnect, keep the report | M5 (`FINI=0`) |
| 6 | Pick Soviet in the dialog, compare the log's side line with the game | S2 |
| 7 | Frame counter against log timestamps in YR | S3 |
| 8 | Quick Co-op: press "Next Mission" after the score screen; type a chat line on each side of the score screen and compare `server.log` (`new datagram length`) with the other side (unless players reported it first) | C-2, C-3 |
| 9 | A guest and a member in one Quick Match: nobody is scored | GU-1 on clients |

**R2** (browser only, as soon as F5A-3 and LW-7b exist; it does not wait for R1): the web client with `#ticket=` reaches the lobby
as the ticket's nick, then with auto-login reaches the welcome screen with no typing.

## Track DB: SQLite by default, Postgres and MySQL when configured

Decision 3: SQLite stays the default; Postgres and MySQL are both supported, chosen by `STORAGE_ENGINE=sqlite|postgres|mysql` and
`DATABASE_URL`. DB1 and DB2 are in phase 0; the rest makes the engine pluggable.

| Id | Task and sketch | Files | Tests | Verify | Deps | Effort | Client |
|---|---|---|---|---|---|---|---|
| DB3 | **Async `Storage`.** Every method of `Storage` (`server/src/storage/Storage.ts`, about 61, all synchronous today) returns a `Promise`; `MemoryStorage` and `SqliteStorage` wrap their results; every caller awaits (124 call sites in `accountStore.ts`, `adminAuth.ts`, `session.ts`, `index.ts`, `LadderService.ts`, `Settlement.ts`, `SettingsService.ts`, and their callers `WolServer.ts`, `routes.ts`, `adminRoutes.ts`, `nativeResults.ts`). **Care:** one connection's WOL lines must stay in order, so `WolServer.handleMessage` awaits each line before the next; `sessions.validate` (every `session` line) reads through an in-memory cache. Mechanical but wide: run it while no other server task is open | all of the above | the whole suite on memory + SQLite; a new test that two lines sent together are handled in order | the smoke scripts (`bun run smoke`) | phase 1 done (decision 12); a single-writer window | L | no |
| DB4 | **`PostgresStorage`.** `STORAGE_ENGINE=postgres` and `DATABASE_URL` in `config.ts` and `storage/index.ts`; the class over `Bun.SQL` (first step: confirm Bun 1.3.13's `Bun.SQL` Postgres client covers transactions and prepared statements as needed; **Assumed** until then). Migrations run their `postgres` branch. Plus `server/test/storageContract.test.ts`: one suite over every `Storage` method, run on memory, SQLite and, when `TEST_POSTGRES_URL` is set, Postgres | `server/src/storage/PostgresStorage.ts`, `storage/index.ts`, `config.ts`, `migrations.ts`, `server/test/storageContract.test.ts` | the contract suite on three engines | start the server on a local Postgres, play the smoke scripts, read the leaderboard | DB3, DB2 | L | no |
| DB5 | **`db-copy` tool.** `bun scripts/db-copy.ts --from sqlite:PATH --to postgres://...\|mysql://...`: refuses a non-empty target, migrates the target to the source's version, copies tables in dependency order in batches, compares row counts and the top of each leaderboard | `server/scripts/db-copy.ts`, a test | copy a fixture database SQLite → SQLite and (with `TEST_POSTGRES_URL`) → Postgres | copy a real database to a local Postgres, compare `GET /leaderboard/...` | DB4 | M | no |
| DB6 | **Backups on a networked engine.** The scheduler (F4-1) and `/health` say "external" for Postgres/MySQL instead of running `VACUUM INTO`; `operations.md` documents `pg_dump`/`pg_restore` (and `mysqldump`) and the upgrade order | `server/src/ops/backupScheduler.ts`, `docs/wol/operations.md` | the scheduler skips on a non-SQLite engine | | DB4, F4-1 | S | no |
| DB7 | **`MysqlStorage`** (in scope, decision 3). Same class shape over `Bun.SQL`'s MySQL client; dialect differences (upsert syntax, `AUTO_INCREMENT`, key lengths on text keys, case-insensitive collation) live in the migrations' `mysql` branch and the class | `server/src/storage/MysqlStorage.ts`, `migrations.ts`, `storage/index.ts` | the contract suite with `TEST_MYSQL_URL` | as DB4 | DB4 | M-L | no |

## Native builds: not planned

**Seen:** `src/web/wolapi.c` is compiled only into the Emscripten target (`CMakeLists.txt:111`); the Linux target (`:94`) and the
Windows build have no WOL shim, and `src/runtime/host.c` has no WOL code (its "launcher emulation" is the mutex check). The server
accepts only `cvers`, `setlocale`, `getlocale` and `session` before login (`WolServer.handleLine`). **Decision 10: online play is web
only**, so there is no native WOL task and the `RA2_LAUNCH_TICKET` delivery is dropped.

## Phase 1: pool, seasons and ranked integrity

| Id | Task and sketch | Files | Tests | Verify | Deps | Effort | Client |
|---|---|---|---|---|---|---|---|
| SE-1 | **Season states, scheduler, archive.** `ladder_seasons.status`: `scheduled \| current \| closing \| archived`; new table `season_results(season_id, sku, ladder_type, rank, player, rating, wins, losses, placed)` (additive). `LadderService.advanceSeasons(now)` moves scheduled → current at `start_time`, current → closing at `end_time` or admin close, closing → archived after the grace, writing the snapshot in one transaction; called once a minute from the settlement timer in `index.ts`. **Care:** "current" today is the newest by `start_time`, so a future scheduled season must not become current early (`getRunningSeason`, `getLeaderboard`) | `server/src/ladder/LadderService.ts`, `Storage*.ts`, `server/src/index.ts` | injected clock: each transition; snapshot frozen against a later rescore; late report inside the grace counts, after it not; a scheduled season is not current; memory + SQLite | create a season that starts in two minutes on a scratch server | DB1 (status values on old rows) | M | no |
| SE-2 | **Reset policy** (decision 7: soft, 0.5, at least 5 games; new seasons default to it). `ladder_seasons.reset_policy` (`hard`, `soft:<factor>`, `carry`), a column change, so a migration. Applied lazily: a player with no standing in the new season starts at `start + (prev - start) * factor` if they had at least N rated games, else `start`; placements restart at 3. Settings `ladder.softResetFactor`, `ladder.softResetMinGames` | `LadderService.ts`, `migrations.ts`, `Storage*.ts`, `SettingsService.ts` | veteran, newcomer, one game short of N, carry, hard; memory + SQLite | | SE-1, DB1 | M | no |
| SE-3 | **Awards** (decision 8: yes, web page only): `season_awards(season_id, sku, ladder_type, player, kind, rank)` written with the snapshot (`champion`, `top10`, `top100`, `placed`); `GET /players/{name}/awards` | `LadderService.ts`, `Storage*.ts`, `server/src/http/routes.ts` | written once at archive; route shape; memory + SQLite | | SE-1 | S-M | no |
| SE-4 | **Season routes**: `GET /seasons/{sku}/{id}` (with the final table once archived), `archived` and `snapshotAt` on `GET /leaderboard/{sku}/{type}/{season}` | `server/src/http/routes.ts` | `seasonsApi.test.ts` cases; memory + SQLite | curl | SE-1 | S | no |
| SE-5 | **Leaderboard page**: first find the existing `/ladder` pages seasons.md mentions; then a season picker from `GET /seasons`, edition and mode tabs, search by name, the player's season history; read-only over public routes | the web client that holds `/ladder` (locate first) | that client's unit tests | browser | SE-4 | M | browser |
| SE-6 | ~~Per-mode boards~~: **not planned** (decision 8: one 1v1 board per edition) | | | | | | |
| G1-M3 | **Quitter rule** (decision 5) behind `ranked.quitterWin` (off until its tests pass, then on): score a win when one player reports a win, the other left before the end and never reported, **and** gserv saw the drop. Change `Settlement.expire` (`one_report`/`no_reports` paths) and `docs/ranked-ladder.md` in ra2web | `server/src/ladder/Settlement.ts`, `SettingsService.ts`, `../ra2web/docs/ranked-ladder.md` | winner reports, loser disconnects (gserv drop recorded), grace passes → scored; without the drop → unscored; off → unchanged; memory + SQLite | tests now; R1 row 4 after phase 1 | | M | no |
| G1-M6 | **Web 2v2 agreement** (decision 5) behind `ranked.web2v2Agreement`: web 2v2 through `Settlement` with a roster-wide rule (every reporter agrees on the winning team) | `Settlement.ts`, the web 2v2 report path in `routes.ts` | a lone winner report is not scored; agreeing reports are; memory + SQLite | | G1-M3 (same file) | M | no |
| G1-S8 | **Adjudication and the season grace**: enforce the grace, or record an explicit override reason in the audit | `server/src/http/adminRoutes.ts`, `LadderService.ts` | inside and outside the grace, with and without a reason | | F2-1 (same file) | S | no |

M1, the first scored RA2 match, is R1 row 3.

**Map pool (decision 14: every stock map available, configured on the admin site).** Every web player imports a full game, so every
stock map is on every client; the pool is the operator's choice.

| Id | Task and sketch | Files | Tests | Verify | Deps | Effort | Client |
|---|---|---|---|---|---|---|---|
| MP-1 | **Stock map catalog.** Extend `server/scripts/map-pool-scan.ts` to list every multiplayer map of both editions from a stock install: name, edition, size, digest (`[Digest] 1=`), start count, and a kind (`quick` for two or more starts, `coop` for the co-op missions). First find the names of the maps present only by hash in `MultiMD.mix` (Assumed: the game's multiplayer map lists, `MPMaps.ini`/`MPMapsMD.ini`, name them) and read one `.mmx` to see whether its record form differs. Write the result as `server/src/matchmaking/stockMaps.ts` (data only: names and numbers, no game content). A `quickMatch.pool` entry may then be just `{edition, mode, stem, enabled, weight}`; size, digest and slots come from the catalog, and an upload still works for a custom map | `server/scripts/map-pool-scan.ts`, `server/src/matchmaking/stockMaps.ts`, `quickMatchMaps.ts`, `SettingsService.ts` (pool validation) | the two maps with real records reproduce (`XMP29U2`, `MP32S8`); a pool entry without size and digest resolves from the catalog; an unknown stem is refused with its name; memory + SQLite | run the scan on a stock install, compare its count with the game's map list | | M | no |
| MP-2 | **Automatic proof per map.** For each map, count matches started, matches that really played (relay traffic past 60 s or a result report) and quick exits (both players gone within 30 s, no traffic). Status: `unproven` (no played match yet), `proven`, `suspect` (quick exits and no played match: the sign of a wrong digest, "scenarios do not match"). Exposed on `GET /admin/quick-match/maps`; `quickMatch.autoDisableSuspect` (default off) switches a suspect map off and audits it | `server/src/matchmaking/mapProof.ts`, `Storage*.ts` (table `map_stats`, additive), `MatchmakingBot.ts` or `NativeRelay.ts` (the events), `adminSettingsRoutes.ts` | played, quick exit, suspect, auto-disable; memory + SQLite | a scratch server with a fake relay | MP-1 | M | no |
| MP-3 | **Mods and Quick Match.** A player whose active mod replaces a stock map has another digest. The launcher's PLAY says "Quick Match uses the stock maps" when a mod is active, and the game's Quick Match failure message names that cause (wording only) | `web/src/screens/launcher/PlayScreen.tsx`, maybe `src/web/wolapi.c` | Vitest for the notice | | | S | browser |

## Phase 2: Quick Co-op, on now, then finish

Built behind `queues.yrCoop.enabled` (see [co-op.md](co-op.md)); two clients played `C1A01MD` to the score screen. Decision 4:
in scope, unranked, **on by default now**.

| Id | Task | Files | Tests | Deps | Effort | Client |
|---|---|---|---|---|---|---|
| C-0 | **Done** (ra2web `4435f8e`): `yrCoopEnabled` defaults to true (`YR_COOP_ENABLED=false` or the setting turns it off); the setting's description loses "Experimental"; `server/README.md` lists the variable; `co-op.md` updated | `server/src/config.ts`, `SettingsService.ts`, `quickMatchMaps.ts` (comment), `test/yrCoop.test.ts`, `server/README.md` | the default publishes `#Lob_39_0`; `false` hides it; full run 671 pass, 0 fail | | S | no |
| C-1 | **Cooperative campaign line.** Not sent today and not needed for `C1A01MD`. Trial: send the VERA20K form `C0,...,-1,<host b64>,<guest b64>` behind a debug flag, play once with and once without, compare | `server/src/matchmaking/MatchmakingBot.ts`, `nativeGameOpts.ts`, `test/yrCoop.test.ts` | record shape with the flag; memory + SQLite | | S-M | 2 clients |
| C-2 | **"Next Mission"** after the score screen: record what the game asks the server for, and whether the server must answer. From players' `server.log` lines once C-0 is live, or R1 row 8 | docs, maybe `WolServer.ts` | | C-0 | S | 2 clients |
| C-3 | **Score-screen chat**: read the logging already added (relay `new datagram length`, `wolapi.c` `chat sent`) from a live match or R1 row 8; fix where it is dropped | `server/src/gserv/NativeRelay.ts` or `src/web/wolapi.c` | a relay test for the found case | C-0 | S-M | 2 clients |
| C-4 | **More co-op missions**: add each further mission to the pool with `mode: "coop"` (size and digest from the file), one client run each | `server/src/matchmaking/quickMatchMaps.ts` | `quickMatchMaps.test.ts` | C-2 | S each | 2 clients |

## Web admin and configuration

The operator's console (`ra2web/admin`, React) over `/admin/*`. Exists (Seen): dashboard, seasons, matches, replays, players and
maps screens in `admin/src/main.tsx`; the settings, map pool, audit and admin-login APIs. Console tasks are checked with
`bun run admin:typecheck` and a browser pass with a viewer, a moderator, an admin and an owner account against a local server.

| Id | Task and sketch | Files | Tests | Deps | Effort | Client |
|---|---|---|---|---|---|---|
| AW-0 | **Split the console** into one file per screen plus the shared `api.ts`, no behaviour change, so later screens are separate writers | `admin/src/main.tsx` → `admin/src/screens/*.tsx` | typecheck; each existing screen still loads | | S-M | browser |
| AW-1 | = F2-4 (cookie and CSRF sign-in) | | | F2-3, AW-0 | M | browser |
| AW-2 | **Settings page**: every key from `GET /admin/settings` grouped by `group`, an editor per kind (bool, int with its range, lines, pool → link to AW-3), default / overridden / "restart required", reset to default, restart-only keys owner-only. New keys appear without console work | `admin/src/screens/Settings.tsx` | typecheck | AW-0 | M | browser |
| AW-3 | **Map pool page**: per edition and mode, the whole stock catalog (MP-1) with a filter by start count and name, a switch and a weight per map, bulk "enable all two-player maps"; upload a custom `.MAP` (`POST /admin/quick-match/maps`); size and digest shown; the proof status from MP-2 (proven, unproven, suspect) with its counts | `admin/src/screens/MapPool.tsx` | typecheck | AW-0; MP-1 for the catalog, MP-2 for the status (the page works without them on today's pool) | M | browser |
| AW-4 | **Audit view**: paged `GET /admin/audit?limit=&before=`, filter by actor and action (add the filter to the route) | `admin/src/screens/Audit.tsx`, `server/src/http/adminSettingsRoutes.ts` | filter route test; memory + SQLite | AW-0, F2-1 | S | browser |
| AW-5 | **Admin users page**: create, role, disable, password reset, sign out everywhere, last-owner guard | `admin/src/screens/AdminUsers.tsx` | typecheck | F2-2, AW-0 | S-M | browser |
| AW-6 | **Kick, mute, ban** from the players screen: `POST /admin/players/{name}/mute\|kick` through `WolServer`, audited | `server/src/http/adminRoutes.ts`, `WolServer.ts`, `admin/src/screens/Players.tsx` | mute and kick reach the socket; audit rows; memory + SQLite | F2-1 (same route file), AW-0 | M | browser |
| AW-7 | **Seasons admin**: create with dates and reset policy, start or close now, archive and awards view | `admin/src/screens/Seasons.tsx` | typecheck | SE-1, SE-2 | S-M | browser |
| AW-8 | **Disputes and adjudication** (route exists; `winner` required; grace rule from G1-S8) | `admin/src/screens/Disputes.tsx` | typecheck | G1-S8 | S-M | browser |
| AW-9 | **Live queues**: `MatchmakingBot.snapshot()` (queue, nick, seconds waiting) and `GET /admin/queues` | `MatchmakingBot.ts`, `adminRoutes.ts`, `admin/src/screens/Queues.tsx` | snapshot test | AW-6 (route file) | S-M | browser |
| AW-10 | **Announcements**: `POST /admin/announce {text, lobbies?}` sent as YuriBOT through `LobbyBot.announce` (LB-4), audited; the `welcome.motd` editor | `adminRoutes.ts`, `admin/src/screens/Announce.tsx` | the announcement reaches every lobby member as YuriBOT | AW-9 (route file), LB-4 | S | browser |
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
| (with their task) | `auth.registrationOpen` (REG-1), `backup.keep` (F4-1), `ladder.softReset*` (SE-2), `ranked.quitterWin` (G1-M3), `ranked.web2v2Agreement` (G1-M6), `auth.guestEnabled` (GU-1), `members.maxGameAccounts` (MB-1), `lobbyBot.*` (LB-1..LB-4) | |

Env-only by design (never runtime settings): the storage engine and its URL, ports, secrets, `AUTO_MIGRATE`.
`server/.env.example` is generated from `config.ts` (O1-2).

## Track LB: the lobby bot, YuriBOT

A bot in the chat lobbies, in the spirit of the one XWIS ran: it greets players, answers help and information commands,
makes announcements, takes reports, and lets linked moderators act from the lobby. Decided 14 Nov 2026 (plan.md decisions
15-17): commands are **`/command`**, answered privately to the asker (decision 15); moderation through game nicks **linked to admin
accounts** (16); the bot is called **`YuriBOT`** (17).

**What it builds on (Seen).** `matchbot` is already a virtual user: `WolServer.sendChannelNames` adds `@matchbot` to the Quick Match and
co-op lobbies' NAMES, and `handlePrivmsg` routes a private message to that name to `MatchmakingBot.handleMessage`
(`server/src/server/WolServer.ts:617`, `:968`). YuriBOT is a second virtual user on the same pattern. Two limits from the web shim:
it reads a sender's nick with `%9[^! ]` (`src/web/wolapi.c:672`), so the bot's name must be at most 9 characters (`YuriBOT` is 7); and
`WolChat::RequestPublicAction`/`RequestPrivateAction` (`/me`) are stubs that send nothing (`wolapi.c:1298`). Whether the retail chat box
passes a typed `/help` on as text is **Open** (LB-0). If it does not, paging YuriBOT (a private message, which always reaches the
server) is the way in.

| Id | Task and sketch | Files | Tests | Deps | Effort | Client |
|---|---|---|---|---|---|---|
| LB-0 | **What the game does with a `/` line** (RA2 and YR, lobby chat and a page): does `RequestPublicMessage` get `/help` verbatim, does the game act on it itself, or drop it? Also the longest chat line the lobby shows, and whether a listed non-operator virtual user appears in the player list and can be paged. Log in `send_chat` (`wolapi.c`), try with two web clients against a local server, write the result into [handoff-wolapi.md](handoff-wolapi.md) | `src/web/wolapi.c` (a log line), docs | | | S | browser |
| LB-1 | **The bot core.** `server/src/bot/LobbyBot.ts`: a virtual user named by `lobbyBot.nick` (default `YuriBOT`, restart-only, at most 9 characters, refused by `AccountStore.register` and as a guest name), `lobbyBot.enabled`. Listed in the NAMES of the chat lobbies, **not** as operator, and **never** in the Quick Match or co-op lobbies (the client takes their operator for the matchmaker) or game rooms. In `handlePrivmsg`: channel text starting with `/` goes to `LobbyBot.handleCommand(user, channel, text)` and is **not** broadcast; a private message to the bot is a command with or without the `/`. Replies are private (`:YuriBOT!YuriBOT@local PRIVMSG <nick> :...`), at most a few lines each within the length LB-0 measured, flood-limited per user; an unknown command answers "try /help". A command registry `{name, usage, role: "player" \| "moderator" \| "admin", run}` | `server/src/bot/LobbyBot.ts`, `server/src/server/WolServer.ts`, `server/src/auth/accountStore.ts`, `server/src/config.ts`, `SettingsService.ts`, `server/test/lobbyBot.test.ts` | the bot is in `Lob_41_0`'s NAMES and not in `Lob_40_0`'s or `Lob_39_0`'s; `/help` in a lobby is not broadcast and the reply reaches only the sender; a page works; rate limit; the name cannot be registered; off hides it | LB-0 | M | no |
| LB-2 | **Help and greeting**: `/help` (the commands this user's role may use), `/rules`, `/motd`; a private greeting on a player's first lobby join per session (`lobbyBot.greeting` lines, `lobbyBot.greetOnJoin`); `lobbyBot.help` and `lobbyBot.rules` as editable lines | `LobbyBot.ts`, `SettingsService.ts` | greeting once per session; texts follow the settings live | LB-1 | S-M | no |
| LB-3 | **Player information**: `/rank [nick]` (current season, edition from the lobby's SKU), `/top [n≤10]`, `/season` (name, end date, reset rule), `/online`, `/queue` (players waiting per queue, from `MatchmakingBot.snapshot()`), `/maps` (the enabled pool) | `LobbyBot.ts`, `server/src/matchmaking/MatchmakingBot.ts` (`snapshot`, shared with AW-9: whichever runs first adds it) | each command against fixtures; an unknown nick; memory + SQLite | LB-1 | M | no |
| LB-4 | **Announcements**: `LobbyBot.announce(text, lobbies?)` sends a message as YuriBOT to the lobbies; scheduled ones from `lobbyBot.announcements` (`[{text, everyMinutes, lobbies?, from?, until?}]`); event ones: a season starting, closing and archived (from SE-1's transitions), and a restart countdown. The admin route (AW-10) calls it | `LobbyBot.ts`, `server/src/index.ts` (timer), `LadderService.ts` (an event hook) | injected clock: schedule, window, lobby filter; the season events fire once | LB-1; SE-1 for the season events | M | no |
| LB-5 | **Reports**: `/report <nick> <reason>` writes `player_reports(id, at, reporter, target, channel, reason, status)` (additive) with a per-user limit; "thank you" reply; listed for moderators in the console (LB-7) | `LobbyBot.ts`, `Storage*.ts`, `server/src/http/adminRoutes.ts` | stored, limited, listed; memory + SQLite | LB-1 | M | no |
| LB-6 | **Moderator commands** (decision 16). An admin account may link one game nick: table `admin_game_links(admin_username UNIQUE, username_key UNIQUE, linked_at, linked_by)` (additive), set from the console by an owner or admin (LB-7). A linked nick may use `/mute <nick> [minutes]`, `/unmute`, `/kick <nick>`, `/ban <nick> <hours≤24> <reason>` as far as its admin account's role allows; a disabled or locked admin account allows nothing. Each is audited with actor `admin:<name> via <nick>`. **Care:** a game login has no TOTP, so the bot allows only moderator-level, time-limited actions; a permanent ban stays in the console. The actions go through one `ModerationService` (mute, kick, timed ban) shared with AW-6 | `server/src/moderation/ModerationService.ts`, `LobbyBot.ts`, `WolServer.ts` (mute enforcement in `handlePrivmsg`), `Storage*.ts` | role gates per command; disabled admin; mute stops the target's lobby chat until it expires; timed ban ends; audit rows; memory + SQLite | LB-1, F2-1; before or with AW-6 | M | no |
| LB-7 | **Console page "Lobby bot"**: edit greeting, help, rules and scheduled announcements (they are settings, so AW-2's editors are reused); the reports list with status; the command log (from the audit); on the admin users page (AW-5), link or unlink a game nick | `admin/src/screens/LobbyBot.tsx`, `admin/src/screens/AdminUsers.tsx` | typecheck | LB-2, LB-5, LB-6, AW-0 | S-M | browser |
| LB-8 | **End to end** with two web clients against a local server, both editions: YuriBOT listed in the lobby, greeting, `/help`, `/rank`, an announcement, a linked moderator's `/mute` | `web/e2e/` | the e2e script | LB-1..LB-6 | M | browser |

## Track LW: the web launcher, members and WOL auto-login

The recomp web launcher exists (`web/src`): Shell with the top bar and game rail, Play, Mods, Game and Settings screens, and the
Install screen `web/src/screens/Import.tsx` (folder, archive or installer, check, copy into OPFS; allowlist in
`web/src/storage/install.ts`). Routes are in `web/src/App.tsx`. Missing: a welcome page, an install guide, accounts, and a WOL
login that needs no typing. The design is in [members-and-sso.md](members-and-sso.md): one **member** owns game accounts (WOL nicks),
**one** for now (`members.maxGameAccounts` = 1); **guests** play offline at once, and online under any name no account or online
player uses, never scored, and a match with a guest is scored for nobody (decision 9).

| Id | Task and sketch | Files | Tests | Deps | Effort | Client |
|---|---|---|---|---|---|---|
| LW-1 | **Welcome page** `/welcome`: what this is; bring your own game (BYOG: you use your own copy, nothing of the game is downloaded from the site); guest or member; links to the guide and to sign-in. Shown on first run and while nothing is installed, dismissible (remembered in the page settings). Adds the route stubs for LW-2, LW-3 too, so later tasks do not share `App.tsx` | `web/src/screens/launcher/WelcomeScreen.tsx`, `web/src/App.tsx` | Vitest: shown with no install, hidden after dismiss, links | | S-M | browser |
| LW-2 | **BYOG install guide** `/install/guide`: a section per source (original CDs, The First Decade, EA App/Origin, Steam) with where the folder usually is and what to pick, the archive or installer option, what is copied and where it stays (this browser's storage), what is never uploaded; ends with a button to `/import` | `web/src/screens/InstallGuide.tsx` (+ CSS module) | Vitest: every source renders, the button goes to `/import` | LW-1 (route) | S-M | browser |
| MB-1 | **Members and game accounts** (server). Additive tables `members(id, login_key UNIQUE, login, email NULL UNIQUE, password_hash, status, created_at, last_login_at)` and `member_game_accounts(member_id, username_key UNIQUE, created_at)`; `MemberService`: `register(login, password, email?)`, `login` with the lockout pattern of `AdminAuth`, `addGameAccount(member, nick, password)` that creates a WOL account (`AccountStore.register`) or claims an existing one by its password, refused past `members.maxGameAccounts` | `server/src/auth/members.ts`, `Storage*.ts`, `SettingsService.ts` | register, lockout, limit of one, claim with right and wrong password, a claimed nick cannot be claimed twice; memory + SQLite | F5A-1 (`Storage*.ts`) | M-L | no |
| MB-2 | **Launcher auth routes**: `POST /v1/members/register\|login\|logout`, `POST /v1/auth/refresh`, `GET /v1/members/me` → `{member, gameAccounts, maxGameAccounts}`. Access token 15 min (held in memory by the page); refresh token 30 days in an `HttpOnly; Secure` cookie on `/v1/auth`, rotated on each use, reuse of an old one revokes it; CORS with credentials only for `LAUNCHER_ORIGINS` | `server/src/http/memberRoutes.ts`, `server/src/config.ts`, `server/src/http/cors.ts` | rotation and reuse detection, expiry (injected clock), CORS refuses other origins; memory + SQLite | MB-1 | M | no |
| MB-3 | **Launch ticket** `POST /v1/auth/launch-ticket {gameAccount, edition}` with the access token; the game account must be the member's | `memberRoutes.ts`, `server/src/auth/tickets.ts` | someone else's game account refused; memory + SQLite | MB-2, F5A-1 | S | no |
| GU-1 | **Guest identity** (decision 9). `POST /v1/auth/guest {nick, edition}` → a ticket, when `nick` passes the nick rules (within the dialog width), is not an account and is not online now; otherwise one clear error ("name taken"). The guest holds the name only while its session lives (no account row; the session and the online user carry `guest: true`), so `POST /register` may take the name later. **Scoring:** an admission whose roster has any guest is refused, so a match with a guest is scored for nobody (Quick Match, lobby ranked, web 2v2); the matchbot may still pair them. Per-IP limit; `auth.guestEnabled` | `tickets.ts`, `server/src/auth/session.ts`, `server/src/http/routes.ts`, `Settlement.ts`, `SettingsService.ts` | name taken by an account, by an online user, free; a guest's session ends and the name is free again; a guest plus a member: admission refused, nobody rated; a register while a guest holds the name is refused; switch off refuses; memory + SQLite | F5A-1, G1-M6 (`Settlement.ts`) | M | no |
| LW-3 | **Account screen and identity**: `/account` (sign in, create a member, create or claim the one game account with "1 of 1", sign out); the Shell bar shows "Guest" or the member and their nick; client `web/src/account/api.ts` (`credentials: "include"`, server from `VITE_WOL_HTTP_URL`) | `web/src/screens/launcher/AccountScreen.tsx`, `web/src/account/api.ts`, `web/src/screens/launcher/Shell.tsx` | Vitest with a fake fetch: sign in, refresh on reload, limit shown, sign out | MB-2, LW-1 | M | browser |
| LW-4 | **PLAY hand-off**: signed in → mint a ticket and open `/game?edition=…#ticket=…`; guest → the launcher asks for a guest name (remembered in the page settings), gets a guest ticket, shows "name taken" inline; with guests off, the game's own login dialog as today | `web/src/screens/launcher/PlayScreen.tsx`, `web/src/account/api.ts` | Vitest: the URL carries the fragment; "name taken" shown; no ticket when offline | MB-3 or GU-1, F5A-2, LW-3 (api.ts) | S-M | browser |
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
| `server/src/config.ts` | C-0, REG-1, F2-3, F4-1, DB2, DB4, MB-2 (one at a time) |
| `server/src/settings/SettingsService.ts` | C-0, REG-1, F4-1, MP-1, MP-2, K1-a, K1-b, SE-2, G1-M3, MB-1, GU-1, LB-1, AW-12 |
| `server/src/index.ts` | F4-1 → DB2 → SE-1 → O1-1 |
| `server/src/http/adminAuthRoutes.ts`, `server/src/auth/adminAuth.ts` | F2-2 → F2-3 → F2-5 |
| `server/src/http/adminRoutes.ts` | F2-1 → G1-S8 → LB-5 → AW-6 → AW-9 → AW-10 → AW-11 |
| `server/src/storage/Storage.ts`, `MemoryStorage.ts`, `SqliteStorage.ts` | DB1 → F5A-1 → MB-1 → SE-1 → SE-2 → SE-3; DB3 touches every line, so nothing else runs during it |
| `server/src/ladder/LadderService.ts` | SE-1 → SE-2 → SE-3 → G1-S8 |
| `server/src/ladder/Settlement.ts` | G1-M3 → G1-M6 → GU-1 |
| `server/src/matchmaking/MatchmakingBot.ts` | C-1 → MP-2 → AW-9 or LB-3 (`snapshot`) → G2-S10 |
| `server/src/server/WolServer.ts` | LB-1 → LB-6 → AW-6 → C-2 (if it needs a server answer) |
| `server/src/bot/LobbyBot.ts` | LB-1 → LB-2 → LB-3 → LB-4 → LB-5 → LB-6 (one at a time; split the command groups into files in LB-1 if they should run in parallel) |
| `admin/src/main.tsx` | AW-0 first; after it each screen is its own file |
| recomp `web/src/App.tsx` | LW-1 (adds all route stubs), then only the screen files change |
| recomp `web/src/game/loader.ts`, `wol.ts` | F5A-2 → F5A-3 (loader call) |
| recomp `src/web/wolapi.c` | F5A-3 → LW-7b → C-3 (if the fix is in the shim) |

## Parallel groups

Groups whose tasks share no file. Start any task of a group once its dependencies are in.

- **Now:** F6-1, F6-2, F2-1, F4-2, AW-0, MP-1 (after C-0 and REG-1 if they touch `SettingsService.ts` at the same time), LW-1 (then
  LW-2), LW-7a, LB-0 (then LB-1, which writes `config.ts` and
  `SettingsService.ts` too, so after C-0, REG-1 and F4-1). C-0, REG-1 and F4-1 all write `config.ts` and
  `SettingsService.ts`, so they go one after the other (C-0 first: it is the smallest).
- **After that:** F2-2 (then F2-3, F2-4), DB1 (then DB2), F5A-1 (then F5A-2, F5A-3), AW-2, AW-3, AW-4.
- **Phase 1 lanes:** seasons (SE-1 → SE-2 → SE-3, SE-4, SE-5) beside integrity (G1-M3 → G1-M6), beside members (MB-1 → MB-2 → MB-3)
  once SE-1 and MB-1 are not both writing `Storage*.ts`. Web: LW-3 → LW-4; LW-7b after F5A-3.
- **After phase 1:** R1; and the **single-writer window** for DB3 (decision 12). Nothing else on the server meanwhile; web and admin
  console tasks can continue.
- **Later:** DB4 → DB5, DB6, DB7; O1-*; AW-5..AW-13; C-1..C-4.

## Decisions

"Decision n" in the tables above is decision n of [plan.md](plan.md), "Decisions". All seventeen were taken on 14 Nov 2026;
none is open. The ones that shape the tasks most:

| Decision | Tasks it shapes |
|---|---|
| 2 real-client session after phase 1 | R1, M1, M2, C-2, C-3 |
| 3 SQLite default, Postgres and MySQL by configuration | DB3-DB7 |
| 4 co-op on by default, unranked | C-0 |
| 9 guests: any free name, never scored, a match with a guest scores for nobody | GU-1, LW-4 |
| 10 web only | no native tasks |
| 11 member sign-in by login name or email, claims count, names capped at 9 | MB-1, GU-1, F5A-3 |
| 12 DB3 after phase 1 | DB3, SE-1, MB-1, LB-5 (written sync first) |
| 14 every stock map available, configured on the admin site; proof automatic | MP-1, MP-2, MP-3, AW-3 |
| 15-17 lobby bot: `/command` with private replies, linked-nick moderation, `YuriBOT` | LB-0..LB-8 |
