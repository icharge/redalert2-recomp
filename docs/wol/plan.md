# WOL shared server: execution plan

Status of 14 Nov 2026. One plan for the whole scope: a configurable, self-managed shared ranked server, a map pool
and seasons, Yuri's Revenge Quick Co-op, a secure admin web, members with launcher single sign-on, and the gaps left in
the [roadmap](roadmap.md) register. Designs are in [admin-and-config.md](admin-and-config.md),
[members-and-sso.md](members-and-sso.md), [seasons.md](seasons.md), [co-op.md](co-op.md) and [operations.md](operations.md);
this page is the order of work, the tasks, how each is checked and what is waiting on you. Paths under `server/` and
`admin/` are in the sibling repo `../ra2web` (branch `feat/shared-ranked-release`); `src/`, `web/` and `docs/` are this repo
(branch `web-port`). Both stay local: nothing is pushed.

**How to read the marks.** Status: **built** (committed, commit named), **partly built**, **not started**. Evidence:
**Seen** = read in code or run in this work; **Assumed** = from a document, not re-checked; **Open** = needs a real client.
Effort: S under an hour, M about a day, L several days. "Tests" are the server's `bun test` (652 pass, `tsc` clean at the
last run); "real client" means a person running two game clients.

## Phase order

| Phase | Goal | Items | Why this order |
|---|---|---|---|
| **0. Foundations** | An operator can run, change, back up and secure the server without editing code | F1 config store, F2 admin auth, F3 migrations, F4 scheduled backup, F5 member model and launcher sign-in, F6 housekeeping | Everything later adds tables, settings and admin routes; F3 makes each of those safe, F1/F2 are what they plug into. F5 is last in the phase because it waits on your decisions and shares F2's password and session code |
| **1. Pool and seasons** | The ladder runs itself and players can see it | M1 map pool, SE seasons lifecycle, reset, awards, leaderboard page | Seasons need F3 (new tables) and the settlement timer; the pool is already data, what is left is proof on real clients |
| **2. Co-op** | The Quick Co-op button works | C1 capture, C2 queue | Needs the pool (mode `coop`) and one real-client capture; unranked, behind a switch |
| **3. The rest** | Everything an operator or player still lacks | A1 admin screens, O1 metrics and docs, K1 more settings keys, G1 ranked-integrity gaps, G2 should-haves | Each is independent once phases 0-1 exist |

Suggested sequence inside the phases (what to start first, given dependencies): F6, F3, F2 remainder, F4, F5 slice A, M1 proof
session, SE1-SE2, then the rest in the order of the sections. The single real-client session that closes most **Open** items
is described once, near the end ("One real-client session").

## What is already built

| Commit (ra2web) | What |
|---|---|
| `fbf8e32` | Map pool of stock two-player maps per edition; size and digest rules reproduce the two real captures |
| `ec585c7` | `settings` table and `SettingsService`; map pool as a setting; `audit_log`; `/admin/settings`, `/admin/audit`, `/admin/quick-match/maps` |
| `68318fe` | `admin_users`, roles, lockout, cookie plus CSRF and bearer console sessions, role checks on every admin route, `scripts/admin-user.ts` |
| `a363c2f` | `scripts/backup.ts` (`VACUUM INTO`, verify, prune); public `GET /seasons` |
| `7788c8f` | Admin console signs in through `/admin/auth/login`, falls back to the game-account login |
| recomp `a10b5ab2`, `e0fd833b` | Design docs and status |

---

## Phase 0: foundations

### F1. Config store (roadmap P1, P14)

**Status: built** (`ec585c7`, Seen: `settings.test.ts`, `adminSettings.test.ts`, memory and SQLite). Ten keys: ranked on/off,
ladder starting rating, placement games, minimum report length, season grace, two rate limits, welcome text, the map pool,
and `net.wolTcpPort` (restart-only example).

**Left:** more keys (K1 below), and the console page (A1). Nothing structural.

