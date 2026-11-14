# WOL shared server: execution plan

Status of 14 Nov 2026, checked against the code the same day. One plan for the whole scope: a configurable, self-managed
shared ranked server, a map pool and seasons, Yuri's Revenge Quick Co-op, a secure admin web and configuration, a pluggable database
(SQLite by default, Postgres or MySQL when configured) with an auto-migrate tool, members with a web launcher and WOL auto-login, a
lobby bot (YuriBOT) for help, announcements and slash commands, and the gaps left in
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
| **DB. Storage engines** | SQLite by default; Postgres and MySQL when configured | DB3 async storage, DB4 Postgres, DB5 copy tool, DB6 backups, DB7 MySQL | DB3 between phase 0 and phase 1, so the season and member storage of phase 1 is written async once; it touches every storage caller, so nothing else on the server runs during it |
| **1. Pool, seasons, ranked integrity** | The ladder runs itself, cannot be gamed by quitting, and players can see it | M1 pool proof (R1), SE seasons, G1-M3 quitters, G1-M6 web 2v2, G1-S8 | Seasons need the settlement timer and (for the reset policy) a migration. M3 and M6 are moved here from phase 3, behind settings, because "fully functional ranked" depends on them |
| **R. Real-client session** | Close the **Open** items | R1 (two clients), R2 (browser) | **After phase 1** (decision 2). Until then M1 (no RA2 match has scored), the five unproven pool maps and the co-op follow-ups stay **Open**, and phase 1's rules are proven by tests only |
| **LW. Web launcher and members** | Welcome, bring-your-own-game guide, guest or member, WOL auto-login | LW-1..LW-8, MB-1..MB-3, GU-1 | The welcome page and the guide need no server and start now; members need slice A's tickets |
| **2. Co-op** | Quick Co-op on by default, then finish it | C-0 switch on, C-1..C-4 | Turned on now (decision 4); "Next Mission" and score-screen chat are fixed as found, the rest needs R1 |
| **AW. Web admin and configuration** | Every admin task in the console, with roles | AW-0..AW-13, K1 keys | AW-0..AW-4 can start in phase 0 (their APIs exist); the rest follow the APIs they show |
| **LB. Lobby bot, YuriBOT** | Help, greetings, announcements, reports and `/commands` in the chat lobbies; linked moderators act from the lobby | LB-0..LB-8 | LB-0 (does the game pass a `/` line on?) starts now; the core after phase 0's settings tasks; announcements of season events after SE-1; moderation shares one service with AW-6 |
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
Origin check, not on the user routes: `GET /admin/auth/me` already exists); TOTP for owners; the cut-over. **Decided (decision 6):
the console is served on the public site behind TLS, with TOTP for owners.** So it goes public only after F2-3 (Origin), F2-4 (no bearer
in `localStorage`) and F2-5 (TOTP) are in; until then it stays behind loopback, a VPN or a proxy allow-list. The separate admin
listener (F2-6) is no longer planned. The cut-over (F2-7) comes last.

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

**Native delivery (`RA2_LAUNCH_TICKET`): dropped (decision 10, online play is web only).** **Seen:** `wolapi.c` is compiled only
into the Emscripten target (`CMakeLists.txt:111`), not into the Linux target (`:94`) or the Windows build, and `src/runtime/host.c` has
no WOL code (its "launcher emulation" is the launcher mutex). The server accepts only `cvers`, `setlocale`, `getlocale` and `session`
before login. So no native build reaches this server, and none is planned to.

**Slices B and C** are replaced by the launcher track (below). **Slice D** (email verification and reset, `SMTP_URL`) and **slice E**
(OAuth, not wanted until the launcher exists) stay later and unchanged. **Slice F** (`ranked.requireMember`) is not planned (decision 1).

### F6. Housekeeping (tasks F6-1, F6-2)

The flaky and timing-out tests (above), and a test that `LadderService.updateSettings` applies live. Put each new environment
variable in `server/README.md` as it lands (O1-2 later generates the full list).

## R. The real-client sessions

R1, **after phase 1** (decision 2; tasks.md has the rows): the five unproven pool maps (M2), the first scored RA2 match (M1), the
quitter rule G1-M3 and the web 2v2 rule G1-M6 as built, a report from a dropped game (M5), sides (S2), YR frame rate (S3), and co-op
"Next Mission" and score-screen chat. R2, in a browser, checks the ticket and auto-login paths as soon as they exist. A retail install
(M4) is no longer in it: online play is web only.

## Track DB: SQLite by default, Postgres and MySQL when configured

