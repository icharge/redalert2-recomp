# FA2EX Test Map: one match, no menus

FA2EX (the browser map editor) tests a map by starting the web build straight into it: a
skirmish on a multiplayer map, the mission itself on a singleplayer one. Nothing is clicked for
the player: no main menu, no skirmish dialog, no score screen. Both editions: `src/runtime/
test_map_sites.h` holds each one's addresses, `run_lift.py`'s `TEST_MAP_SITES` its patch sites.

## The settings file

`[Settings]` `Mode=skirmish|singleplayer`, `Scenario=` the staged file. A skirmish adds `Name`,
`Country` (−2 random), `Color`, `Start` (−1 random), `Credits`, `UnitCount`, `GameSpeed`
and the option flags, and `[AI1]`..`[AI7]` (`Difficulty` 0 Easy, 1 Normal, 2 Hard; `Country`,
`Color`, YR `Start`). A mission adds `Difficulty` 0 (easiest) to 4 (hardest), 2 Normal. A
missing key keeps the behaviour it had before the key existed.

| Key | YR | RA2 | What |
|---|---|---|---|
| `[Settings] RevealMap=1` | yes | yes | the map starts revealed for the human, skirmish and mission: Read_Scenario's own no-shroud reveal, `MapClass::RevealEntireMap` (YR `0x577F30` with a NULL house, RA2 `0x55A1F0`), patch site `reveal` |
| `[Settings] Start=0..7` | yes (the dialog's start, `0xA8B3A4`) | yes, patched | RA2's skirmish has no start choice (random, then farthest, `0x5B7920`). Patch site `ra2_start`: the human's house (`0x4F52F0`, House+0x134) takes that start; until then it is held back from the AI houses, which pick around it |
| `[Settings] GameMode=<id>` | 1–9 | 1–8 | a mode number of `MPModes(MD).ini` (below); the mode lookup `0x5D5F30` (RA2 `0x5B6FE0`) matches it at the mode's +0x28. An id the game lacks, or a mode the map's `[Basic] GameMode` does not offer, falls back to the default mode with a `[test-map]` line. Every mode works, also those the skirmish dialog does not list |
| `[AIn] Ally=1` | yes (team) | no | puts that AI on the human's team (YR team slots: human `0xA8B39C`, AI row `0xA8B2DC`; team A when `[Settings] Team` is not given). Cooperative (mode 3) ignores teams: see below |
| `[AIn] Team=0..3` | yes | no | that AI's team |
| `[Settings] Observer=1` | no | no | not offered: the country list's Observer entry (item data −3, YR `0x4E3B5D`, RA2 `0x4D169D`) is stored and marked as an observer by `0x69B8C0`, but a skirmish still builds a normal house for the human that takes a start; the observer is a LAN/online feature (`MPObserver.cpp`) |

A mission (`Mode=singleplayer`) takes its houses, AI and speed from the map and the campaign: the
menu-loop patch jumps to Select_Game's new-campaign block, so the skirmish fill (AI rows, start,
speed, mode) never runs. The host gives a test mission `-SPEEDCONTROL` (as the launcher's speed
control preference does), so its speed can be changed in the game.

## Game modes: MPModes.ini

Red Alert 2: `ra2.mix` → `local.mix` → `mpmodes.ini`. Yuri's Revenge: `ra2md.mix` → `localmd.mix` →
`mpmodesmd.ini`. Each line is `id=GUI:<label>, STT:<tooltip>, <rules overlay INI>, <map filter>,
<random maps allowed>` under a section that groups modes ([Battle], [ManBattle], [FreeForAll],
[Unholy], [Cooperative]). The id is what `GameMode=` takes. The CSF label is the first field.

