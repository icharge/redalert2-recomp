# Issues found playing it

What a first play in a local Chrome turned up, whether each is new or already
known, what was behind it, and what was done. Each was reproduced with a script
in `web/e2e/` first (`drive.mjs`, `timeline.mjs`, `save.mjs`), then fixed where
the cause was. The fixes in `win32hle` are pcrecomp's, so the native Linux host
gets them too. Tasks: the W4.1x series in [tasks.md](tasks.md).

| # | What was seen | Known? | Cause | Status |
|---|---|---|---|---|
| 1 | No Bink movies | Known | no decoder yet (stage 8); `HLE_BINK_SKIP` stubs | open, stage 8 |
| 2 | No animation in the main menu's sidebar | Known: the same as 1 | the menu opens a movie by file handle right after its dialog (`[bink] open (handle)`); the stub plays two empty frames | open, stage 8 |
| 3 | A drop-down list stays on the screen after a pick (and the skirmish minimap stayed black) | New | `win32hle` painted windows into one picture but never told the windows under a closing one to repaint: the list is a window of its own, and hiding it left its pixels | fixed: `ShowWindow(SW_HIDE)`, `SWP_HIDEWINDOW` and `DestroyWindow` expose what the window covered (pcrecomp `7710d40`) |
| 4a | No loading screen at the start | Partly | the page had a spinner and a file name, no bar, nothing between "files copied" and the menu | fixed: `LoadingScreen` (bytes copied of bytes, file, seconds; then a bar over the usual start-up time) |
| 4b | No loading screen when a game starts: 15 seconds of one frozen picture | New | the game's own loading screen draws without pumping messages, and the picture was made only from the pump | fixed: the primary's `Unlock` calls `hle_dd_unlock_hook`, which publishes the frame (pcrecomp `b6dda7d`, `src/web/presenter.c`) |
| 5 | Holding the right button does not pan | New | the game pans on a right-drag only past the drag threshold, read with `GetSystemMetrics(SM_CXDRAG)`, which answered 0 | fixed: 4, as on Windows (pcrecomp `c9d924a`). Also true of the native host |
| 6 | Saving a game seems to freeze it | New | not a freeze: the save is made (Delete Game appears), then a confirmation box (resource `0xCE`, an OK button) waits for a click, and the box was never visible: the game painted it, then the save list under it (a full-screen sibling dialog the game invalidates) repainted over it | fixed: a window under a newer visible sibling dialog gets no WM_PAINT until that one is gone (pcrecomp `4413f81`). Also true of the native host |
| 7 | The opponent drop-down (Brutal Enemy) does nothing; Options, Set Game Resolution shows an empty list | New | a combo box made no taller than its field has no room for its list: `CB_GETDROPPEDCONTROLRECT` answered a list of height 0, so the game made a 0-high drop window. Windows still shows the items | fixed: such a list shows up to 8 items (pcrecomp `user32.c`). The resolution list is the same bug: it now lists 640x480 to 1280x1024 and on |
| 8 | Drop-down lists have no border (the colour list, the resolution list); one edge of the side list only | New | not a system border (the drop window has no `WS_BORDER`, no extended style), and no GDI call on a DC without pixels is made while one is open; so the game draws its own frame, and it is lost or painted over here | **parked**, W4.17; see below |
| 9 | Pressing a sidebar button shows no pressed ("clicked") frame; hovering shows no highlight | New | the game's own button class gets `WM_LBUTTONDOWN`, paints and locks the primary, and the picture is the same as before | **parked**, W4.18; see below |
| 10 | The lobby's right panel is not finished: no minimap until something repaints it (a drop-down used and closed does) | New | the lobby's panels slide in (`seq-13` in `e2e/shots` is the middle of it) and the last frame, the title tab and the minimap, never appears; a mouse move does not change it. Not a movie (no `[bink]` line), not the 15 ms frame throttle (publishing from the idle pump changed nothing) | **parked**, W4.19; see below |
| 11 | Can the game change its resolution while running? | Question | the game takes its size from `RA2MD.INI` when a game or mission starts (menus stay 800x600): it cannot change mid-battle, but each new game can use a new size, and the page scales the picture ([hires.md](../hires.md), W9.1 and W9.2) | answered |

## What was behind 6

