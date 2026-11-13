# Running the shared server yourself

What an operator can do without editing code, what exists today and what is still to build. Paths under `server/`
are in `../ra2web`. Status of 14 Nov 2026.

## Run and configure

| Task | How today |
|---|---|
| Start | `cd ../ra2web/server && bun run src/index.ts` (the working directory decides where `data/` is) |
| Configure | Environment variables, or `server/.env` and `server/.env.local` (real environment wins over files). The names are in `server/src/config.ts`; the ones that matter first: `SERVER_PORT`, `EXTERNAL_URL`, `ADMIN_USERNAMES`, `DB_PATH`, `LOG_FILE`, `NATIVE_RANKED_ENABLED`, `QUICK_MATCH_MAPS`, `WOL_TCP_HOST` |
| Configure at runtime | Admin console or API, see [admin-and-config.md](admin-and-config.md): ranked on/off, ladder knobs, rate limits, welcome text, map pool |
| Reload the environment | `kill -HUP <pid>` (not available on Windows; restart instead). Runtime overrides survive a reload |
| Stop | `SIGINT`/`SIGTERM`: connections close, the database is flushed and closed |
| Health | `GET /health`. There is no `/metrics` yet ([roadmap M8](roadmap.md)) |
| Logs | `data/server.log`, rotated by size and day (`LOG_MAX_BYTES`, `LOG_MAX_FILES`, `LOG_ROTATE_DAILY`); level `LOG_LEVEL` |

## Data

Everything lives in one SQLite file, `data/ra2web.sqlite` (`DB_PATH`), plus replays in `server/replays/` and uploaded
maps in `data/maps/`. Tables are created on start (`CREATE TABLE IF NOT EXISTS`), so a new release adds its tables
the first time it runs; a change to an existing table is a code-driven migration in `SqliteStorage` (the SKU migration
copies the file to a `.bak` first).

### Migrations (target)

Add a `schema_version` table and number each step. Each migration is a function that runs in a transaction and writes the new
version; on start the server applies the missing ones in order and refuses to start if the database is *newer* than the code
(a downgrade). Before any migration that changes existing rows the server copies the file to `data/backups/pre-<version>.sqlite`.
This replaces today's "detect by schema shape" checks with one ordered list.

### Backup and restore (target, [roadmap M7](roadmap.md))

| Piece | Design |
|---|---|
| Backup | `bun scripts/backup.ts [--to DIR]` runs `VACUUM INTO 'DIR/ra2web-<UTC time>.sqlite'`, a consistent copy that is safe while the server runs; keeps the newest `BACKUP_KEEP` (default 14) |
| Schedule | The server runs it daily at `BACKUP_AT` (default 04:00 local) when `BACKUP_DIR` is set; the log says what it wrote. Off when unset |
| Verify | After writing, open the copy read-only, run `PRAGMA integrity_check` and count the accounts; a failed check is logged as an error and keeps the previous good backups |
| Restore | Stop the server, copy the chosen file over `data/ra2web.sqlite` (and delete `-wal`/`-shm` beside it), start. The restore note belongs here and in `server/README.md` |
| Off-host | Copy `BACKUP_DIR` with the operator's own tool (rsync, rclone, the host's snapshot); the server does not push data anywhere |

Until this exists, a manual backup while stopped is a file copy of `data/ra2web.sqlite`.

## Upgrade

1. Take a backup.
2. Stop the server, update the checkout (`git pull` of `ra2web` and, for the client, the recomp repo's `web/public/game/`).
3. `bun install`, start. New tables and migrations apply on start; the log prints the schema version.
4. If it is wrong, stop, restore the backup, check out the previous commit, start.

Never run two servers on one database file.

## Health and monitoring (target, [roadmap M8](roadmap.md))

`GET /health` stays a cheap liveness check. `GET /metrics` (admin-only or loopback) adds: connected players, queued players
per queue, matches in progress, settlement states (`pending`, `scored`, ...), seconds since the last settlement tick, database
size, last backup time and result. The console's health page reads the same data. An operator who wants alerts points an
external checker at `/health` and the settlement-age metric (a stuck timer shows as that number growing).

## Network and security

| Port | Default | Exposure |
|---|---|---|
| HTTP and WebSocket | `SERVER_PORT` 9090 | public (behind TLS at a reverse proxy) |
| Classic client lobby (TCP) | `WOL_TCP_HOST:WOL_TCP_PORT` 127.0.0.1:6667 | loopback until you set `WOL_TCP_HOST=0.0.0.0`; then public |
| World Domination | `WDT_HOST:WDT_PORT` 127.0.0.1:29090 | loopback by default |
| Match relay (UDP) | with the game server | public for players |

Put the HTTP port behind a reverse proxy with TLS. To keep the admin API off the public internet, have the proxy refuse
`/admin/*` from outside, or serve it on a separate listener ([admin-and-config.md](admin-and-config.md)). Set `ADMIN_USERNAMES`
to the smallest list you need; with no separate admin accounts yet, an admin is a game account, so use a long unique password.

## Setup checklist for a new operator

1. Install Bun; check out `ra2web`; `cd server && bun install`.
2. Copy the example environment: set `EXTERNAL_URL` (the public URL), `ADMIN_USERNAMES`, `NATIVE_RANKED_ENABLED=true` if you want ranked Quick Match.
3. Start, open `/health`, register the admin's game account, open the admin console.
4. Set the welcome text and the map pool; try Quick Match with two clients ([quick-match.md](quick-match.md)).
5. Put TLS in front; decide `WOL_TCP_HOST`; schedule off-host copies of the backup folder.

## What to build, in order

1. `schema_version` and the ordered migrations (small, protects every later change).
2. `scripts/backup.ts` and the scheduled backup with verification (M7).
3. `/metrics` and the health page (M8).
4. A server `README` section that is this page's checklist, so the repo explains itself.
5. A single `server/.env.example` listing every variable with its default and meaning (generated from `config.ts` so it cannot drift).
