# Task 1 implementation report

## Status

DONE

## Implementation

- Added `web/src/storage/stats-preferences.ts` with safe reads/writes for the shared `ra2-stats` preference and `?stats` precedence.
- Made `FrameStats` controlled by `Play`, preserving its sampling behavior and Alt+Shift+F shortcut.
- Added the live `statsOn` state and preference update callback in `Play` and wired it to both in-game controls.
- Added an accessible “FPS overlay” Radix switch and Alt+Shift+F hint to `SettingsDialog`.
- Added a persistent “FPS overlay” switch to launcher game settings.
- Retained the former `FrameStats` exports `statsWanted` and `rememberStats` as re-exports for existing consumers.

## Files changed

- `web/src/storage/stats-preferences.ts` (created)
- `web/src/screens/FrameStats.tsx`
- `web/src/screens/Play.tsx`
- `web/src/components/SettingsDialog.tsx`
- `web/src/components/LauncherGameSettings.tsx`

## Verification

- `pnpm --dir web typecheck` — passed; both the application and service-worker TypeScript checks completed without errors.
- Commit hooks also completed Prettier and ESLint successfully.
- No tests were added or run, per the brief.

## Commit

- `5271a91e2a0cacca60613e1a3082b881b214922f` — `Share FPS overlay preference across settings`

## Self-review

- The launcher and in-game controls read/write the same preference; the active game uses one controlled state shared by its switch, hotkey, and overlay.
- A `?stats` query opts in at startup, and subsequent in-game changes persist the selected value.
- Storage exceptions safely fall back to the disabled default or skip persistence.
- Existing `FrameStats` helper imports remain compatible through re-exports.
- No known concerns. The working tree retains the pre-existing untracked plan and spec files; they were not included in the commit.

## Review fix

- Updated `readStatsPreference()` and `writeStatsPreference(on)` to default to safely accessed `window.localStorage` when their storage argument is omitted. Explicit `null` and injected storage are still honored; storage access failures remain caught.
- This fixes the launcher switch initialization and persistence while retaining `?stats` precedence through the shared reader.
- Verification: `pnpm --dir web typecheck` exited 0. Both `tsc --noEmit` and `tsc --noEmit -p tsconfig.sw.json` completed without errors.
- Fix commit: `dd2a5e0a` — `Use browser storage for FPS preference defaults`.

## Whole-branch review cleanup

- Removed `Play.tsx`’s duplicate safe `browserStorage()` helper and let `statsWanted` and `writeStatsPreference` use their shared safe-storage defaults. The shared module’s optional injected-storage arguments remain unchanged.
- Command: `pnpm --dir web typecheck`
- Output: exit 0; `tsc --noEmit` and `tsc --noEmit -p tsconfig.sw.json` completed without errors.
