# WOL shared server: execution plan

Status of 14 Nov 2026, checked against the code the same day. One plan for the whole scope: a configurable, self-managed
shared ranked server, a map pool and seasons, Yuri's Revenge Quick Co-op, a secure admin web and configuration, a pluggable database
(SQLite, Postgres, optionally MySQL) with an auto-migrate tool, members with a web launcher and WOL auto-login, and the gaps left in
the [roadmap](roadmap.md) register. Designs are in [admin-and-config.md](admin-and-config.md),
[members-and-sso.md](members-and-sso.md), [seasons.md](seasons.md), [co-op.md](co-op.md) and [operations.md](operations.md).

**This page is the phase order, the status of each item and the decisions. The tasks, one session each, with files, sketches,
tests, dependencies, effort and the file-ownership map, are in [tasks.md](tasks.md).**

Paths under `server/` and `admin/` are in the sibling repo `../ra2web` (branch `feat/shared-ranked-release`); `src/`, `web/` and
`docs/` are this repo. Both stay local: nothing is pushed.

**Marks.** Status: **built** (committed, commit named), **partly built**, **not started**. Evidence: **Seen** = read in code or run
in this work; **Assumed** = from a document, not re-checked; **Open** = needs a real client. Effort: S under an hour, M about a day,
L several days. "Real client" means a person running two game clients.

**Tests** (`cd ../ra2web/server && bun test`, `bunx tsc --noEmit -p .`), 14 Nov 2026: `tsc` exit 0. Two full runs of 662 tests in 44
files: **661 pass, 1 fail**, then **659 pass, 3 fail**. The fail in both runs is the known `errorReport.test.ts` flake (S12); the second
run also had two `nativeQuickMatch.test.ts` "sides and colours" tests hit the 5 s timeout. All three are task F6-1.

## Phase order

| Phase | Goal | Items | Why this order |
|---|---|---|---|
| **0. Foundations** | An operator can run, change, back up and secure the server without editing code; a launcher can hand the game a login | F6 housekeeping, F2 admin security, F4 scheduled backup, F3 migrations and the auto-migrate tool (DB1, DB2), REG registration switch, F5 slice A tickets | F4 before F3, so real data is backed up before any migration runs. F3 is needed only for **changed** tables; new tables are `CREATE TABLE IF NOT EXISTS` and arrive without it (Seen, `SqliteStorage.ts`), so F5 slice A does not wait for it |
| **R. Real-client session** | Close the **Open** items | R1 (two clients), R2 (browser, after slice A) | Right after phase 0, or as soon as a person is free: most rows need nothing from phase 0. It gates M1 (no RA2 match has scored), the five unproven pool maps, the co-op follow-ups and the native question N1 |
| **DB. Storage engines** | Postgres (and optionally MySQL) beside SQLite | DB3 async storage, DB4 Postgres, DB5 copy tool, DB6 backups, DB7 MySQL | DB3 between phase 0 and phase 1, so the season and member storage of phase 1 is written async once; it touches every storage caller, so nothing else on the server runs during it |
| **1. Pool, seasons, ranked integrity** | The ladder runs itself, cannot be gamed by quitting, and players can see it | M1 pool proof (R1), SE seasons, G1-M3 quitters, G1-M6 web 2v2, G1-S8 | Seasons need the settlement timer and (for the reset policy) a migration. M3 and M6 are moved here from phase 3, behind settings, because "fully functional ranked" depends on them |
| **LW. Web launcher and members** | Welcome, bring-your-own-game guide, guest or member, WOL auto-login | LW-1..LW-8, MB-1..MB-3, GU-1 | The welcome page and the guide need no server and start now; members need slice A's tickets |
| **2. Co-op** | Finish Quick Co-op and decide to enable it | C-1..C-5 | Built behind a switch; what is left needs a real client |
| **AW. Web admin and configuration** | Every admin task in the console, with roles | AW-0..AW-13, K1 keys | AW-0..AW-4 can start in phase 0 (their APIs exist); the rest follow the APIs they show |
| **3. The rest** | Operations and should-haves | O1, G2 | Independent once phases 0-1 exist |

## What is already built

