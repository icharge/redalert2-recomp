# Server settings and the admin platform

Status of 14 Nov 2026. **Implemented** (ra2web `ec585c7`, `68318fe`): the settings store, the Quick Match map pool as
data, the audit trail and their admin routes, and admin accounts with roles, cookie and bearer sessions, CSRF and lockout.
**Designed, not built:** TOTP, admin-user management in the console, a separate admin listener, and the admin web UI
beyond what exists (see "Console login"). Paths under `server/` are in `../ra2web`.

## Configuration layers

| Layer | Where | Who changes it | Takes effect |
|---|---|---|---|
| Built-in default | `server/src/config.ts` | a developer | next build |
| Environment and `.env` / `.env.local` | process env, files beside `server/` | the operator, on the host | restart (or `kill -HUP`) |
| **Runtime override** | `settings` table in the database | an admin, from the console or the API | at once for a live setting; next boot for a restart-only one |

The environment is the base. An override wins over it; deleting the override returns the setting to the
environment's value. A `SIGHUP` reload re-reads the environment and then puts the overrides back, so a reload
can never undo an admin's change. Secrets and anything that decides where the server listens stay environment-only
(`ADMIN_USERNAMES`, `VERA_ADMIN_KEY`, `VERA_RELAY_TICKET_KEY`, `DB_PATH`, `SERVER_PORT`): they are not in the table
and cannot be read through the API.

## What can be set at runtime

`GET /admin/settings` lists every setting with its running value, its default, whether it is overridden, and
whether a restart is needed. `PUT /admin/settings/{key}` with `{"value": ...}` sets one; `DELETE` resets it.

