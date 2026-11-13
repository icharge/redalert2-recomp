# Members and launcher single sign-on: design

Status of 14 Nov 2026: **design for your decisions; one slice implemented** (see "What exists").
Nothing here changes how a client logs in today. The launcher does not exist yet, so this fixes the
contract it will be built against.

## What exists

| Piece | Today | Where |
|---|---|---|
| Account | `accounts(username, password_hash, created_at, banned)`; `Bun.password` hash; username unique, case-insensitive | `server/src/auth/accountStore.ts` |
| Register / login | `POST /register`, `POST /login` with `{user, pass}` returns `{user, sessionToken}`; rate-limited per IP | `routes.ts` |
| Session | opaque bearer token, one live session per user (a new login replaces the old), TTL `SESSION_TTL_SECONDS` (24 h) | `auth/session.ts` |
| WOL login | after HTTP, the line `session <token>`; a bad token, a banned account or an invalid nick gives `378` | `WolServer.handleSession` |
| Web client | `web/src/game/wol.ts` does `POST /register` then `/login` with the game's nick and password, then `session <token>` | |
| Retail login screen | nick and password fields, each at most **10 characters** (`login[10], password[10]` in `src/web/wolapi.c`); the shim forwards them to `Module.ra2WolStart(login, password)` | |
| Native build | `src/runtime/host.c` emulates the launcher; the classic TCP gateway on 6667 only takes `session <token>` | |
| Admin | a game session whose username is in `ADMIN_USERNAMES` | `adminRoutes.requireAdmin` |

Two facts shape the design. First, the retail screen cannot carry a token (10 characters), so the
ticket must travel **beside** the game's own fields, never through them. Second, the shim already
sits between the game and the server: it holds `g_login`/`g_password` and does the HTTP login. The
ticket exchange therefore belongs in the shim (web: the JS bridge; native: `host.c`), and the game's
own dialog stays a formality.

## Account model

```
members      id (uuid), nick, nick_key (lower, unique), email (unique, nullable),
             email_verified_at, password_hash (argon2id via Bun.password), status (active|suspended|banned),
             created_at, last_login_at, legacy (0|1)
identities   provider ("discord"|"google"|...), subject, member_id            -- optional OAuth, later
devices      id, member_id, label, created_at, last_seen_at, revoked_at        -- one per launcher install
refresh      token_hash, device_id, member_id, expires_at, rotated_from        -- launcher login, rotating
tickets      ticket_hash, member_id, device_id, edition, expires_at, used_at   -- game launch, single use
```

`accounts` migrates 1:1 into `members` (same nick, `legacy=1`, no email). The migration is additive: the
old table stays until a release after the migration, so a rollback is a config switch.

