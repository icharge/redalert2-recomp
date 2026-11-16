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

## Run as a service

Service definitions live in `../ra2web/server/deploy/`:

- `ra2web.service`: systemd unit (dedicated `ra2web` user, `server/.env` as `EnvironmentFile`, `Restart=on-failure`,
  read-only filesystem except `data/`, `replays/`, `error-reports/`); `systemctl reload` is a `SIGHUP`. The install commands are in
  its header. `server/install-service.sh` does the same in one step on Ubuntu.
- `windows-service.md`: the Windows service with NSSM, exact commands (no `SIGHUP` there: restart after editing `.env`).
- `README.md`: what both have in common.

No logrotate is needed: the server rotates `data/server.log` itself (`LOG_MAX_BYTES` 100 MiB, `LOG_MAX_FILES` 5, `LOG_ROTATE_DAILY` true).

## Data

Everything lives in one SQLite file, `data/ra2web.sqlite` (`DB_PATH`), plus replays in `server/replays/` and uploaded
maps in `data/maps/`. Tables are created on start (`CREATE TABLE IF NOT EXISTS`), so a new release adds its tables
the first time it runs; a change to an existing table is a code-driven migration in `SqliteStorage` (the SKU migration
copies the file to a `.bak` first).

### Migrations (built, ra2web `d011e4b`)

The database carries a `schema_version` table. On start the server applies the missing migrations in order (each in a
transaction with its version row), after copying the file to `backups/pre-migration-<version>-<time>.sqlite` beside the database
(or into `BACKUP_DIR`). It refuses to start if the database is *newer* than the code (a downgrade: run the newer server, or restore
the copy). A failed migration rolls back, stops the server and names the migration. The start log prints the version
(`Schema: version N`), and `GET /health` shows `schemaVersion`. A database from before this has no version; it is stamped as
version 1. To apply them by hand instead (ra2web `b81685d`): set `AUTO_MIGRATE=false`, and the server refuses to start while one is
pending; with it stopped, `bun scripts/migrate.ts status` and `plan` show what is pending without changing anything, and `up` takes
the copy and applies it.

### Backup and restore ([roadmap M7](roadmap.md))

| Piece | State |
|---|---|
| Backup | **Built.** `bun scripts/backup.ts [--to DIR] [--keep N] [--db FILE]` runs `VACUUM INTO 'DIR/ra2web-<UTC time>.sqlite'`, a consistent copy that is safe while the server runs; default folder `data/backups` beside the database (or `BACKUP_DIR`), keeps the newest 14 (or `BACKUP_KEEP`) |
| Schedule | **Built** (ra2web `5e1e6ac`). Set `BACKUP_DIR`: the server runs the same backup daily at `BACKUP_AT` (default 04:00 local), takes a missed one at start, retries a failed one after an hour, keeps `BACKUP_KEEP` (the live setting `backup.keep`), logs and audits each run (`backup.run`), and shows `lastAt`, `lastOk` and `nextAt` under `backup` in `GET /health` |
| Verify | **Built.** After writing, the copy is opened read-only, `PRAGMA integrity_check` runs and the accounts are counted; a copy that fails is deleted, the run exits 1 and the earlier backups are left alone (pruning happens only after a good copy) |
| Restore | **Built** (ra2web `84788cc`). Stop the server, then `bun scripts/restore.ts <backup file> [--db FILE] [--port N]`: it refuses while anything answers `/health` on `SERVER_PORT`, checks the backup (`integrity_check`, an `accounts` table), moves the current database and its `-wal`/`-shm` aside as `<name>.before-restore-<UTC time>` (nothing is deleted) and copies the backup in. Start the server. By hand it is the same steps: stop, copy the file over the database, delete `-wal`/`-shm`, start |
| Off-host | Copy `BACKUP_DIR` with the operator's own tool (rsync, rclone, the host's snapshot); the server does not push data anywhere |

Until this exists, a manual backup while stopped is a file copy of `data/ra2web.sqlite`.

### Postgres or MySQL

With `STORAGE=postgres` or `mysql` the server runs on a SQLite cache (`DB_PATH`, default `data/ra2web-cache.sqlite`) and mirrors
every write to `DATABASE_URL`; the database is the source of truth and the cache can be thrown away. The scheduled backup and
`scripts/backup.ts` stay off, and `GET /health` says `backup: "external"` and shows `storage.mirror` (`pending`, `lastShippedAt`,
`lastError`); `status` is `degraded` while a ship error persists or more than 1000 changes wait. `/metrics` has
`ra2web_mirror_pending` and `ra2web_mirror_last_ship_seconds`; alert on either growing. Back up the database with its own tools,
or the provider's managed backups, from a schedule you run:

```sh
# Postgres (custom format, restorable with pg_restore)
pg_dump --format=custom --file=ra2web-$(date -u +%Y%m%dT%H%M%SZ).dump "$DATABASE_URL"
# MySQL (consistent snapshot without locking the tables)
mysqldump --single-transaction --routines --result-file=ra2web-$(date -u +%Y%m%dT%H%M%SZ).sql -h HOST -u USER -p DBNAME
```

