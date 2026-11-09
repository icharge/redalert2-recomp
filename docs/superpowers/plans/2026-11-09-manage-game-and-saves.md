# Manage Game and Saved Games Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the design board's Install and Game changes into the launcher. The Install screen's mods list opens as a dialog. The Game tab gets a MANAGE GAME panel with a storage breakdown, actions, a REMOVE… dialog, and a SAVED GAMES dialog that lists each save with its title and details, and can download or remove it.

**Architecture:** Two new storage modules do the work: `save-info.ts` reads a save's title and details from the file, and `install-parts.ts` measures and removes each part of an install (game content, mods, maps, saves, settings). `save-library.ts` lists, reads and removes single saves. `GameScreen.tsx` gets new actions in `GameActions`, wired in `App.tsx`, and three new components under `screens/launcher/game/`. Every destructive action asks first, inline: a confirmation strip that replaces the row or footer, never a second pop-up.

**Tech Stack:** React 19, TypeScript, Radix Themes (`Dialog`, as `RemoveButton` uses `AlertDialog` today), CSS modules, Vitest with Testing Library, OPFS and IndexedDB through `storage/opfs.ts` and `storage/manifest.ts`.

**Spec:** the "RA2 Web Launcher Redesign" design canvas, boards `A-Install.dc.html` (version 93) and `A-Game.dc.html` (version 101), plus the comment threads on them (2026-11-09). This plan restates what each board shows, so executors don't need canvas access.

## Global Constraints

