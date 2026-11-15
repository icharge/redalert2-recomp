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
- [x] 8. Browser check.

## Decisions

- Task 6: the left-out disclosure reads "1 other file is left out" for one file, and "{n} other files are left out" otherwise (the plan's wording is the plural only).
- Task 6: a browser whose `estimate()` gives no quota still gets the existing "not enough room" block from `checkSpace` (`storage/install.ts`, not touched here): with no quota, free space counts as 0. The meter is hidden as the plan says; the INSTALL button is disabled by that existing check. Not changed.
- Task 7: CHOOSE ANOTHER FOLDER on the failed screen is shown only for a failed copy (the one with `retry`). A failure before the copy (looking at the folder) has nothing else to offer than TRY AGAIN, which already returns to step 1, so a second button doing the same thing is left out.
- Task 7: the "copied and is kept" line counts the finished files only (the bytes of the `plan.copy` files in `done`), not the bytes of the file that was being written when it failed, and it is left out when no file was finished.
- Task 7: "Parts" progress treats the files as finished also when every `plan.copy` path is in `done`, not only when `doneFiles >= totalFiles` (a resume with nothing left to copy sends no progress event).
- Task 7: a part that is copying shows "{done} of {size}" only once some bytes are done; before that it shows the size, so the mods (no progress events) do not read "0 B of 140 MB".
- Task 7: the renamed controls broke `src/App.test.tsx` (BACK is now LAUNCHER) and the Playwright harness (`e2e/lib.mjs`, `e2e/import.mjs`, `e2e/load-saved-game.mjs` waited for the heading READY TO INSTALL, and `--movies` clicked a Movies box that is now ticked at first). Fixed: the test name, and a new `awaitReview` helper in `e2e/lib.mjs` that waits for CHOOSE WHAT TO INSTALL and unticks the movies unless `movies` is set. The e2e scripts need the game files and a real browser; they were syntax-checked (`node --check`) but not run.
- Task 8: the install screen's top row class was named `.bar`, which the progress bar's `.bar` rule later in the same stylesheet overrode (height 14px, a border); renamed `.topbar`. Found in the browser, fixed in the Task 8 commit.

## Checked in a browser (Task 8)

The dev server was `web-dev-ipv4` from `.claude/launch.json` (`pnpm --dir web dev --host 127.0.0.1 --port 5175`, the dev server of `docs/web/testing.md`), opened with `?mute`, on the Browser pane. Nothing was signed in to. The pane's window was hidden, so screenshots timed out and animations did not run: everything below was read from the DOM (`read_page`, sizes from `getBoundingClientRect`, scroll widths, focus order from `focusin` events), not seen.

- Nothing was installed in that browser, so the Play tab is the empty one. At 1280x720: heading, kicker in amber `#f2b134`, three steps, the 440px INSTALL THE GAME button and the guide link are laid out; the title block ends 56px above the footer; no sideways scroll. At 390x844: the footer stacks (button, steps, link), controls are 64px and 47px tall, no sideways scroll, the title ends above the footer. A first run opens on the welcome page; its key (`ra2.welcome-dismissed`) was set in that pane's local storage to reach PLAY.
- Step 1 at 1280x800: the panel is 920px wide and starts 104px from the top; LAUNCHER and INSTALL GUIDE sit in the top row at 44px; the two columns are 320px apart at the right. At 390x844: one column, no sideways scroll, every button at least 44px except the info tip (24px, the existing `InfoTip` component, not changed here). WHERE IS MY GAME? opens one entry at a time (the first open at the start) and closes on a second click, at 390px with the long path inside the box. Tab reaches every control, in order.
- Step 2 (review) was reached with fake small files put into the folder input from the page's console (a `DataTransfer` of `File` objects with `webkitRelativePath`); INSTALL was never pressed, so nothing was copied or written to OPFS. At 1280px: the found line, the Game content row naming both games, the rows at 64px, the 280px Space panel with its meter (`16.4 KB of 22.0 GB`, 2% wide), the cutscene note after unticking Movies, and the left-out disclosure open and shut. At 390px: one column, no sideways scroll, rows 64 to 85px, buttons at least 44px.

## Not checked in a browser

- Step 3 (installing) and the failed screen: they need a copy to run, and this would have written a game into the pane's OPFS. They are covered by the Vitest tests only (parts list, keep-the-tab-open note, failed copy, TRY AGAIN in the same installation, CHOOSE ANOTHER FOLDER, a failure before the copy).
- The real folder picker and a real drag and drop of a folder: they cannot be driven from the automated browser.
- Colours and spacing against the design were read from the CSS, not compared by eye. No screenshot of any screen was taken (the window was hidden).
- A resume where most files are already there, in a browser: the importer reports them in the first progress event (importer test), the parts list is built from that set; there is no component test for it.
- `e2e/lib.mjs`, `e2e/import.mjs`, `e2e/load-saved-game.mjs`: edited for the new heading and the movies default, syntax-checked only.

## Left

- `docs/web/frontend.md` (step 5, "Install") and `docs/web/storage.md` now use the new step names (done 15 November 2026).
- The existing space check blocks INSTALL when `navigator.storage.estimate()` gives no quota (see Decisions).
- The info tip beside the archive button is 24px, below the 44px rule (shared component).

## Review after the build (15 November 2026)

The session that wrote the plan checked the eight commits and then looked at every screen in the
built-in browser at 1440 x 900, with `?mute`, on the dev server (port 5175).

- `pnpm test`: 1009 pass, and the same 3 fail as before the work started. `pnpm typecheck` is
  clean. `pnpm lint` has 0 errors.
- Seen on screen: the empty Play tab, step 1, step 2, the installing screen, and the failed screen.
  Step 1 was also seen at 390 wide, with no sideways scroll.
- The copy was driven for real with 12 small fake files put into the folder input from the console.
  Reading was slowed and made to fail on `movies01.mix` by wrapping `Blob.prototype.stream` in the
  page. The failed screen showed "1.34 MB of 3.07 MB was copied and is kept". TRY AGAIN then
  finished the copy, and the manifest held one installation with two games. The fake install was
  removed afterwards with REMOVE EVERYTHING.
- Two display fixes came out of this: the archive types and their hint now stay together on one
  line, and the found line leaves out "in" when the folder has no name.

Not seen in a browser: the real folder picker, real drag and drop, an archive or installer, the
mods dialog, and steps 2 to 4 at phone width.

