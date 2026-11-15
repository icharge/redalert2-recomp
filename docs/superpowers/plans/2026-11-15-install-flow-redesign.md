# Install Flow Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the redesigned empty Play tab and install flow (choose, review, installing, failed) from the design board into the launcher.

**Architecture:** `screens/Import.tsx` keeps its stage machine and gets new markup per stage. Two small additions carry the new behaviour: `runImport` reports the installation's slot and each finished file, and a new pure module `storage/import-progress.ts` turns that into per-part progress. `PlayScreen.tsx` gets a new nothing-installed layout. No change to what is copied or where.

**Tech Stack:** React 19, TypeScript, Radix Themes (`Dialog`), CSS modules, react-router, Vitest with Testing Library, pnpm.

**Spec:** the "RA2 Web Launcher Redesign" design canvas, version 106, boards `A-Play-Empty` and `A-Install` (four states: choose, review, copy, failed). Their source is saved in `docs/superpowers/specs/assets/2026-11-15-install-redesign/` (`A-Play-Empty.dc.html`, `A-Install.dc.html`): read them for exact sizes, colours and copy. The board's numbers and names (3.1 GB, 62%, `C:\Westwood\RA2`, the mod names) are samples; the app shows real values. This plan says where the app differs from the board.

## Global Constraints

