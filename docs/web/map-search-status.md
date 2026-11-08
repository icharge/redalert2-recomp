# Map search status (2026-11-08)

The map search works in both games' map screens: Customize Battle (dialog `0x6B`) and the network
game's map screen (`0xCD`). How it works is in [frontend.md](frontend.md), "The map search".

## What it does

- A search box sits above map list `1363`, drawn by the game in its own frame and font.
- Every word must occur in the map name, in any case. A number from 1 to 8 on its own is a player
  count, matched against the name's "(2-4)". Thai (CP874) is matched as typed.
- The game sees only the matching maps, so Use Map starts the map picked.
- When nothing matches, the game shows the whole list and the page says "No maps match" over its
  top right corner.
- A screen opens unfiltered.

## How the box's text is known

The game covers the added Edit with a one-line control of its own and keeps the typed text inside
it, out of user32's reach (`WM_GETTEXT` and the list messages return nothing). `map_search.c`
follows that control's clicks and keys as the game takes them from its queue (pcrecomp's
`hle_take_hook`), and `map_box.c` applies them as the game's box does. Checked against the game:

| Input | The game's box | Followed |
|---|---|---|
| typing with the canvas focused (keys) | text | yes |
| typing with TYPE on (characters) | text | yes |
| Backspace, Delete | one character | yes |
| Home, End, Left, Right | move the caret | yes |
| Shift with those | no selection, only the caret | yes |
| a click in the box | caret to the end | yes |
| Tab | stays in the box, no text | yes |
| over 255 characters | takes any length | counted; the label shows until the box is emptied |

## Checks

- `map_box_selftest`, `map_match_selftest`, `map_dialog_selftest`: ok.
- pcrecomp `user32_take_selftest` and the other user32 selftests: ok.
- Page: 769 Vitest tests, typecheck clean.
- In the browser, Red Alert 2 (network map screen) and Yuri's Revenge (skirmish):
  - "lake" narrowed the list;
  - "lake 4" left Lake Blitzen;
  - "lost" then Use Map started Lost Lake (2-4);
  - "lakezz" showed the label, in sharp and in integer scaling;
  - reopening the screen started unfiltered;
  - the RA2 scrollbar sits against the moved list.

## Left

- Linked maps loaded from a URL: the game scans maps once, from Init_Game (`0x699980` in YR).
  Not started.
- The page's pointer mapping (`toGamePixels` in `input.ts`) ignores integer scaling, so clicks may
  land off in that mode. It is separate from the map search.