- Work on `web-port`. Another session has uncommitted changes in this checkout (`LauncherTab.tsx`, `CrashDialog.test.tsx`, `cursor-preferences.ts`, `presenter.c`, `run_lift.py` and others): never stage, revert or stash them; `git add` only this plan's files, by path.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Don't push.
- Labels are upper case, in the launcher's Barlow Condensed button style: MANAGE GAME, BROWSE FILES, REINSTALL GAME, SAVED GAMES…, REMOVE…, REMOVE ALL, KEEP, CANCEL, DONE.
- Confirmations are inline (the row or footer turns into "<question> [CONFIRM] [KEEP/CANCEL]" on a light red ground, `rgba(211, 38, 43, 0.1)`), never a nested dialog. Once confirmed, a removal is final: there is no Undo.
- Copy that tells the player something is safe must stay true: "Your own game folder isn't touched." Saves, settings and mods survive REINSTALL GAME.
- Tests: `pnpm --dir web test` (Vitest) and `pnpm --dir web typecheck` must pass at each commit, apart from the 3 failing tests that belong to the other session's cursor removal (`CrashDialog.test.tsx`, `LauncherTab`), which you name in your report and leave alone.
- Browser checks use `?mute`. Never sign in to anything.
- Keep `docs/web/manage-game-status.md` updated as you go (what's done, what's checked, what's left), and commit it with each task.

## Review Focus

1. **A save present in both places.** A save the import brought (in `game.files`) and a save of the same name the game wrote since (in `save/<storage>/`) are one save. It must list once, and removing it must delete both copies, or the old one comes back on the next start. Test in Task 2.
2. **A save the reader can't parse.** A truncated save, an unknown format, or a save from a modded game: the row still shows, titled by its file name without `.sav`, with "Saved <date>" from the file's time. Never a crash, never a missing row. Test in Task 1 and Task 4.
3. **Removing game content while other parts stay.** REMOVE… with only "Game content" ticked must leave saves and settings in `save/<storage>/`. Mods go with the install's records today (`Manifest.removeRecords` deletes `mods:<storage>`), so the dialog says so. Test in Task 3.
4. **REINSTALL GAME keeps the slot.** A new slot means a new `storage` name (`slot-<n>-<id>`), which would orphan saves, settings and mods. Reinstall must re-copy into the same slot: mark the files missing, then open `/import?resume=<slot>`. Test in Task 3 and Task 6.
5. **A removal that fails half way** (a file held by the game in another tab: `NoModificationAllowedError`). The dialog shows the error from `remove-install.ts`'s wording, keeps what it couldn't remove listed, and the sizes are re-measured. Test in Task 3 and Task 5.

---

### Task 1: Read a save's title and details

**Files:**
- Create: `web/src/storage/save-info.ts`
- Create: `web/src/storage/save-info.test.ts`
- Create: `web/src/storage/fixtures/save-ra2.sav`, `web/src/storage/fixtures/save-ra2md.sav`
- Modify: `docs/web/storage.md` (a "Saved game files" section)

**Interfaces:**
- Produces: `export interface SaveInfo { description: string; scenario?: string; savedAt?: number /* ms since epoch */ }` and `export function readSaveInfo(data: Uint8Array): SaveInfo | null`.

A `.sav` file is an OLE compound file (signature `D0 CF 11 E0 A1 B1 1A E1`). The game's Load Game screen reads its details from a property set stream in it. Which stream and which property ids hold what is not recorded anywhere in this repo, so step 1 finds out from real files.

- [ ] **Step 1: Get two real saves and find the fields**

In the browser build (`pnpm --dir web dev`, then `/?mute`), start a skirmish in each edition, save it with a description you type (for example `PLAN TEST RA2`), and note what the game's own Load Game list shows for it (description, and any scenario or date column). Download the saves with the Game tab's DOWNLOAD .ZIP and unzip them into `web/src/storage/fixtures/` under the names above. If either is over 2 MB, record a ruling and build a small synthetic compound file in the test instead.
Then dump every stream and property with a throwaway script in the scratchpad (not committed). Record the stream name, each property id, its type, and which one holds the description, scenario and save time, in `docs/web/storage.md` under "Saved game files".

- [ ] **Step 2: Write the failing tests**

```ts
it("reads the title the game shows in Load Game", () => {
  const info = readSaveInfo(fixture("save-ra2.sav"));
  expect(info?.description).toBe("PLAN TEST RA2"); // the description typed in step 1
});
it("reads Yuri's Revenge saves too", () => {
  expect(readSaveInfo(fixture("save-ra2md.sav"))?.description).toBe("PLAN TEST YR");
});
it("reads when it was saved", () => {
  expect(readSaveInfo(fixture("save-ra2.sav"))?.savedAt).toBe(/* the value found in step 1, as ms */);
});
it("answers null for a file that is not a save", () => {
  expect(readSaveInfo(new Uint8Array([1, 2, 3]))).toBeNull();
  expect(readSaveInfo(fixture("save-ra2.sav").slice(0, 600))).toBeNull(); // cut short
});
```
Add a `scenario` assertion only if step 1 found a scenario field.

- [ ] **Step 3: Run the tests and watch them fail**

Run: `pnpm --dir web exec vitest run src/storage/save-info.test.ts`
Expected: FAIL, `readSaveInfo` is not exported.

- [ ] **Step 4: Implement `readSaveInfo` in `save-info.ts`**

Parse the compound file (512-byte header, FAT, directory entries, and the mini stream for streams under 4096 bytes), open the stream found in step 1, and read the property set (MS-OLEPS: section offset, then id/offset pairs, `VT_LPWSTR`/`VT_LPSTR` strings, `VT_FILETIME` times). Any bounds or format problem returns `null`, never throws. No new dependency.

- [ ] **Step 5: Run the tests and watch them pass**

Run: `pnpm --dir web exec vitest run src/storage/save-info.test.ts`
Expected: PASS, 4 tests (5 with scenario).

- [ ] **Step 6: Commit**

```bash
git add web/src/storage/save-info.ts web/src/storage/save-info.test.ts web/src/storage/fixtures/save-ra2.sav web/src/storage/fixtures/save-ra2md.sav docs/web/storage.md docs/web/manage-game-status.md
git commit -m "web: read a saved game's title and details from the file"
```

### Task 2: List, read and remove single saves

**Files:**
- Create: `web/src/storage/save-library.ts`
- Create: `web/src/storage/save-library.test.ts`

**Interfaces:**
- Consumes: `readSaveInfo` (Task 1); `SaveStore`, `SavedFile`, `isSavePath` from `saves.ts`; `Manifest.deleteFiles`; `CopyTarget`, `gamePath`, `readGameFile` from `opfs.ts`.
- Produces:
  ```ts
  export interface SaveEntry {
    name: string;          // as the game keeps it, e.g. "SAVE0003.SAV" or "Saved Games/x.sav"
    size: number;
    modified: number;      // ms
    info: SaveInfo | null;
    written: boolean;      // the game wrote it since the import (in save/<storage>/)
    imported: boolean;     // it came with the import (in game.files)
  }
  export interface SaveLibraryDeps { store: SaveStore; manifest: Manifest; target: CopyTarget;
    readImported(home: string, name: string): Promise<Uint8Array> }
  export function listSaves(deps: SaveLibraryDeps, game: GameRecord): Promise<SaveEntry[]>; // newest first
  export function readSave(deps: SaveLibraryDeps, game: GameRecord, save: SaveEntry): Promise<Uint8Array>;
  export function removeSaves(deps: SaveLibraryDeps, game: GameRecord, saves: SaveEntry[]): Promise<void>;
  ```

- [ ] **Step 1: Write the failing tests** (in-memory `SaveStore`, a fake `CopyTarget` recording `remove` calls, and a real `Manifest` on `fake-indexeddb` as `manifest.test.ts` does)

```ts
it("lists written and imported saves once each, newest first", async () => {
  // written: SAVE0002.SAV (t=200); imported: SAVE0001.SAV (t=100), SAVE0002.SAV (t=50)
  const saves = await listSaves(deps, game);
  expect(saves.map((s) => [s.name, s.written, s.imported])).toEqual([
    ["SAVE0002.SAV", true, true], ["SAVE0001.SAV", false, true]]);
});
it("leaves out files that are not saves, such as RA2MD.INI", async () => { /* ... */ });
it("removes both copies of a save, so it does not come back", async () => {
  await removeSaves(deps, game, [saveNamed("SAVE0002.SAV")]);
  expect(target.removed).toEqual(expect.arrayContaining([
    "save/ra2md/SAVE0002.SAV", gamePath("ra2md", "SAVE0002.SAV")]));
  expect((await manifest.getGame("ra2md", 1))?.files["SAVE0002.SAV"]).toBeUndefined();
});
it("reads the written copy over the imported one", async () => { /* readSave returns the written bytes */ });
it("still lists a save it cannot read, with info null", async () => { /* garbage bytes */ });
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --dir web exec vitest run src/storage/save-library.test.ts`
Expected: FAIL, the module does not exist.

- [ ] **Step 3: Implement `save-library.ts`**

Match names without regard to case, as `exportSaves` does. `removeSaves` removes the written copy with `target.remove("save/<storage>/<name>")`, then the imported one with `manifest.deleteFiles(game.slot, game.id, names)` and a `target.remove` of each path it returns. It collects failures and throws one `Error` afterwards, like `removeInstall`.

- [ ] **Step 4: Run them and watch them pass**

Run: `pnpm --dir web exec vitest run src/storage/save-library.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit** `save-library.ts`, its test and the status doc: `web: list, read and remove single saved games`.

### Task 3: Measure and remove the parts of an install, and reinstall

**Files:**
- Create: `web/src/storage/install-parts.ts`
- Create: `web/src/storage/install-parts.test.ts`

**Interfaces:**
- Consumes: `classify` (`install.ts`), `isSettingsPath` (`settings-files.ts`), `listMods`/`removeMod` (`mods.ts`), `listSaves`/`removeSaves` (Task 2), `removeInstall` (`remove-install.ts`), `Manifest.deleteFiles`, `Manifest.markFilesMissing`.
- Produces:
  ```ts
  export type InstallPart = "game" | "mods" | "maps" | "saves" | "settings";
  export type PartSizes = Record<InstallPart, number>; // bytes
  export function measureParts(deps: SaveLibraryDeps, install: ActiveInstall): Promise<PartSizes>;
  export function removeParts(deps: SaveLibraryDeps, install: ActiveInstall, parts: InstallPart[]): Promise<void>;
  export function prepareReinstall(manifest: Manifest, install: ActiveInstall): Promise<void>;
  ```

What each part is, across every edition of the install:
- `maps`: `game.files` whose `classify(name)?.kind === "map"`.
- `saves`: every save from `listSaves`.
- `settings`: `game.files` of kind `"settings"`, plus the written files under `save/<storage>/` for which `isSettingsPath` is true.
- `mods`: every `listMods(manifest, game.storage)` record.
- `game`: all of `game.files` except maps, saves and settings.

- [ ] **Step 1: Write the failing tests**

```ts
it("measures each part of a two-edition install", async () => {
  expect(await measureParts(deps, install)).toEqual({ game: 2000, mods: 140, maps: 18, saves: 9, settings: 4 });
});
it("removes only the ticked parts", async () => {
  await removeParts(deps, install, ["maps", "mods"]);
  const after = await measureParts(deps, await reloadInstall());
  expect(after).toMatchObject({ maps: 0, mods: 0, saves: 9, settings: 4 });
});
it("removing game content keeps saves and settings in save/<storage>/", async () => {
  await removeParts(deps, install, ["game"]);
  expect(target.removed.some((p) => p.startsWith("save/"))).toBe(false);
});
it("removes game content last, after the parts that need its records", async () => {
  await removeParts(deps, install, ["game", "saves", "mods"]);
  const lastSave = target.removed.findLastIndex((p) => p.startsWith("save/"));
  const firstGame = target.removed.findIndex((p) => p === gamePath("ra2md", "a.mix"));
  expect(firstGame).toBeGreaterThan(lastSave);
});
it("reports a file it could not remove and leaves the rest removed", async () => {
  target.failOn("game/ra2md/a.yrm", new DOMException("held", "NoModificationAllowedError"));
  await expect(removeParts(deps, install, ["maps"])).rejects.toThrow(/in use/);
});
it("prepares a reinstall in the same slot: every game file marked missing, saves untouched", async () => {
  await prepareReinstall(manifest, install);
  const yr = await manifest.getGame("ra2md", 1);
  expect(Object.values(yr!.files).every((f) => !f.done)).toBe(true);
  expect(yr!.storage).toBe(install.editions[1]!.storage);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --dir web exec vitest run src/storage/install-parts.test.ts`
Expected: FAIL, the module does not exist.

- [ ] **Step 3: Implement `install-parts.ts`**

The order is settings, saves, maps, mods, then game (through `removeInstall(manifest, target, slot)`). Reuse `remove-install.ts`'s `notRemoved` wording: export it rather than copying it. `prepareReinstall` calls `markFilesMissing(id, names, slot)` for every non-save, non-settings file of each edition.
Before writing `prepareReinstall`, read `Import.tsx` and `App.tsx`'s `resume` handling and confirm that `/import?resume=<slot>` re-copies files marked missing (`needsResume`). If it doesn't, rule on the smallest change to make it, and record the ruling.

- [ ] **Step 4: Run them and watch them pass**

Run: `pnpm --dir web exec vitest run src/storage/install-parts.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**: `web: measure and remove each part of an install, and prepare a reinstall`.

### Task 4: The SAVED GAMES dialog

**Files:**
- Create: `web/src/screens/launcher/game/SavedGamesDialog.tsx`, `SavedGamesDialog.module.css`, `SavedGamesDialog.test.tsx`

**Interfaces:**
- Consumes: `SaveEntry` (Task 2); `EDITION_BRAND`, `EditionIcon`, `formatBytes`; `Page.module.css` classes (`dialog`, `dialogTitle`, `primary`, `outline`, `quiet`).
- Produces:
  ```tsx
  export interface SavesGroup { game: GameRecord; saves: SaveEntry[] }
  export function SavedGamesDialog(props: {
    open: boolean; onOpenChange(open: boolean): void;
    groups: SavesGroup[];                       // one per edition, in rail order
    onDownload(game: GameRecord, save: SaveEntry): Promise<void>;
    onRemove(game: GameRecord, saves: SaveEntry[]): Promise<void>;
    onDownloadZip(game: GameRecord): Promise<string>;  // the existing onDownloadSaves
    onImportZip(game: GameRecord, zip: File): Promise<string>; // the existing onImportSaves
  }): JSX.Element;
  export function saveTitle(save: SaveEntry): string;   // info.description, else the name without ".sav"
  export function saveDetails(save: SaveEntry): string; // [info.scenario, "Saved 2 Nov 2026, 21:14"].join(" · ")
  ```

What the board shows (`A-Game.dc.html`):
- **Header:** the title SAVED GAMES, the line "The saves in this browser, by game. Download one to keep a copy, or remove it.", and a close (X) button.
- **Groups:** one per edition, headed by the edition icon, its upper-case name and a count ("3 saves", "1 save", "No saves").
- **Row:** the title (16px, semibold); the details line (13px, muted); the file name (12px, monospace, muted); the size; a download icon button (aria-label "Download <name>"); and a red remove icon button (aria-label "Remove <name>").
- **Remove on one row:** the row's ground turns light red, and the size and buttons give way to "Remove this save?" with REMOVE (solid red) and KEEP. Opening another row's confirmation cancels the first.
- **Footer:** REMOVE ALL (red outline), then DONE. Pressed, REMOVE ALL turns the footer into a red strip: "Remove all 6 saves?" over "They can't be brought back. Download them first to keep them.", with REMOVE ALL (solid) and CANCEL. REMOVE ALL is disabled when there are no saves.
- **Zips:** each group's header row carries DOWNLOAD .ZIP and IMPORT .ZIP (quiet buttons), because a zip belongs to one edition. The board had them in the footer; ledger this as a ruling.
- **Closing** the dialog cancels any open confirmation.

- [ ] **Step 1: Write the failing tests**

```tsx
it("groups saves by edition with their titles, details and file names", async () => { /* two groups, headings "RED ALERT 2" and "YURI'S REVENGE", "3 saves" */ });
it("titles a save it could not read by its file name", () => {
  expect(saveTitle({ ...save, name: "SAVE0004.SAV", info: null })).toBe("SAVE0004");
});
it("formats the details line", () => {
  expect(saveDetails({ ...save, info: { description: "x", savedAt: Date.UTC(2026, 10, 2, 21, 14) } }))
    .toMatch(/^Saved 2 Nov 2026, \d\d:14$/);
});
it("asks inline before removing one save, and KEEP cancels", async () => { /* onRemove not called after KEEP */ });
it("removes one save after REMOVE", async () => { /* onRemove called with [that save] */ });
it("asks before removing all, then removes every save of every edition", async () => { /* onRemove once per game */ });
it("downloads one save", async () => { /* onDownload called with game and save */ });
it("shows the error and keeps the row when a removal fails", async () => { /* onRemove rejects → role=alert text */ });
```

- [ ] **Step 2: Run them and watch them fail**: `pnpm --dir web exec vitest run src/screens/launcher/game/SavedGamesDialog.test.tsx`. Expected: FAIL, the module does not exist.
- [ ] **Step 3: Implement the dialog** with Radix `Dialog` (Escape and focus trapping as `LinkDialog` has them), the list scrolling inside the dialog (`max-height: calc(100vh - 160px)`), and dates through `Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })`.
- [ ] **Step 4: Run them and watch them pass.** Expected: PASS, 8 tests.
- [ ] **Step 5: Commit**: `web: a saved games dialog, by game, with download and remove`.

### Task 5: The REMOVE… dialog

**Files:**
- Create: `web/src/screens/launcher/game/RemoveDialog.tsx`, `RemoveDialog.module.css`, `RemoveDialog.test.tsx`

**Interfaces:**
- Consumes: `InstallPart`, `PartSizes` (Task 3).
- Produces: `export function RemoveDialog(props: { open: boolean; onOpenChange(open: boolean): void; sizes: PartSizes | null; onRemove(parts: InstallPart[]): Promise<void> }): JSX.Element`.

What the board shows:
- **Header:** the title REMOVE FROM THIS BROWSER, the line "Pick what to remove. Your own game folder isn't touched.", and X.
- **Rows:** one checkbox row per part, with name, hint and size. Each is a real `<input type="checkbox">` in a `<label>`, as `Import.tsx` does. A part of size 0 is disabled.
  - Game content: "Red Alert 2 and Yuri's Revenge" (or the one edition's name)
  - Mods: "<n> mods, and their slots on the MODS tab"
  - Custom maps: "<n> maps you added or downloaded"
  - Saved games: "<n> saves"
  - Settings and hotkeys: "Back to the game's defaults"
  - Mods and Custom maps start ticked; the others start unticked.
- **Warnings:**
  - Game content ticked: "Without game content, both games need installing again. Mods go with it."
  - Saved games ticked: "Removed saves can't be brought back. Download them first to keep them."
- **Footer:**
  - REMOVE EVERYTHING · <total> (red outline) on the left. It does not remove at once: it turns the footer into the inline strip "Remove everything, <total>?" with REMOVE EVERYTHING (solid) and CANCEL. This is a ruling: the board removed straight away, but this is the costliest action.
  - CANCEL and REMOVE <ticked total> (solid red) on the right. With nothing ticked, REMOVE is disabled and reads REMOVE.
- **Working:** while a removal runs, the buttons are disabled and the main button reads REMOVING…. When it fails, the error shows in `role="alert"` and the dialog stays open.

- [ ] **Step 1: Write the failing tests**

```tsx
it("starts with mods and maps ticked, and the button says their total", () => { /* "REMOVE 158 MB" */ });
it("disables a part with nothing in it", () => { /* sizes.mods = 0 → Mods checkbox disabled */ });
it("warns when game content or saves are ticked", async () => { /* both texts appear */ });
it("removes the ticked parts", async () => { /* onRemove(["mods","maps"]) */ });
it("asks inline before removing everything", async () => { /* strip → onRemove(all five) */ });
it("keeps the dialog open with the error when removing fails", async () => { /* role=alert */ });
```

- [ ] **Step 2: Run them, expect FAIL** (no module).
- [ ] **Step 3: Implement.** Sizes through `formatBytes`. Five rows: no table-driven abstraction beyond one `PARTS` array, like `Import.tsx`'s `GROUPS`.
- [ ] **Step 4: Run them, expect PASS** (6 tests).
- [ ] **Step 5: Commit**: `web: a remove dialog that picks the parts of the install`.

### Task 6: The MANAGE GAME panel, wired in

**Files:**
- Create: `web/src/screens/launcher/game/ManagePanel.tsx`, `ManagePanel.module.css`
- Modify: `web/src/screens/launcher/GameScreen.tsx` (replace the right column: SAVED GAMES section, `StoragePanel`, `RemoveButton`; take BROWSE FILES out of INSTALLED)
- Modify: `web/src/screens/launcher/GameScreen.test.tsx`
- Modify: `web/src/App.tsx` (the `/manage` route's props)
- Modify: `docs/web/frontend.md` (Launcher, item 4 "Game")

**Interfaces:**
- Consumes: Tasks 2–5.
- Produces, added to `GameActions`:
  ```ts
  listSaves(game: GameRecord): Promise<SaveEntry[]>;
  onDownloadSave(game: GameRecord, save: SaveEntry): Promise<void>;
  onRemoveSaves(game: GameRecord, saves: SaveEntry[]): Promise<void>;
  measureParts(install: ActiveInstall): Promise<PartSizes>;
  onRemoveParts(install: ActiveInstall, parts: InstallPart[]): Promise<void>;
  onReinstall(install: ActiveInstall): Promise<void>; // App: prepareReinstall, then navigate(`/import?resume=${slot}`)
  ```
  `onRemove`, `onDownloadSaves` and `onImportSaves` stay: OLDER COPIES and the zip buttons use them.

What the board shows (right column, one panel):
- **Heading:** MANAGE GAME.
- **Storage:** "Browser storage" with "4.3 GB of 60 GB" (from `estimate`), the bar, then a list: Game content, Mods, Custom maps, Saved games (from `measureParts`), and "Cache and other" (usage minus their sum, never below 0; hidden when 0). With no estimate, the bar and the "of" figure are left out, but the list stays.
- **Actions:** a list of full-width rows, each with an icon:
  - BROWSE FILES (moved from INSTALLED)
  - REINSTALL GAME
  - SAVED GAMES… (with the save count on the right)
  - REMOVE… (red)
- **REINSTALL GAME confirms inline:** its row becomes "Reinstall? Saves, settings and mods are kept." with REINSTALL and CANCEL.
- **INSTALLED** keeps the editions, ADD MOVIES and RESUME INSTALL.
- **Refresh:** after any removal, the panel re-measures and re-lists, using the existing `removed` counter as the refresh key.

- [ ] **Step 1: Update `GameScreen.test.tsx` first**
  - Replace the tests for the old SAVED GAMES section and the REMOVE GAME alert dialog with tests that:
    - see the storage breakdown;
    - open SAVED GAMES… and REMOVE…;
    - confirm and cancel REINSTALL GAME (with `onReinstall` called only after REINSTALL);
    - check that BROWSE FILES still opens the file explorer.
  - Keep the OLDER COPIES tests unchanged.
- [ ] **Step 2: Run them and watch them fail.** Run: `pnpm --dir web exec vitest run src/screens/launcher/GameScreen.test.tsx`. Expected: FAIL on the new tests.
- [ ] **Step 3: Implement `ManagePanel` and change `GameScreen`.** Then wire `App.tsx`:
  - The deps are `{ store: opfsSaveStore(), manifest, target, readImported: readGameFile }`, with `manifestWork(...)` around removals, as `onRemove` uses it.
  - `onDownloadSave` downloads the bytes under the save's own name, the same way `onDownloadSaves` makes its link.
  - Every removal ends with `await reload()`, as `onRemove` does.
- [ ] **Step 4: Run the whole page suite and typecheck**
  Run: `pnpm --dir web test` and `pnpm --dir web typecheck`.
  Expected: all pass, except the other session's 3 known failures. Name them in the report.
- [ ] **Step 5: Check it in the browser** (`?mute`, with a real install):
  - the panel and the breakdown;
  - SAVED GAMES… lists the saves from Task 1 with their titles;
  - download one;
  - remove one, and see it gone after a reload;
  - REMOVE… with Custom maps only;
  - REINSTALL GAME, then CANCEL.
  Record what was checked in the status doc.
- [ ] **Step 6: Update `docs/web/frontend.md`** item 4 for the new panel and dialogs, and commit: `web: the Game tab's MANAGE GAME panel, saved games and remove dialogs`.

### Task 7: The Install screen's mods list as a dialog

**Files:**
- Modify: `web/src/screens/Import.tsx:431-460` (`ModList`) and `:548-593` (the Mods row)
- Modify: `web/src/screens/Import.module.css`, `web/src/screens/Import.test.tsx` (the test "opens the mods to show each one's game, size and files")
- Modify: `docs/web/frontend.md` (item 5, Install)

What the board shows (`A-Install.dc.html`):
- **The Mods row:** stays one line. Its count button ("2 mods", with a right-pointing chevron and `aria-haspopup="dialog"`) opens a dialog in place of expanding the list.
- **The dialog:** titled MODS IN THE FOLDER, with the line "Each folder in Mods becomes a mod on the MODS tab. <count> · <size>" and a close (X) button.
- **Its list:** the existing `ModList` content (name, edition · size, the file list, and "Left out: patches the game" in amber), and a DONE button.
- **The click:** stays `preventDefault`ed, so it doesn't tick the checkbox (keep the existing comment).

- [ ] **Step 1: Change the existing test** to: click "2 mods" → `getByRole("dialog", { name: "MODS IN THE FOLDER" })` holds each mod's name and files → DONE closes it → the Mods checkbox is still ticked.
- [ ] **Step 2: Run it, expect FAIL**: `pnpm --dir web exec vitest run src/screens/Import.test.tsx`.
- [ ] **Step 3: Implement** with Radix `Dialog`, and remove `aria-expanded`/`aria-controls` and the inline list.
- [ ] **Step 4: Run it, expect PASS**, then `pnpm --dir web test` and `pnpm --dir web typecheck`.
- [ ] **Step 5: Commit**: `web: the install's mod list opens as a dialog`.