Restore, in this order:

1. Stop the server (`systemctl stop ra2web`).
2. Restore the database: `pg_restore --clean --if-exists --no-owner --dbname="$DATABASE_URL" ra2web-<time>.dump`, or
   `mysql -h HOST -u USER -p DBNAME < ra2web-<time>.sql`.
3. Delete the cache file (`data/ra2web-cache.sqlite` with its `-wal` and `-shm`) to get exactly what was restored. Leaving it is
   safe, since the start rebuilds it from the database, but changes it still holds unshipped are shipped first and land on top
   of the restored data.
4. Start the server; the log's `Storage:` and `mirror` lines say it reached the database, and `/health` shows the mirror.

Upgrade: back up the database first, then update and start. A schema migration runs on the cache and then pushes the whole
cache to the database, so the database is rewritten in one start; a downgrade cannot undo it, only the backup can.

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
`/admin/*` from outside, or serve it on a separate listener ([admin-and-config.md](admin-and-config.md)). Console accounts
(`bun scripts/admin-user.ts create <name> --role owner`) are the only way into the console: `ADMIN_LEGACY_AUTH` is off by default,
so a game-account password is not an admin key, and the console no longer offers a game login (F2-7). Before `/admin` leaves the
allow-list, follow [Going public](#going-public-cut-over) ([admin-and-config.md](admin-and-config.md)).

## Going public (cut-over)

Until every step below is done, keep `/admin/` behind loopback, a VPN or the proxy allow-list. Run these on the server, from the
`server/` directory of `ra2web` (the commands read the same `.env` files as the server):

1. **Make the key** that seals the authenticator secrets: `openssl rand -hex 32`. Put it in `.env.local` as `ADMIN_TOTP_KEY=<value>`
   and keep it apart from the database backups (a copy of both opens every secret).
2. **Create the owners**: `bun scripts/admin-user.ts create <name> --role owner` for each person (the password comes from a prompt,
   `--password-file` or `ADMIN_PASSWORD`; at least 12 characters). Create a second owner so one lost phone does not lock you out.
3. **Give each owner an authenticator**: `bun scripts/admin-user.ts totp <name>`. It prints the secret and the `otpauth://` URI;
   add it to the app, type the code it shows, and store the recovery codes (each works once). A lost phone is
   `bun scripts/admin-user.ts totp-reset <name>`, then step 3 again.
4. **Set the environment** in `.env.local`: `ADMIN_TOTP_REQUIRED=true`, `ADMIN_LEGACY_AUTH=false` (the default; delete the line if
   it says `true`) and no `ADMIN_USERNAMES` (delete the line or leave it empty).
5. **Restart** (`systemctl restart ra2web`, or restart the Windows service). If `ADMIN_LEGACY_AUTH` is still on with
   `ADMIN_USERNAMES` set, the log shows a warning at start.
6. **Check**: `bun scripts/admin-user.ts check`. Every line must say `OK` (an enabled owner exists, every owner has a confirmed
   authenticator, `ADMIN_TOTP_KEY` is set and valid, `ADMIN_TOTP_REQUIRED` is true, `ADMIN_LEGACY_AUTH` is false,
   `ADMIN_USERNAMES` is empty). It exits 1 when anything says `NOT`; fix that line and run it again.
7. **Sign in once from the allow-listed address** with the password and the code, and open the authenticator page. A game account
   (even one that was in `ADMIN_USERNAMES`) must now get `401` from `/admin/settings`.
8. **Open the proxy**: in `server/nginx.conf`, in `location ^~ /admin/`, delete the `allow ...;` and `deny all;` lines (that is the
   allow-list) and reload: `nginx -t && systemctl reload nginx`. If the console is served from another origin, that origin must be in `ADMIN_ORIGIN`.

To go back, put the `allow`/`deny` lines in again and reload nginx; nothing else needs to change. `ADMIN_LEGACY_AUTH=true`
exists only for a migration and `check` reports it as `NOT`.

## Setup checklist for a new operator

1. Install Bun; check out `ra2web`; `cd server && bun install`.
2. Copy the example environment: set `EXTERNAL_URL` (the public URL), `ADMIN_USERNAMES`, `NATIVE_RANKED_ENABLED=true` if you want ranked Quick Match.
3. Start, open `/health`, create the first owner with `bun scripts/admin-user.ts create <name> --role owner`, sign in to the console API (`POST /admin/auth/login`).
4. Set the welcome text and the map pool; try Quick Match with two clients ([quick-match.md](quick-match.md)).
5. Put TLS in front; decide `WOL_TCP_HOST`; schedule off-host copies of the backup folder.

## What to build, in order

1. `schema_version` and the ordered migrations (small, protects every later change).
2. The scheduled backup (`scripts/backup.ts` itself is built, M7).
3. `/metrics` and the health page (M8).
4. A server `README` section that is this page's checklist, so the repo explains itself.
5. A single `server/.env.example` listing every variable with its default and meaning (generated from `config.ts` so it cannot drift).
