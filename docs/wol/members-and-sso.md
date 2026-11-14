# Members and launcher single sign-on: design

Status of 14 Nov 2026: **design; decisions taken (end of page); nothing built yet.** Nothing here
changes how a client logs in today. The launcher is the recomp **web launcher** (`web/src`, which exists:
Play, Mods, Game, Settings, Install); it gains a welcome page, an install guide, guest or member sign-in and
WOL auto-login ([tasks.md](tasks.md), track LW). An external launcher can use the same ticket contract later.

## What exists

| Piece | Today | Where |
|---|---|---|
| Account | `accounts(username, password_hash, created_at, banned)`; `Bun.password` hash; username unique, case-insensitive | `server/src/auth/accountStore.ts` |
| Register / login | `POST /register`, `POST /login` with `{user, pass}` returns `{user, sessionToken}`; rate-limited per IP | `routes.ts` |
| Session | opaque bearer token, one live session per user (a new login replaces the old), TTL `SESSION_TTL_SECONDS` (24 h) | `auth/session.ts` |
| WOL login | after HTTP, the line `session <token>`; a bad token, a banned account or an invalid nick gives `378` | `WolServer.handleSession` |
| Web client | `web/src/game/wol.ts` does `POST /register` then `/login` with the game's nick and password, then `session <token>` | |
| Retail login screen | nick and password fields, each at most **10 characters** (`login[10], password[10]` in `src/web/wolapi.c`); the shim forwards them to `Module.ra2WolStart(login, password)` | |
| Native builds | **No WOL path to this server** (Seen, 14 Nov): `wolapi.c` is compiled only into the web build (`CMakeLists.txt`), `src/runtime/host.c` has no WOL code (its launcher emulation is the launcher mutex), and the server accepts only `cvers`, `setlocale`, `getlocale` and `session <token>` before login, also on the TCP gateway (6667). Online play is web only (decision 10 in [plan.md](plan.md)) | `WolServer.handleLine` |
| Game's nick | the dialog's login, copied into `g_login` and then `g_nick` in `m_chat_request_connection`; the server takes the nick from the session instead | `src/web/wolapi.c:1118` |
| Admin | a game session whose username is in `ADMIN_USERNAMES` | `adminRoutes.requireAdmin` |

Two facts shape the design. First, the retail screen cannot carry a token (10 characters), so the
ticket must travel **beside** the game's own fields, never through them. Second, the shim already
sits between the game and the server: it holds `g_login`/`g_password` and does the HTTP login. The
ticket exchange therefore belongs in the shim (the web build's JS bridge and `wolapi.c`; online play is web
only), and the game's own dialog is skipped (auto-login, below).

## Account model: one member, many game accounts (one for now)

A **member** is the person who signs in to the launcher. A **game account** is a WOL nick, which is
today's `accounts` row. Ratings, history and admissions stay keyed by that nick (`username_key`), so nothing
in the ladder changes. A member may own several game accounts in the model; **for now the limit is one**
(setting `members.maxGameAccounts` = 1; the code refuses a second).

```
members               id (uuid), login, login_key (lower, unique), email (unique, nullable), email_verified_at,
                      password_hash (argon2id via Bun.password), status (active|suspended|banned),
                      created_at, last_login_at
member_game_accounts  member_id, username_key (unique: a nick belongs to at most one member), created_at
accounts              unchanged: the game account (username, password_hash, created_at, banned)
refresh               token_hash, member_id, expires_at, rotated_from              -- launcher login, rotating
launch_tickets        ticket_hash, username_key, member_id (null for slice A and guests), edition,
                      created_at, expires_at, used_at                               -- game launch, single use
identities            provider, subject, member_id                                 -- optional OAuth, later
```

All tables are new, so they need no migration (`CREATE TABLE IF NOT EXISTS`). A game account without a member (every account today, and
every `POST /register`) keeps working with nick and password exactly as now. A member gets a game account
either by creating a new nick or by **claiming** an existing one with its password; both count toward the
limit. `devices` from the first draft is dropped for now: the refresh token is per browser, and "sign out
everywhere" revokes all of a member's refresh tokens.

