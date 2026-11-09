# Dynamic Screen Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task. Steps use checkbox syntax for tracking.

**Goal:** Make `[Video] DynamicScreen=yes` select browser-controlled resolution and expose that choice in the existing in-game toolbar settings.

**Architecture:** The saved game INI is the durable source of truth for dynamic versus fixed resolution; existing per-installation localStorage choices are migrated once when the INI has no `DynamicScreen` key. A runtime-only resolution override gives the engine the browser size without replacing the saved fixed dimensions. The existing browser resize and game mode-switch paths apply changes while running.

**Tech Stack:** TypeScript, React, Vitest, browser OPFS, C/WebAssembly, existing game-loop patches and browser end-to-end tests.

**Spec:** User discussion in this chat: `[Video] DynamicScreen=yes` means ignore INI video dimensions for browser-sized play, and the choice is available from the in-game toolbar/sidebar. This plan makes the implementation decisions below explicit for review.

## Global Constraints

- Support both Red Alert 2 and Yuri's Revenge, including existing installations and imported INIs.
- Preserve INI encoding, unrelated settings, and the stored fixed width and height while dynamic mode is active.
- Keep the menu shell at 800×600 and preserve the existing online-match rule: resolution changes wait for the next match.
- Do not silently overwrite unrelated user changes in the workspace or commit without a separate request.

## Review Focus

- A prior fixed or “game's own” localStorage preference with no INI marker must not silently become dynamic (Task 1).
- Imported INI with an explicit marker must take precedence over stale localStorage (Task 1).
- A browser resize must not erase the saved fixed size; changing back to fixed must restore it (Tasks 2–3).
- Game save synchronization must not write runtime-only browser dimensions over the persisted fixed dimensions (Task 2).
- Resizing while an online game or a modal menu is active must respect the existing game-loop safeguards (Tasks 3–4).

### Task 1: Durable resolution mode and migration

**Files:** `web/src/storage/game-settings.ts`, `web/src/storage/game-settings-defaults.ts`, `web/src/storage/video-preferences.ts`, their existing tests, and `web/src/screens/launcher/settings/VideoTab.tsx`.

**Interfaces:** Add `readIniVideoChoice(ini: Ini): VideoChoice | undefined` and `writeIniVideoChoice(ini: Ini, choice: VideoChoice): Ini` in `game-settings.ts`. `undefined` means the marker is absent; `null` retains the existing “game's own” choice. Keep the existing `VideoChoice` representation.

- [ ] Add tests for `DynamicScreen=yes` reading as browser mode; `no` reading the fixed dimensions; case-insensitive key/value parsing; preservation of unrelated ANSI bytes and duplicate sections according to edition semantics.
- [ ] Add migration tests: explicit marker beats localStorage; missing marker migrates a saved browser, fixed or game's-own choice; no marker and no saved preference defaults to browser. Cover both editions and inaccessible localStorage.
- [ ] Run `pnpm exec vitest run src/storage/game-settings.test.ts src/storage/video-preferences.test.ts` in `web`; confirm the new assertions fail for the missing functionality.
- [ ] Implement the INI helpers and migration at the existing saved/imported/default settings boundary. Set `DynamicScreen=yes` for a fresh profile. For fixed or game's-own choices set `DynamicScreen=no`; fixed selections also update width and height. Once migrated, use the INI marker as the authority and avoid a stale localStorage override.
- [ ] Update the launcher Video tab to read and persist the same INI mode for each applicable edition. Preserve “game's own” behavior as a UI choice for legacy users; both it and a fixed selection disable dynamic mode. Surface write errors through existing settings error handling.
- [ ] Rerun the targeted tests and `pnpm exec vitest run src/screens/launcher/settings/SettingsScreen.test.tsx`; confirm the added cases pass and report any unrelated existing failures.

### Task 2: Runtime-only browser dimensions

**Files:** `web/src/game/loader.ts`, `web/src/storage/saves.ts`, `src/web/settings.c`, relevant existing tests.