| Commit (ra2web) | What |
|---|---|
| `fbf8e32` | Map pool of stock two-player maps per edition; size and digest rules reproduce the two real captures |
| `ec585c7` | `settings` table and `SettingsService`; map pool as a setting; `audit_log`; `/admin/settings`, `/admin/audit`, `/admin/quick-match/maps` |
| `68318fe` | `admin_users`, roles, lockout, cookie plus CSRF and bearer console sessions, role checks on every admin route, `scripts/admin-user.ts` |
| `a363c2f` | `scripts/backup.ts` (`VACUUM INTO`, verify, prune); public `GET /seasons` |
| `7788c8f` | Admin console signs in through `/admin/auth/login`, falls back to the game-account login |
| `f282661` | YR Quick Co-op: lobby 39, unranked queue 141, switch `YR_COOP_ENABLED` / `queues.yrCoop.enabled` (off) |
| `7f69afc` | Built-in stock co-op mission `C1A01MD` in the pool (`mode: "coop"`), used only while the switch is on |
| `e2e4676` | Co-op record: Cooperative mode id 3, starts and AI opponents; the result kept as unscored history |
| `5c91029`, `cd8721f`, `b47f736` | Co-op diagnostics and wording: options sent to a closed room, "partner" not "opponent", relay datagram and chat logging |
| recomp `a10b5ab2`, `e0fd833b` | Design docs and status |

---

## Phase 0: foundations

### F1. Config store: built

`ec585c7`, `f282661` (Seen: `settings.test.ts`, `adminSettings.test.ts`, memory and SQLite). **Eleven keys** in `SETTING_DEFS`
(`server/src/settings/SettingsService.ts`): `ranked.nativeEnabled`, `queues.yrCoop.enabled`, `ladder.startingRating`,
`ladder.placementMatches`, `ladder.minReportDurationSeconds`, `ladder.seasonGraceSeconds`, `limits.loginMaxPerMin`,
`limits.registerMaxPerHour`, `welcome.motd`, `quickMatch.pool`, `net.wolTcpPort` (restart-only). More keys are K1 (tasks.md,
"Web admin and configuration"); a stored value that stops validating after an upgrade is skipped with a warning (Seen).

### F2. Admin authentication and security: built for the API, partly for the console

`68318fe`, `7788c8f` (Seen: `adminAuth.test.ts`, 20 tests). Separate `admin_users` with four roles, five-failure lockout for 15
minutes, per-address login limit, 30 minute idle and 8 hour absolute sessions, cookie (`HttpOnly; SameSite=Strict; Path=/admin`) plus
CSRF header or Bearer, role per route, restart-only settings owner-only, audited logins, no default credential,
`ADMIN_LEGACY_AUTH=false` closes the game-account route. **Seen:** only `adminAuth.ts` and `SettingsService.ts` call `insertAudit`; bans,
season edits, adjudications, map and replay deletes write only a log line.

**Left** (tasks F2-1..F2-7): audit every admin change; admin-user routes; Origin check; console onto cookie and CSRF (depends on the
Origin check, not on the user routes: `GET /admin/auth/me` already exists); TOTP for owners; a separate admin listener; the cut-over.
**Rule until then: the console stays off the public internet** (loopback, VPN or a proxy allow-list) until F2-3 (Origin) and F2-4
(no bearer in `localStorage`) are in, and F2-5 (TOTP) if it is ever public. The cut-over (F2-7) comes after F2-4.

### F3. Ordered migrations and the auto-migrate tool: not started (tasks DB1, DB2)

Tables are created with `CREATE TABLE IF NOT EXISTS` and one shape check (`migrateSkuColumns`, `SqliteStorage.ts`) that copies the
file to a `.bak` first (Seen). New tables arrive free; a changed table (for example `ladder_seasons.reset_policy`,
`admin_users.totp_secret`) needs a migration. DB1 builds an ordered list with `schema_version`, a pre-migration backup, one
transaction per step and a downgrade guard. It is **dialect-aware from the start** (`up(tx, dialect)`), so the same list serves
Postgres and MySQL later. DB2 is the tool: `bun scripts/migrate.ts status|plan|up` and `AUTO_MIGRATE` (apply on start, or refuse to
start while any is pending), with a database lock on networked engines.

### F4. Backup schedule and restore: partly built

`scripts/backup.ts` and `src/ops/backup.ts` (`a363c2f`; Seen: `backup.test.ts`, a run on a real file).
Left: the daily schedule and its status in `/health` (F4-1), the restore script (F4-2). **F4-1 lands before DB1 runs on real data.**

