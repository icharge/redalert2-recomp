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
game. A skirmish or mission opens at the saved INI size. The native host and
browser HLE list 16-bit modes from 640x480 through 5120x1440; the native host
also adds the monitor's current mode and the size in `RA2.INI`. `AllowHiResModes`
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
