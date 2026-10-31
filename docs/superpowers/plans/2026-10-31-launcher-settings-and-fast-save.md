# Launcher Game Settings, Immediate Save, and Fast Exit

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a browser player set the game's own settings (gameplay, audio, video, hotkeys) from the
launcher; persist every in-game settings change immediately so closing the tab loses nothing; and
return to the launcher quickly on Exit instead of waiting for the guest's save-and-teardown path.

**Architecture:** The game owns its settings. The launcher edits the per-edition copies in
`save/<storage>/` (`RA2.INI`/`RA2MD.INI`, `KEYBOARD.INI`/`KEYBOARDMD.INI`), which `restoreSaves`
lays over the import at the next start. A fast watcher plus a file-write hook in `win32hle` persist
in-game changes as the game writes them. With settings already persisted, the web host may skip the
guest's exit save and teardown and terminate immediately.

**Tech stack:** React 18, TypeScript, Radix UI Themes, Vitest, Emscripten, `win32hle` (sibling
`../pcrecomp` repository), Playwright e2e scripts.

**Related docs:** [storage.md](../../web/storage.md), [frontend.md](../../web/frontend.md),
[decisions.md](../../web/decisions.md), [protocol.md](../../web/protocol.md),
[testing.md](../../web/testing.md).

## Progress summary

| ID       | Track    | Task                                                      | Status      |
| -------- | -------- | --------------------------------------------------------- | ----------- |
| SAV-1    | Persist  | Classify edition settings files                           | Done        |
| SAV-2    | Persist  | Fast settings sync + `flushSettings()`                    | Done        |
| SAV-3    | Persist  | `pagehide` / hidden-tab flush                             | Done        |
| SAV-4    | Persist  | `win32hle` file-write hook + `settingsSaved` event        | Done        |
| SAV-5    | Persist  | Page reacts to `settingsSaved`                            | Done        |
| SAV-6    | Persist  | Edition-named host `.host` file + migration               | Done        |
| LAUNCH-1 | Launcher | INI/hotkey storage module + OPFS save reader              | Done        |
| LAUNCH-2 | Launcher | Unit tests for the storage module                         | Done        |
| LAUNCH-3 | Launcher | Gameplay/audio/video controls in the launcher             | Done        |
| LAUNCH-4 | Launcher | Keyboard/hotkey editor                                    | Done        |
| LAUNCH-5 | Launcher | Component tests                                           | Done        |
| LAUNCH-6 | Launcher | E2E: launcher values survive a launch                     | Done |
| LAUNCH-7 | Launcher | Document the launcher exception to D7                     | Done        |
| EXIT-0   | Exit     | Measure the exit timeline                                 | Done |
| EXIT-1   | Exit     | Persist settings before answering Exit / Quit             | Done        |
| EXIT-2   | Exit     | Fast exit from `ra2_web_exit_confirmation`                | Done        |
| EXIT-3   | Exit     | Fast exit from the presenter's `IN_QUIT`                  | Done        |
| EXIT-4   | Exit     | Bound `leaveGame`'s save flush                            | Done        |
| EXIT-5   | Exit     | E2E: exit time budget and settings survive                | Done |
| VERIFY-1 | Verify   | Typecheck, lint, unit tests                               | Done        |
| VERIFY-2 | Verify   | Build both editions                                       | Done        |
| DOC-1    | Docs     | Update storage/frontend/decisions/protocol/tasks/progress | Done        |
| DOC-2    | Docs     | Record the pcrecomp commit and its required version       | Done |

## Global constraints

- Game settings stay authoritative in the game's INI files; the launcher must not keep a second
  editable copy in IndexedDB/localStorage.
- The launcher is only available while no game is running. Do not write the save store during play.
- Preserve every INI line the launcher does not edit, byte for byte (ANSI/Latin-1).
- Do not add save-on-exit/quit code. Settings persist on change; exit may skip the guest save.
- Keep native Windows and Linux builds on their existing teardown path. All fast-exit changes are
  web-only (`__EMSCRIPTEN__`).
- Changes in `../pcrecomp` are separate commits with their own tests.
- Use the existing output format: booleans as `yes`/`no` where the shipped INI does, integers as
  written by the game, and volumes as decimals (`0.700000`).

## What the game writes

The game's own save points, found in the lifted code:

