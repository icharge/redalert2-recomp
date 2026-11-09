# Manage game and saves: status

Plan: [docs/superpowers/plans/2026-11-09-manage-game-and-saves.md](../superpowers/plans/2026-11-09-manage-game-and-saves.md).
Ledger: `.superpowers/sdd/2026-11-09-manage-game-and-saves/progress.md`.

## Tasks

| # | Task | State |
|---|------|-------|
| 1 | Read a save's title and details | not started (waits on the user saving a game in each edition) |
| 2 | List, read and remove single saves | not started |
| 3 | Measure and remove the parts of an install, and reinstall | not started |
| 4 | The SAVED GAMES dialog | not started |
| 5 | The REMOVE... dialog | not started |
| 6 | The MANAGE GAME panel, wired in | not started |
| 7 | The Install screen's mods list as a dialog | done |

## Task 7 checks

- `Import.test.tsx`: the mods test was changed first and failed on the missing
  `aria-haspopup="dialog"`, then passes (20 of 20).
- `pnpm --dir web typecheck`: passes.
- `pnpm --dir web test`: 77 of 80 files pass. The 3 failures are outside this
  change: `cursor-preferences.test.ts`, `changelog.test.ts` and
  `SettingsScreen.test.tsx`, which belong to the other session's uncommitted work.
- Not checked in a browser yet.

## Left

- Tasks 1 to 6.
- Fix or wait on the 3 failing tests above.
