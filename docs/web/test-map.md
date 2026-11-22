# FA2EX Test Map: one skirmish, no menus

FA2EX (the browser map editor) tests a map by starting the web build straight into a skirmish on
it. Nothing is clicked for the player: no main menu, no skirmish dialog, no score screen. Yuri's
Revenge only so far; Red Alert 2's addresses are not mapped.

## How it runs

1. FA2EX writes the map and a settings file to OPFS `fa2ex-test/` and opens the launcher at
   `/game?testmap=1&return=<editor path>` in a new tab (yurinet `src/game/test-map.ts`).
2. The launcher copies both files into `/game` before `callMain` (the game lists maps once, at
   start-up) and adds `--test-map /game/fa2ex-test.ini`.
3. `src/web/test_map.c` reads the file after the game folder is mounted.
4. `run_lift.py test_map_patches` (three byte-checked sites, `gamemd` only):

   | Site | What |
   |---|---|
   | `0x0052DC87` (Select_Game's menu loop, `cmp esi, 0x12`) | `goto L_0052E10F`, Select_Game's own Skirmish case: no main menu, no intro |
   | `0x0052E168` (`call 0x6AE2C0`, the skirmish dialog) | replaced by `src/runtime/test_map_fill.inc`, which does the dialog's work from the settings file and returns al = 1 ("Start Game") |
   | `0x0055D14A` (`call 0x685670`, the end-of-scenario routine) | skipped once a test match ends; the page gets `testMapDone` and closes the tab |

   The fill runs in the lifted function's own context, so it calls the game with `RECOMP_CALL`.
   Only `run_lift.py` is hashed by the lift check: editing `test_map_fill.inc` needs a rebuild,
   not a relift.

5. A failed fill (the map is not in the list, the mode refuses it) prints why, sends
   `testMapFailed`, and returns al = 0: the game falls back to its menus.

## What the fill writes (measured from the dialog, gamemd)

| Step | From the dialog | Globals |
|---|---|---|
| Game mode | `0x6AEADD`, `0x6AEAF1` | default mode `0x5D5E10`, then `0x5E2F80`: mode `0xA8B3C4`/`0xA8B250`, object `0xA8B23C` |
| Scenario | `0x6AEB3C`, `0x6AEB62` | list items `[0xA8B8CC]`, count `[0xA8B8D8]`, file name at item + 0x58; `0x5E7BF0(ecx = index)` fills `0xA8B8E0` and Scen + 0x125C; `0x5D63E0` checks the mode offers it; index `0xA8B254`/`0xA8B3C8` |
| Handle | `0x6AD39F` | `0x735090(ecx = 0xA8B380, edx = text, -1)`. **The text is 16-bit**: an 8-bit name comes out as every other letter ("Tester" became "Tse") |
| Human | `0x6AD3BA`, `0x6AD636`, `0x6AD63B` | country `0x69B760(country, 1)` (−2 random), colour `0x69B7E0(colour, 1)` (−2 random), team `0xA8B39C` (−1), start `0xA8B3A4` (−1 random) |
| AI rows | `0x6AD3C1`–`0x6AD4F2` | five 8-entry arrays, row r at index r + 1, written only for a row holding an AI: level `0xA8B27C` (Hard 0, Normal 1, Easy 2), country `0xA8B29C`, colour `0xA8B2BC`, team `0xA8B2DC`, start `0xA8B2FC` |
| AI count | `0x6ACFBD`–`0x6AD052` | the number of AI rows, `0xA8B274` |
| Remembered rows | `0x6AD4F8`–`0x6AD5F8` | 12-byte records from `0xA8B3EC`, {None 1 / Hard 4 / Normal 5 / Easy 6, country, colour}: what the dialog restores next time, not what the match uses |
| Player record | `0x6AD647`–`0x6AD6EA` | `new(0x85)`, `0x53ECB0` at +0x28, name, +0x4B/+0x53/+0x5B/+0x63 from the human's globals, +0x73 = −1, appended to the vector `0xA8DA74` (items `0xA8DA78`, count `0xA8DA84`) |
| Random picks | `0x6AD6FE` | `0x69B8C0(ecx = Session)` |
| Options | `0x6AD703`–`0x6AD8A4` | speed `6 − pos` to `0xA8B268`/`0xA8EB60`, credits `0xA8B25C`, units `0xA8B270`, and the option bytes |

The dialog's settings save (`0x6990A0`) is skipped, so a test leaves the player's own skirmish
preferences alone.

Trap: the AI arrays were first missed because a `grep -o '/\* 0x...: [^*]*\*/'` over the lifted C
drops every instruction whose operand has a `*` (`[esi*4 + 0xa8b27c]`). Disassemble the exe
(capstone) when a window must be complete.

## Checked

Under Node (`node build/ra2md-fast/ra2md.js --run --game DIR --headless --mute --debuglog
--test-map /game/fa2ex-test.ini`, with `MSYS_NO_PATHCONV=1` from Git Bash), on a two-start
Yuri's Revenge map staged as `fa2ex-test.yrm`:

- one human (country 0, start 0) and one Normal AI (random country): no menu, `Assigning Starting
  Points` for house 0 (Americans) and house 1 (Alliance), `Capture_Mouse()`, and the picture keeps
  changing (the AI builds);
- no AI: the match starts and keeps running; it does not end by itself in 200 s.

Not checked yet: the end of a match (`testMapDone`, patch 3) and the Abort Mission path; the
launcher end to end in a browser.

## Map requirements

- Staged as `.yrm`: the start-up scan lists loose `*.YRM` (`0x69A002`), never loose `*.MAP`.
- `[Basic] GameMode` must offer the default mode (`standard`); FA2EX adds it to the staged copy.
- A waypoint for each start spot used (0..7).