| Edition        | Main settings writer                         | Hotkey writer                                     |
| -------------- | -------------------------------------------- | ------------------------------------------------- |
| Yuri's Revenge | `sub_005FAD10` (`0x005FAD10`) -> `RA2MD.INI` | `sub_005FB320` (`0x005FB320`) -> `KEYBOARDMD.INI` |
| Red Alert 2    | `sub_005D91B0` (`0x005D91B0`) -> `RA2.INI`   | `sub_005D97A0` (`0x005D97A0`) -> `KEYBOARD.INI`   |

The main settings writer runs when the options dialog is applied (`sub_004E1D00` calls it on OK) and
again during the Exit path (`0x0052DE2F`). That duplication is why the exit save can be skipped once
changes are persisted.

Keys written by the main settings writer:

- `[Options]`: `GameSpeed`, `Difficulty`, `CampDifficulty` (Yuri only), `ScrollMethod`, `ScrollRate`,
  `AutoScroll`, `DetailLevel`, `SidebarCameoText`, `UnitActionLines`, `ShowHidden`, `ToolTips`
- `[Video]`: `ScreenWidth`, `ScreenHeight`, `StretchMovies`
- `[Audio]`: `SoundVolume`, `VoiceVolume`, `ScoreVolume`, `IsScoreRepeat`, `IsScoreShuffle`,
  `SoundLatency`, `InGameMusic`
- `[Network]`: `Socket`, `NetCard`, `DestNet`, `NetID` (not player-facing; out of scope)

Hotkeys live in `[Hotkey]` as Windows virtual-key values. Values above `0xff` carry modifiers:
`0x100` Shift, `0x200` Ctrl, `0x400` Alt (inferred from the shipped `TeamSelect` / `TeamAddSelect` /
`TeamCreate` / `TeamCenter` defaults; confirm during implementation).

## Current working tree

Already written on 2026-10-31, not yet used by a screen:

- `web/src/storage/game-settings.ts`: Latin-1 INI parsing/editing, per-edition file names, hotkey
  parsing and labels, `hotkeyFromEvent`, `loadGameSettings`, `writeGameSettings`.
- `web/src/storage/opfs.ts`: `readSaveFile(storage, name)` and `SavedSettingsFile`, a
  case-insensitive top-level reader for `save/<storage>/`.

`pnpm --dir web typecheck` passes with these changes. The save watcher and launcher UI are unchanged.

---

## Track 1: Persist settings immediately (SAV)

### SAV-1: Classify edition settings files

**Status:** Done. `settings-files.ts` owns the names and the path predicates; `saves.ts` and
`game-settings.ts` both import it.

**Files:**

- Created: `web/src/storage/settings-files.ts`
- Modify: `web/src/storage/saves.ts`
- Modify: `web/src/storage/game-settings.ts` (re-exports the names)

**Steps:**

- [x] Export a path predicate using `settingsFileNames(game)` plus `.host/<edition>.ini`.
- [x] Use it in `isProfileIniPath`/`storedBytes` so compaction covers both editions and the host file.
- [x] Keep `KEYBOARD.INI`/`KEYBOARDMD.INI` in the fast set but not in the oversized-INI compactor.

**Acceptance:** `settingsFileNames("ra2")` -> `ra2.ini`, `keyboard.ini`;
`settingsFileNames("ra2md")` -> `ra2md.ini`, `keyboardmd.ini`; one predicate is used by both the
watcher and the launcher.

### SAV-2: Fast settings sync and `flushSettings()`

**Status:** Done. Settings use a 250 ms pass and a separate one-stable-look pending map; `.sav`
keeps the two-look rule. `flushSettings()` runs two settings looks and is exposed on
`GameHandle.saves`.

**Files:**

- Modify: `web/src/storage/saves.ts`
- Modify: `web/src/game/loader.ts` (no extra call needed: `SaveSync` is the handle)

**Steps:**

- [x] Add a ~250 ms settings-only pass to `startSaveSync`, separate from the 2 s general pass.
- [x] Copy a settings file after one stable observation (size and mtime unchanged for one tick);
      keep the existing two-look rule for `.sav`.
- [x] Add `flushSettings()` to `SaveSync` that reads only the known settings files and awaits their
      OPFS writes.
- [x] Keep `flush()` for full shutdown/leave paths.
- [x] Expose `flushSettings()` on `GameHandle.saves` and call it from the pagehide/settings paths.

**Acceptance:** Changing a hotkey or volume and closing the tab within ~250 ms leaves the new value in
`save/<storage>/`; no torn INI is copied.

