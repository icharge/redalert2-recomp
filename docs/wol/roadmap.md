# WOL roadmap: gaps to a fully functional product

Audit of 14 November 2026 (recomp `web-port`, ra2web `feat/shared-ranked-release`, both local).
It supersedes the open items scattered over [quick-match.md](quick-match.md),
[matchbot.md](matchbot.md), [shared-ranked-server.md](shared-ranked-server.md) ("Known
limitations") and [shared-ranked-server-gap-analysis.md](shared-ranked-server-gap-analysis.md)
(its T0-T14 are implemented; what remains of them is listed here).

**The execution plan is [plan.md](plan.md)** (phase order, status, decisions) and **[tasks.md](tasks.md)** (one-session tasks with
files, tests, dependencies and effort; also the Postgres/MySQL and auto-migrate track, the web admin and the web launcher). This page is
the evidence register behind them.

Every row says how it is known. **Seen** = observed in code, a log or the database this
session. **Assumed** = from a document, not re-checked. **Open** = needs a real client.
Effort: S under an hour, M a day, L several days. Paths under `server/` are in `../ra2web`.

## Done in this pass

| # | What | Evidence | Commit (ra2web) |
|---|---|---|---|
| D1 | The five failing server tests were test bugs, not product bugs: three wrote replay fixtures to `/tmp` with `:` in the file name (invalid on Windows), two expected the `#WDTmatch` room for an unarmed `LIST 33`, which was removed on purpose because it polluted Custom Match | `bun test`: 586 pass, 5 fail before; the same files pass after | `e035cfb` |
| D2 | **Map pool.** Quick Match picks a random stock two-player map per match (YR `XMP21S2`, `XMP29U2`, `XMP31S2`; RA2 `MP21S2`, `MP29U2`, `MP31S2`). RA2 no longer plays the eight-player `MP32S8`. `QUICK_MATCH_MAPS` narrows the pool. `scripts/map-pool-scan.ts` reads size and digest from an install | Size is the file length; digest is the map's own `[Digest] 1=` line, not a file hash. Both rules reproduce the two records captured from real clients (`XMP29U2` 83573 / `QaYxyl...`, `MP32S8` 194911 / `0xhVrb...`). `quickMatchMaps.test.ts`, `nativeQuickMatch.test.ts` | `fbf8e32` |
| D3 | **Ghost queue entries.** The retail dialog ends a search 180 s after the last `Working`; a lone player's entry then stayed queued with no dialog behind it. Each 15 s reminder now repeats `Working` | `matchbot.md` "Known gaps" said so; test with a 20 ms reminder | `9792507` |
| D4 | **Duration exploit.** Settlement took the minimum of the clients' durations, so a loser could report 10 s and force `too_short` (terminal, not adjudicable), and a pair could report a long duration for a match that ended at once. It now takes the longer claim, capped by the server-observed time from admission to the last report | `Settlement.settle`; two new tests on both backends | `ffd641c`, harness fix after it |
| D5 | `bun test` wrote its fake players into the real `data/server.log` (found: `alice`/`bob` lines at 20:31 in the log) | log size unchanged across a run after the fix | `864d391` |

| D6 | **Settings as data.** A `settings` table and a `SettingsService` hold the operator's overrides of the environment; live ones apply to the running server, restart-only ones are flagged. The Quick Match map pool is a setting (per edition and mode, weights, on/off; an uploaded map's size, digest and slots are read from the file). Every change writes an `audit_log` row | `bun test` 627 pass, `tsc` clean; `settings.test.ts`, `adminSettings.test.ts`, `quickMatchMaps.test.ts` on memory and SQLite | `ec585c7` |
| D7 | **Admin accounts with roles.** An `admin_users` table (viewer, moderator, admin, owner) separate from game accounts; login with a per-account lockout (5 failures, 15 min) and a per-address limit; sessions in memory (30 min idle, 8 h absolute) delivered as an `HttpOnly; SameSite=Strict; Path=/admin` cookie plus a CSRF token, or as a Bearer for scripts; every route checks the role (viewer reads, moderator bans and adjudicates, admin changes live settings, owner changes restart-only ones); logins and failures are audited, never with the password; `bun scripts/admin-user.ts create <name> --role owner` makes the first owner and there is no default credential. The game-account `ADMIN_USERNAMES` login still works as owner until `ADMIN_LEGACY_AUTH=false` | `adminAuth.test.ts` (20 tests: roles, lockout, expiry, cookie and CSRF, bearer, role gates, legacy switch, no accounts means nothing reachable); `bun test` 647 pass, `tsc` clean | `68318fe` |
| D8 | **Backup and public seasons.** `bun scripts/backup.ts` writes a consistent copy with `VACUUM INTO` while the server runs, checks it (`integrity_check`, account count) and only then prunes to the newest N; `GET /seasons[?sku=]` lists seasons with the slug the leaderboard route takes | `backup.test.ts`, `seasonsApi.test.ts`; ran the script against a real database file | `a363c2f` |

