# Map list work: status (2026-11-07)

Handoff note for the next session. Branch `web-port`; nothing pushed.

## Done and committed

| Repo | Commit | What |
|---|---|---|
| pcrecomp | `6f03136` | EnumChildWindows in z-order (fixes RA2's map-list scroll bar drawn 80,60 away), mouse wheel (`hle_input_wheel`), ScrollBar SBM_* state. Selftests user32_zorder/wheel/scrollbar |
| pcrecomp | `890662e` | `hle_list_filter` / `hle_list_counts`: a list box shows only some items; the game sees the shorter list. Selftest user32_listfilter |
| redalert2-recomp | `e31ee61f` | page wheel → `ra2_input_wheel`; `--wheel` script event |
| redalert2-recomp | `602587ac` | map search v1: a **React overlay** (`web/src/screens/MapSearch.tsx`) over the map list, `mapList` event, `ra2_map_search` export, `src/web/map_search.c`, `map_match.c` |
| redalert2-recomp | `02d0b5b5` | `?mute` page option (use `?dev&target=game&mute` for browser checks) |
| redalert2-recomp | `a13c62ba` | (import-fix session) install for a removed installation installs, not fails |

## In progress, uncommitted: the search box made native

The user asked for the search box to look like the game's frames, ideally native. Approach: the map
screens' dialog templates (0x6B Customize Battle, 0xCD network map screen; list 1363 in both games)
get one more control, an Edit (id 2400, style 0x50010080, 12 du high) where the top of the list was;
the list moves down 14 du. The game makes and draws it as its own (checked in RA2: red frame, game
font, typing works with real key presses).

Uncommitted files (all mine, none shared with the other session's work):

- pcrecomp `runtime/win32hle/user32.c`, `win32hle.h`: `hle_dialog_template_swap` hook (the host may
  hand a dialog its own template) and `hle_window_text`. New `user32_template_selftest.c` (passes).
  `win32hle.h` also holds another session's uncommitted `hle_ws_udp_on_queue` line: stage only my two
  declarations (build the index from HEAD + mine, as before).
- `src/web/map_dialog.c/.h` + `map_dialog_selftest.c` (passes): builds the template with the box.
- `src/web/map_match.c/.h` + selftest (passes): the query is now the game's CP874 bytes (not UTF-8);
  `ra2_map_players()` takes a lone number 1-8 out of the query as the player count ("lake 4").
- `src/web/map_search.c` rewritten: swap hook → template with the box; pump reads the box with
  `WM_GETTEXT` (the game keeps the text itself: `hle_window_text` stayed empty), filters, and posts
  "No maps match" to the help line (static 1685) when nothing matches. No page event any more.
- `src/linux/script.c`: calls `web_map_search_start()` in `script_start()`.
- `CMakeLists.txt`: adds `src/web/map_dialog.c`.

**Next step (a bug):** with the last build (RA2, into `web/public/game`, `WM_GETTEXT` read) the box
shows "lake" but the list is still NOT narrowed. Find out which link breaks: is
`web_map_search_dialog` reached for 0x6B (the swap hook made the dialog), does
`hle_dialog_item(d, 2400)` find the box, what does `WM_GETTEXT` return (add a temporary
`fprintf(stderr, "[maps] ...")` in `web_map_search_pump`, run headless:
`node build-web-game/ra2.js --run --game ./game --headless --mute --debuglog --press 0xE2:1667@2
--press 0x100:1401@2 --press 0x102:1450@3` then type with `--key 0x4C@8` etc.). The React overlay
of `602587ac` did narrow the list, so `hle_list_filter` itself works. Note the browser tool's `type`
action does not reach the game; use `key` with "l a k e".

Then:
1. Remove the React overlay: `MapSearch.tsx/.module.css/.test.tsx`, its use in `Play.tsx`,
   `mapList` in `store.ts`/`protocol.ts` (+ tests), `ra2_map_search` export, docs rows in
   `docs/web/protocol.md`, the map-search paragraph in `docs/web/frontend.md` (rewrite for the native
   box). `Play.tsx`, `store.ts`, `protocol.ts`, `protocol.md` also hold another session's uncommitted
   edits: stage only mine.
2. Rebuild Yuri's Revenge (`cmake --build build-web`) and check there too; check the help line text.
3. Add `map_dialog_selftest` to `docs/web/testing.md` ("The map search's rules").
4. Commit pcrecomp (template swap) then redalert2-recomp; ask before pushing.

## Not started

Linked maps from a URL that update live (needs a game patch to re-read maps when Customize Battle
opens: the scan is `0x699980` in YR, called once from Init_Game). The user said "Not now".