### REG. Registration switch (new)

**Seen:** `/register` is open to anyone, limited only per IP (`limits.registerMaxPerHour`, 20 an hour, `routes.ts:198`). The web
client calls `/register` before every `/login` (`web/src/game/wol.ts:110`), so every web login uses up that IP's registration budget
(players behind one NAT stop being able to register). REG-1: a live `auth.registrationOpen` and a limiter that counts only accounts
actually created.

### F5. Members and launcher sign-in

**Slice A: tickets on today's accounts** (tasks F5A-1..F5A-3; no migration, the table is additive). Server: `TicketService`, `POST
/v1/auth/redeem`, a mint script. Web: the loader reads and clears `#ticket=`, redeems, and `WolClient` uses the held session.
**The gap the earlier plan missed (Seen):** the game's nick comes from the dialog. `m_chat_request_connection`
(`src/web/wolapi.c:1118`) copies the typed login into `g_login` and then `g_nick` (line 1127) and sets the virtual IP from it, while
the server takes the nick from the session (`WolServer.handleSession`). So a ticket for X with Y typed leaves the two disagreeing. The
fix belongs in the shim: a new export `ra2_wolapi_set_launch_login(nick)` fills the saved-nick slot the dialog reads
(`WolChat::GetNick`) and makes the launch nick win in `m_chat_request_connection`. Skipping the dialog altogether is LW-7 (below).

**Native delivery (`RA2_LAUNCH_TICKET`): parked behind N1.** **Seen:** `wolapi.c` is compiled only into the Emscripten target
(`CMakeLists.txt:111`), not into the Linux target (`:94`) or the Windows build, and `src/runtime/host.c` has no WOL code (its
"launcher emulation" is the launcher mutex). The server accepts only `cvers`, `setlocale`, `getlocale` and `session` before login. So
no native build reaches this server today. The accepted delivery decision stays the contract; N1 decides how a native build gets a WOL
path at all.

**Slices B and C** are replaced by the launcher track (below). **Slice D** (email verification and reset, `SMTP_URL`) and **slice E**
(OAuth, not wanted until the launcher exists) stay later and unchanged. **Slice F** (`ranked.requireMember`) is not planned (decision 1).

### F6. Housekeeping (tasks F6-1, F6-2)

The flaky and timing-out tests (above), and a test that `LadderService.updateSettings` applies live. Put each new environment
variable in `server/README.md` as it lands (O1-2 later generates the full list).

## R. The real-client sessions

R1 (tasks.md has the rows): the five unproven pool maps (M2), the first scored RA2 match (M1), today's behaviour when a player quits
(the baseline for G1-M3), a report from a dropped game (M5), sides (S2), YR frame rate (S3), co-op "Next Mission" and score-screen
chat, and whether a retail install can log in at all (M4, N1). R2, in a browser, checks the ticket and auto-login paths.

## Track DB: Postgres or MySQL