## Platform work (scope added 14 Nov): ranked plan

Ordered as requested: foundations, then map pool and seasons, then co-op, then the rest. Design and status are in
[admin-and-config.md](admin-and-config.md), [members-and-sso.md](members-and-sso.md), [seasons.md](seasons.md),
[co-op.md](co-op.md) and [operations.md](operations.md). Effort: S under an hour, M a day, L several days.

| # | Item | State | Effort | Depends |
|---|---|---|---|---|
| **Foundations** | | | | |
| P1 | Config store (settings as data, restart flags, audit) | **done** (D6); more keys are one entry each | S per key | |
| P2 | Admin auth: separate admin accounts, roles, cookie sessions, CSRF, lockout, no default credentials; threat model | **done** (D7); TOTP, admin-user management screen and the loopback-only listener are not built | L | P1 (audit) |
| P3 | Member model, launch ticket and redeem endpoint, migration of `accounts` | designed; needs decisions 1-4 of [members-and-sso.md](members-and-sso.md) | L | P2 (shares the password and session code) |
| P4 | Ordered migrations (`schema_version`) and backup/restore (M7) | backup script **done** (D8); `schema_version` migrations and the scheduled daily backup are designed, not built | M | |
| **Map pool and seasons** | | | | |
| P5 | Map pool: data, weights, on/off, size and digest from the file, per-map validation | **done** (D6); admin UI page missing | S for the page | P1 |
| P6 | `GET /seasons`, archived flag on the leaderboard (SE4) | `GET /seasons` **done** (D8); the `archived` flag waits for P7's states | S | |
| P7 | Season states, scheduler, archive snapshot, soft reset policy (SE1, SE3, SE7) | designed; decision on reset rule | M | P6 |
| P8 | Leaderboard page and awards (SE2, SE6) | designed | M | P7 |
| **Co-op** | | | | |
| P9 | One real run of Quick Co-op to learn the record | **done in effect**: two clients played `C1A01MD` to the score screen after three record fixes ([co-op.md](co-op.md)); the campaign line and "Next Mission" stay open (tasks C-1, C-2) | S | |
| P10 | Lobby 39 + co-op queue (type 141), unranked, behind a switch | **built** (ra2web `f282661`, `7f69afc`, `e2e4676`) | M | P9, P5 |
| **The rest** | | | | |
| P11 | Admin web UI screens: settings, map pool, audit, live queues, bans/mutes/kicks, disputes, announcements, health | API partly done | L | P2 |
| P12 | `/metrics`, health page, `.env.example` generated from config, README checklist | designed | M | |
| P13 | Launcher side: shim reads `#ticket=` and `RA2_LAUNCH_TICKET`; launcher login, email, OAuth | designed | L | P3 |
| P14 | More settings keys: queue rules, per-queue ranked, game speed, lobbies | one entry each | S each | P1 |

What blocks a "fully self-managed" server, in order of value: **P2** (an admin that is not a game account, plus a real audit),
**P4** (a backup you can restore), **P7** (seasons that end and start without a person), then **P3**.

## Must-have: not yet "fully functional"

