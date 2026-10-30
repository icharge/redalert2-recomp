# web/

The page for the browser build: React, TypeScript and Radix. It loads the game
(`public/game/`, from `build-web.cmd` or `build-web.sh` in the repository root),
draws its picture on a canvas and sends it the mouse and keys. The design is in
[docs/web](../docs/web/README.md).

## Try it locally

You need your own game folder at `../game` (the same one the other builds use), a
built game, and a current Chrome, Edge or Firefox.

```
build-web.cmd             # in the repository root: builds both editions' modules into web/public/game/
cd web
pnpm install
pnpm dev                  # http://127.0.0.1:5173
```

The dev server serves the game folder's files (only those the import would keep, only to
this machine) so the page can start the game without an import. The first load copies about
1 GB into the tab's memory: expect 20 to 40 seconds before the main menu. `RA2_GAME_DIR`
names another folder.

## Commands

|                                                    |                                                                                                     |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `pnpm dev`                                         | the dev server, with the cross-origin headers the game's threads need                               |
| `pnpm build`                                       | typecheck and a production build into `dist/` (mode `production`, reads `.env.production`)          |
| `pnpm build:prod`                                  | the deployment build: mode `production`, reads `.env.production` (same as `pnpm build`)             |
| `pnpm build:mode <name>`                           | the same with another Vite mode, reads `.env.<name>` (e.g. `pnpm build:mode staging`)               |
| `pnpm test`                                        | Vitest: the protocol, the store, input mapping, the presenter, the loader, the screens              |
| `pnpm lint`, `pnpm typecheck`, `pnpm format:check` | ESLint, `tsc`, Prettier                                                                             |
| `node e2e/smoke.mjs`                               | with `pnpm dev` running: waits for the main menu in a real Chrome                                   |
| `node e2e/drive.mjs --step "click 719,221@4" ...`  | clicks and keys through the menus, with screenshots ([docs/web/testing.md](../docs/web/testing.md)) |

`CHROME_PATH` names the browser the `e2e/` scripts use. Nothing from the game is part of
`dist/` or the repository.
