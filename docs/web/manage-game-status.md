# Manage game and saves: status

Plan: [docs/superpowers/plans/2026-11-09-manage-game-and-saves.md](../superpowers/plans/2026-11-09-manage-game-and-saves.md).
Ledger: `.superpowers/sdd/2026-11-09-manage-game-and-saves/progress.md`.

## Tasks

| # | Task | State |
|---|------|-------|
| 1 | Read a save's title and details | not started (waits on the user saving a game in each edition) |
| 2 | List, read and remove single saves | done (tests only; `readInfo` is injected until Task 1) |
| 3 | Measure and remove the parts of an install, and reinstall | done (tests only; the Manage panel wires it in Task 6) |
| 4 | The SAVED GAMES dialog | not started |
| 5 | The REMOVE... dialog | not started |
| 6 | The MANAGE GAME panel, wired in | not started |
| 7 | The Install screen's mods list as a dialog | done |

## Task 3 checks

- `install-parts.test.ts`: 11 tests, written first and failing on the missing
  module, then passing. Six are the brief's: measuring a two-edition install;
  removing only the ticked parts; game removal leaving the saves and settings in
  `save/<storage>/` alone; game removal last; a file that will not delete gives
  an "in use" error while the rest is removed; the reinstall preparation. Five
  more: a settings file the game wrote is counted and removed with the import's
  copy; a map both editions read is deleted once and forgotten from both records;
  removing only the game deletes just its files and keeps the other parts;
  removing every part removes the installation.
- Ruling R6: removing the game when not every part is ticked deletes only the
  game's own files and marks them not copied. The installation stays listed,
  with its saves, settings, maps and mods, and Resume import copies the game back.
  With every part ticked, the whole installation goes. `deleteRecordedFiles`
  (save-library.ts) is the delete-then-record step shared by saves, maps,
  settings and the game.
- `prepareReinstall` marks each edition's game files not copied, so the install
  is incomplete and Resume import copies them again. The brief's resume check
  holds: `/import?resume=<slot>` → `runImport(slot)` → `beginImport` takes a
  file marked not done as to copy, and `needsResume` is true while a record is
  incomplete. Import.tsx and App.tsx are unchanged.
- `save-library.ts` exports `pathsReadElsewhere` and `collectSaveRemovals`;
  `remove-install.ts` exports `notRemoved` and `deleteInstallFiles`. `removeSaves`
  and `removeInstall` behave as before (`save-library.test.ts`,
  `remove-install.test.ts` pass).
- Not checked in a browser yet.

## Task 7 checks

- `Import.test.tsx`: the mods test was changed first and failed on the missing
  `aria-haspopup="dialog"`, then passes (20 of 20).
- `pnpm --dir web typecheck`: passes.
- `pnpm --dir web test`: 77 of 80 files pass. The 3 failures are outside this
  change: `cursor-preferences.test.ts`, `changelog.test.ts` and
  `SettingsScreen.test.tsx`, which belong to the other session's uncommitted work.
- Not checked in a browser yet.

## Task 2 checks

- `save-library.test.ts`: 10 tests, written first and failing on the missing
  module, then passing (10 of 10). Review fix: a file that will not delete stays
  listed, and a file another edition still reads is not deleted. They cover listing written and imported saves
  once each, newest first; leaving out non-saves; a save that cannot be read
  still listed with `info: null`; reading the written copy over the imported
  one; reading an imported-only save; removing both copies; removing an
  imported-only save.
- `SaveInfo` is defined in `save-library.ts`. `listSaves` takes `readInfo` as a
  dependency, so it does not depend on Task 1's parser.
- `pnpm --dir web test`: 78 of 81 files pass. The 3 failing files are the same
  ones as before, outside this change: `cursor-preferences.test.ts`,
  `changelog.test.ts` and `SettingsScreen.test.tsx`.
- `pnpm --dir web typecheck`: passes.
- Not checked in a browser yet.

## Left

- Tasks 1, 4 to 6. Removing the game (ruling R6) leaves the install resumable with its
  saves, settings, maps and mods; the Manage panel wires the parts in Task 6.
- Task 1 replaces the injected `readInfo` with the real save parser.
- Fix or wait on the 3 failing tests above.