**Interfaces:** Add an explicit dynamic/fixed mode to the launch and resolution-command data flow. Define the exact exported WASM command in this task and use it consistently in Task 3; a dynamic resize must update game options and trigger the existing pending resize without persisting width/height as the fixed preference.

- [ ] Add integration tests for an INI with `DynamicScreen=yes`, `ScreenWidth=1920`, `ScreenHeight=1080` and a browser size of 1452×1048: the engine receives 1452×1048 while the durable INI retains 1920×1080. Repeat after a resize and save sync, then restart and switch to fixed to recover 1920×1080.
- [ ] Add tests for fixed mode, `DynamicScreen=no`, existing repeated `[Video]` sections, and a failed INI write. Confirm dynamic state and stored dimensions cannot diverge silently.
- [ ] Run the affected loader and save tests and confirm the new dynamic-preservation tests fail.
- [ ] Implement the runtime override and persistence boundary. Do not rely on an initial temporary INI rewrite alone: `startSaveSync` can persist game-written copies. Preserve the saved fixed dimensions across game writes and ensure the engine's initial in-memory options use the browser size before match start. If the engine cannot take the override before startup, prove the first-frame switch with a browser test and document the limitation.
- [ ] Retain `?video=WxH` as a one-launch developer override without changing the durable `DynamicScreen` or fixed size. Keep all other INI sections intact.
- [ ] Run `pnpm exec vitest run src/game/loader.test.ts src/storage/saves.test.ts` in `web` and the relevant native settings selftests; confirm all new cases pass.

### Task 3: In-game toolbar and live resize

**Files:** `web/src/screens/Play.tsx`, `web/src/components/SettingsDialog.tsx`, `src/web/settings.c`, their tests, and launcher settings tests as needed.

**Interfaces:** The existing toolbar Settings → Resolution selector sends the Task 2 mode-aware command. Dynamic selection writes `DynamicScreen=yes`; fixed selection writes `DynamicScreen=no` and the selected dimensions. The current 400 ms window resize debounce remains.

- [ ] Add tests for selecting browser mode and fixed mode from the toolbar, persistence after reload, launcher/toolbar agreement, and rapid resize coalescing to the final size. Assert that fixed mode does not follow window resizes.
- [ ] Add tests that an open host settings panel defers the mode switch, a game pause menu uses its existing safe path, and an online match does not switch mid-game.
- [ ] Run the focused tests and confirm the new mode-persistence assertions fail.
- [ ] Wire the selector and launcher to the same persisted INI state; use the mode-aware command for initial apply and dynamic resize. Avoid writing browser dimensions to the stored fixed dimensions. Display write failures rather than indicating an unsaved choice succeeded.
- [ ] Run `pnpm exec vitest run src/components/SettingsDialog.test.tsx src/screens/launcher/settings/SettingsScreen.test.tsx` plus the new Play/host tests; confirm the new cases pass.

### Task 4: End-to-end verification and documentation

**Files:** `web/e2e/remaster.mjs`, `web/e2e/resolution-load-saved.mjs`, `docs/web/frontend.md`, `docs/hires.md`, and `CHANGELOG.md`.

- [ ] Add a browser regression covering a fresh import, a conflicting 1920×1080 INI, a 1452×1048 viewport, switching to a fixed size through the toolbar, returning to dynamic, resizing, exit and reload. Verify both the actual frame dimensions and durable INI values; run for both editions.
- [ ] Exercise online-match deferral and a resize while the game's pause menu is open using the existing browser harness. Verify the menu shell remains 800×600.
- [ ] Update documentation to explain the marker, migration, preservation of fixed dimensions, toolbar control, resize debounce, and online exception.
- [ ] Run the focused browser scenarios, `pnpm run typecheck`, and `pnpm test` from `web`. Record all failures by name, including pre-existing failures in unrelated dirty workspace files; do not report the suite as passing unless its exit code is zero.