**Nickname rules** (the WOL protocol is IRC-like and the retail lobby lists render a narrow charset):
2-15 characters (already `MIN/MAX_USERNAME_LENGTH`), `A-Z a-z 0-9 _ - [ ]`, must start with a letter, unique
case-insensitively, a reserved list (`matchbot`, `admin`, `system`, `moderator`, the operator's own list) refused
at registration and at rename. One primary nick per member in v1; a rename is allowed once per 30 days and keeps
the old nick reserved to the member for 90 days (ratings are keyed by nick, see "Open: rating key").

**Email.** Optional by default, required to use the launcher's password reset. A verification mail carries a
single-use signed token (24 h); a reset token lives 1 h and is single use; both are stored hashed. Sending needs
SMTP settings (`SMTP_URL` and a from address); without them the admin can mark an address verified by hand. This
is a decision: email required, optional, or absent.

## Launcher login and the ticket

```
Launcher          Server                         Game (shim)
   | login (email|nick + password, or OAuth)           |
   |----------------->|                                |
   |<-- access token (15 min) + refresh token (30 d, rotating, per device)
   | POST /v1/auth/launch-ticket  {edition, device}    |
   |----------------->|  ticket: 32 random bytes, 60 s, single use, bound to member+device+edition
   |<-- ticket        |                                |
   | start game with the ticket (see "Delivery") ----->|
   |                  |<-- POST /v1/auth/redeem {ticket}
   |                  |--> {user, sessionToken}   (the same shape as /login)
   |                  |<-- session <token> over WOL as today
```

The server stores only the ticket's hash. Redeeming marks it used; a second use, an expired ticket, a
revoked device or a banned member is refused with one generic error. A redeemed ticket yields the normal
game session, so **nothing after login changes**: lobbies, matchbot, settlement and the ladder keep using the
nick and the session token.

**Delivery to the game** (command lines are readable by other processes, URLs are logged):

| Build | Channel | Reason |
|---|---|---|
| Native (host.c) | environment variable `RA2_LAUNCH_TICKET` set by the launcher on the child process; `host.c` reads and clears it, then redeems over HTTPS | not visible in the process list; only the child inherits it |
| Web | URL fragment `#ticket=...`; `web/src/game/wol.ts` reads and removes it (`history.replaceState`) before any request | fragments are not sent to servers, so they are not in access logs |
| Fallback | a named pipe or loopback listener the launcher opens; only if the env route proves unreliable | local IPC, more code |

With a ticket the shim **skips the login dialog**: it completes the login the way `host.c` already emulates
the launcher, with the member's nick. Without a ticket nothing changes: the typed nick and password still go to
`/register`/`/login`. That keeps retail installs, bots and Vera working until the operator chooses to require members.

## Expiry, refresh, revocation

| Credential | Lifetime | Revocation |
|---|---|---|
| Launch ticket | 60 s, once | consumed; not otherwise needed |
| Game session | 24 h (setting), one per member | logout, ban, "log out everywhere", password change |
| Access token (launcher) | 15 min | expires |
| Refresh token | 30 d, rotated on each use; reuse of an old one revokes the whole device | device revoke from the member page or admin |

A ban or suspension deletes the member's sessions, revokes their devices and closes their WOL connection (the
gateway already drops a banned account at `session`). The one-session-per-user rule stays: a launcher login on a
second machine replaces the first game session. Whether to allow one per device is a decision.

## Linking and migrating existing WOL accounts

- **Legacy nick, no email** (today's accounts): keep working with nick+password exactly as now. Nothing is forced.
- **Claim**: a launcher member proves ownership of a legacy nick by entering that nick and its old password once;
  the nick becomes theirs (`members.id` assigned, `legacy` cleared). Ratings follow because they are keyed by nick.
- **New member**: registering in the launcher creates a member with a fresh nick; `POST /register` keeps working
  and creates a legacy-style member, so existing tools do not break.
- **Optional later**: require a verified member for ranked play (a setting), so a ranked nick is always tied to a person.

## Open: rating key

Ratings, history and admissions are keyed by the lower-cased nick (`username_key`). A rename must therefore rewrite
those keys in one transaction, or members are keyed by `id` and the nick becomes a display attribute. The second is
the cleaner long-term model and costs a migration of every ladder table; the first is a small change. **Recommended:**
no rename in v1 (nick is permanent, support does it by hand), and revisit with the member id key when seasons need it.

## What to implement first

1. `members`, `tickets` and `devices` tables and the migration (server only, no launcher): `POST /v1/auth/redeem` and an
   admin/CLI `ticket` command to mint a ticket for testing. This lets the web client and a test launcher be tried now.
2. The shim side: `wol.ts` reads `#ticket=`; `host.c` reads `RA2_LAUNCH_TICKET`.
3. Launcher login (`/v1/auth/login`, refresh, revoke), email verification and reset, then OAuth.

## Decisions that are yours

1. Email: required, optional or none.
2. Rename: allowed (with the key migration) or permanent nick.
3. One session per member, or one per device.
4. Is a member required for ranked, eventually, or do bare nick+password accounts stay first-class?
5. Which OAuth providers, if any (each needs an app registered under your name).
6. Delivery: env var and URL fragment as above, or a local pipe from the start.
