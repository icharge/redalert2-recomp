# High resolution and widescreen

Yuri's Revenge takes its in-game resolution from `RA2MD.INI`; Red Alert 2 uses
`RA2.INI`:

```ini
[Video]
ScreenWidth=1920
ScreenHeight=1080
```

Both games use an 800x600 shell. Red Alert 2's mode toggle is forced on by
`run_lift.py`'s `ra2_shell_patches`, so its menus return to 800x600 after a
game. A skirmish or mission opens at the saved INI size. Leaving a match from
the reconnection screen's "Leave Game" also returns to the shell:
`run_lift.py`'s `reconnect_patches` sets 800x600 when that path returns, since
it skips the score screen that normally switches back (both editions). The
native host and
browser HLE list 16-bit modes from 640x480 through 5120x1440; the native host
also adds the monitor's current mode and the size in `RA2.INI`. The browser
host's own resolution setting accepts any plausible size (320 to 8192) rather
than only the catalog, for the in-game "Match browser size" choice, which uses
the page's pixel size. `AllowHiResModes`
is forced on and the game-side dimension cap is 8192. On the virtual display,
`SetDisplayMode` is remembered, not applied. The presenter keeps the game's
aspect ratio, letterboxing 4:3 menus in a widescreen window.

## Red Alert 2's menu, size picker and online range

Red Alert 2 (`game.exe`) has Yuri's mode toggle, off by default. `run_lift.py`
forces it on (`ra2_shell_patches`), sets the shell to 800x600 and sends the
switch back after a game to 800x600 too. Related patches, all checked by their
bytes first so a different build gets none:

- `ra2_confirm_patches`: picking a size in Options or Display Options opens no
  "The display mode will be changed" confirm (dialog 0xD9); the size is stored
  for the next game and nothing switches live.
- `ra2_hires_patches` and `ra2_mode_cap_patches`: `AllowHiResModes` forced on and the
  size cap in both dialogs raised.
- `ra2_online_patches`: the online join check (`sub_00745780`, which the shipping
  exe skips with a jump) is real again with the range 1024x768 to 1920x1080: room
  flag `0x200` allows up to 1024 wide, `0x400` and unflagged rooms 1920. A larger
  size is clamped quietly and stored; at match start an online game below
  1024x768 is raised to it. Skirmish and campaign are unrestricted. A patched
  client can ignore this, so the RA2Web server must enforce the range itself.
- `src/web/wolapi.c` keeps the room flag bits (`0x200`, `0x400`) through room
  creation and room-list parsing; `wolapi_selftest.c` checks the round trip.

Yuri's Revenge's Create Game screen owns the resolution option: the "Limit
screen resolution" checkbox (control 0x71E, `[MultiPlayer] WOLLimitResolution`).
The stock game clears the option at 1024+ and only publishes the 640/800 caps,
so a normal room (option off) compared every guest against the stock 1024
default and prompted above it. `yr_online_patches` replaces that:

- the option can be enabled at any host size (the stock force-off and the two
  dialog width gates are removed);
- when on, the room publishes `0x400` and the host's own match size is capped
  to 1920x1080 (stored and saved). A guest above 1920 gets the stock prompt,
  whose text `src/runtime/woltext.c` rewrites from 640x480/800x600 to
  1920x1080; Yes stores 1920x1080 and saves it, No aborts the join;
- when off, no bits are published, so the join is accepted without a cap or a
  prompt.

The RA2Web server still relays the room flags and does not enforce them; a
patched client can ignore the check.

The host (`CMakeLists.txt`, `src/runtime/host.c`) links at `/BASE:0x10000000` with a
1 MB stack and runs the game on a thread with a 16 MB one: at the old base
(0x60000000) this Windows would not start the ~480 MB image, and a 16 MB main
stack sat on the guest's 0x00400000 range. The host skips its suspended-child
range hold when that range is already free.

Not covered by a run: the online clamp in a real two-player lobby.

## Live resize in the browser