- Work on `web-port` in this checkout. Another session has uncommitted changes here: never stage, revert, stash or commit a file this plan does not name. `git add` by path only. Do not touch `web/src/storage/install.ts`, `web/CHANGELOG.md`, `docs/web/frontend.md`, or `web/src/screens/launcher/settings/*` (they hold someone else's uncommitted edits).
- Commit after each task. Trailer: `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`. Never push. Never use `--no-verify`.
- Run from `web/`: `pnpm exec vitest run <file>` for one file, `pnpm test` for all, `pnpm typecheck`, `pnpm lint`. Before Task 1, run `pnpm test` once and write down the tests that already fail (two in `SettingsScreen.test.tsx` about the Cursor setting are known). Leave them alone and name them in your report; a new failure is yours to fix.
- Test first: write the test, watch it fail for the right reason, then write the code.
- Labels are upper case in the launcher's Barlow Condensed button style. Body copy is sentence case. Use the exact copy in this plan.
- Every button and link is at least 44px tall. Text contrast is at least 4.5:1: muted text is `#a7a29a`, never darker than `#8a8c92` on the panel.
- Real elements only: `<button>`, `<a>`/`<Link>`, `<input>` with a label. No `onClick` on a `div` or `span`.
- The screens must work at phone width: two-column layouts become one column under 900px, and nothing scrolls sideways.
- Keep `docs/web/install-redesign-status.md` updated (done, checked, left) and commit it with each task.

## Review Focus

- A copy fails midway and the player presses TRY AGAIN: it must carry on in the same installation, not stop with "already installed".
- The folder holds only Red Alert 2: the found line and the Game content row name one game, with no empty "and".
- The browser gives no storage quota: the space meter and its line are hidden, and nothing shows `NaN` or `undefined`.
- A group with no files (no movies, no mods): its row is disabled and reads "None", and the "cutscenes will be black" note does not appear.
- A resumed install where most files are already there: the parts list shows them DONE from the first progress event.

---

### Task 1: `runImport` reports its slot and each finished file

**Files:**
- Modify: `web/src/storage/importer.ts` (`RunOptions`, `runImport`)
- Test: `web/src/storage/importer.test.ts`

**Interfaces:**
- Produces, on `RunOptions`:
  - `onSlot?(slot: number): void`: called once, as soon as the installation is known (created or resumed), before any file is copied.
  - `onFileDone?(path: string): void`: called with the `plan.copy` path of every file that is in place: each file an earlier run finished (the `resume.done` names) and each file as its copy completes. A file two games read may be reported twice.

- [ ] **Step 1: Write the failing tests** in `importer.test.ts`, using the file's existing fixtures:
  - `"reports the installation's slot before copying"`: `onSlot` is called once with the slot `runImport` returns, and before the first `onProgress` call.
  - `"reports each file as it is copied"`: the set of `onFileDone` paths equals the set of `prepared.plan.copy` paths.
  - `"a resume reports the files an earlier run finished"`: run once and abort after the first file (the file's existing cancel pattern), run again with `slot`: the second run's `onFileDone` set again equals every `plan.copy` path.
- [ ] **Step 2: Run** `pnpm exec vitest run src/storage/importer.test.ts`. Expected: the three new tests fail, the callbacks are never called.
- [ ] **Step 3: Implement.** Call `options.onSlot?.(slot)` right after `const slot = installation.slot`. Call `options.onFileDone?.(name)` in the `resume.done` loop (outside the `counted` check) and after `manifest.markFileDone` resolves in `markDone`.
- [ ] **Step 4: Run** the file again. Expected: all pass.
- [ ] **Step 5: Commit** `feat(web): the import reports its slot and each finished file`. Include this plan and `docs/superpowers/specs/assets/2026-11-15-install-redesign/` in this first commit.

### Task 2: Per-part progress

**Files:**
- Create: `web/src/storage/import-progress.ts`
- Test: `web/src/storage/import-progress.test.ts`

**Interfaces:**
- Consumes: `ImportPlan`, `FileKind` from `storage/install.ts` (read only).
- Produces:

```ts
export type PartId = "game" | "movies" | "mods" | "maps" | "saves" | "settings";
export interface PartProgress {
  id: PartId;
  label: string; // "Game content" | "Movies" | "Mods" | "Custom maps" | "Saved games" | "Settings and hotkeys"
  bytes: number;
  doneBytes: number;
  state: "done" | "copying" | "waiting";
}
export function partProgress(
  plan: ImportPlan,
  done: ReadonlySet<string>,
  current: string | null,
  filesFinished: boolean,
): PartProgress[];
```

Rules:
- Parts come in the order of `PartId` above. A part with no files is left out.
- File parts group `plan.copy` by kind: `archive`, `sound`, `data`, `logo` are `game`; `movie` is `movies`; `map` is `maps`; `save` is `saves`; `settings` is `settings`. Entries with `stub: true` are skipped (movies left out become stubs).
- `doneBytes` sums the sizes of the part's files whose path is in `done`.
- `state`: `done` when `doneBytes === bytes`; else `copying` when `current` is one of the part's paths or `doneBytes > 0`; else `waiting`.
- `mods` is present when `plan.bringMods` and at least one mod has no `problem`. Its `bytes` is the sum of those mods' bytes, `doneBytes` is 0, and `state` is `copying` when `filesFinished`, else `waiting` (mods are brought after the files, with no progress events).

- [ ] **Step 1: Write the failing tests**, building plans with `planImport` and a fixture folder as `install.test.ts` does:
  - `"groups the copy into parts, in order, without empty parts"`.
  - `"leaves stubbed movies out"`: with `movies: false`, no `movies` part.
  - `"a part is done when all its files are, copying when one is current or some are done, waiting otherwise"`.
  - `"mods wait until the files are finished"`.
  - `"the parts' bytes add up to the copy's real files"`: sum of file parts' `bytes` equals the sum of non-stub `plan.copy` sizes.
- [ ] **Step 2: Run** `pnpm exec vitest run src/storage/import-progress.test.ts`. Expected: fails, module not found.
- [ ] **Step 3: Implement** `partProgress`.
- [ ] **Step 4: Run** again. Expected: pass. Run `pnpm typecheck`.
- [ ] **Step 5: Commit** `feat(web): per-part progress for the install screen`.

### Task 3: Empty Play tab

**Files:**
- Modify: `web/src/screens/launcher/PlayScreen.tsx` (the `if (!install)` branch), `web/src/screens/launcher/PlayScreen.module.css`
- Test: `web/src/screens/launcher/PlayScreen.test.tsx`

**What it shows** (board `A-Play-Empty`): the screen mirrors the real Play screen.
- Key art with `dim={0.35}`.
- A title block where the game title normally sits (reuse `.title`'s position): kicker `NOTHING INSTALLED YET` in amber `#f2b134`; `<h1>` `BRING YOUR` / `OWN GAME` on two lines, same style as the game title; a paragraph, 18px, max-width 620px: `Red Alert 2 and Yuri’s Revenge run here from your own copy: the CDs, The First Decade, the EA App or Steam. Nothing is uploaded.`
- The bottom bar, same frame as the Play footer, three columns:
  - left, an `<ol aria-label="How it works">`: `Choose your game folder`, `Pick what to install, about 2 to 3 GB`, `Play`, each with its number;
  - centre, the `INSTALL THE GAME` button (the existing `.play` style, in the place PLAY has), calling `onInstall`;
  - right, a `<Link to="/install/guide">` with a small line `Files not ready?` above `READ THE INSTALL GUIDE`.
- Under 900px the bar stacks: button first, then the steps, then the link.

- [ ] **Step 1: Write the failing tests** (keep `"nothing installed shows one INSTALL THE GAME button"` passing):
  - `"nothing installed says to bring your own game"`: heading with name matching `/BRING YOUR\s*OWN GAME/`, and the text `Nothing is uploaded.` is present.
  - `"nothing installed lists the three steps"`: the list named `How it works` has 3 items.
  - `"nothing installed links to the install guide"`: link `/READ THE INSTALL GUIDE/` has `href` `/install/guide`.
- [ ] **Step 2: Run** `pnpm exec vitest run src/screens/launcher/PlayScreen.test.tsx`. Expected: the three new tests fail.
- [ ] **Step 3: Implement** the branch and its styles.
- [ ] **Step 4: Run** again. Expected: pass.
- [ ] **Step 5: Commit** `feat(web): the empty Play tab says what to do`.

### Task 4: Install frame: steps, LAUNCHER and INSTALL GUIDE links, wider panel

**Files:**
- Modify: `web/src/screens/Import.tsx`, `web/src/screens/Import.module.css`, `web/src/App.tsx` (the `/import` route only)
- Test: `web/src/screens/Import.test.tsx`

**Interfaces:**
- Produces: `Import` takes a new optional prop `onGuide?: () => void`. `App.tsx` passes `onGuide={() => navigate("/install/guide")}`.

**What changes:**
- The panel is 920px wide (`max-width: 100%`), top padding as the board.
- Steps read `CHOOSE`, `REVIEW`, `INSTALL`, each shown with its number (`1 CHOOSE`). A done step shows a check icon after its label. `data-state` stays `done` / `current` / `next`, plus `failed` on the current step when the stage is `failed` after a copy (Task 7 sets this; add the CSS now: label and bar `#ff8a80`). Colours: current `#f1ede6` with a `#d3262b` bar; done `#a7a29a` with a `#8b1a1a` bar; next `#8a8c92` with a `#3a3b40` bar.
- The back button reads `LAUNCHER` (it was `BACK`), top left. A new `INSTALL GUIDE` button with a question-mark icon sits top right and calls `onGuide`; it is not rendered without `onGuide`. Both are hidden while copying, as BACK is today.

- [ ] **Step 1: Write the failing tests.** Update `"marks the current step"` to the new labels and `"goes back when asked"` to the name `LAUNCHER`. Add `"opens the install guide when asked"`: with `onGuide`, clicking `INSTALL GUIDE` calls it; without it there is no such button.
- [ ] **Step 2: Run** `pnpm exec vitest run src/screens/Import.test.tsx`. Expected: those three fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** again, and `pnpm typecheck`. Expected: pass.
- [ ] **Step 5: Commit** `feat(web): install screen frame, with links to the launcher and the guide`.

### Task 5: Choose step

**Files:**
- Modify: `web/src/screens/Import.tsx` (`Chooser`), `web/src/screens/Import.module.css`
- Test: `web/src/screens/Import.test.tsx`

**Interfaces:**
- Consumes: `SOURCES` (`name`, `folders`, `pick`) exported from `web/src/screens/InstallGuide.tsx`.

**What it shows** (board state "choose"), two columns, `minmax(0, 1fr) 320px`:
- Left:
  - `<h1>` `INSTALL THE GAME`; paragraph `Use your own copy of Red Alert 2 or Yuri’s Revenge. The files are copied into this browser. Nothing is uploaded.`
  - The `message` (cancelled, not a folder) stays above the drop area, as today.
  - The drop area (232px tall, dashed `#6f7177` border) now holds: a folder icon, `Drop your game folder here`, `or`, and the primary `CHOOSE FOLDER` button. Drag and drop behaviour is unchanged.
  - Below: an outlined button `USE AN ARCHIVE OR INSTALLER` (same action as the old link), the caption `.7z · .zip · .rar · installer .exe`, and the existing `InfoTip`.
  - A last line: `Needs about 2 GB free, or 3 GB with the movies.` When `deps.pickDirectory` exists, it is followed by the button-styled link `Folder button not working?`, which opens the file picker (the old `Use file picker`).
- Right, an `<aside>` titled `WHERE IS MY GAME?`: one disclosure button per `SOURCES` entry (`aria-expanded`), the first open at the start, one open at a time, clicking the open one closes it. An open entry shows `folders[0]` in a `<code>` box that wraps long paths (`overflow-wrap: anywhere`) and the entry's `pick` text.

- [ ] **Step 1: Write the failing tests.** Update `"starts by asking for the folder, and says nothing is uploaded"` and the archive test to the new copy and the button name `USE AN ARCHIVE OR INSTALLER`; update `"without a folder picker, CHOOSE FOLDER uses the file picker"` if names changed. Add:
  - `"says where each copy of the game puts its folder"`: the region `WHERE IS MY GAME?` has a button per `SOURCES` name; the first is expanded and shows `SOURCES[0].folders[0]`; clicking `Steam` shows the Steam folder and collapses the first.
  - `"offers the file picker when the folder button does not work"`: with `pickDirectory`, `Folder button not working?` clicks the hidden folder input (assert as the existing file-picker test does).
- [ ] **Step 2: Run** the file. Expected: the changed and new tests fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** again. Expected: pass.
- [ ] **Step 5: Commit** `feat(web): install step 1 shows where the game folder is`.

### Task 6: Review step

**Files:**
- Modify: `web/src/screens/Import.tsx` (`FIRST`, `Stage`, `look`, `Review`), `web/src/screens/Import.module.css`
- Test: `web/src/screens/Import.test.tsx`

**Interfaces:**
- The `review` stage gains `quota?: number` (from the `deps.estimate()` call `look` already makes).

**What changes** (board state "review"), two columns, `minmax(0, 1fr) 280px`:
- `FIRST.movies` becomes `true`: movies are ticked by default.
- Left:
  - `<h1>` `CHOOSE WHAT TO INSTALL`.
  - A found line: each edition with its icon, title and its readiness text now visible (`Found` in green `#57d68d` with a check icon; anything else in amber as `.notReady` is today), then `in {source.name}`.
  - The `stopped` alert, mod problems and `plan.warnings` stay, under the found line.
  - The list (`role="group"`, name `What to install`). First row, not a control: a ticked grey box, `Game content` with a small `ALWAYS` tag, sub-line of the found editions' titles joined with ` and ` (one title when there is one), then count and size. Then one row per group as today (native checkbox inside its `<label>`, so the whole row toggles), restyled: 22px box, rows at least 60px tall, off rows in `#a7a29a`. The Movies hint becomes `Campaign cutscenes. Without them, cutscenes are black`. The mods button and dialog are unchanged; the button is 44px tall.
  - The left-out line becomes a disclosure button `{n} other files are left out` (`aria-expanded`); open, it shows `Tools, the game’s exe and DLLs, and files the game does not read are not copied.` Not rendered when `n` is 0.
- Right, an `<aside aria-label="Space">`:
  - `SPACE NEEDED`, then `formatBytes(plan.bytes)` large.
  - With a `quota`: a meter (`role="img"`, label `{size} of {quota}`), width `plan.bytes / quota` clamped to 2–100%, and `of the {formatBytes(quota)} this browser allows`. Without a quota: neither.
  - When the folder has movies (`found.movies.count > 0`) and Movies is off: the amber note `Cutscenes will be black. You can add the movies later on the GAME tab.`
  - The primary `INSTALL {size}` button (disabled when `stopped`), then `CHOOSE ANOTHER FOLDER` (it was `OTHER FOLDER`).

- [ ] **Step 1: Write the failing tests.** Update the existing review tests for the new names (`CHOOSE WHAT TO INSTALL`, `What to install`, `CHOOSE ANOTHER FOLDER`) and for movies being ticked at first (`"brings the real movie archive when asked"` becomes `"brings the movies unless they are unticked"`). Add:
  - `"says which games were found and where"`.
  - `"shows the space the install needs against what the browser allows"`: with `estimate` returning `{ quota }`, the meter's label is `{size} of {quota}`; with `{}`, no meter and no `NaN`.
  - `"warns that cutscenes will be black when the movies are unticked"`, and not when the folder has no movies.
  - `"says what is left out when asked"`: the sentence appears only after the disclosure is clicked.
  - `"names one game when the folder has one"`: an RA2-only folder's Game content row reads `Red Alert 2`, with no `and`.
- [ ] **Step 2: Run** the file. Expected: the changed and new tests fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** again, and `pnpm typecheck`. Expected: pass.
- [ ] **Step 5: Commit** `feat(web): install step 2 confirms what was found and shows the space`.

### Task 7: Installing and failed steps

**Files:**
- Modify: `web/src/screens/Import.tsx` (`Stage`, `start`, `Copying`, the failed branch), `web/src/screens/Import.module.css`
- Test: `web/src/screens/Import.test.tsx`

**Interfaces:**
- Consumes: `onSlot`, `onFileDone` (Task 1); `partProgress` (Task 2).
- `Stage` changes: `copying` gains `plan: ImportPlan` and `done: ReadonlySet<string>`; `failed` gains `retry?: { prepared: Prepared; progress: CopyProgress | null }`.

**Behaviour:**
- `Import` keeps the running installation in a ref, starting at the `slot` prop; `onSlot` sets it; every `runImport` call passes it as `slot` when set. A second attempt then resumes the same installation.
- `start` collects `onFileDone` paths in a `Set` and puts a fresh copy on the stage with each progress event.
- When the copy fails (not cancelled): do not close the source; go to `failed` with `retry`. When it is cancelled or finishes: close the source as today. Cancelling still returns to step 1 with `Cancelled. What was copied is kept: RESUME INSTALL carries on.`
- A failure while looking has no `retry`.

**Installing** (board state "copy"):
- `INSTALLING` with the percentage large and amber beside it (`62%`).
- The bar; under it `{done} of {total}` and the current file name in monospace.
- A list named `Parts` from `partProgress(plan, done, progress?.file ?? null, filesFinished)`, where `filesFinished` is `progress.doneFiles >= progress.totalFiles`. Each item: a dot, the label, a note (`done`: the size; `copying`: `{doneBytes} of {bytes}`; `waiting`: the size), and the state word `DONE`, `COPYING` or `WAITING`. Colours: done `#57d68d`, copying `#f1ede6`, waiting `#8a8c92`. Two columns, one under 900px.
- The persistent-storage warning as today.
- `CANCEL`, beside the note `Keep this tab open until it finishes. If you cancel, what was copied is kept and RESUME INSTALL carries on.`

**Failed** (board state "failed"), a `role="alert"` block:
- A warning icon and `THAT DID NOT WORK`; the error message.
- With `retry.progress`: a thin bar at the copied share and `{done} of {total} was copied and is kept. TRY AGAIN carries on from there.` The current step is marked `data-state="failed"`.
- `TRY AGAIN`: with `retry`, calls `start(retry.prepared)`; without, returns to step 1 (today's behaviour).
- `CHOOSE ANOTHER FOLDER`: closes the source and returns to step 1.
- With `onGuide`: the link-styled button `Read the install guide`.

- [ ] **Step 1: Write the failing tests.** Keep `"shows the copy with a CANCEL button"` passing. Add:
  - `"shows each part of the copy and where it stands"`: during a copy held open by the file's existing pattern, the list `Parts` has `Game content`, and an item reads `COPYING` or `DONE`.
  - `"says to keep the tab open"`.
  - `"a failed copy says what was kept and tries again in the same installation"`: make the target fail on the second file; the alert shows `was copied and is kept`; let the target succeed and click `TRY AGAIN`; `onDone` is called and the manifest holds exactly one installation.
  - `"a failed copy can go back to choose another folder"`.
  - `"a failure before the copy only offers to try again from the start"`: no `was copied` line.
- [ ] **Step 2: Run** the file. Expected: the new tests fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test`, `pnpm typecheck`, `pnpm lint`. Expected: only the failures written down before Task 1.
- [ ] **Step 5: Commit** `feat(web): the install shows each part, and a failed copy can be tried again`.

### Task 8: Check in the browser and write it up

**Files:**
- Modify: `docs/web/install-redesign-status.md`

- [ ] **Step 1:** Start the dev server the project's way (see `docs/web/testing.md`) and open the launcher with `?mute`. Never sign in to anything.
- [ ] **Step 2:** Check the empty Play tab (if a game is installed, say so and check `/import?resume=` is not needed; do not remove anyone's install) and `/import` step 1 at desktop width and at 390px wide: no sideways scroll, every control reachable by Tab, the WHERE IS MY GAME? entries open and close. The folder picker cannot be driven from the automated browser: say which steps you could not see.
- [ ] **Step 3:** Write in the status doc what is done, what was checked in a browser and how, what was not, and any test that was already failing. Note that `docs/web/frontend.md` still needs its install section updated by the session that owns it.
- [ ] **Step 4: Commit** `docs(web): install redesign status`.