### SAV-3: `pagehide` and hidden-tab flush

**Status:** Done. The hidden-tab full flush stays; `pagehide` adds a best-effort
`flushSettings()`.

**Files:**

- Modify: `web/src/screens/Play.tsx`

**Steps:**

- [x] Keep the existing `visibilitychange === "hidden"` flush.
- [x] Add `pagehide` (capture) calling `flushSettings()` (best effort).
- [x] Document that an abrupt tab kill cannot be caught; SAV-2 is the real guarantee.

**Acceptance:** Hiding or closing the tab after a settings write does not lose the value.

### SAV-4: `win32hle` file-write hook

**Status:** Done. The hook and selftest are in `../pcrecomp` commit `3f78d82`; the other
working-tree edits there are separate.

**Files:**

- Modify: `../pcrecomp/runtime/win32hle/kernel32_ext.c`
- Modify: `../pcrecomp/runtime/win32hle/kernel32.c` (definition)
- Modify: `../pcrecomp/runtime/win32hle/win32hle.h`
- Modify: `../pcrecomp/runtime/win32hle/kernel32_ext_selftest.c`
- Modify: `src/web/main.c`

**Steps:**

- [x] Extend `hfile` with the host path and a written flag; set the path in `k_CreateFileA` and
      `lopen_common`, mark it in `k_WriteFile` and `k__lwrite`.
- [x] Add `void (*hle_on_file_written)(const char *path)` (or similar) called from `file_closer`
      when a written file's basename is a settings file.
- [x] Also notify after `k_WritePrivateProfileStringA` renames its temporary file.
- [x] Implement the callback in `src/web/main.c` as `{"e":"settingsSaved","path":"..."}`.
- [x] Add a `kernel32_ext_selftest` case for the hook; the web selftest passes.

**Acceptance:** Applying options or saving hotkeys emits exactly one `settingsSaved` event per file
write; unrelated files emit none.

### SAV-5: Page reacts to `settingsSaved`

**Status:** Done. The event is parsed, carried through `GameStore.line()`'s return value, and the
loader flushes settings immediately.

**Files:**

- Modify: `web/src/game/protocol.ts`
- Modify: `web/src/game/loader.ts`
- Modify: `web/src/game/store.ts`

**Steps:**

- [x] Add the event to the protocol type and the event switch.
- [x] Flush `saves.flushSettings()` on the event (no debounce: one file close is one event).
- [x] Ignore events after the runtime exits (the save sync is stopped by `leaveGame`).

**Acceptance:** An in-game settings change reaches OPFS within ~100 ms of the file close.

### SAV-6: Edition-named host settings

**Status:** Done. `HOST_INI` follows `RA2_TARGET_GAME`; Yuri migrates `.host/ra2.ini` once.

**Files:**

- Modify: `src/web/settings.c`
- Modify: `web/src/storage/settings-files.ts`, `web/src/storage/saves.ts`, tests

**Steps:**

- [x] Derive `HOST_INI` from the edition, so RA2 uses `.host/ra2.ini` and Yuri uses
      `.host/ra2md.ini`.
- [x] One-time migration: if the new file is absent, read the old `.host/ra2.ini` and rewrite it.
- [x] Keep `.host/` excluded from the file browser.
- [x] Update the settings-path and save-sync tests.

**Acceptance:** Both editions keep separate host settings; an existing Yuri `.host/ra2.ini` is
migrated once.

---

## Track 2: Game settings in the launcher (LAUNCH)

### LAUNCH-1: Storage module (in progress)

**Status:** Done. `web/src/storage/game-settings.ts`, `readSaveFile`, and the unit tests are in
place; typecheck and tests pass.

**Files:**

- Created: `web/src/storage/game-settings.ts`
- Modified: `web/src/storage/opfs.ts`
- Modify: `web/src/storage/game-settings.ts` as tests reveal gaps

**Interfaces:**

- `settingsFileNames(game): { main; keyboard }`
- `parseIni` / `serializeIni` / `getIniValue` / `setIniValue` (Latin-1, preserves untouched lines)
- `parseHotkeys` / `hotkeyLabel` / `hotkeyFromEvent`
- `loadGameSettings(game, deps?)`: saved file first, imported file second
- `writeGameSettings(game, name, data, deps?)`: writes `save/<storage>/<name>`

