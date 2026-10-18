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
| 6 | Saving a game seems to freeze it | New | not a freeze: the save is made (Delete Game appears), then a confirmation box, a modal dialog (resource `0xCE`, an OK button), is never drawn, and the game waits for the click on it | **open**: Enter, or a click where its OK button is, dismisses it. Cause below |

## What is known about 6

`DialogBox` runs a modal loop and the game's own dialogs are drawn by the game
into the picture. The in-game menu (`0xB5`), the save list (`0x2B4`), the abort
confirmation (`0xB6`) all show. The two that follow a save, a short one (`0xF0`)
and the confirmation (`0xCE`, 451 x 328, centred, an owner-drawn OK button and a
text static), receive `WM_INITDIALOG`, `WM_SHOWWINDOW`, `WM_PAINT` and the game's
own `0x4AF` to their controls, and nothing reaches the picture, though the game
goes on drawing the picture (the primary is locked 40 times a second). Tools for
the next step: `--heartbeat 3 --windows` lists every window each time
(`hle_dump_windows`), `--msgtrace N` traces the messages to windows numbered N
and up, `LOG_FILE=... node e2e/save.mjs --arg --msgtrace --arg 65856`.
`gdidc.c` draws nothing on a window's DC ("nothing here draws windows"), so the
likely cause is GDI drawing on the dialog's window DC; the proof is a trace of
which GDI calls the game makes on a DC with no pixels. It reproduces on the
native host too, so it is pcrecomp's to fix, by binding a window's DC to the
primary at the window's origin.

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