| # | Gap | Evidence | Impact | Effort / risk | Verify | Depends |
|---|---|---|---|---|---|---|
| M1 | **No RA2 Quick Match has been scored.** Both recent RA2 matches ended `unscored too_short` (18 s and 91 s games, minimum is 120 s); the first play-through is still `pending` from before the GSKU fix | Seen: `ladder_admissions` rows `g1-mwfd8tw5`, `g1-mwff6p84` (16640, `too_short`), `g1-mwfcun8h` (`pending`) | The RA2 report path is proven to be accepted, but the score and rating change are not | S, no risk. Needs a person: play RA2 Quick Match for over two minutes with two clients, report both | `GET /players/<name>` shows a win and a changed rating; admission state `scored` | none |
| M2 | **The five new pool maps are untested on real clients.** The digest rule is checked on two maps (one per edition); the other five follow the same rule | Seen: scan reproduces both captured records. Open: no client has loaded `XMP31S2`, `XMP21S2`, `MP21S2`, `MP29U2`, `MP31S2` | A wrong digest makes both clients leave with "scenarios do not match" | S per map, low risk: set `QUICK_MATCH_MAPS=<one map>` and play | Both clients reach the first frame; server log `quick match map <name>` | D2 |
| M3 | **A player who quits is not penalised.** One report never awards a win (decision 3), so a loser who closes the game before reporting leaves the match `incomplete` | Seen: `Settlement.expire` gives `one_report` / `no_reports`; `docs/ranked-ladder.md` "What does NOT score" | Rating can be protected by quitting; the main ranked-integrity gap | M. **Decision for the user** (see below) | Test: winner reports, loser never does, grace passes | none |
| M4 | **Real retail installs are untested.** Only the recomp's lifted clients have played Quick Match. An original install uses the real `wol.dll`/launcher. **Seen 14 Nov:** the server accepts only `cvers`, `setlocale`, `getlocale` and `session <token>` before login (`WolServer.handleLine`), so a retail `wol.dll`'s own login lines are probably refused; N1 in [tasks.md](tasks.md) | Assumed (`quick-match.md` "Not verified") | If it differs, Quick Match fails for the people the server is for | Open; needs a retail install | One real install in a Quick Match against a recomp client | none |
| M5 | **`FINI=0` is untraced.** The server scores whatever `FINI` both reports agree on; the retail client's behaviour when a game ends without a result is unknown | Assumed (`quick-match.md`) | A game ended by a disconnect might be reported as a win or loss in a way the server cannot tell apart | M to trace in `sub_` of the report builder, or observe by playing | Capture a report from a dropped game | none |
| M6 | **Web 2v2 still scores from one report** through the old path | Assumed (`shared-ranked-server.md` "Known limitations") | One player can claim any result for a web 2v2 | M. 2v2 settlement needs a roster-wide agreement rule (decision) | Test with a lone winner report | decision on team rule |
| M7 | **No scheduled backup** of the SQLite database. Only the SKU migration takes a `.bak` | Seen: `data/` holds one migration `.bak` and no job; `server/README.md` mentions backup only for rollback | Ratings and history are a single file | S. A `VACUUM INTO` or `sqlite3 .backup` job plus a restore note | Restore into a scratch folder and read the leaderboard | none |
| M8 | **No metrics endpoint.** `/health` exists; queue length, match outcomes and settlement counts are only in log lines (`settlement: state counts ...`) | Seen: `routes.ts` `/health`; no `/metrics` | Cannot alert on stuck queues or a pile of `pending` | M | `curl /metrics` | none |

## Should-have

| # | Gap | Evidence | Effort | Notes |
|---|---|---|---|---|
| S1 | Random start position (`-2`) is resolved by the game, so the loading screen may show it wrongly | Assumed (`quick-match.md`) | S to observe | With two-player maps a wrong display is cosmetic only |
| S2 | COU numbering vs the record's side field: the log line `quick match sides ... (asked: ...)` shows what was asked and written, but no real pick has been compared with the game's loaded side | Seen: the log line exists. Open: no comparison | S | Pick Soviet in the dialog, read the log, compare in game |
| S3 | **YR 60 fps** under Quick Match was never measured; the speed field's place is not traced in the game | Assumed (`nativeGameOpts.ts` header) | S | Use the frame counter against `server.log` timestamps |
| S4 | Custom Match after the shim lobby-filter change (lobbies 39/40 pass the filter) | Assumed | S | Start a Custom Match in YR, check it joins the main lobby |
| S5 | Lobbies 39 and 35 (mode word 2) are not published; no run has produced that mode | Assumed | M, needs the mode word trigger | Only matters if a client reaches it |
| S6 | RA2 login-failure message needs an RA2 rebuild (production bundles: `./build-web.cmd --mode all --edition both`) | Assumed (previous session) | M (build time) | Fast RA2 build first (`--mode fast --edition ra2`) |
| S7 | "Connection" slider (GOptions latency fudge, `3 - slider`, overwritten at match start from max ping, thresholds 600/1000 ms): no INI key found | Assumed | S to decide | **Decision for the user**: leaving it alone is the safe default (a forced fast setting risks stalls) |
| S8 | Adjudication skips the season-grace check, and a win/loss adjudication needs an explicit `winner` | Assumed (`shared-ranked-server.md`) | S | Documented behaviour; decide whether to enforce the grace |
| S9 | Vera: the 3-rated-games-per-24h limit is not implemented; `GET /v1/matches/{id}` is memory-only for 10 minutes; rematches in the same paired room rank | Assumed | M | Vera is the sibling client's contract |
| S10 | The matchbot's countdown is a fixed 10 s even when both players are ready; no gserv at match time requeues no one (`Requeue` and the entries are dropped) | Seen: `matchbot.md` "Known gaps" | S | Cosmetic and a rare failure path |
| S12 | `errorReport.test.ts` flakes in a full run (shared `tmp-error-reports` folder) | Seen: 1 failure in one full run, 12/12 alone three times | S | Give each test its own `mkdtempSync` folder |
| S11 | UDP relay admission/renewal and a native recording (replays) are unconfirmed against real clients | Assumed (`shared-ranked-server.md`) | M, needs clients | Replay playback is not promised across engines |