- [x] Implement the module and OPFS reader.
- [x] Typecheck (`pnpm --dir web typecheck`).
- [x] Add the tests in LAUNCH-2.

### LAUNCH-2: Unit tests for the storage module

**Status:** Done. 11 tests in `web/src/storage/game-settings.test.ts`.

**Files:**

- Created: `web/src/storage/game-settings.test.ts`

**Steps:**

- [x] CRLF and untouched-line preservation.
- [x] First section/key wins; missing section/key is created at the right place.
- [x] Saved file wins over imported; imported name case is preserved.
- [x] Write uses the resolved name (no `RA2MD.INI` + `ra2md.ini` duplicate).
- [x] `hotkeyFromEvent`: Shift+1 -> 305, Ctrl+1 -> 561, Alt+1 -> 1073; modifier-only -> null.
- [x] `hotkeyLabel` round-trips the shipped hotkey values.

**Acceptance:** `pnpm --dir web test -- game-settings` passes.

### LAUNCH-3: Gameplay/audio/video controls

**Status:** Done. Sliders write on `onValueCommit`, so there is nothing pending at close.

**Files:**

- Modified: `web/src/components/LauncherGameSettings.tsx`
- Modified: `web/src/components/LauncherGameSettings.module.css`

**Steps:**

- [x] Load `loadGameSettings(game)` when the dialog opens; show a loading/error state.
- [x] Add tabs: `Launcher` (existing controls), `Gameplay`, `Audio`, `Video`, `Keyboard`.
- [x] Render `[Options]` controls: GameSpeed, Difficulty, Campaign difficulty (Yuri), Scroll
      method, Scroll rate, Auto scroll, Detail level, Sidebar cameo text, Unit action lines, Show
      hidden, Tooltips.
- [x] Render `[Audio]` controls: Sound, Voice, Score volume (0-100%), Repeat, Shuffle, In-game
      music, Sound latency.
- [x] Render `[Video]`: Stretch movies. Keep the existing launcher Resolution control as the
      launch override; document its precedence.
- [x] Write sliders on commit; write switches/selects immediately.
- [x] No pending writes to flush: sliders commit before the dialog can close.
- [x] Show a short "applies next launch" note and write errors.

**Acceptance:** Every listed key can be changed; the value lands in `save/<storage>/<edition>.ini`
and other lines are unchanged.

### LAUNCH-4: Keyboard editor

**Status:** Done.

**Files:**

- Modified: `web/src/components/LauncherGameSettings.tsx`

**Steps:**

