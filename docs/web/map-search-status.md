# Map search status (2026-11-08)

The native map search is implemented for Red Alert 2 and Yuri's Revenge. Nothing has been pushed.

## Earlier commits

| Repo | Commit | What |
|---|---|---|
| pcrecomp | `6f03136` | Child enumeration in z-order, mouse wheel routing, and scrollbar state needed by RA2's map list |
| pcrecomp | `890662e` | `hle_list_filter` / `hle_list_counts`; the game sees the filtered list |
| redalert2-recomp | `e31ee61f` | Page wheel input routed to the game |
| redalert2-recomp | `602587ac` | Initial map search implementation (later replaced with a native control) |
| redalert2-recomp | `02d0b5b5` | `?mute` page option for browser checks |
| redalert2-recomp | `a13c62ba` | Installer detection improvement |

## Current implementation

- Dialogs 0x6B (Customize Battle) and 0xCD (network map picker) receive a native Edit control
  (ID `0x7FFE`) above map list 1363. The list moves down to make room.
- `src/web/map_search.c` tracks typed characters and key edits, filters on the game thread, and
  lazily resolves the Edit child in case the dialog callback runs before its controls exist.
- `src/web/map_match.c` handles case-insensitive word matching, CP874 input, and optional player
  count terms. `src/web/map_dialog.c` rewrites the dialog template.
- The React search overlay and its page protocol event/export have been removed. Search input and
  filtering stay in the game UI.
- The pcrecomp side adds the dialog-template swap hook and `hle_window_text`.

## Verification

- Rebuilt both web targets with `cmake --build build-web-game --parallel 8` and
  `cmake --build build-web --parallel 8`.
- Browser check after rebuilding: typing `lake` narrowed YR to three maps and RA2 to two maps.
- A no-match query restores the full list. The code attempts to set “No maps match” on static help
  control 1685, but that text does not render in the current web UI. The zero-result feedback needs
  a separate rendering approach.
- The selftests for map matching, dialog-template rewriting, and the pcrecomp template swap were
  run earlier in this work; they were not rerun for this handoff.

## Remaining work

- If desired, implement visible zero-result feedback; the game skips drawing the static help
  control through the web host, so setting its text alone is ineffective.
- Linked maps loaded from a URL are still out of scope. They require the game to rescan maps when
  Customize Battle opens; the scan is at `0x699980` in YR and currently runs once from Init_Game.
  The user previously said “Not now.”
- Do not push without the user's request.
