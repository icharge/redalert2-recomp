# FPS Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let players control the FPS overlay from launcher game settings and in-game settings, with both controls sharing the saved preference.

**Architecture:** Keep `ra2-stats` as the shared localStorage preference and centralize safe reads and writes in a small storage module. `Play` owns the live overlay state and passes it to `FrameStats` and `SettingsDialog`; launcher settings read and write the same preference.

**Tech Stack:** React 18, TypeScript, Radix UI Themes, Vitest (existing coverage only; no new tests per task instructions).

**Spec:** [docs/superpowers/specs/2026-10-30-fps-toggle-design.md](../specs/2026-10-30-fps-toggle-design.md)

## Global Constraints

- Preserve the existing storage key `ra2-stats` and `?stats` URL opt-in.
- Keep the Alt+Shift+F shortcut and the overlay's content and sampling unchanged.
- This is a page preference; do not add game protocol settings.

## Review Focus

- A blocked or unavailable localStorage must leave the launcher usable; rely on existing safe-storage patterns and inspect the exception paths.
- A `?stats` launch must still start with the overlay visible, even if the saved preference is off; preserve `statsWanted` precedence.
- The hotkey and in-game switch must update the same live value; use a single `Play` state and callback.
- A launcher preference change must be read by a later game launch; use the same preference module and key in both screens.
- Both labeled switches must remain accessible and independently render in their respective dialogs; use descriptive Radix `Switch` labels and stable IDs.

---

### Task 1: Share the FPS preference between launcher and game

**Files:**
- Create: `web/src/storage/stats-preferences.ts`
- Modify: `web/src/screens/FrameStats.tsx`
- Modify: `web/src/screens/Play.tsx`
- Modify: `web/src/components/SettingsDialog.tsx`
- Modify: `web/src/components/LauncherGameSettings.tsx`

**Interfaces:**
- `readStatsPreference(storage?: Pick<Storage, "getItem"> | null): boolean` safely reads `ra2-stats`, returning false when unavailable.
- `writeStatsPreference(on: boolean, storage?: Pick<Storage, "setItem"> | null): void` safely persists `1` or `0` to `ra2-stats`.
- `statsWanted(search: string, storage?: Pick<Storage, "getItem"> | null): boolean` honors `?stats` first, then delegates to the saved preference.
- `FrameStats` receives controlled `on: boolean` and `onToggle(): void` props; it no longer owns duplicate visibility state.
- `SettingsDialog` receives `statsOn: boolean` and `onStatsChange(on: boolean): void`.

- [x] **Step 1: Centralize the shared preference**

Move the existing `ra2-stats` key and safe localStorage access into `stats-preferences.ts`. Implement the three interfaces above, preserving false as the default when storage is unavailable and preserving `?stats` precedence in `statsWanted`.

- [x] **Step 2: Make `FrameStats` controlled**

Change `FrameStats` to accept `on: boolean` and `onToggle(): void`; remove its local visibility state. Keep Alt+Shift+F and the sampling effect behavior unchanged.

- [x] **Step 3: Lift live visibility state into `Play`**

Initialize one `statsOn` state from `window.location.search` and the shared preference. Add a single update callback that sets state and persists the new preference. Pass state and callback to `FrameStats` and `SettingsDialog`.

- [x] **Step 4: Add the in-game Settings switch**

Add an accessible Radix switch labeled “FPS overlay” to `SettingsDialog`, using `statsOn` and `onStatsChange`. Keep the Alt+Shift+F hint near the switch.

- [x] **Step 5: Add the launcher Settings switch**

Initialize a local `fpsOverlay` state in `LauncherGameSettings` from `readStatsPreference()` and write updates with `writeStatsPreference()`. Add a labeled “FPS overlay” switch to the existing launcher game settings dialog.

- [x] **Step 6: Check the web TypeScript build**

Run: `pnpm --dir web typecheck`

Expected: both application and service-worker TypeScript checks complete without errors.