In the browser build a skirmish or campaign changes size while it runs, in
both editions: the F10 Resolution choice, and "Match browser size" when the
window is resized. What follows is Yuri's Revenge; Red Alert 2's differences
are under "Red Alert 2" below.
The game already has a routine that does the whole job, the mode switch
(`sub_00560BF0`) that Start_Scenario runs at every match start with the map
loaded: it frees and recreates every screen-sized surface (primary, hidden,
composite, tile, sidebar, alternate), sets the tactical view and its Z and A
buffers, and lays the sidebar's cameo buttons out again. Nothing in it is
browser-specific; only its trigger is.

- **When.** `run_lift.py`'s `live_resize_patches` adds a check after each
  `Main_Loop` call in the game loop (0x0048CE8A): one frame has finished, and
  no modal menu or network wait loop is running (those run their own loops,
  so a size chosen while the pause menu is open applies when it closes). The
  check asks the host (`src/web/settings.c`, `ra2_live_resize_due`) whether a
  size set through `RA2_SETTING_RESOLUTION` differs from the current mode.
- **What.** First the command bar's rectangle set is freed and built for the
  new size (`sub_00730530`, `sub_0072FC60`, the pair the menus' layout uses).
  The menus build that set for the size the next match will have, so the
  match-start switch never needed this; during a match it still describes the
  old size, and without the rebuild the bar and its two buttons stay at the
  old y (below the picture after growing). The bar's one-time init
  (MouseClass slot 53) copies four values out of that set (its y, width, width
  less the button art's, left edge); the patch repeats that arithmetic, since
  the init itself reloads the sidebar's art. Then the mode switch, then the
  release of the screen-sized caches (`sub_0072DEF0`), as Start_Scenario does.
  A dump of the bar's globals after a 1280x720 to 1600x900 switch matches a
  match started at 1600x900, apart from heap addresses.
- **Which size.** The host's last requested size, not the options': a size
  the page sends before the game has read its options reaches only the INI,
  so the match starts at the old size and switches on its first frame.
- **Cost.** The switch and the frame after it: 23 to 58 ms in Chrome
  (1920x1080 to 1024x768, 1600x900 to 1280x720, 1280x720 to 1920x1080), 140 to
  165 ms under Node on a busy machine. The host logs it (`live resize done`).
  The page sends "Match browser size" 400 ms after a resize settles, so a
  window drag costs one switch at its end; until then the presenter scales
  the last frame.
- **Checked in Chrome.** Grow and shrink between 1024x768 and 1920x1080 in a
  skirmish: the map, the sidebar (cameo rows follow the height; a build in
  progress keeps going), the command bar, the pause menu's layout, and edge
  scrolling to the new right and bottom limits (the camera's limits follow
  the size).
- **Not live.** Online matches (Session.Type 4) keep the size their room
  agreed on and take the new one at the next match.
- **The view.** It keeps its top-left corner, so a smaller size shows the
  left part of what was on screen.

**Red Alert 2.** The same patch, `LIVE_RESIZE['game']`: the check after the
game loop's `Main_Loop` call (0x00481DBA, `sub_0053FBD0`), with the options'
size at 0x00A40B38, the current one at 0x008523E0 and Session.Type at
0x00A3D298. Its match start does the same work in another order: the cache
release and profile reset (`sub_006F30F0`) before the switch
(`sub_005434E0`), and `ra2_profile_patches` building the display profile
again after it. So the live patch runs the switch, then that same profile
rebuild (`RA2_PROFILE_RESET`), as `ra2_load_patches` does for a loaded game.
The command bar needs nothing before the switch: `ra2_tab_patches` rebuilds
its rectangle set and the bar's two cached values (0xABE374, 0xABE37C) inside
the switch, at every switch, and the live patch is only applied where that
site matches. (`ra2_tab_patches` had dropped out of the 'game' patch list in
70977647; it is back.)

- **Checked under Node** (`--resize`, with a temporary dump of the layout
  globals): 1280x720 to 1920x1080 and on to 1024x768 in a skirmish. The
  current size, the bar's y and x, its rectangle, the sidebar's height and top
  match a match started at that size (1920x1080: bar at y 1048, rectangle 0,
  1048, 1752, 32, sidebar 922 high; 1024x768: y 736, 0, 736, 856, 32, 610).
  Edge scrolling to the bottom-right stops at the same camera position as in
  a match started at that size (TacticalClass at 0x0083996C, the camera at
  +0xB0/+0xB4: -672, 1832 at 1920x1080 and 224, 2144 at 1024x768). 70 to
  128 ms.
- **Checked in Chrome**, through the F10 Resolution menu: 1280x720 to
  1920x1080 (113 ms), then to 1024x768 (28 ms). The map, the sidebar (16 cameo
  rows at 1920x1080, 10 at 1024x768), the command bar and its buttons look as
  in a match started at that size. Once, opening F10 also opened the game's
  own pause menu behind it; the size then applied on Resume Mission.
- **The pause menu.** It runs its own loop, so a size chosen with Red Alert
  2's in-game menu open applies when the menu closes.

`--resize WxH@s` (browser build, `src/linux/script.c`) sends the setting from
a script, so a headless run under Node can switch mid-match:

```
node build-web/ra2md.js --run --game <folder> --headless --mute --debuglog --no-intro \
  --press 0xE2:1667@1 --press 0x100:1401@2 --press 0x102:1559@3 --waitlog Capture_Mouse@4 \
  --resize 1920x1080@14 --resize 1024x768@28
```

Red Alert 2 (a `RA2_TARGET=game` tree's `ra2.js`) has its own skirmish
controls, and a slower speed so the AI does not win in seconds:

```
node build-web-game/ra2.js --run --game <folder> --headless --mute --debuglog --no-intro \
  --press 0xE2:1667@1 --press 0x100:1401@2 --select 0x102:1321=5@3 --press 0x102:1559@4 \
  --waitlog Capture_Mouse@5 --resize 1920x1080@18 --resize 1024x768@38
```

## What works

The playtest suite checks each size in a skirmish, and 1080p in a campaign
(`py -3 tools/playtest.py 'res-*'`):

| Resolution | Skirmish | Campaign | Notes |
|---|---|---|---|
| 1280x720 | pass | | |
| 1920x1080 | pass | pass (Allied, first mission) | sidebar of 16 cameo slots; view 1752x1048 |
| 2560x1440 | pass | | |
| 3440x1440 | pass | | ultrawide |
| 3840x2160 | pass | | sidebar rows capped at 30 (below) |
| 5120x1440 | pass | | 5K mode cycle verified without recording; headless frame capture is very slow at this size |

A larger resolution shows more of the battlefield, not a bigger picture: the
art stays at its native size, and the presenter's sharp scaling is what makes
it large on a 4K screen.

## The 4K limit is RA2's

At 3840x2160 the game faults just after allocating its view buffers:

```
[game] SidebarSurface (168x2160) SYSTEM MEMORY
[game] Set_View_Dimensions(0,0,3672,2128)
[game] Allocating ZBuffer (3672x2128)
=== fault 0xC0000005 at ... read of 0x00000064 in lifted sub_006ABD30
```

The shipping code does the same under `--original`
(`[original] exception 0xC0000005 at 006ABF96 (read 0x00000064)`), so it is not
the lift. `0x006ABF6C` lays out the sidebar's cameo buttons: rows =
`(height - 26 - top) / 50`, two buttons per row, written into a static array
at `0x00B07E80` with 0x38-byte entries. The next object starts at
`0x00B0B328`, which leaves about 240 entries, and at 2160 lines the loop runs
past the end into whatever follows (a null vtable).

## The fix: cap the rows

The lift caps the row count at 30 (`run_lift.py`, `sidebar_rows_patches`):
60 buttons, a tab's share of the array. Every place that computes the rows
divides by 50 the same way (`imul 0x51EB851F`, `sar 4`, `add r, r >> 31`), so
the patch finds each by that shape in the sidebar code that reads its height
(`0x00886F9C`) or top (`0x00B0B4F8`) and adds one line of C after the `add`:

```c
if ((int32_t)eax > 30) eax = 30; /* remaster: sidebar rows, run_lift.py sidebar_rows_patches */
```

It finds 26 sites. Up to 1440 lines the rows are 27 or fewer and nothing
changes; at 2160 the strip is 30 rows and the space below it stays empty.
`--original` runs the shipping code unpatched and still crashes at 4K, which
is the point: the oracle is the original game, the remaster is the lift.
