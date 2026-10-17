# Testing the browser build

Three levels. The page's own logic is tested alone. The game is tested
under Node without a browser. Then the playtest suite runs in a real
headless browser. The Windows suite stays the reference for lift bugs
([docs/testing.md](../testing.md)), because the browser build runs the same
lifted C.

## The page: Vitest

`web/` runs `pnpm test` (Vitest, jsdom, Testing Library). This covers
everything that doesn't need the game:

- `storage/install.ts`: the allowlist against a real install's file list
  (names only, recorded once and checked in), the PE stamp read from a
  synthetic header, and space estimates.
- `storage/manifest.ts`: resuming, a size mismatch, removal of shared files.
- `game/protocol.ts`: parsing `@ra2` lines, and ignoring other lines.
- `game/store.ts`: phase transitions, including `crashed` from any phase.
- Screens: Import with a mocked directory handle, Library with a manifest,
  and Settings round-tripping IndexedDB (`fake-indexeddb`).

No test touches game files, so CI can run them on every push.

## The game without a browser: Node

```
node build-web/ra2.js --run --game ./game --headless --mute --debuglog
```

The same arguments as the Linux build, so `tools/conformance.py` can run it
with `--host web`: the boot milestones in `conformance.json` are the stage 3
check. This needs a local game folder, so it runs on a developer's machine,
not in CI.

## The suite in a browser: Playwright

`tools/playtest.py --web` runs the existing cases ([docs/testing.md](../testing.md))
against the browser build. The cases don't change. Only the way the game is
started and observed does:

| Linux and Windows | Browser |
|---|---|
| start the exe with arguments | Playwright opens `http://localhost:4173/?test=1&arg=...` (the built page on `vite preview`, with COOP/COEP) |
| game folder on disk | under `?test=1`, the page mounts a folder Playwright serves from the local `game/`, instead of OPFS, so no import is needed per run |
| `--press DLG:CTRL@s` and the other script events | the same strings, passed as `arg=` and handled by `src/linux/script.c`, unchanged |
| `--waitlog TEXT` | the same, inside the game |
| the log, read by `playtest.py` | Playwright collects the console (`print`, `printErr`) into the same log file |
| `--record`, the contact sheet | Playwright's screenshots of the canvas at fixed times, and its video |
| exit code | the `exit` event ([protocol.md](protocol.md)) |

Playwright runs Chromium headless, with GPU or SwiftShader for WebGL2.
`--jobs N` runs N browser contexts, as `playtest.py` runs N games today.

A case fails in the browser and passes on Linux: then it's a browser bug
(the host, `win32hle` under Emscripten, or the page), not a lift bug.

## What runs where

| Check | CI | Developer machine |
|---|---|---|
| `pnpm lint`, `pnpm typecheck`, `pnpm test` | yes | yes |
| `pnpm build` (page only, no game) | yes | yes |
| Node boot (`conformance.py --host web`) | no (needs game files) | yes |
| `playtest.py --web` | no (needs game files) | yes |

## Performance

The frame-time overlay (Settings) and the `fps` event give a number per run.
Stage 5 records skirmish frame times at 800x600 and 1080p here, and stage 9
the same with HD vehicles on. Use Chrome's Performance panel with
`-gseparate-dwarf` builds to see lifted function names.

| Run | 800x600 | 1080p | 1080p, HD vehicles |
|---|---|---|---|
| skirmish, 2 AIs, 5 min, desktop Chromium | | | |