- [x] List `loaded.hotkeys` with a humanized action label and the current key label.
- [x] Click a key, then capture the next keydown with `hotkeyFromEvent`; Escape can be bound
      (the game's default `Options=27`) and a Cancel button cancels.
- [x] Write to `[Hotkey]` immediately and preserve the rest of the file.
- [x] Support all hotkeys present in the file; show an empty state if the import has no keyboard file.

**Acceptance:** Changing `Options`, `TeamCreate_1`, and `ScreenCapture` from the launcher survives a
relaunch; modifier combinations display and store correctly.

### LAUNCH-5: Component tests

**Status:** Done. 5 tests in `web/src/components/LauncherGameSettings.test.tsx`.

**Files:**

- Created: `web/src/components/LauncherGameSettings.test.tsx`

**Steps:**

- [x] Render with a memory `loadGameSettings`/`writeGameSettings` dependency.
- [x] Assert a switch, a select and a slider each write the expected INI change.
- [x] Assert a hotkey capture writes the expected value.
- [x] Assert the dialog stays usable if a write rejects (error shown, other controls still work).

**Acceptance:** `pnpm --dir web test -- LauncherGameSettings` passes.

### LAUNCH-6: E2E launcher settings survive a launch

**Status:** Done for both editions. `web/e2e/launcher-settings.mjs` changes Auto scroll, Sound
volume (40%) and a hotkey (F5), starts the game, reads the restored `RA2.INI`/`RA2MD.INI` and
`KEYBOARD.INI`/`KEYBOARDMD.INI`, exits, and confirms the launcher reads all three back. Run with
`--profile ../work/perf/profile-fresh --edition ra2md|ra2`.

**Files:**

- Created: `web/e2e/launcher-settings.mjs`

**Steps:**

- [x] Open launcher settings for Yuri and RA2.
- [x] Change a gameplay value, volume, and hotkey.
- [x] Start the game and confirm the restored INI/keyboard values.
- [x] Exit and confirm the launcher reads them back.

**Acceptance:** Both editions pass.

### LAUNCH-7: Document the D7 exception

**Status:** Done.

**Files:**

- Modified: `docs/web/decisions.md` (D7), `docs/web/frontend.md`, `docs/web/storage.md`,
  `docs/web/protocol.md`, `docs/web/tasks.md`, `docs/web/progress.md`

- [x] Record that the launcher edits the game's own INI files (no second copy) and that the F10
      menu remains authoritative during play.

---

## Track 3: Fast exit (EXIT)

### EXIT-0: Measure the exit timeline

**Status:** Done. The run uses the existing imported profile
(`work/perf/profile-fresh`) at `/game/1`, so it does not copy the 1.1 GB `../game` folder into
memory. Result: **152 ms** from the Exit click to the launcher URL, with no native Exit dialog and
zero workers left.

**Files:**

- Modify: `web/e2e/exit-confirm.mjs`

**Steps:**

- [x] Instrument the confirmation-to-URL time in the e2e report.
- [x] Run against the pre-imported profile and a build; record 152 ms.
- [x] Keep the 4 s regression guard in the report.

**Note:** the first `--build` attempts failed because the published `ra2md.wasm.br`/`.gz` sidecars
did not match the new `ra2md.js`/`.wasm`. The passing run used a matching published set; any future
fast-build run must copy or regenerate the sidecars too.

**Acceptance:** We know whether the delay is the guest save, teardown, page flush, or navigation.

### EXIT-1: Persist before answering Exit / Quit

**Status:** Done. The page uses the full `flush()` before replying (settings and an
in-progress `.sav`), then `leaveGame(..., flush=false)` skips the duplicate.

**Files:**

- Modify: `web/src/screens/Play.tsx`

**Steps:**

- [x] `answerExitConfirmation(true)`: `await saves.flush()` before replying.
- [x] The page has no `ra2_quit()` call site; `IN_QUIT` now exits directly (EXIT-3).
- [x] If the flush rejects, keep the dialog/error path and do not reply or claim the game is
      leaving.

**Acceptance:** Settings and saved games are on OPFS before the guest is allowed to terminate.

### EXIT-2: Fast exit from `ra2_web_exit_confirmation`

**Status:** Done. Web-only; the fast path lives in `src/web/main.c`.

**Files:**

- Modify: `src/web/main.c`

**Steps:**

- [x] After `hle_block_end()`, when the answer is Exit (`answer == 2`), call `hle_exit(0)` instead
      of returning to the guest.
- [x] Keep Cancel (`answer != 2`) unchanged.
- [x] The code is compiled only for the web host, so native/Linux keeps its guest save path.

**Acceptance:** Exit Game reaches the page's `exit` event without running `sub_005FAD10` or the
guest destructors.

### EXIT-3: Fast exit from `IN_QUIT`

**Status:** Done.

**Files:**

- Modify: `src/web/presenter.c`

**Steps:**

- [x] Replace `hle_post_message(h, WM_CLOSE, 0, 0)` with `hle_exit(0)` for the page's Quit action.
- [x] Remove the now-unused `WM_CLOSE` definition.

**Acceptance:** The sidebar Quit returns to the launcher without the guest's close path.

### EXIT-4: Bound `leaveGame`'s flush

**Status:** Done. `leaveGame(..., flush=false)` skips the second full flush after EXIT-1 already
persisted everything; other leave paths keep `flush=true`.

**Files:**

- Modify: `web/src/game/lifecycle.ts`
- Modify: `web/src/game/lifecycle.test.ts`

**Steps:**

- [x] On the fast-exit path, stop the watcher and skip a second `flush()` (EXIT-1 already did it).
- [x] Keep the full `flush()` for leaving to switch mods and for non-fast exits.
- [x] Add a lifecycle test for the skipped second flush.

**Acceptance:** Exit navigation does not repeat the save scan; any saved game is copied before the
guest exits.

### EXIT-5: E2E exit time and settings survival

**Status:** Done for both editions with the fast-exit build. Timing passes at **152 ms**;
`launcher-settings.mjs` changes Auto scroll, volume and a hotkey, starts the game, exits, and
confirms the launcher reads all three back. Volume/hotkey are changed from the launcher, not by
driving the game's own Options screen (headless mouse drags on its volume slider did not register).

**Files:**

- Modify: `web/e2e/exit-confirm.mjs`
- Created: `web/e2e/launcher-settings.mjs`

**Steps:**

- [x] Assert confirmation-to-launcher under a recorded budget (`exitMs < 4000`, recording the
      actual value).
- [x] Change a gameplay setting, volume and a hotkey; exit; confirm the launcher reads them back,
      for Yuri and RA2.
- [x] Keep the "Stay in game" and stale/invalid reply checks.
- [x] Assert no `called after runtime exit` and workers are released.

**Acceptance:** Both editions pass with the fast-exit build; the game's own Options-screen drag is
not automated.

---

## Track 4: Verification and documentation

### VERIFY-1: Web checks

**Status:** Done. 42 test files / 370 tests pass; lint has 0 errors (the existing `Play.tsx` hook
warning remains); Prettier is clean for the changed files, with only pre-existing `work/` files
still failing the repository-wide check.

- [x] `pnpm --dir web typecheck`
- [x] Focused tests: `game-settings`, `saves`, `LauncherGameSettings`, `protocol`, `store`,
      `lifecycle`
- [x] `pnpm --dir web test` (42 files / 370 tests)
- [x] `pnpm --dir web lint` (0 errors; existing warning only)
- [x] `pnpm --dir web format:check` (changed files clean; `work/` pre-existing warnings)

### VERIFY-2: Build both editions

**Status:** Done. Both builds used `-DWEB_LINK_OPT=-O1` into separate temp output directories.

- [x] `node build-web/...` for Yuri (`RA2_TARGET=gamemd`) and RA2 (`RA2_TARGET=game`).
- [x] Headless boot check for both editions: `boot` -> `settings` -> `mode` -> `menu`.

### DOC-1: Update the web docs

**Status:** Done.

- [x] `docs/web/storage.md`: settings files per edition, launcher edits the save store, fast sync.
- [x] `docs/web/frontend.md`: launcher tabs and the D7 exception.
- [x] `docs/web/decisions.md`: amend D7.
- [x] `docs/web/protocol.md`: `settingsSaved` event and fast-exit behavior.
- [x] `docs/web/tasks.md` and `docs/web/progress.md`: record the completed tasks and tests.

### DOC-2: Record the pcrecomp change

**Status:** Done. The hook is in `../pcrecomp` commit `3f78d82`, which also carries the
profile-write-in-place change the hook needs. The remaining sibling edits (other files and the
dsound music declarations) are not part of it.

- [x] Add the `win32hle` file-write hook as its own commit in `../pcrecomp` (`3f78d82`).
- [x] Note the required pcrecomp commit in the web progress doc (`3f78d82`).

---

## Acceptance criteria (end state)

1. A launcher player can change gameplay, audio, video (stretch), and any hotkey for both editions.
2. The launcher writes only the edition's own files and preserves every untouched byte.
3. In-game changes reach OPFS within ~250 ms; hiding/closing the tab does not lose them.
4. The page does not need to save on exit; Exit Game returns to the launcher promptly (recorded
   budget < 1 s).
5. RA2 never writes Yuri files and Yuri never writes RA2 files (including `.host`).
6. Native Windows and Linux keep their existing save/teardown behavior.
7. Typecheck, lint, unit tests, both-edition build, and the new e2e tests pass.

## Risks and open questions

- **Default values and ranges** for `[Options]`/`[Audio]` need verification against the in-game
  options screen before shipping the sliders. Missing keys currently fall back to documented
  defaults; confirm each.
- **When the game writes** on Apply vs only at Exit. The callers suggest Apply (and Exit), but
  confirm with `HLE_FILETRACE=1` before enabling the fast exit. If Apply does not write, keep the
  guest save in the fast-exit path.
- **Modifier encoding** of hotkeys (`0x100`/`0x200`/`0x400`) is inferred from shipped defaults;
  confirm by rebinding Shift/Ctrl/Alt combinations in-game.
- **Fast exit and saves**: confirm saved games are written when the player saves, not only during
  teardown. If not, do not skip teardown.
- **INI case**: the save store may already hold `RA2MD.INI`; always write the resolved name to avoid
  a second lowercase file.
- **Launcher while playing**: the launcher settings dialog must not write the save store while a game
  is running. The Library screen currently guarantees this.
- **Network keys** (`Socket`, `NetCard`, `DestNet`, `NetID`) are deliberately out of scope until the
  WOL/LAN screens own them.
