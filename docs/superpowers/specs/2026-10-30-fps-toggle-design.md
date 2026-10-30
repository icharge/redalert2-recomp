# In-game FPS toggle

Status: approved in conversation, 30 October 2026.

## Intent

Make the frame statistics overlay discoverable and controllable from both the
launcher game settings and the in-game Settings dialog, while preserving the
Alt+Shift+F shortcut and the existing `?stats` startup option.

## Goals and constraints

- Show an accessible on/off switch in the launcher's per-game settings and in
  the in-game Settings dialog.
- Keep the switch, keyboard shortcut, and overlay in sync.
- Use the current shared localStorage preference (`ra2-stats`) in both dialogs,
  and preserve URL opt-in.
- Keep settings owned by the page; this is a diagnostic display setting, not a
  host/game setting.
- Do not change the overlay's contents or sampling behavior.

## Approaches

- **One shared browser preference (recommended):** both launcher and in-game
  switches read and write the existing `ra2-stats` preference. `Play` owns the
  live `statsOn` value and passes it to `FrameStats` and `SettingsDialog`; its
  hotkey and in-game switch update the same value. This keeps launcher changes
  persistent across navigation and makes the active overlay stay synchronized.
- **Broadcast a custom window event:** the dialog asks `FrameStats` to toggle
  via an event. This avoids lifting state but adds implicit coupling and makes
  state synchronization harder to follow.

Use the shared preference because the launcher and game live on separate
screens. Keep a controlled live value in `Play` while the game is open, so its
two controls cannot drift apart.

## Implementation choices

Initialize the launcher switch from `ra2-stats`. Initialize the live game value
from `?stats` or that stored preference. Changing the value from either screen
writes the preference. Both dialogs present a labeled Radix switch, “FPS
overlay”; the in-game dialog also explains the existing Alt+Shift+F shortcut.

## Scope

Update `FrameStats`, `SettingsDialog`, `LauncherGameSettings`, and their `Play`
wiring, plus focused tests for preference persistence and live control
synchronization. No game protocol changes are needed.

## Visual capture

[FPS toggle in Game settings](assets/2026-10-30-fps-toggle/fps-toggle-settings-preview.png)
shows the actual `SettingsDialog` component with the FPS overlay enabled, over
an existing Red Alert 2 main-menu capture. This is a component preview, not a
live game-session screenshot.
