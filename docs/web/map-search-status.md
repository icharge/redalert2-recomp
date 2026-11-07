# Map search status (2026-11-08)

Native map search is implemented for Red Alert 2 and Yuri's Revenge. Work is local and has not been pushed.

## Behavior

- Customize Battle (dialog `0x6B`) and the network map picker (`0xCD`) receive a native Edit control above map list `1363`.
- Search words match case-insensitively in the map name. CP874 input and a player-count term from 1 to 8 are supported.
- The game applies filtering through `hle_list_filter`, so the selected map and game-side list state stay consistent.
- A query with no matches keeps the game's safe full-list fallback. The game emits a `mapSearch` event and the page shows “No maps match” over the list.
- The Edit's committed characters and edit keys update the tracked query once, including when Backspace is delivered through both key and text-input paths.

## Verification

- `cmake --build build-web-game --parallel 8` — passed.
- `cmake --build build-web --parallel 8` — passed.
- `npm run build` in `web` — passed (TypeScript, service worker, and Vite build).
- Browser checks: `lake` showed three YR maps and two RA2 maps; `lake 4` showed “Lake Blitzen (2-4)” and “Lost Lake (2-4)” in YR, and “Lake Blitzen (2-4)” in RA2.
- Final Yuri's Revenge browser check: `zzzz` showed the no-match label while retaining the selected map safely. Backspace followed by `lake 4` restored the two matching maps and hid the label; clearing the query restored the full list.
- The check exposed keydown events reaching the dialog wrapper instead of the Edit child. The search tracker now follows clicks on the native Edit and accepts its committed characters plus relevant edit keys; clicks elsewhere stop search-key handling.

## Out of scope

Linked maps loaded from a URL still require the game to rescan maps when Customize Battle opens. The scan is at `0x699980` in YR and currently runs once from Init_Game. The user previously said “Not now.”

Do not push without the user's request.
