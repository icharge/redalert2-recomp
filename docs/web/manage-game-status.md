# Manage game and saves: status

Plan: [docs/superpowers/plans/2026-11-09-manage-game-and-saves.md](../superpowers/plans/2026-11-09-manage-game-and-saves.md).
Ledger: `.superpowers/sdd/2026-11-09-manage-game-and-saves/progress.md`.

## Tasks

| # | Task | State |
|---|------|-------|
| 1 | Read a save's title and details | not started (waits on the user saving a game in each edition) |
| 2 | List, read and remove single saves | done (tests only; `readInfo` is injected until Task 1) |
| 3 | Measure and remove the parts of an install, and reinstall | done (tests only; the Manage panel wires it in Task 6) |
| 4 | The SAVED GAMES dialog | done (tests only; the Manage panel opens it in Task 6) |
| 5 | The REMOVE... dialog | done (tests; not checked in a browser) |
| 6 | The MANAGE GAME panel, wired in | done (tests; not checked in a browser) |
| 7 | The Install screen's mods list as a dialog | done |

## Final review fixes (done)

One fix pass after the final code review; each was written as a failing test first.

- R9, a folder save that several editions hold belongs to the install. `listSaves(deps, game,
  editions?)` lists it once, under the first edition (rail order) whose record holds that
  `home/name`; a copy an edition wrote in its own `save/<storage>/` stays that edition's. `removeSaves`
  and `collectSaveRemovals` take the same `editions`: they delete the file once (unless a record
  outside the install reads it) and forget it in every edition. `GameActions.listSaves` and
  `onRemoveSaves` pass `install.editions` through.
- `measureParts` and `countParts` dedupe game files, maps and settings records by `home/name`
  across editions; saves come from the deduped list.
- R10, `removeParts` removes the whole installation when "game" is wanted and every part that holds
  something (bytes or a count above 0) is wanted. The Remove dialog says so: "Everything is ticked,
  so the whole install leaves this browser."
- IMPORT .ZIP calls `onChanged`, so the dialog and the figures list and measure again.
  (`importSaves` only writes to `save/<storage>/`, so App has no records to reload.)
- `listSaves` no longer crashes on a written save with no size or time (falls back to the import's
  values, else 0); `saveDetails` leaves out "Saved ..." when there is no usable time.
- Still unchecked: the browser check of Tasks 5 and 6, and Task 1. Deferred review findings are not done.
- Suite: 840 of 844 pass; the 4 failures are the other session's (`SettingsScreen` 2, `changelog` 1,
  `cursor-preferences` 1). Typecheck passes.

## Tasks 5 and 6 checks

- Tests (the deferred test pass): `RemoveDialog.test.tsx` has 10 tests, the Task 5 brief's six
  plus the warning copy for one edition, removing only the game, a disabled REMOVE when nothing
  is ticked, and CANCEL in the remove-everything strip. `GameScreen.test.tsx` is rewritten for
  the MANAGE GAME panel: the storage breakdown (with and without an estimate, and "Cache and
  other" hidden when nothing is left over), SAVED GAMES…, REMOVE… (remove, cancel, and a failure
  shown), REINSTALL GAME (confirm and cancel, and `onReinstall` only after REINSTALL), and BROWSE
  FILES in the panel. The OLDER COPIES tests are unchanged. `App.test.tsx` rewrites the REMOVE GAME
  test for REMOVE…: an in-use game file keeps the installation, and REMOVE EVERYTHING then forgets it.
- Typecheck (`tsc --noEmit`, both configs) passes. The full suite has 4 failures, all in files
  outside this change: `SettingsScreen.test.tsx` (2), `changelog.test.ts` (1) and
  `cursor-preferences.test.ts` (1), which belong to the other session's uncommitted work.
- Not checked in a browser yet (Task 6 Step 5).
- `RemoveDialog.tsx`: the Task 5 brief's six behaviours, with the copy from the brief. The
  game-content warning uses R6's wording. The "game" row is the edition titles joined with
  " and ". Two props beyond the brief: `editions` (titles) and `counts` (mods, maps, saves),
  so the rows can say how many.
- `countParts` (install-parts.ts, new): the mod, map and save counts, which `measureParts`
  (bytes only) does not give.
- `ManagePanel.tsx`: the storage breakdown (estimate, then the four parts, then "Cache and
  other" when it is above 0), BROWSE FILES, REINSTALL GAME (inline), SAVED GAMES… (the
  SavedGamesDialog) and REMOVE… (the RemoveDialog). Each removal refreshes the panel.
- `App.tsx`: `saveLibrary()` builds the deps with `readInfo: () => null` (R1). Removals run
  under `manifestWork` and end with `reload()`. `onReinstall` runs `prepareReinstall`, then
  opens `/import?resume=<slot>`.
- GameScreen: the right column is the Manage panel. The saved-games section, StoragePanel and
  RemoveButton are gone. The old `.bar`, `.stack` and `.remove` CSS classes are unused now and
  left in place.

## Task 4 checks

- `SavedGamesDialog.test.tsx`: 11 tests, written first and failing on the missing
  module, then passing (11 of 11). The brief's 8 plus 3: a zip download's message
  shows as a status line; a zip import goes to one edition; closing the dialog
  cancels an open confirmation.
- Presentational: all data and actions come in as props. Confirmations are inline
  (the row or the footer turns into the question), with no nested dialog.
- Zip buttons sit in each group's header (the ruling); DOWNLOAD .ZIP and IMPORT .ZIP
  are quiet buttons there.
- The full suite and typecheck were skipped on purpose, at the coordinator's
  request; they run once after all tasks.
- Not checked in a browser yet.

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

- Task 1, and the browser check of Tasks 5 and 6 (`?mute`, a real install). Removing the game (ruling R6) leaves the install resumable with its
  saves, settings, maps and mods; the Manage panel wires the parts in Task 6.
- Task 1 replaces the injected `readInfo` with the real save parser.
- Fix or wait on the 3 failing tests above.

## Browser check (2026-11-09)

Checked on the dev server at `/?mute` with a fake two-edition install (seeded through the manifest, then removed):
- **Manage panel:** sizes are counted once.
- **Saved games:** a folder save is listed once. Inline remove and the REMOVE ALL strip ("Remove 1 save?") work, there is no sideways scroll, and DOWNLOAD .ZIP is disabled for an empty group.
- **Remove dialog:** rows, disabled empty parts and warnings show correctly.
- **Removing only the game:** leaves "Install not finished" with RESUME INSTALL and keeps the maps, save and settings. The INSTALLED header counts only files on disk.
- **REMOVE EVERYTHING:** leaves no records and no files.

Not checked: the Install screen's mods dialog (needs a real folder). Left: Task 1 (save titles), which needs one real save per edition.