| id | Section | Label | Overlay (RA2 / YR) | Filter |
|---|---|---|---|---|
| 1 | Battle | `GUI:Battle` | `MPBattle.ini` / `MPBattleMD.ini` | `standard` |
| 2 | FreeForAll | `GUI:FreeForAll` | `MPFreeForAll.ini` / `MPFreeForAllMD.ini` | `standard` |
| 3 | Cooperative | `GUI:Cooperative` | `MPCoop.ini` / `MPCoopMD.ini` | `cooperative` |
| 4 | Unholy | `GUI:UnholyAlliance` | `MPUnholy.ini` / `MPUnholyMD.ini` | `standard` |
| 5 | ManBattle | `GUI:Megawealth` | `MPMW.ini` / `MPMWMD.ini` | `megawealth` |
| 6 | ManBattle | `GUI:Duel` | `MPDuel.ini` / `MPDuelMD.ini` | `duel` |
| 7 | ManBattle | `GUI:MeatGrind` | `MPMeat.ini` / `MPMeatMD.ini` | `meatgrind` |
| 8 | ManBattle | `GUI:NavalWar` | `MPNaval.ini` / `MPNavalMD.ini` | `navalwar` |
| 9 | Battle (YR only) | `GUI:TeamGame` | `MPTeamMD.ini` | `teamgame` |

A map offers a mode when its `[Basic] GameMode=` list (comma-separated keywords) holds the mode's
filter; the check is `0x5D63E0` (RA2 `0x5B7470`) on the map-list item. The last field is whether
random maps may use the mode, not whether the skirmish lists it.

**Cooperative (3)** is humans against the computer: "Making Alliances" allies every computer
player with every other, and the humans together; a team setting does not change that. It needs
at least one computer player: with none, YR crashed at game frame 33 (a null virtual call from
`0x49FA00`). The map's own houses and triggers act as in the mission it came from; CnCNet's
co-op maps (`INI/MPMaps.ini`, `IsCoopMission=yes`) add the enemies as computer players,
`EnemyHouseN=<side>,<colour>,<start>`, which is what `[AIn] Country=`, `Color=` and `Start=` give
here.

## A singleplayer map

The menu-loop patch writes `Scenario` into the scenario's own file name (Scen + 0x125C, RA2
+ 0x83C), sets the campaign difficulty (`[0xA8EB64]`, RA2 `[0xA40B1C]`) and jumps to Select_Game's
new-campaign block (`0x52E527`, RA2 `0x51411E`; it wants eax = Scen, ebx = 0, and in RA2 esi = 1),
which sets the difficulty and session type 0. The campaign-or-file test before Start_Scenario
(`0x52E6E0`, RA2 `0x51429A`) is then sent to the file path (`0x52E737`, RA2 `0x5142F1`), so the
staged map plays instead of the campaign's next mission. A mission is opened by name through the
game's files, so a stock mission inside the archives works too (used for the check below).

## Red Alert 2

Its sites and the fill's addresses were found by aligning game.exe's instructions with
gamemd.exe's (Select_Game 0x0052D9A0 ↔ 0x005135F0, the skirmish dialog's handler 0x006ACEE0 ↔
0x006829F0, its WM_INITDIALOG 0x006AE6E0 ↔ 0x00683FC0, the end-of-game block 0x0055CFD0 ↔
0x0053F840), then each read back from game.exe. Differences: the menu choice is in ebp; the
skirmish has no team or start choice (starts are random); AI rows are level 0xA3D2DC, country
0xA3D2FC, colour 0xA3D31C; the player record is 0x75 bytes; skirmish maps are listed as loose
`*.MPR` (`0x6712C3`).

## How it runs

1. FA2EX writes the map and a settings file to OPFS `fa2ex-test/` (fa2web
   `src/vfs/testMapHandoff.ts`; production serves it at `/fa2/` beside the launcher at `/emu/`,
   so they share OPFS) and opens the launcher at
   `/emu/game?testmap=1&edition=<ra2|ra2md>&return=<editor path>` in a new tab.