## Nice-to-have

- A matchmaking queue that reports its player count in the retail dialog (`Pool <n>` is a reply the game
  parses; not used).
- A rotating or seasonal map pool, and a per-player veto; needs `maps/` data and a UI.
- A native ladder screen: excluded by decision 5. The four ladder COM methods remain stubs
  (`WolChannel::RequestLadderSearch` and `RequestLadderList` are `m_stub_10`/`m_stub_8` in `src/web/wolapi.c`).
- A web page for adjudication and for a live queue view (the admin routes exist, no UI).
- More pool maps. The scan names only the maps that follow the `MPnnSx`/`XMPnnUx` pattern; about 30 more
  two-player maps in `MultiMD.mix` are present by hash but unnamed, and the `.mmx` standard maps (Arena, Dustbowl
  and others) are a different file layout whose record form is not captured.

## Decisions that are yours

1. **M3, a quitter's penalty.** Options: (a) keep it, a missing loser report is unscored (today, safest
   against false losses); (b) score a win when one player reports a win and the other disconnected before
   the game's end and never reported, by the server's own disconnect record; (c) as (b) but only with
   a gserv-observed drop. I recommend (c): the server already sees the connection drop.
2. **S7, the Connection slider.** Leave it, or force the fast setting at match start.
3. **M6, 2v2.** Settle web 2v2 through the same agreement rule, or leave it casual-only.
4. **Pool size.** Three maps per edition is a start. Say which stock maps you want if you have favourites;
   each needs a real two-client run (M2).
5. **Launcher sign-in: decided 14 Nov, recommendation accepted** ([members-and-sso.md](members-and-sso.md)); original options: email required, optional or none; permanent nick or
   rename (rating key); one session per member or per device; require a member for ranked eventually; OAuth providers;
   ticket delivery (env var and URL fragment, recommended, or a local pipe).
6. **Admin split** ([admin-and-config.md](admin-and-config.md)): separate admin accounts with roles (recommended) or the
   current `ADMIN_USERNAMES` plus the audit trail only; whether the console is reachable from the public internet; TOTP for owners.
7. **Seasons** ([seasons.md](seasons.md)): reset rule (recommended: soft, factor 0.5, at least 5 games), badges or not, one
   board for Quick Match and lobby ranked or two, season length.
8. **Co-op** ([co-op.md](co-op.md)): in scope or a "not hosted" message; ranked or not (recommended: not); which missions.

## What I could not verify

Everything marked **Open**: no clients were run in this pass. The server was tested with its own
suite (the numbers below), the matchbot with fake sockets, and the map digests against the two records
captured earlier.

## Tests

`cd ../ra2web/server && bun test` and `bunx tsc --noEmit -p .`. Before this pass: 586 pass, 5 fail. After it:
**602 pass, 1 fail** in the full run, `tsc` clean. The one failure is
`POST /errorreport > two desync reports for the same gameId ...`, which passes alone (three runs, 12/12) and
failed in one full run: a test-order or timing flake in `errorReport.test.ts`, which shares the folder
`test/tmp-error-reports` between tests. It is unrelated to this work and not yet fixed (S12).

The first full run after D4 had ten failures in `wgameres.test.ts`: its harness reported a 300 s game at the
instant of admission. D4 is meant to refuse exactly that, so the harness's clock now passes 300 s first.