**Task pattern for a key** (S each): add an entry to `SETTING_DEFS` in `server/src/settings/SettingsService.ts` (type, range,
`live`, the `ServerConfig` field it writes); if the consumer copies the value at start (as `LadderService` did) add a line to the
`settings.onApplied` handler in `server/src/index.ts` that pushes it; add a case to `test/settings.test.ts`. A key that needs a
restart sets `live: false`, which the API already reports as `restartRequired` and which only an owner may change.

**Verify:** `GET /admin/settings` shows it; `PUT` changes behaviour without a restart (a test reads the consumer).
**Risk:** low. A stored value that stops validating after an upgrade is skipped with a warning (Seen).

### F2. Admin authentication and security (P2, P11 part)

**Status: built for the API, partly for the console** (`68318fe`, `7788c8f`; Seen: `adminAuth.test.ts`, 20 tests).
Separate `admin_users` with four roles, five-failure lockout for 15 minutes, per-address login limit, 30 minute idle and 8 hour
absolute sessions, cookie (`HttpOnly; SameSite=Strict; Path=/admin`) plus CSRF header or Bearer, role per route, restart-only
settings owner-only, audited logins, no default credential, `ADMIN_LEGACY_AUTH=false` closes the game-account route.

**Left**, in order (each independent):

1. **Audit every admin change** (S, do first). Today only settings and logins write `audit_log`; bans, season edits,
   adjudications, map deletes, replay deletes write a log line. Add one wrapper in `server/src/http/adminRoutes.ts` that, after a
   non-GET returns below 400, calls `storage.insertAudit({at, actor, action: "http.<METHOD> /admin/<path>", target, detail:{ip,status}})`.
   Route handlers that know old and new values can add their own richer row. Test: perform each mutation, read `/admin/audit`.
2. **Admin-user management routes** (S-M). `GET/POST /admin/users`, `POST /admin/users/{name}/role|disable|enable|password`,
   owner-only, using `AdminAuth` (add `setRole(name, role, actor)`; revoke live sessions on a role change, as `setDisabled` does).
   Refuse to demote or disable the last active owner. Test: role gates, last-owner rule, sessions revoked.
3. **Origin check** (S). For a cookie session, a non-GET must also carry an `Origin` equal to `EXTERNAL_URL`'s HTTP origin or a new
   `ADMIN_ORIGIN`; reject otherwise. Test with a forged `Origin`. Bearer is unaffected.
4. **Console onto cookie and CSRF** (M). `admin/src/api.ts` stores nothing in `localStorage`: login sets the cookie, the CSRF token is
   kept in memory and sent as `X-CSRF-Token`, `GET /admin/auth/me` restores the session on reload. Removes the long-lived bearer in
   `localStorage` (the main XSS exposure of the console). Needs 2 first.
5. **TOTP for owners** (M, decision 6). Column `admin_users.totp_secret` (encrypted with a server key from the environment),
   RFC 6238 (SHA-1, 30 s, one step of drift) with `node:crypto` HMAC, ten single-use recovery codes stored hashed; login becomes
   two steps (`POST /admin/auth/login` returns `{needTotp: true, pending}`, then `POST /admin/auth/totp`). Test: wrong, replayed and
   drifted codes, recovery code single use.
6. **Separate admin listener** (S-M, decision 5). `ADMIN_LISTEN=127.0.0.1:9091` serves only `/admin/*` from a second `Bun.serve`
   and the public listener answers 404 for `/admin/*` when it is set. Test with both handlers.
7. **Cut over** (operator step, S): create real accounts, confirm the console works, set `ADMIN_LEGACY_AUTH=false`, remove
   `ADMIN_USERNAMES`. Then drop the legacy fallback in `admin/src/api.ts`.

**Threat model:** as in [admin-and-config.md](admin-and-config.md). What the built part closes: a game-password takeover is no
longer admin (once legacy is off); brute force (lockout, limit); forged cross-site changes (cookie plus CSRF, bearer cannot be
forged by a browser); insider changes unseen (audit, after task 1); a bricking setting (validation, restart-only for owners).
What stays open until tasks 3-6: a stolen bearer in the console's `localStorage`, admin API on the public origin, no second factor.