**Decided (decision 3):** SQLite stays the default; Postgres and MySQL are both supported and chosen by configuration
(`STORAGE_ENGINE=sqlite|postgres|mysql`, `DATABASE_URL`). **Seen:** `Storage` (`server/src/storage/Storage.ts`, about 61 methods) is
fully synchronous over `bun:sqlite`, with 124 call sites in seven files outside storage plus their callers. Networked drivers are
asynchronous, so the first step is **DB3: make `Storage` async** (L, mechanical, wide; one connection's WOL lines must stay in order).
Then **DB4** a `PostgresStorage` over `Bun.SQL` (**Assumed:** Bun 1.3.13's `Bun.SQL` has the Postgres and MySQL clients this needs;
DB4 checks first) with one storage contract suite run on every engine; **DB5** a `db-copy` tool from SQLite to either engine; **DB6**
backups for networked engines (`pg_dump`, `mysqldump`; the scheduler reports "external"); **DB7** a `MysqlStorage`.

## Phase 1: map pool, seasons and ranked integrity

**M1. Map pool: built for data and admin API** (`fbf8e32`, `ec585c7`, `7f69afc`). Left: the proof on real clients for `XMP31S2`,
`XMP21S2`, `MP21S2`, `MP29U2`, `MP31S2` (R1 rows 1-2; a wrong digest ends with "scenarios do not match"), the console page (AW-3). More
maps only after that proof; about 30 two-player maps in `MultiMD.mix` are unnamed by hash and `.mmx` maps use an uncaptured layout
(Assumed).

**SE. Seasons: partly built.** Exists (Seen): per-season standings and history, season bound at admission, grace after the end,
admin create, edit and close, the public leaderboard and player routes, `GET /seasons`. Left (SE-1..SE-5): states, scheduler and
archive snapshot; reset policy (a column change, so it needs DB1), **soft, factor 0.5, at least 5 rated games, placements restart at 3**
(decision 7); awards, shown on the web page (decision 8); `GET /seasons/{sku}/{id}` and the archived flag; the leaderboard page. One
1v1 board per edition stays (decision 8), so per-mode boards are not planned. **Care in SE-1:** "current" today is the newest season by `start_time`, so a scheduled future season
must not become current early.

**G1. Ranked integrity, moved into this phase behind settings** (rules decided, decision 5).

| Item | State | Task | Setting |
|---|---|---|---|
| M3 quitter not penalised | not started | G1-M3: score the win when one player reports a win, the other never reported **and** gserv saw the drop | `ranked.quitterWin` (on once tested) |
| M6 web 2v2 on one report | not started | G1-M6: roster-wide agreement through `Settlement` (every reporter agrees on the winning team) | `ranked.web2v2Agreement` |
| Guests in a match | not started | GU-1: a match with any guest in its roster is not admitted, so nobody in it is scored | |
| S8 adjudication skips the grace | documented | G1-S8: enforce it or record an override reason | |
| M5 `FINI=0` | not traced | R1 row 5 | |

## Track LW: the web launcher, members and WOL auto-login

The recomp web launcher exists (`web/src`: Shell, Play, Mods, Game, Settings, and the Install screen `screens/Import.tsx`).
It gets:

- a **welcome page** and a **bring-your-own-game (BYOG) install guide**: where the game folder is for each source (CDs, The First
  Decade, EA App/Origin, Steam), what is copied, and that it stays in the player's browser;
- **guest or member**: guests play offline at once, and online under **any name that no account and no player online already uses**
  (decision 9). A guest is never scored, and **a match with a guest in it is scored for nobody**. A **member** (the person) owns
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

**Decided (decision 4): in scope, unranked, on by default now** (task C-0 flips the default; `YR_COOP_ENABLED=false` or the
setting still turns it off). Publishing lobby 39 makes the retail button live instead of "Matching Server Not Found", so players will
reach the parts not yet checked. **Left** (C-1..C-4): the cooperative campaign line (not sent, its wire form unknown, not needed for
`C1A01MD`); "Next Mission" after the score screen (not exercised; a player who presses it may hit a dead end); chat on the score screen
(a UDP datagram through the relay, logging added, cause open); more missions.

## Track AW: web admin and configuration

The console (`ra2web/admin`) has dashboard, seasons, matches, replays, players and maps screens in one `admin/src/main.tsx`. In
order: split it into a file per screen (AW-0, so screens are separate writers), the cookie sign-in (AW-1 = F2-4), the settings page
(every key rendered from its definition, so new keys need no console work), the map pool page, the audit view, admin users, kick,
mute and ban, seasons admin, disputes, live queues, announcements, health and logs, **configuration export and import** with a dry-run
diff, and a read-only environment view (secrets only as "set / not set"). Settings keys (K1) are added in batches, since they all
write `SettingsService.ts`. Env-only by design: the storage engine and its URL, ports, secrets, `AUTO_MIGRATE`.

## Track LB: the lobby bot, YuriBOT

A bot in the chat lobbies, in the spirit of XWIS's: it greets players, answers `/help`, `/rules`, `/rank`, `/top`, `/season`,
`/online`, `/queue` and `/maps`, takes `/report`, makes scheduled and event announcements (and the console's announcements go out as
YuriBOT), and lets a moderator whose game nick is linked to an admin account `/mute`, `/kick` and ban for up to 24 hours from the
lobby, each audited. **Seen:** `matchbot` is already a virtual user (listed in the Quick Match lobbies' NAMES, private messages to it
routed in `WolServer.handlePrivmsg`), so YuriBOT follows that pattern, listed in the chat lobbies only and never as operator. The web shim
reads a sender's nick as at most 9 characters (`wolapi.c:672`), and `/me` actions are stubs. **Open:** whether the retail chat box
passes a typed `/help` on as text (LB-0); if it does not, paging YuriBOT always works. A game login has no TOTP, so moderation from
the lobby is limited to time-limited, moderator-level actions; a permanent ban stays in the console.

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
| A native build can reach the server | **Seen: no.** `wolapi.c` is web-only; `host.c` has no WOL code; the server takes only `session <token>` before login. Not planned (decision 10) |
| A retail install can log in through the TCP gateway | **Open**, likely not for the same reason; not planned (web only) |
| The game's own auto-login path exists | **Open** (LW-7a) |
| The admin console works with the new login in a browser | **Assumed**: typechecked and the API is tested, the UI was not run |
| `LadderService.updateSettings` applies live | **Assumed** (F6-2 adds the test) |
| Migrations, scheduled backup, season lifecycle, members, launcher pages | **Not started** |

---

## Decisions

### Taken (14 Nov 2026, by you)

1. **Launcher sign-in.** Launch ticket (60 s, single use, redeemed over HTTP by the shim), delivered by the `#ticket=` URL
   fragment; email optional; permanent nick (the game account's); one live game session per member (with the limit of one game
   account, the same as one per game account); no member required for ranked; no OAuth until wanted. The native
   `RA2_LAUNCH_TICKET` delivery is withdrawn by decision 10.
2. **The real-client session runs after phase 1.** Until then M1, M2 and the co-op follow-ups stay **Open**, and phase 1's rules are
   proven by tests only.
3. **Storage engines: SQLite is the default; Postgres and MySQL are both supported**, chosen by configuration
   (`STORAGE_ENGINE`, `DATABASE_URL`). DB3, DB4 and DB7 are all in scope.
4. **Quick Co-op: in scope, unranked, on by default now** (C-0). "Next Mission" and score-screen chat are fixed as they are found.
5. **Ranked integrity:** a quitter loses only when gserv saw the drop and the other player reported a win (`ranked.quitterWin`);
   web 2v2 scores only when every report agrees on the winning team (`ranked.web2v2Agreement`).
6. **Admin console on the public site, with TOTP for owners.** Public only once the Origin check, the cookie console and TOTP are in;
   no separate admin listener.
7. **Season reset: soft, factor 0.5, at least 5 rated games**, placements restart at 3.
8. **Awards yes** (web page only), **one 1v1 board per edition**. Season length: a quarter if the ladder is active, otherwise 365 days.
9. **Guests** play offline at once, and online under **any name that no account and no player online already uses**, never scored;
   **a match with a guest in it is scored for nobody**.
10. **Online play is web only.** No native WOL path; the native launch ticket is dropped.

Taken later the same day, for the lobby bot (numbered on so the open ones keep their numbers):

15. **Commands are `/command`**, the line is not shown to the lobby, and the answer goes only to the asker. If the game does not pass
    `/` lines on (LB-0), paging the bot is the way in.
16. **Moderation through the bot: yes, by game nicks linked to admin accounts**, up to the admin account's role, time-limited, audited.
17. **The bot's name is `YuriBOT`** (a setting, restart-only, reserved from registration and guest names).

### Still open (the recommendation stands until you say otherwise)

11. **Member details.** Recommended: log in with a login name or email, kept apart from the game account's nick; claiming an existing
    WOL account into a member with its password counts toward the limit of one; game account and guest names capped at the retail
    login field's width (F5A-3 measures 9 or 10 characters).
12. **When DB3 (async storage) runs.** Recommended: right after phase 0, as a window with no other server task open.
13. **S7, the Connection slider.** Recommended: leave it alone.
14. **Pool size.** Recommended: prove the five untested maps (R1) before adding any; say if you have favourite stock maps.