**Guests** (decision 9 in [plan.md](plan.md)). "Play as guest" plays offline at once (campaign, skirmish,
LAN need no account). Online, the guest types **any name that no account and no player online already uses**
(within the nick rules and the dialog's width), and the launcher asks `POST /v1/auth/guest {nick, edition}` for
a ticket; a taken name gets one clear "name taken". The guest holds the name only while its session lives: no
`accounts` row, the session carries `guest: true`, and `POST /register` refuses the name while a guest is on it.
A guest is never scored, and **a match with any guest in its roster is scored for nobody** (the admission is
refused). `auth.guestEnabled` switches guests off.

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
   | login (login name|email + password)               |
   |----------------->|                                |
   |<-- access token (15 min, in memory) + refresh token (30 d, rotating, HttpOnly cookie on /v1/auth)
   | POST /v1/auth/launch-ticket  {gameAccount, edition} (or POST /v1/auth/guest {edition})
   |----------------->|  ticket: 32 random bytes, 60 s, single use, bound to game account+member+edition
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
| Native | ~~environment variable `RA2_LAUNCH_TICKET`~~: **dropped** (decision 10, online play is web only; no native build has a WOL path) | |
| Web | URL fragment `#ticket=...`; `web/src/game/loader.ts` reads and removes it (`history.replaceState`) before any request, then redeems through `wol.ts`. The web launcher's PLAY uses the same fragment, so there is one path | fragments are not sent to servers, so they are not in access logs |

**WOL auto-login.** With a ticket the game goes from Internet to the welcome screen with no login dialog:

1. The loader redeems the ticket and keeps `{user, sessionToken}`; `WolClient` uses that session and skips
   `/register`/`/login`.
2. `wolapi.c` gets the nick through a new export (`ra2_wolapi_set_launch_login`). It fills the saved-nick slot the
   dialog reads (`WolChat::GetNick`), and `m_chat_request_connection` uses it for `g_login`, `g_nick` and the virtual IP
   whatever was typed. Without this the game and the server would disagree on the nick.
3. The dialog itself is skipped either through the game's own auto-login path, if the lifted code has one (task LW-7a
   looks), or by the shim completing the dialog through the browser build's dialog hooks (LW-7b).

The retail field holds 10 bytes (`nick[10]`), so game account nicks are capped at what it shows (9 or 10
characters, measured in F5A-3), below the server's general 15. Without a ticket nothing changes: the typed nick and
password still go to `/register`/`/login`. That keeps retail-style login, bots and Vera working.

## Expiry, refresh, revocation

| Credential | Lifetime | Revocation |
|---|---|---|
| Launch ticket | 60 s, once | consumed; not otherwise needed |
| Game session | 24 h (setting), one per game account (with the limit of one, one per member) | logout, ban, "log out everywhere", password change |
| Access token (launcher) | 15 min | expires |
| Refresh token | 30 d, rotated on each use; reuse of an old one revokes all of the member's refresh tokens | sign out, "sign out everywhere", admin |

A ban or suspension deletes the member's sessions, revokes their refresh tokens and closes their WOL connection (the
gateway already drops a banned account at `session`). The one-session rule stays: a launch on a second machine
replaces the first game session.

## Linking and migrating existing WOL accounts

- **Game account without a member** (every account today): keeps working with nick+password exactly as now.
- **Claim**: a member proves ownership of an existing nick by entering it and its password once; a
  `member_game_accounts` row links it. Ratings follow because they are keyed by nick. It counts toward the limit.
- **New game account**: created from the launcher's account screen under the member; `POST /register` keeps working
  and creates a game account with no member, so existing tools do not break.
- **Optional later**: require a member for ranked play (a setting), so a ranked nick is always tied to a person.

## Open: rating key

Ratings, history and admissions are keyed by the lower-cased nick (`username_key`). A rename must therefore rewrite
those keys in one transaction, or members are keyed by `id` and the nick becomes a display attribute. The second is
the cleaner long-term model and costs a migration of every ladder table; the first is a small change. **Recommended:**
no rename in v1 (nick is permanent, support does it by hand), and revisit with the member id key when seasons need it.

## What to implement first

The order is in [tasks.md](tasks.md):

1. Slice A, tickets on today's accounts (F5A-1..F5A-3): `launch_tickets`, `POST /v1/auth/redeem`, a mint script; the web
   loader and `wolapi.c`.
2. The web launcher's welcome page and install guide (LW-1, LW-2), which need no server.
3. Members and game accounts, the launcher routes, the launch ticket, guests (MB-1..MB-3, GU-1), then the account screen,
   the PLAY hand-off and auto-login (LW-3..LW-8).
4. Later: email verification and reset; OAuth only if wanted.

## Decisions (taken 14 Nov 2026)

The recommendations in this page were accepted:

1. Email: **optional** (needed only for password reset).
2. Rename: **permanent nick** in v1; ratings stay keyed by nick, no ladder migration.
3. **One live game session per member**, as today (with one game account per member, the same as one per game account).
4. **No member required for ranked yet**; bare nick+password accounts stay first-class. `ranked.requireMember` can be added later.
5. **No OAuth** until the launcher exists.
6. Delivery: **URL fragment `#ticket=` (web)**. The native `RA2_LAUNCH_TICKET` was withdrawn later the same day:
   online play is web only.

Added 14 Nov 2026 (your direction): the launcher is the recomp web launcher with a welcome page and a
bring-your-own-game guide; players choose guest or member; **one member, many game accounts, limited to one for now**;
the game's WOL login is automatic; guests online use any free name, are never scored, and a match with a guest is
scored for nobody; members sign in with a login name or email, kept apart from the nick, a claimed WOL account counts
toward the limit, and game and guest names are capped at 9 characters (decision 11 in [plan.md](plan.md)).