**Verify:** the test suite, plus a manual pass with a viewer, an admin and an owner account against a running server.
**Dependencies:** none. **Effort:** the six tasks total about L. **Risk:** low; lockout means a forgotten owner password is reset
from the host with `bun scripts/admin-user.ts password <name>` (Seen).

### F3. Ordered migrations (P4 part, M7 part)

**Status: not started.** Tables are created with `CREATE TABLE IF NOT EXISTS` and one shape check (`migrateSkuColumns`,
`SqliteStorage.ts`) that copies the file to a `.bak` first (Seen). New tables arrive free; a changed table does not.

**Tasks** (M):

1. `server/src/storage/migrations.ts`: `interface Migration { version: number; name: string; up(db: Database): void }` and an ordered
   array. Version 1 is "the schema as it is today" and runs the existing create statements plus `migrateSkuColumns`, which stay
   idempotent.
2. Table `schema_version(version INTEGER PRIMARY KEY, name TEXT, applied_at INTEGER)`. On start, `SqliteStorage` reads the highest
   version; a database with tables but no `schema_version` is baselined to 1 after checking its shape.
3. For each pending migration: `backupDatabase(dbPath, <data>/backups/pre-<version>.sqlite)` (reuse `src/ops/backup.ts`), then run it
   in a transaction that also inserts the `schema_version` row. A failure rolls back and stops the server with the migration's name.
4. A database **newer** than the code refuses to start with a clear message (the downgrade guard).
5. Log the version at start; show it in `/health`. `MemoryStorage` is unaffected.

**Tests:** `migrations.test.ts`: fresh database lands on the latest version; a fixture in the old shape (with and without SKU columns)
upgrades with its rows intact; a newer database refuses; a failing migration leaves the data and version untouched and the
pre-backup exists; running twice is a no-op. **Verify on real data:** copy `data/ra2web.sqlite`, start the server against the
copy, compare `GET /leaderboard/...` before and after (Open until run).
**Dependencies:** none; **blocks:** SE1-SE3, F5 slice B (each adds migrations). **Risk:** medium, it runs on every start and on
real ratings; the copy-first rule and the transaction contain it.

### F4. Backup schedule and restore (M7, P4)

**Status: partly built.** `scripts/backup.ts` and `src/ops/backup.ts` (`a363c2f`; Seen: `backup.test.ts`, three tests, and a run
on a real file). Not built: the schedule, restore tooling, status in `/health`.

**Tasks** (S-M):

1. `server/src/ops/backupScheduler.ts`: `startBackupSchedule(opts: {dir, keep, at: "HH:MM", now, log, onResult})`, a once-a-minute
   timer that runs `backupDatabase` when the local time passes `at` and no backup ran that day. Config `BACKUP_DIR` (off when unset),
   `BACKUP_AT` (default `04:00`), `BACKUP_KEEP` (default 14); `backup.keep` as a live setting.
2. Record the last result (time, file, bytes, ok, error) in memory and as an audit row `backup.run`; expose it in `/health` and in
   `/metrics` (O1). A failed run logs an error; the previous backups are untouched (Seen in the function).
3. Restore: `bun scripts/restore.ts <file> [--db PATH]` refuses while a server answers on `SERVER_PORT`, verifies the file
   (`integrity_check`), moves the current database and its `-wal`/`-shm` aside as `*.before-restore`, copies the backup in. The note
   in [operations.md](operations.md) stays the manual form.
