# Install flow redesign: status

Plan: [2026-11-15-install-flow-redesign.md](../superpowers/plans/2026-11-15-install-flow-redesign.md).
Designs: `docs/superpowers/specs/assets/2026-11-15-install-redesign/`.

## Tests that already failed before this work

`pnpm test` in `web/` before Task 1: 3 failures, 981 passes, none in files this plan touches.

- `src/storage/cursor-preferences.test.ts`: cursor choice keeps the launcher's choice per installation.
- `src/screens/launcher/settings/SettingsScreen.test.tsx`: stores the software-cursor choice for the next launch.
- `src/screens/launcher/settings/SettingsScreen.test.tsx`: hints are tooltips.

They belong to the session that owns the Cursor setting and are left alone.

## Tasks

- [x] 1. `runImport` reports its slot and each finished file.
- [x] 2. Per-part progress.
- [x] 3. Empty Play tab.
- [x] 4. Install frame.
- [x] 5. Choose step.
- [x] 6. Review step.
- [x] 7. Installing and failed steps.
- [ ] 8. Browser check.

## Decisions

- Task 6: the left-out disclosure reads "1 other file is left out" for one file, and "{n} other files are left out" otherwise (the plan's wording is the plural only).
- Task 6: a browser whose `estimate()` gives no quota still gets the existing "not enough room" block from `checkSpace` (`storage/install.ts`, not touched here): with no quota, free space counts as 0. The meter is hidden as the plan says; the INSTALL button is disabled by that existing check. Not changed.
- Task 7: CHOOSE ANOTHER FOLDER on the failed screen is shown only for a failed copy (the one with `retry`). A failure before the copy (looking at the folder) has nothing else to offer than TRY AGAIN, which already returns to step 1, so a second button doing the same thing is left out.
- Task 7: the "copied and is kept" line counts the finished files only (the bytes of the `plan.copy` files in `done`), not the bytes of the file that was being written when it failed, and it is left out when no file was finished.
- Task 7: "Parts" progress treats the files as finished also when every `plan.copy` path is in `done`, not only when `doneFiles >= totalFiles` (a resume with nothing left to copy sends no progress event).
- Task 7: a part that is copying shows "{done} of {size}" only once some bytes are done; before that it shows the size, so the mods (no progress events) do not read "0 B of 140 MB".
- Task 7: the renamed controls broke `src/App.test.tsx` (BACK is now LAUNCHER) and the Playwright harness (`e2e/lib.mjs`, `e2e/import.mjs`, `e2e/load-saved-game.mjs` waited for the heading READY TO INSTALL, and `--movies` clicked a Movies box that is now ticked at first). Fixed: the test name, and a new `awaitReview` helper in `e2e/lib.mjs` that waits for CHOOSE WHAT TO INSTALL and unticks the movies unless `movies` is set. The e2e scripts need the game files and a real browser; they were syntax-checked (`node --check`) but not run.

## Left

`docs/web/frontend.md` still needs its install section updated by the session that owns it.