2. The launcher (`web/src/game/test-map.ts`, wired in `loader.ts` and `screens/Play.tsx`) copies
   every file there into `/game` before `callMain` (the game lists maps once, at start-up) and
   adds `--test-map /game/fa2ex-test.ini`. On `testMapDone` or `testMapFailed` it calls
   `window.close()` (FA2EX opens the tab from a script, `window.open('about:blank')` and then
   the URL, so the tab may close itself); if the tab is still open 400 ms later (opened by hand,
   or the close refused) it goes to the `return` path with `testmap=done|failed` added (a
   same-origin path only; without one, the launcher's root). `closeOrReturn` in `test-map.ts`.
3. `src/web/test_map.c` reads the file after the game folder is mounted.
4. `run_lift.py test_map_patches` (byte-checked sites in both editions; YR addresses below, RA2's
   in `TEST_MAP_SITES['game']`):

   | Site | What |
   |---|---|
   | `0x0052DC87` (Select_Game's menu loop, `cmp esi, 0x12`) | `goto L_0052E10F`, Select_Game's own Skirmish case: no main menu, no intro |
   | `0x0052E168` (`call 0x6AE2C0`, the skirmish dialog) | replaced by `src/runtime/test_map_fill.inc`, which does the dialog's work from the settings file and returns al = 1 ("Start Game") |
   | `0x0055D14A` (`call 0x685670`, the end-of-scenario routine) | skipped once a test match ends; the page gets `testMapDone` and closes the tab |
   | `0x0048CDD3` (Main_Game's first `call 0x52D9A0`, Select_Game; RA2 `0x481D03` → `0x5135F0`) | after it returns, the staged map has loaded: the page's `menu` event (phase running) and the input script's clock |
   | `0x0048CFAA` (Main_Game's second Select_Game call; RA2 `0x481EDA`) | every way out of a match comes back here (its end, Options → Abort Mission → Quit). After a test match: `testMapDone` (once) and the game thread waits (`ra2_test_map_hold`): no skirmish dialog, no menu, and no exit (an exit sends the page to the launcher) |

   The fill runs in the lifted function's own context, so it calls the game with `RECOMP_CALL`.
   Only `run_lift.py` is hashed by the lift check: editing `test_map_fill.inc` needs a rebuild,
   not a relift.

5. A failed fill (the map is not in the list, the mode refuses it) prints why, sends
   `testMapFailed`, and returns al = 0: the game falls back to its menus.

## Straight to the match

What a test launch skips, and what it only hides:

- **Skipped: the logo and intro movies, the start-up splash wait.** `--test-map` puts the host in
  its no-movie start (`startup_order.h` mode 0, whatever `--intro` said): the start-up Binks are
  cut to two frames and the splash's timed wait is skipped. Every later movie is cut too (a
  mission's briefing). The launcher passes no intro argument on a `?testmap=1` launch.
- **Skipped: the main menu, the skirmish dialog, the score screen, the menus after the match.**
- **Hidden: the boot screen.** The launcher keeps its own full loading screen (not the small
  chip) until the game's `testMapStarted` event, sent when the test match is set up
  (`ra2_test_map_started`), just before the scenario loads.
- **Shown: the game's own map-loading screen**, with its progress, as in a match started from
  the menus (the user asked to see it). Then the `menu` event, which a test sends once the map
  has loaded (the `0x48CDD3` site), marks the page running. In Chrome on an RA2 skirmish: about
  11 s from navigation to the match. Under Node (Yuri's Revenge skirmish, fast build): 10 s to
  the test start, 21 s more to load the map.

A launch without `?testmap=1` keeps its intro argument, its logo and the chip over the game's own
boot screen.

## What the fill writes (measured from the dialog, gamemd)

| Step | From the dialog | Globals |
|---|---|---|
| Game mode | `0x6AEADD`, `0x6AEAF1` | default mode `0x5D5E10`, then `0x5E2F80`: mode `0xA8B3C4`/`0xA8B250`, object `0xA8B23C` |
| Scenario | `0x6AEB3C`, `0x6AEB62` | list items `[0xA8B8CC]`, count `[0xA8B8D8]`, file name at item + 0x58; `0x5E7BF0(ecx = index)` fills `0xA8B8E0` and Scen + 0x125C; `0x5D63E0` checks the mode offers it (it takes the list item, `[0xA8B8CC][index]`, not the index: `0x6AEB5A`); index `0xA8B254`/`0xA8B3C8` |
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

And with `build/ra2md-fast` and `build/ra2-fast` after the singleplayer and RA2 work (each: no
menu, `Capture_Mouse()`, game frames advancing):

- YR mission: `Mode=singleplayer`, `Scenario=all01umd.map` (inside the archives): `Reading
  scenario: ALL01UMD.MAP`;
- YR skirmish again (after the `0x5D63E0` item fix): Americans and a Hard AI (Russians);
- RA2 skirmish on a stock four-start map staged as `fa2ex-test.mpr`: Americans and a Normal AI
  (British);
- RA2 mission: `Scenario=all01t.map`: `Reading scenario: ALL01T.MAP`.

In Chrome (2026-11-23, `build/ra2-fast` and `build/ra2md-fast` after merging into `web-port`;
FA2EX's dev server on 4001 passing `/emu/` to the launcher's on 5175), with an RA2-only import:

- FA2EX's own hand-off (an RA2 skirmish map, `fa2ex-test.mpr`) at
  `/emu/game?testmap=1&edition=ra2&return=/emu/`: both files staged in `/game`, the arguments
  end in `--test-map /game/fa2ex-test.ini`, straight to the loading screen and into the match;
- a `testMapDone` line fed to the page (`Module.print`) sent it to `/emu/?testmap=done`;
- RA2 missions (`all01t.map`, `sov01t.map`) said "Unable to read scenario!": that import has only
  `maps01.mix`. The same build under Node with `--memfs` on a full install reads `ALL01T.MAP` and
  starts it.

Abort Mission (fixed with the `0x48CFAA` site; before it, Quit landed in the real skirmish
dialog). Under Node, each edition, a skirmish and a mission, with `--key 0x1B@6 --press
0xB5:1314@8 --press 0xB6:1737@10` (Escape; the options dialog's Abort Mission; the abort
dialog's top button, Quit; the same IDs in both editions): `Game loop finished`, `testMapDone`,
the hold, and no dialog opens. In Chrome (RA2 skirmish): Escape → Abort Mission → Quit took the
tab to `/emu/?testmap=done`. A Yuri's Revenge launch without `--test-map` still opens the main
menu (`0xE2`).

The input script's clock starts at the test map's `menu` event under `--test-map` (there is no
main menu). `--dump-frames` does not work under Node: its folder is resolved before the game
folder is mounted.

In Chrome, after the start-up and close changes (RA2, FA2EX's own hand-off): a tab opened from a
script as FA2EX does showed the game's loading screen for about 4 s, then the match; Abort
Mission → Quit closed the tab. The same launch typed into a tab went to `/emu/?testmap=done`.

Missing overlay (bridges, ore) on FA2EX's test maps, 2026-11-23: not the test path. A stock RA2
map (`mp09t3.map` from `multi.mix`, original bytes) staged as `fa2ex-test.mpr` shows its ore
field under `--test-map` in Chrome. FA2EX's staged map (a generated 74×82 map, "Random 34466")
looks the same under `--test-map` and in a skirmish started from the menus on the same file: no
ore or bridges near the base. Its `[OverlayPack]` decodes to 262,144 cells with about 730 set,
types 102–113 almost evenly (RA2's `[OverlayTypes]`: 102–104 `LOBRDG26`–`28`, 105–113
`TIB01`–`TIB09`), so the encoder's type numbers or cell positions are the place to look.

The keys, under Node (fast builds, a two-start YR map and a four-start RA2 map, both `standard`):
`RevealMap=1` runs the reveal in YR and RA2 skirmishes and missions (`[test-map] revealing the
map` between the start assignment and the map's load); RA2 `Start=2` with three AIs: the human's
house takes start 2 and the AIs take 0, 1 and 3; `GameMode=2` (both editions) and `GameMode=5`
(YR, on a copy whose `[Basic] GameMode` adds `megawealth`) start in that mode, `GameMode=6` on a
`standard` map falls back to Battle; a YR co-op copy of `c4w01md` (`GameMode=cooperative` added)
with `GameMode=3` and three AI rows starts, allies the AIs together, and runs; a test mission gets
`-SPEEDCONTROL`.

Not checked yet: a match that ends by itself (`testMapDone` from patch 3, then the hold); Yuri's
Revenge in a browser (no YR import there). The view opens beside the base on the RA2 skirmish
map tried (H centres it), as with `--intro`.

## Map requirements

- Staged as `.yrm`: the start-up scan lists loose `*.YRM` (`0x69A002`), never loose `*.MAP`.
- `[Basic] GameMode` must offer the default mode (`standard`); FA2EX adds it to the staged copy.
- A waypoint for each start spot used (0..7).