4. Document off-host copying (operator's tool); the server pushes nothing.

**Tests:** injected clock: runs once per day, skips when `BACKUP_DIR` is unset, reports a failure. `restore.test.ts`: restore into a
scratch folder, read an account back. **Verify:** restore a real backup into a scratch folder and read the leaderboard (Open).
**Dependencies:** none. **Risk:** low. A backup of a live WAL database through `VACUUM INTO` is consistent (Seen in the test with an
open connection).

### F5. Members and launcher single sign-on (P3, P13)

**Status: design only** ([members-and-sso.md](members-and-sso.md)). Nothing in it changes how a client logs in today.
**The launcher does not exist**, so this fixes the contract it will be built against. The retail login screen takes at most 10
characters per field (Seen, `src/web/wolapi.c`), so a ticket travels beside the fields, and the shim, which already does the HTTP
login, redeems it.

It is built in slices so most of it is not blocked on your decisions:

**Slice A: tickets on the existing accounts** (M; no member model, no decision needed except delivery, decision 1).

1. Migration (F3): `launch_tickets(ticket_hash PRIMARY KEY, username_key, edition, created_at, expires_at, used_at)`.
2. `server/src/auth/tickets.ts`: `TicketService.mint(username, edition): string` (32 random bytes, stored as SHA-256, 60 s, once) and
   `redeem(ticket): {user, sessionToken} | undefined` (refuses used, expired, banned, unknown with one generic result; creates the
   normal game session through `SessionManager.create`).
3. Routes: `POST /v1/auth/redeem {ticket}` (per-IP limiter as `/login`); a mint route for the launcher in slice C, and for now
   `bun scripts/ticket.ts mint <nick> [--edition yr]` for testing.
4. Web shim: `web/src/game/wol.ts` reads `#ticket=` from `location.hash`, clears it with `history.replaceState` before any request,
   calls redeem instead of `POST /register`/`/login`, then `session <token>` as today. Test: `wol.test.ts` with a fake fetcher.
5. Native shim: `src/runtime/host.c` reads and clears `RA2_LAUNCH_TICKET`, redeems it and feeds the session to the TCP gateway.
   **Assumed:** how the native build currently obtains its session token was not re-read for this plan; task 5 starts by finding
   that path in `host.c` and the gateway (`WolTcpGateway` takes `session <token>`).
6. Without a ticket nothing changes, so retail installs, bots and Vera keep working.

**Slice B: member model** (L; needs decisions 1-4). Tables `members`, `devices`, `refresh`, `identities` as in the design; migration of
`accounts` into `members` (`legacy=1`), keeping `accounts` for one release so a rollback is a switch. `AccountStore` becomes a facade;
nick rules and reserved names enforced at registration; claim flow for legacy nicks. **Rating key:** recommended, nick is permanent in
v1 (ratings stay keyed by `username_key`), so no ladder migration is needed.
**Slice C: launcher login** (L): `POST /v1/auth/login` (email or nick), 15 minute access token, 30 day rotating refresh per device
(reuse of an old refresh revokes the device), `POST /v1/auth/launch-ticket`, device list and revoke, "log out everywhere".
**Slice D: email** (M): verification and reset tokens (hashed, 24 h and 1 h, single use), `SMTP_URL`; without SMTP an admin marks an
address verified. **Slice E: OAuth** (M per provider, only if decision 5 says yes).
**Slice F: require a member for ranked** (S, setting `ranked.requireMember`, only if decision 4 says so).

**Tests:** ticket single use, expiry (injected clock), banned member, wrong edition, replay after redeem, redeem rate limit; refresh
rotation and reuse detection; migration keeps ratings. **Needs a real client:** the web path in a browser; the native path with an
install (Open).
**Dependencies:** F3; F2's password hashing and lockout code is reused. **Effort:** A is M; the whole is XL. **Risk:** slice A low
(additive); slice B medium (touches login for everyone, hence the one-release overlap and the unchanged nick+password path).

### F6. Housekeeping before the rest (S)

- S12: `test/errorReport.test.ts` shares `tmp-error-reports`; give each test its own `mkdtempSync` folder (flake in one full run, Seen).
- Fix the test-environment leaks first seen in D5 if any new test touches `data/` (none known).
- Put `ADMIN_LEGACY_AUTH`, `BACKUP_*`, `ADMIN_ORIGIN`, `ADMIN_LISTEN` in `server/README.md` as they land (O1 generates the full list).

---

## Phase 1: map pool and seasons

### M1. Map pool

**Status: built for data and admin API** (`fbf8e32`, `ec585c7`; Seen: `quickMatchMaps.test.ts`, `adminSettings.test.ts`, the digest
rule reproduces both real records). Per edition and mode, weights, enabled flag, size/digest/slots read from the uploaded file,
refused when it has no digest, fewer than two start points or is over 4 MiB.

**Left:**

1. **Prove each map on a real client** (roadmap M2; Open). Five maps have never been loaded: `XMP31S2`, `XMP21S2`, `MP21S2`,
   `MP29U2`, `MP31S2`. For each: set the pool to that map alone (or weight it up), play Quick Match with two clients, check both reach
   the first frame and the log shows `quick match map <name>`. A wrong digest ends with "scenarios do not match". Effort S per map.
2. **Pool page in the console** (S-M, part of A1): list, add by upload, weight, enable, remove, with the size and digest shown.
3. **Rotating or seasonal pool** (nice to have): a season may carry its own pool; `quickMatch.pool` entries gain `seasonId?`. Not planned.
4. **More maps:** about 30 more two-player maps in `MultiMD.mix` are unnamed by hash, and `.mmx` maps use a layout whose record form was
   never captured (Assumed). Add only after the M2 proof for the existing ones.

**Dependencies:** F1. **Risk:** low to the server; the cost of a bad map is a failed match, so a new map goes in disabled or low weight.

### SE. Seasons and the leaderboard (P6-P8)

**Status: partly built.** Exists (Seen): per-season standings and history, season bound at admission, grace after the end, admin create,
edit and close, public `GET /leaderboard/{sku}/{type}/{season}`, `GET /players/{name}`, and `GET /seasons[?sku=]` (`a363c2f`, tested).
Missing: SE1 reset, SE2 awards, SE3 archive, SE5 modes, SE6 page, SE7 scheduled start and end ([seasons.md](seasons.md)).

**Tasks, in order:**

1. **States, scheduler, archive** (M; needs F3; decision 3 on mode boards can wait). `ladder_seasons.status` takes
   `scheduled | current | closing | archived` (the admin already writes `closedAt`); new table `season_results(season_id, sku,
   ladder_type, rank, player, rating, wins, losses, placed)`. `LadderService.advanceSeasons(now)` moves a scheduled season to
   current at `start_time`, a current one to closing at `end_time` or on admin close, and a closing one to archived after the grace,
   writing the snapshot in one transaction. Call it from the settlement timer in `server/src/index.ts` (the timer already runs every
   few seconds; run this once a minute). **Care:** "current" today is the newest by `start_time`, so a scheduled future season must
   not become current early; `getRunningSeason`/`getLeaderboard` need a test for it. Routes: `GET /seasons/{sku}/{id}`, `archived` and
   `snapshotAt` on the leaderboard. Tests on both storages with an injected clock: transitions, the snapshot is frozen against a later
   rescore, a late report inside the grace still counts, a late report after it does not.
2. **Reset policy** (M; decision 1). `ladder_seasons.reset_policy` (`hard`, `soft:<factor>`, `carry`). Apply it **lazily**: when a player
   has no standing in the new season, derive the start from their previous-season standing (`start + (prev - start) * factor` if they
   had at least N rated games, else `start`; placements restart at 3) the first time they are needed, so no bulk job runs at the
   season boundary. Settings `ladder.softResetFactor`, `ladder.softResetMinGames`. Tests: veteran, newcomer, one game short of N, carry.
3. **Awards** (S-M; decision 2): `season_awards(season_id, sku, ladder_type, player, kind, rank)` written with the snapshot (`champion`,
   `top10`, `top100`, `placed`), `GET /players/{name}/awards`.
4. **Admin season screens** (S-M, part of A1): create with dates and reset policy, start or close now, view the archive.
5. **Leaderboard page** (M): in the web client, `/ladder`: season picker from `GET /seasons`, edition and mode tabs, search by name,
   the player's season history. Read-only over the public routes. Verify in a browser; no client needed.
6. **Per-mode boards** (S, decision 3): add ladder types rather than tables (`qm-1v1`, later `coop`); the admission already carries
   its source (`wol-native`), so the rating service can choose the type.

**Dependencies:** F3 for 1-3; 1 before 2-3. **Effort:** about L in total. **Risk:** medium for task 1 (it changes which season a game is
scored into); the admission-bound season rule means a running match is unaffected (Seen).

---

## Phase 2: Yuri's Revenge Quick Co-op

**Status: researched, not implemented** ([co-op.md](co-op.md)). Seen in the lifted `gamemd`: the button is control `0x771`, mode word 2,
dispatched at `0x0077B40C` to the same Quick Match runner `0x0079FC40`; lobby prefix `Lob_39_`. **Assumed** (VERA20K notes): same
`Match` request line, game channel tournament field 0, cooperative game mode, the host replaces the map with the first Allied mission,
and a cooperative campaign line `C0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,-1,<host b64>,<guest b64>`. **Open:** the exact record a real matchbot sent.

**C1. Capture** (S; needs a YR client; roadmap P9). Add a switch `queues.yrCoop.enabled` (default off) and, when on, publish
`#Lob_39_0` with `@matchbot` the way lobby 40 is (`NATIVE_QUICK_MATCH_LOBBY` in `server/src/protocol/qmCodes.ts`, used in
`WolServer.ts` around the lobby list and the channel join). Answer a co-op `Match` with the best-guess record and log every `GAMEOPT`
line (`web/e2e/wol.mjs --start` logs them). Press Quick Co-op with two clients; keep the log. This answers the three Open questions
and does not ship anything.

**C2. Queue** (M; after C1 and M1 for the pool): queue type 41, unranked, two players, never paired with Quick Match players
(`MatchmakingBot.ts`: extend `isNativeQuickMatchType`-style helpers, add the queue); the record builder in `matchmaking/nativeGameOpts.ts`
gets a co-op variant (tournament 0, cooperative mode, the campaign line); map chosen from the pool with `mode: coop` (size and digest by
the same rule); no `Settlement.admit`, so nothing is rated. Tests `nativeCoop.test.ts` modelled on `nativeQuickMatch.test.ts`: lobby
join, pairing, record shape, never pairs with a Quick Match entry, nothing admitted. **Verify (real client):** both clients reach the
mission's first frame; log shows the co-op pair line. Keep the switch off until that passes.

**Dependencies:** M1 (pool mode `coop`), C1 before C2. **Risk:** publishing lobby 39 changes what retail clients show (the button
becomes live instead of "Matching Server Not Found"); a wrong record makes both clients leave with "scenarios do not match". Hence off
by default and a real run before enabling. **Scope decision 4** below (in scope or a clear "not hosted" message; unranked).

---

## Phase 3: the rest

### A1. Admin web screens (P11)

**Status: partly built.** Exists (Seen): dashboard, seasons, matches, replays, players, maps in `admin/src/main.tsx`. Every screen is
a thin view of an API, so build in this order, each S-M, each with the API first where it is missing:

1. Settings page and map pool page (API done, F1/M1).
2. Audit view (API done: `GET /admin/audit?limit=&before=`).
3. Admin users page (needs F2 task 2) and sign-out-everywhere.
4. Bans, mutes, kicks: the WOL server has the commands; add `POST /admin/players/{name}/mute|kick` through `WolServer` and audit them.
5. Disputes and adjudication screen (route exists; adjudication needs `winner`, roadmap S8).
6. Live queue view: `MatchmakingBot.snapshot()` (queue, waiting seconds, nick) and `GET /admin/queues`.
7. Announcements: `POST /admin/announce {text}` broadcast through the WOL server and recorded in the audit; also the `welcome.motd` setting.
8. Health and log tail: `GET /admin/logs?tail=200` reading `LOG_FILE`, bounded, owner-only; health data from O1.

**Verify:** each screen with all three roles in a browser; `bun run admin:typecheck`. **Dependencies:** F2 for 3-8.

### O1. Operations and documentation (P12)

**Status: partly built** (backup script, F4 above). Remaining, in order:

1. `GET /metrics`, Prometheus text, admin role or loopback only: connected players, queued players per queue, matches in progress,
   settlement counts by state, seconds since the last settlement tick (a stuck timer shows as that number growing), database size, last
   backup time and result, schema version. Test: counts match a fixture.
2. `server/.env.example` generated from `server/src/config.ts` by `scripts/gen-env-example.ts` (each `env.NAME` with its default and the
   comment above it), plus a test that fails when the file is stale, so it cannot drift.
3. `server/README.md` gets the checklist from [operations.md](operations.md) (run, configure, back up, upgrade, restore, expose).
4. Systemd unit and Windows service notes, log rotation already exists (`LOG_MAX_BYTES`, `LOG_MAX_FILES`, `LOG_ROTATE_DAILY`).
5. A signed-in "health" console page reading 1.

### K1. More settings keys (P14)

Each S, in this order of value: queue rules (pair window, rating spread), ranked on/off per queue, game speed, per-channel lobby
switches, minimum report length per mode, `queues.yrCoop.enabled` (C1), `ranked.requireMember` (F5F), `ladder.softReset*` (SE2),
`backup.keep` (F4). Pattern in F1.

### G1. Ranked-integrity gaps (roadmap M1, M3-M6, S8)

| Item | State | Tasks | Verify | Decision |
|---|---|---|---|---|
| M1 first RA2 scored match | not proven (Seen: both recent RA2 matches ended `too_short`) | play over two minutes with two RA2 clients, both report | `GET /players/<name>` shows the win and a changed rating; admission `scored` | none |
| M3 quitter not penalised | not started | with option (c): score a win when one player reports a win and the other left before the end and never reported, **and** gserv saw the drop; change `Settlement.expire` (`one_report`/`no_reports` paths) and `docs/ranked-ladder.md` | test: winner reports, loser disconnects, grace passes | recommended (c) |
| M5 `FINI=0` | not traced | trace the report builder in the lifted game or capture a report from a dropped game | a captured report | none |
| M6 web 2v2 on one report | not started | route web 2v2 through `Settlement` with a roster-wide agreement rule (all reporters agree on the winning team) | test: lone winner report is not scored | team rule |
| S8 adjudication skips the season grace | documented | enforce the grace or record an explicit override reason | test both | small |

M (each) apart from M1 and M5 which need a client. Risk: M3 and M6 change who gets rating, so ship behind a setting and test on both storages.

### G2. Should-have and nice-to-have (roadmap S1-S11, nice list)

Grouped by what they need:
- **Real client, observe only (S):** S1 random start position display, S2 side numbering vs the log line, S3 YR 60 fps against server
  timestamps, S4 Custom Match after the lobby-filter change, S5 lobbies 39/35 (folds into C1), S11 UDP relay and native recording.
- **Build (S-M):** S6 RA2 login-failure message needs an RA2 rebuild (`build-web.cmd --mode fast --edition ra2` first, then production
  per `CLAUDE.md`), S10 matchbot countdown and requeue on no gserv, S9 Vera items (3 rated games per 24 h, match lookup beyond 10 minutes;
  the sibling client's contract, so confirm with its owner first).
- **Decision (S7):** the Connection slider; leaving it alone is the safe default.
- **Nice to have, not planned:** queue size in the retail dialog (`Pool <n>`), native ladder screen (excluded by an earlier decision), per-player
  veto, more maps (M1 task 4).

---

## One real-client session

Most **Open** items close with one sitting of two clients (one YR, one RA2 pair; ideally one retail install for M4):

| Order | Check | Closes |
|---|---|---|
| 1 | YR Quick Match on each pool map in turn (disable the others), play past the first frame | M2 |
| 2 | RA2 Quick Match, play over two minutes, report both | M1 |
| 3 | A match left early by one player (no report) | confirms M3's current behaviour before changing it |
| 4 | A match ended by a disconnect, keep the report | M5 |
| 5 | Pick Soviet in the dialog, compare the log line with the game | S2 |
| 6 | Frame counter against log timestamps | S3 |
| 7 | Custom Match in YR | S4 |
| 8 | Quick Co-op against the C1 capture build | C1, S5 |
| 9 | One retail install in a Quick Match against a recomp client | M4 |
| 10 | Web client with `#ticket=` after F5 slice A | F5 |
| 11 | A native launch with `RA2_LAUNCH_TICKET` after F5 slice A | F5 |

## Verified and assumed

| Claim | Evidence |
|---|---|
| Settings, pool, audit, admin auth, backup script, `GET /seasons` work as specified | **Seen**: server tests (652 pass, `tsc` clean), the CLI and backup run on real database files |
| Map size is the file length and the digest is the map's `[Digest] 1=`; two real records reproduce | **Seen** |
| The other five pool maps load on real clients | **Open** |
| Quick Co-op is mode 2 sharing the Quick Match runner and uses lobby 39 | **Seen** in `gamemd` (dispatch table and prefix); everything about the co-op record is **Assumed** from VERA20K |
| The admin console works with the new login against a running server in a browser | **Assumed**: typechecked and the API is tested, the UI was not run |
| `LadderService.updateSettings` applies live | **Assumed**: used by the settings hook, no dedicated test (add one in F6) |
| Launcher ticket flow | **Design only**; native delivery path in `host.c` **Assumed** |
| Migrations, scheduled backup, season lifecycle, members | **Not started** |

---

## Decisions needed from you

Recommendations first. Each says what it unblocks.

1. **Launcher sign-in design** (unblocks F5 slices B-F). Recommend: **launch ticket** (60 s, single use, redeemed over HTTP by the shim),
   delivered by environment variable `RA2_LAUNCH_TICKET` (native) and URL fragment `#ticket=` (web); **email optional** (needed only for
   password reset); **permanent nick** in v1 (ratings stay keyed by nick, no ladder migration); **one live game session per member**
   (as today); **no member required for ranked yet**, add `ranked.requireMember` later; **no OAuth** until the launcher exists. Slice A
   (tickets on the existing accounts) can start on the delivery choice alone.
2. **Admin split** (unblocks F2 tasks 4-6). Recommend: keep the separate accounts (built), turn `ADMIN_LEGACY_AUTH` off after the first
   owner works, add **TOTP for owners** before the console is on the public internet, and serve `/admin` on a **separate loopback or VPN
   listener** rather than the public origin.
3. **Season reset rule** (unblocks SE2). Recommend: **soft reset, factor 0.5, at least 5 rated games**, placements restart at 3.
   Season length: a quarter if the ladder is active, otherwise keep 365 days.
4. **Awards and badges** (SE3). Recommend: yes, as a web-page feature only (the retail game cannot show them).
5. **One board or two for Quick Match and lobby-made ranked 1v1** (SE6). Recommend: one board per edition, as today.
6. **Co-op scope** (unblocks C2). Recommend: **in scope but unranked**, first Allied mission only to start (a pool of missions later),
   behind `queues.yrCoop.enabled`; do C1 first, because without a capture the record is a guess.
7. **M3, a quitter's penalty.** Recommend option (c): score the win only when gserv saw the drop.
8. **M6, web 2v2.** Recommend: settle through the same agreement rule (all reporters agree on the winning team), behind a setting.
9. **S7, the Connection slider.** Recommend: leave it alone.
10. **Pool size.** Recommend: prove the five untested maps (M2) before adding any; say if you have favourite stock maps.
11. **A real-client session.** Not a design choice but a need: who runs the session in the table above, and with which installs (a retail
    install for M4)? Phases 1-3 are buildable without it, but several are only **Seen** in tests until it happens.
