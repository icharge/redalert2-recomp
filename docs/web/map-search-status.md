# Map search status (2026-11-08)

The map search works in both games' map screens: Customize Battle (dialog `0x6B`) and the network
game's map screen (`0xCD`). How it works is in [frontend.md](frontend.md), "The map search".

## What it does

- A search box sits above map list `1363`, drawn by the game in its own frame and font.
- Every word must occur in the map name, in any case. A number from 1 to 8 on its own is a player
  count, matched against the name's "(2-4)". Thai (CP874) is matched as typed.
- The game sees only the matching maps, so Use Map starts the map picked.
- When nothing matches, the list is empty and the page says "No maps match" over its top right
  corner. The game still holds the map picked before (an empty list stops Red Alert 2), so Use Map
  keeps that map.
- Changing the game type keeps the search: it applies to the refilled list at once.
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
| over 255 characters | takes any length | counted; no maps show until the box is emptied |

## The game's own pick

The game's map list keeps its pick and its scroll position itself: its procedure answers
`LB_GETCURSEL`, and it reads items by the index it keeps. A filter that renumbered the list under it
made the game read past the end and stop (searching, then changing the game type). So user32's
`hle_list_filter` changes the list only when the game next looks at its queue, asks the game for
its pick first, and then sends it the pick's new index (`LB_SETCURSEL`) and top row
(`LB_SETTOPINDEX`). An empty result keeps the pick as the list's only item, and the game's paint
sees no items, so the list looks empty.

## Checks

- `map_box_selftest`, `map_match_selftest`, `map_dialog_selftest`: ok.
- pcrecomp `user32_listfilter_selftest` (with a list that keeps its own pick, as the game's does),
  `user32_take_selftest` and the other user32 selftests: ok.
- Page: 774 Vitest tests, typecheck clean.
- Changing the game type while searching, in both games: the search applies to the new list, the
  picked map stays picked, and nothing stops. "zzz" then another type: empty list and the label.
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