The game makes its dialogs with `CreateDialog` and runs its own message loop (there is no
`DialogBox` modal loop here). The in-game menu (`0xB5`), the save list (`0x2B4`) and the
abort confirmation (`0xB6`) showed; the two that follow a save, a short one (`0xF0`) and the
confirmation (`0xCE`, 451 x 328, centred, an owner-drawn OK button and a text static), did
not. A trace of what the game does to the primary (Lock/Unlock) and of every invalidation
showed it: the game paints the box, then calls `InvalidateRect` on the save list, a dialog
the size of the screen, which repaints, and the picture is composed with the list on top of
the box. Windows paints into what shows; here every window is drawn into one picture, so a
repaint of a window under a newer one now waits until the newer one goes (the close exposes
it). It was not GDI on a window DC, the first guess.

Tools that found it: `--heartbeat 3 --windows`, `--msgtrace N` (messages to windows numbered
N and up), `LOG_FILE=... node e2e/save.mjs --arg --msgtrace --arg 65700`. `save.mjs` now also
clicks OK and shoots the screen without the box.

## What is known about 8, 9 and 10 (parked)

The three are cosmetic and none was a clear fault of the emulation, so they wait for a
reference (a screenshot or a short video of the Windows game at the same moment) to
compare with. What was measured, so the next try need not repeat it:

- **How it was measured.** A debug build (not kept) with a ring of the lifted functions
  entered (`RECOMP_TRACE`, about 5 minutes to build), a log of every primary and back-surface
  `Unlock` with the box of pixels that changed, and a log of `InvalidateRect`, `PAINT` and
  `ValidateRect`. `e2e/diff.mjs` counts what differs between two screenshots; `drive.mjs`
  has `down` and `up`.
- **8, no border on drop-down lists.** The drop window is the game's own class
  (`ComboDropWin`) with style `0x50000000` and no extended style, so no system border; no
  GDI call lands on a DC without pixels while a list is open. If the original draws a frame
  it does it in its own paint, and that draw is lost or covered here. Not found.
- **9, hover and pressed frames.** The game draws every menu button from one SHP (17 frames)
  and asks for frame 2 each time, hovered or held; the other frames are the slide-in and
  slide-out of the whole panel (frames 0 to 16 in turn, which does run after a click). On a
  press it redraws the button into its back surface and the net change that reaches the
  screen is 0 pixels (text moved 217 pixels and back). Hover does nothing to the button at
  all. Either the original shows no such frames in this screen, or what makes it show them is
  not reached; a reference decides which.
- **10, the lobby panel's last frame.** The map preview is drawn into the back surface in the
  dialog's first paint (644,37 to 788,125); the 14-frame slide-in then redraws the panel
  top (632,0 to 799,198) over it; the game's own last repaint (`InvalidateRect` of the dialog)
  copies only x below 632 to the screen. Any later repaint of the whole dialog (a drop-down
  closing) draws the preview again and copies it. Ruled out: the older-dialog rule from W4.15
  (`HLE_NOUNDER` test), the 15 ms publish throttle (publishing from the idle pump changed
  nothing), the pointer position (`GetCursorPos` is right). Not tested: whether Windows
  repaints the map's `WS_EX_TRANSPARENT` static after a sibling paints (the map's window has
  that style).

## What went wrong on the way (worth knowing)

- **A picture thread that takes the machine starves the game.** The first fix for
  4b was a thread that took the machine lock, copied the primary and converted it
  outside the lock, as the Linux recorder does. In wasm the game then sat in the
  main menu's movie loop with no pumping. A thread that only sleeps was fine, so it
  is the lock contention. The hook on `Unlock` has no thread and shows a whole
  frame (nothing else has the surface locked).
- **A click a moment too early is lost.** The e2e scripts click at fixed seconds
  after the menu event; the menu is slower when something loads, and a click on the
  next screen before it is up goes nowhere. `drive.mjs` takes `--step` times, so
  leave room; `save.mjs` has `SLOW=1.8` for a slow run.
- **Frames in the battle are not 800 x 600.** The game picks its size from its own
  settings in the game folder (2580 x 1080 for the author's), so the page scales
  the picture down and the in-game menu is small. `save.mjs` finds the buttons from
  the picture's width. Choosing the size from the browser window is W9.x work.

## Not done, on purpose

Right-drag pans without Pointer Lock now (the page sends the position and the
button, as for any click); W4.13's virtual cursor is only needed for edge scrolling
at the canvas's border, which is W9.5.