**Seen:** `Storage` (`server/src/storage/Storage.ts`, about 61 methods) is fully synchronous over `bun:sqlite`, with 124 call sites
in seven files outside storage plus their callers. Networked drivers are asynchronous, so the first step is **DB3: make `Storage`
async** (L, mechanical, wide; one connection's WOL lines must stay in order). Then **DB4** a `PostgresStorage` over `Bun.SQL`
(**Assumed:** Bun 1.3.13's `Bun.SQL` has the Postgres and MySQL clients this needs; DB4 checks first) with one storage contract suite
run on memory, SQLite and Postgres; **DB5** a `db-copy` tool from SQLite to Postgres; **DB6** backups for networked engines (`pg_dump`,
the scheduler reports "external"); **DB7** MySQL only if decided. SQLite stays the default.

## Phase 1: map pool, seasons and ranked integrity

**M1. Map pool: built for data and admin API** (`fbf8e32`, `ec585c7`, `7f69afc`). Left: the proof on real clients for `XMP31S2`,
`XMP21S2`, `MP21S2`, `MP29U2`, `MP31S2` (R1 rows 1-2; a wrong digest ends with "scenarios do not match"), the console page (AW-3). More
maps only after that proof; about 30 two-player maps in `MultiMD.mix` are unnamed by hash and `.mmx` maps use an uncaptured layout
(Assumed).

**SE. Seasons: partly built.** Exists (Seen): per-season standings and history, season bound at admission, grace after the end,
admin create, edit and close, the public leaderboard and player routes, `GET /seasons`. Left (SE-1..SE-6): states, scheduler and
archive snapshot; reset policy (a column change, so it needs DB1); awards; `GET /seasons/{sku}/{id}` and the archived flag; the
leaderboard page; per-mode boards. **Care in SE-1:** "current" today is the newest season by `start_time`, so a scheduled future season
must not become current early.

**G1. Ranked integrity, moved into this phase behind settings.**

| Item | State | Task | Setting |
|---|---|---|---|
| M3 quitter not penalised | not started | G1-M3: score the win when one player reports a win, the other never reported **and** gserv saw the drop | `ranked.quitterWin` (off until decided) |
| M6 web 2v2 on one report | not started | G1-M6: roster-wide agreement through `Settlement` | `ranked.web2v2Agreement` |
| S8 adjudication skips the grace | documented | G1-S8: enforce it or record an override reason | |
| M5 `FINI=0` | not traced | R1 row 5 | |

## Track LW: the web launcher, members and WOL auto-login

The recomp web launcher exists (`web/src`: Shell, Play, Mods, Game, Settings, and the Install screen `screens/Import.tsx`).
It gets:

- a **welcome page** and a **bring-your-own-game (BYOG) install guide**: where the game folder is for each source (CDs, The First
  Decade, EA App/Origin, Steam), what is copied, and that it stays in the player's browser;
- **guest or member**: guests play offline at once and online with a generated, unranked nick; a **member** (the person) owns
  **game accounts** (WOL nicks, today's `accounts` rows, which keep the ratings), at most **one** for now (`members.maxGameAccounts`
  = 1). See [members-and-sso.md](members-and-sso.md);
- **WOL auto-login**: PLAY hands the game a ticket (`#ticket=`), the loader redeems it, the shim uses the ticket's nick, and the game
  goes from Internet to the welcome screen without the login dialog. LW-7a first looks for the game's own auto-login path in the lifted
  code; otherwise LW-7b completes the dialog from the shim. Without a ticket nothing changes, so retail-style login, bots and Vera keep
  working.

## Phase 2: Yuri's Revenge Quick Co-op

**Status: built behind a switch** (`f282661`, `7f69afc`, `e2e4676`, `5c91029`, `cd8721f`, `b47f736`; Seen: `test/yrCoop.test.ts`).
The lobby `#Lob_39_0` is published only while `queues.yrCoop.enabled` is on and the pool has an enabled `coop` map (the built-in
`C1A01MD` counts). The queue is type 141, unranked, never paired with Quick Match; results are kept as unscored history. **Seen on two
real clients** ([co-op.md](co-op.md)): paired through lobby 39, loaded `C1A01MD`, played to the "Campaign Results" score screen, after
three record fixes (mode id, countries, starts and AI).

**Left** (C-1..C-5): the cooperative campaign line (not sent, its wire form unknown, not needed for `C1A01MD`); "Next Mission" after
the score screen (not exercised); chat on the score screen (it is a UDP datagram through the relay, logging added, cause open); more
missions; the decision to enable it. Publishing lobby 39 makes the retail button live instead of "Matching Server Not Found", so the
switch stays off until decision 4.

## Track AW: web admin and configuration

The console (`ra2web/admin`) has dashboard, seasons, matches, replays, players and maps screens in one `admin/src/main.tsx`. In
order: split it into a file per screen (AW-0, so screens are separate writers), the cookie sign-in (AW-1 = F2-4), the settings page
(every key rendered from its definition, so new keys need no console work), the map pool page, the audit view, admin users, kick,
mute and ban, seasons admin, disputes, live queues, announcements, health and logs, **configuration export and import** with a dry-run
diff, and a read-only environment view (secrets only as "set / not set"). Settings keys (K1) are added in batches, since they all
write `SettingsService.ts`. Env-only by design: the storage engine and its URL, ports, secrets, `AUTO_MIGRATE`.

## Phase 3: the rest

O1 (`/metrics`, a generated `server/.env.example` with a staleness test, the `server/README.md` checklist, service notes) and the G2
should-haves (S6 RA2 login-failure message, S9 Vera items after its owner agrees, S10 matchbot countdown and requeue). S1-S4 and S11
are observations in R1; S7 (the Connection slider) is a decision, left alone by default.

---

## Verified and assumed

| Claim | Evidence |
|---|---|
| Settings, pool, audit, admin auth, backup script, `GET /seasons` work as specified | **Seen**: server tests (above), the CLI and backup run on real database files |
| Map size is the file length and the digest is the map's `[Digest] 1=`; two real records reproduce | **Seen** |
| The other five pool maps load on real clients | **Open** (R1) |
| Quick Co-op is mode 2 on the Quick Match runner, lobby 39 | **Seen** in `gamemd` |
| Quick Co-op pairs, loads `C1A01MD` and plays to the score screen | **Seen** on two real clients ([co-op.md](co-op.md)) |
| The cooperative campaign line and "Next Mission" | **Open** |
| New tables need no migration; changed tables do | **Seen** (`CREATE TABLE IF NOT EXISTS` for every table) |
| `Storage` is synchronous; a networked engine needs DB3 first | **Seen** (`Storage.ts`: no `Promise`; 124 call sites) |
| `Bun.SQL` covers Postgres and MySQL in Bun 1.3.13 | **Assumed** (DB4 checks) |
| A native build can reach the server | **Seen: no.** `wolapi.c` is web-only; `host.c` has no WOL code; the server takes only `session <token>` before login |
| A retail install can log in through the TCP gateway | **Open**, likely not for the same reason (R1 row 9) |
| The game's own auto-login path exists | **Open** (LW-7a) |
| The admin console works with the new login in a browser | **Assumed**: typechecked and the API is tested, the UI was not run |
| `LadderService.updateSettings` applies live | **Assumed** (F6-2 adds the test) |
| Migrations, scheduled backup, season lifecycle, members, launcher pages | **Not started** |

---

## Decisions needed from you

Recommendations first. Taken decisions are marked.

1. **Launcher sign-in: DECIDED 14 Nov 2026.** Launch ticket (60 s, single use, redeemed over HTTP by the shim), delivered by
   `RA2_LAUNCH_TICKET` (native) and `#ticket=` (web); email optional; permanent nick (now: the game account's nick); one live game
   session per member (with the limit of one game account, the same as one per game account); no member required for ranked; no
   OAuth until the launcher exists. The native delivery waits for N1 (decision 13).
2. **The real-client session** (first, because it gates M1, M2, M4, the co-op follow-ups and N1): who runs R1, when, with which
   installs (one retail install for row 9)? Recommended: as soon as someone is free, even before phase 0 finishes.
3. **Storage engine.** Recommended: **Postgres only** as the networked option, SQLite stays the default; MySQL (DB7) only if you need it.
   And when to run DB3 (async storage): recommended right after phase 0, as a window with no other server task open.
4. **Co-op scope.** Recommended: **in scope, unranked**; keep the switch off by default until C-2 and C-3 are checked on clients, then
   enable it; `C1A01MD` only to start, more missions one client run each.
5. **M3, a quitter's penalty.** Recommended option (c), behind `ranked.quitterWin`: score the win only when gserv saw the drop.
6. **M6, web 2v2.** Recommended: settle through the agreement rule, behind `ranked.web2v2Agreement`.
7. **Admin exposure.** Recommended: separate accounts (built), `ADMIN_LEGACY_AUTH` off after the first owner works, **TOTP for
   owners** before the console is ever public, and `/admin` on a **separate loopback or VPN listener**.
8. **Season reset rule.** Recommended: **soft reset, factor 0.5, at least 5 rated games**, placements restart at 3. Season length: a
   quarter if the ladder is active, otherwise keep 365 days.
9. **Awards and badges.** Recommended: yes, web page only.
10. **One board or two for Quick Match and lobby ranked 1v1.** Recommended: one board per edition, as today.
11. **Guests online.** Recommended: yes, unranked, a generated nick, `auth.guestEnabled` to switch them off.
12. **Member details.** Recommended: log in with a login name or email, kept apart from the game account's nick; claiming an existing
    WOL account into a member with its password counts toward the limit of one; game account nicks capped at the retail login
    field's width (F5A-3 measures 9 or 10 characters).
13. **N1, a native WOL path.** Recommended: park it; decide after R1 row 9 between `wolapi.c` with a C bridge in the native builds and
    classic login lines in the server (which retail installs would need anyway).
14. **S7, the Connection slider.** Recommended: leave it alone.
15. **Pool size.** Recommended: prove the five untested maps before adding any; say if you have favourite stock maps.
