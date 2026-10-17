# Issues found playing it

What a first play in a local Chrome turned up, whether each is new or already
known, what is behind it, and the plan. The status column says what has been
shown and what is still a guess. Fixes become tasks in [tasks.md](tasks.md)
(the W4.1x series), each with its own check.

| # | What was seen | Known? | Behind it | Status |
|---|---|---|---|---|
| 1 | No Bink movies | Known | no decoder yet (stage 8); `HLE_BINK_SKIP` stubs | known, stage 8 |
| 2 | No animation in the main menu's sidebar | Probably the same as 1 | the radar-sized animation is likely a Bink movie too | to check: count what the game opens |
| 3 | Dropdowns draw wrongly | New, unexplained | a combo box's list is a pop-up window; how `win32hle` draws it and whether it reaches the picture is not known | to reproduce and read |
| 4 | No loading screen, at startup and when a game loads | Two things | (a) the page: a spinner overlay exists but may not read as a loading screen; (b) the game: its own loading screens draw without pumping messages, and `screen.c` shows a frame only from the pump (its own comment says so) | to confirm with a timeline |
| 5 | Holding the right button does not pan | New | the game probably moves the cursor itself (`SetCursorPos`) while the button is down, and a page cannot move the real cursor. The Linux host warps the SDL cursor; the web host has no warp | to reproduce; plan below |
| 6 | Saving a game seems to freeze it | New, unexplained | unknown: a dialog that is not shown, a loop that never pumps, or the save itself | to reproduce |

## Plan

Order: reproduce each first (a test in `web/e2e/` that shows it), then fix, so
each fix has a check. Nothing here is guessed into the code before it is seen.

1. **Reproduce all of 3, 4, 5, 6** with `e2e/timeline.mjs` and `e2e/drive.mjs`:
   screenshots through a load, a dropdown opened, a right-drag in a battle, the
   in-game menu and Save. Read the `@ra2` events and the log for each.
2. **Loading screens (4b).** Publish frames from a thread of their own, not from
   the pump: it takes the machine lock like the Linux recorder does
   (`mach_enter`, `hle_dd_frame`, `mach_leave`), so a loading screen that never
   pumps still reaches the page. This also keeps the picture moving while a
   dialog loop does not pump.
3. **Loading screen (4a).** A page-side loading screen worth the name: progress
   for the file copy (bytes, not file count), then "Starting the game" until the
   first frame arrives, so there is never a black canvas.
4. **Right-drag pan (5).** Find how the game scrolls (the cursor position it
   reads, the warps it makes). Then, in a battle (the game draws its own cursor),
   use Pointer Lock and a virtual cursor: the page sums the mouse's relative
   movement, clamps it to the picture, and sends the result as the position; a
   `SetCursorPos` from the game is published so the page moves the virtual
   cursor to match. This is also what edge scrolling needs (W9.5), so it is done
   once.
5. **Dropdowns (3)** and **Save (6):** after reproducing, the fix goes where the
   cause is: in `win32hle` (pcrecomp) if a pop-up window is not drawn, in the
   presenter if a frame is not published, in the page if an event is lost.
6. **Sidebar animation (2):** check whether it is a movie; if so it waits for
   stage 8, and the stub movie could draw a still frame meanwhile.

Each fix gets a line in [bringup.md](../bringup.md) when it is a wall that was
hit, and the page's tests grow where the cause is in the page.