| Key | Type | Live | Notes |
|---|---|---|---|
| `ranked.nativeEnabled` | bool | yes | Retail Quick Match counts for the ladder (`NATIVE_RANKED_ENABLED`) |
| `ladder.startingRating` | 0-5000 | yes | |
| `ladder.placementMatches` | 0-100 | yes | |
| `ladder.minReportDurationSeconds` | 0-3600 | yes | Shortest game that scores |
| `ladder.seasonGraceSeconds` | 0-86400 | yes | |
| `limits.loginMaxPerMin`, `limits.registerMaxPerHour` | 1-10000 | yes | Rebuilds the rate limiters |
| `welcome.motd` | up to 20 lines of 200 | yes | Shown at sign-in (also Vera's welcome) |
| `quickMatch.pool` | list of maps | yes | See below |
| `net.wolTcpPort` | 1-65535 | **restart** | Example of a restart-only setting; stored and shown as pending |

Every write is validated first (type, range, per-map rules) and refused with a message that names the setting; nothing
is stored on a refusal. A stored value that no longer validates after an upgrade is skipped at boot with a warning, not
fatal. Not yet in the table, and the order they should be added in: queue rules (pair window, rating spread), ranked
on/off per queue, game speed, per-channel lobbies, minimum report length per mode. Each is one entry in
`SETTING_DEFS` (`server/src/settings/SettingsService.ts`) plus one line wiring its consumer, if the consumer copies the
value at start (as `LadderService` did, fixed by `updateSettings`).

## The Quick Match map pool

A pool entry is `{edition, mode, stem, slots, size, digest, enabled, weight}`. `mode` is `quick` (1v1 Quick Match) or `coop`
([co-op.md](co-op.md)). The pick is random by weight over the enabled maps of the edition and mode; an empty pool falls
back to the built-in maps so the queue is never empty.

`POST /admin/quick-match/maps?edition=yr&stem=XMP29U2[&mode=quick][&weight=1]` with the `.MAP` file as the body adds or
replaces a map. The server reads the file itself: `size` is its length, `digest` is its own `[Digest] 1=` value, `slots` is
`[Header] NumberStartingPoints`, and it refuses a file with no digest, fewer than two start points or over 4 MiB. Nobody
types a size or digest, so a wrong digest ("scenarios do not match") cannot come from a typo.
`POST /admin/quick-match/maps/{edition}/{stem}` with `{"enabled":false,"weight":3}` edits one;
`DELETE` removes it; `GET /admin/quick-match/maps` lists them. The CLI equivalent for reading an install is
`bun server/scripts/map-pool-scan.ts <game dir> --probe NAME.MAP`.

A map enters the pool unproven. Whether a real client loads it is [roadmap M2](roadmap.md): add it with a low weight or
disabled first, try it with two clients, then enable it.

## The audit trail

Every settings and pool change appends a row to `audit_log` (time, actor, action, target, old and new value as JSON);
`GET /admin/audit?limit=&before=` pages it newest first. It is append-only through the API. The same table takes the
other admin actions as they are moved onto the service (bans, mutes, adjudications, season changes: today these
write only a log line or their own table).

## Admin platform design

### Today

The console is a React app (`ra2web/admin`) over `/admin/*`. An admin is **a game account** whose name is in
`ADMIN_USERNAMES`, authenticated by the game's bearer session token. That is the weakest part: a stolen game password
is an admin takeover, there are no roles (any listed name can do everything, including closing a season or deleting a map),
and the audit is a log line.

### Console login (built)

| Route | Use |
|---|---|
| `POST /admin/auth/login` `{username, password}` | Sets the `ra2admin` cookie (`HttpOnly; SameSite=Strict; Path=/admin`, `Secure` over HTTPS) and returns `{username, role, token, csrfToken}`. A wrong password and an unknown name give the same 401; a locked account gives 429 |
| `GET /admin/auth/me` | Who the session is, its role and its CSRF token |
| `POST /admin/auth/logout` | Ends the session and clears the cookie |

A browser sends the cookie and puts `csrfToken` in `X-CSRF-Token` on every change; a script sends `Authorization: Bearer <token>`
and needs no CSRF header. Accounts are made from the host: `bun scripts/admin-user.ts create|list|password|disable|enable`
(password from `--password-file`, `ADMIN_PASSWORD` or a prompt, at least 12 characters). The role a route needs comes from its
method and path (`requiredPermission` in `http/adminAuthRoutes.ts`): reads need `viewer`; ban, unban and adjudication need `moderator`;
every other change needs `admin`; a restart-only setting needs `owner`. Differences from the target below: sessions are not bound to
the `Origin` header, there is no per-username limiter beyond the lockout, and the WDT operator routes accept any `admin` or `owner`
session. The React console (`ra2web/admin`) signs in through `/admin/auth/login` and falls back to the game-account login, and then
uses the token as a Bearer, so it does not use the cookie or CSRF path yet; it has no screen for managing admin users.

### Target

| Concern | Design |
|---|---|
| Separate identity | `admin_users(username, password_hash, role, disabled, created_at, last_login_at, failed_logins, locked_until)`; never a game account. Argon2id through `Bun.password` |
| First admin, no default credentials | The server never ships or creates one. `bun scripts/admin-user.ts create <name> --role owner` reads the password from a prompt or `--password-file`, refuses fewer than 12 characters, and prints nothing. With no admin the console answers "not configured" |
| Roles | `owner`, `admin`, `moderator`, `viewer` (matrix below). Checked per route, not per page |
| Sessions | Random 32-byte token in an `HttpOnly; Secure; SameSite=Strict` cookie scoped to `/admin`; 30 minutes idle, 8 hours absolute; kept in memory so a restart signs everyone out; "sign out everywhere" and password change revoke all |
| CSRF | State-changing requests need an `X-CSRF-Token` header equal to a value issued at login (double submit, bound to the session); `SameSite=Strict` is the second layer; `Origin` must match the admin origin |
| Brute force | The login limiter keys by address **and** by username; five failures lock the account for 15 minutes; the failure and the lock are audited; the response never says which half was wrong |
| Audit | Every state change writes `audit_log` (who, what, old, new, source address) before returning; rows are never edited or deleted through the API |
| Input validation | One validator per route body, as the settings do; request bodies are size-bounded (`bodyLimit.ts`); map files and replays are parsed, never executed |
| Secrets | In the environment only, never returned by an API, never logged; the console shows "set / not set" |
| Transition | The old bearer route keeps working while `ADMIN_LEGACY_AUTH` is not `false`, mapped to the `owner` role, so nothing breaks when this ships; the owner turns it off once their admin user works |

Permission matrix (`x` = allowed):

| Capability | viewer | moderator | admin | owner |
|---|---|---|---|---|
| Dashboard, matches, players, replays, audit (read) | x | x | x | x |
| Kick, mute, ban, unban | | x | x | x |
| Adjudicate or void a match, rescore | | | x | x |
| Seasons: create, edit, close, soft reset | | | x | x |
| Map pool, announcements, live settings | | | x | x |
| Restart-only settings, admin users, secrets view | | | | x |

### Threat model (short)

| Threat | Today | Mitigation in the target |
|---|---|---|
| Game-account takeover becomes admin | open | separate admin identity, lockout, optional TOTP later |
| Stolen admin token replayed | bearer token, 24 h, usable from anywhere | cookie, short idle timeout, CSRF token, Origin check |
| Cross-site request forgery | not exposed (bearer header) but the console must not move to cookies without CSRF | the CSRF design above is a condition of moving to cookies |
| An insider changes ratings unseen | log lines only | audit trail with old and new values; viewer role for read-only staff |
| Malicious map upload | none (maps are data) | `describeMap` reads text only; size cap; never loaded by the server |
| Setting that bricks the server | n/a | validation with ranges; restart-only values for ports; reset to the environment's value is always one call |
| Admin API exposed to the internet | same origin as the game API | optional `ADMIN_LISTEN` on a separate port or a path allow-list at the reverse proxy (documented in [operations.md](operations.md)) |
| Rate limits hide an attack | per-IP limiter | per-username limiter, lock, alert line in the log |

### Admin web UI: what exists and what it needs

Exists in `ra2web/admin`: dashboard, seasons, matches, replays, players and maps (read from the routes above).
Missing, in order: settings page and map-pool page (the API is done), audit log view, live queue view, bans/mutes/kicks
(the WOL server has the commands; no admin route), dispute and adjudication screen (route exists), announcements, server
health and log tail, admin-user management. The UI is thin: every screen is one of the routes above, so the API is built first.

## Decisions that are yours

1. Admin split: build separate admin accounts (recommended) or keep `ADMIN_USERNAMES` and add only the audit trail.
2. Whether the admin console may be reachable on the public origin, or only on a loopback/VPN port.
3. TOTP for owners (recommended before the console is on the public internet).
4. Who gets which role, and whether a moderator can ban without a second approver.
