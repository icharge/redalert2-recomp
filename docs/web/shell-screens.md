# The game's shell screens: how the main menu works, and how `finder_screen.c` makes one

The main menu, Single Player, Skirmish, Customize Battle and the rest are **shell screens**: each is a Win32 dialog the game
makes from a resource, with its own dialog procedure, drawn by the game's own code (not by Windows). A screen of ours, the
map finder (`src/web/finder_screen.c`, built with `-DRA2_FINDER_NATIVE=ON`), is made the same way, so the game draws it as one
of its own and plays its screen change.

This page is what was read and what was seen. A statement is marked **read** (the lifted code under `src/recomp/gen/`),
**seen** (frames of a run), or **VERA20K says** (a lead from the Rust rewrite VERA20K, which the bytes did not confirm; see
[reverse-engineering.md](../reverse-engineering.md): a name is a lead, the bytes are the proof). Addresses are Yuri's
Revenge 1.001 (`gamemd.exe`). `game.exe` (Red Alert 2) has the same screens at other addresses; nothing here was checked
there.

## 1. A screen, from the inside

| Step | What | Where |
| --- | --- | --- |
| Make | `0x622650` (ecx = resource id, edx = dialog procedure, one stack argument): makes the dialog from the resource and pushes `{hwnd, resource id}` on the **shell dialog stack** (pairs from `0xB72D28`, count `0xB72F50`); the newest is also in `0xB72F44` (hwnd) and `0xB72F48` (id) | **read** |
| Set up | `0x622820` (ecx = the dialog, edx = its resource id): registers the dialog and its controls for the game's drawing, loads the screen's background, lays the controls out and gives its buttons their plates. The layout asks `0x608CD0` which control ids the screen has as plate buttons (a per-screen table in code) | **read**, and the finder's header |
| Show | `0x622800` (ecx = the dialog): shows it | **read** |
| Messages | every shell procedure hands each message to the **common handler** `0x622B50` first (ecx = hwnd, edx = message, then wParam, lParam). It paints the background, handles the show and the slide | **read** |
| Loop | `0x7759E0` runs the screen until it ends, and sends it `0x4A9` as it starts | the finder's header; VERA20K says |
| Leave | `0x7757E0(dialog, result)`: slides the screen out, then ends it with `result`. It calls `0x622720`, which calls the **slide-out** `0x608070`, takes the dialog off the stack and destroys it | **read** |

The dialog ids (VERA20K says; the first four were also seen): main menu `0xE2`, Single Player `0x100`, Skirmish `0x102`,
Customize Battle `0x6B`, random map `0x105`, score `0x108`, in-game menu `0xB5`. The original keeps a list of 55 ids that slide
(`0x60C540`). The map finder borrows Customize Battle's id (`0x6B`) for its layout.

### The main menu, and a change of screen

The main menu is dialog `0xE2`. Pressing Single Player does not change a page inside it: the main menu **slides out**, is
destroyed, and Single Player (`0x100`) is made, set up and **slides in**. The same for Skirmish, and for Customize Battle.
(**Seen**: every press from the main menu to Customize Battle replaces the whole body of the screen, and each time the
sidebar plays the same animation. VERA20K models each as its own dialog with its own slide.)

The animation is the one thing that is the same on every screen. It is the **right-hand sidebar** (the column of button
rows, the gauge at its top), not the body:

1. **Out.** The old screen stays up, whole, while its sidebar retracts: the plates are replaced row by row in a stair
   pattern (about 0.5 s).
2. **Dark phase.** The body goes to a dark map outline while the sidebar's gauge slides in.
3. **In.** The new screen appears and its sidebar slides in the same way.

(**Seen**, in frames every 30 ms; `web/e2e/finder-transition.mjs` takes them.)

### What the slide is

- **Out** (`0x608070`, ecx = dialog). It calls `EnumChildWindows(dialog, 0x606800, 1)` (a per-control pass, see below),
  disables the window, sets a flag in the dialog's record (`+0xBE` = 1), and runs the game's message pump until the flag is
  cleared. The common handler (`0x622C7C`, on a message in its 2 to 0x2B range, probably the paint that the loop asks for)
  runs the tick routine `0x6071E0(dialog, 0)` and clears the flag. Then `EnumChildWindows(dialog, 0x606800, 0)`, and the
  window is enabled again. **Read.** It returns at once, with no slide, for a dialog that is not showing steady (its record's
  `+0xBD` set and `+0xB0 == 1`). The slide-out sound is played from here (VERA20K says; a call to `0x750920` is there).
- **In** is run by the dialog's show handling (the show completion `0x60AA60`, the common handler's `0x4EC` case). **Read**
  only as far as that.
- **Tick routine** `0x6071E0` reads per-dialog flags from the dialog's record (`+0xD6`, `+0xD7`), takes the sidebar's
  surfaces and draws the column's frames. **Read.** VERA20K describes it as the right-panel column (every tile row's frame, plus
  the Skirmish map button and the top panel) on a 30 ms tick, "nothing is repositioned".
- **The records.** The game keeps a record for each dialog and each button in hash tables keyed by window handle: dialogs at
  `0xAC1B00` (count `0xAC1B04`, bucket bits `0xAC1B0C`, hash function pointer `0xAC1B18`, a node is `{key, record, ..., next at
  +0x204}`), looked up the same way by `0x608070`, `0x6071E0` and `0x606800`. **Read.**

## 2. Can only some buttons transition, or the page content change in place?

Short answers, from the code and from three experiments on the finder (frames in the worktree's `e2e/shots`, not kept):

**Only specific buttons: not with the game's own animation.** The slide draws the sidebar column as a whole. What it does
to each control is decided by `0x606800`, which compares against about 140 ids (the dialog ids above, and control ids such as
`0x468` the map preview, `0x694` the title, `0x695` the status line). There is no argument that picks buttons. The only
selectors are the per-dialog flags `+0xD6` and `+0xD7` (the top panel and the map button), whose meaning is VERA20K's
reading, not tested here. A control with an id the game does not know is not handled like the game's buttons: see the Find
button below. A button animation of our own would have to be drawn by us (the page, or C into the game's surface).

**Changing the page in place, with the screen's own slide: yes, as a round trip.** On a live dialog (tried on the finder,
`slide_out(dialog)` from `finder_screen.c`):

1. `slide_out(dialog)`: the body stays up, the sidebar retracts. **Seen.**
2. `ShowWindow(dialog, SW_HIDE)`: the game goes to the dark phase and slides the sidebar in again behind it. **Seen.**
3. Change what the page shows (show or hide controls, set texts, refill lists, swap the preview). Do it here: nothing
   of it is visible.
4. `ShowWindow(dialog, SW_SHOW)`: the body comes back, with the sidebar already in. **Seen.**

What did not work: sending the dialog `0x4A9` again after a slide-out. The sidebar stays empty (**seen**). `0x4A9` starts a
screen; it is not a way to slide in.

What is not known: a slide-in with no dark phase over the body (the old screen's body staying up while only the sidebar
animates both ways). The slide-out alone does that. Nothing was found that runs the slide-in alone; the show handling
(`0x4EC`, `0x60AA60`) is where to look.

So a "page change" costs the dark phase (about 0.7 s) and replaces the whole body at once; the game's own screens do the same.
The buttons on the sidebar are then the new page's. A page that only swaps some controls is cheaper done as a page of ours,
or with no animation.

## 3. `src/web/finder_screen.c`

Built only with `-DRA2_FINDER_NATIVE=ON`, Yuri's Revenge only. In the default build the Find button in Customize Battle
opens the page's panel (`MapFinderPanel`); with the flag it opens this screen. The page half is
`web/src/components/NativeMapFinder.tsx` (no UI: it searches, downloads, and answers).

### The pieces

| Piece | What it is |
| --- | --- |
| Template (`build_template`) | a `DLGTEMPLATEEX` built in C, 533 x 369 units like the map screens: title, label, the search Edit, the list, status line, the preview (`0x468`) and three buttons (Search `0x6C5`, Add `0x583`, Back `0x5C0`). The ids are Customize Battle's so the layout treats them as its plate buttons. The **texts** are the game's labels (`GUI:Search`, `GUI:Add`, `GUI:Back`, `GUI:ChooseMap`, `GUI:GameMap`); any other text shows as `MISSING:'...'`, so results go in the list, not on a label |
| Procedure (`finder_proc`) | a host function registered with `win32hle_register` (a user32 shim called as a guest procedure is): stdcall `(hwnd, message, wParam, lParam)` on the guest stack. It hands every message to `0x622B50` first, then takes `WM_COMMAND` (the three buttons) and `WM_PAINT` (the preview) |
| Open (`open_now`) | slides Customize Battle out, makes the dialog (`CreateDialogIndirectParamA`) with `hle_dialog_resource_forget()` first (else user32 names it as the last resource looked up, Customize Battle, and `map_search.c` takes it for a map screen), calls the set-up `0x622820` with `0x6B`, hides Customize Battle, sends `0x4A9`, shows the first row |
| Close (`close_now`) | slides the finder out, frees the preview, resets the game's "last previewed map" (`0xAC0D30`), destroys it, shows Customize Battle again and puts `0xAC48A8` (the current shell dialog) back |
| Rows | the game's own list takes a row as message `0x4CD` with a UTF-16 string (it makes the row's record), then `LB_SETITEMDATA`. `LB_ADDSTRING` answers `-1`; rows put in the host's list directly are never drawn |
| Search text | the game keeps what the player typed in its own one-line control; it is followed from the keys that reach it (`map_box.c`, the way `map_search.c` does) |
| Preview | the game's own preview code, on a map file the page put in `/game` for it (`docs/web/online-maps-research.md`) |

### Threads

The game runs on its own thread; the page's calls (`ra2_finder_results`, `ra2_finder_note`, `ra2_finder_added`,
`ra2_finder_preview`) arrive on another. They only write buffers under a spin lock and set a flag in `g_in_flags`; the game
thread takes them in `web_finder_screen_pump()` (called from the presenter's pump). Everything that touches the game's windows
happens in the pump. A change of screen runs the game's own loop for a while (a slide takes about 0.5 s), and that loop calls the
pump again: `g_sliding` stops the pump from starting another change meanwhile.

### Page and game

| Game to page (`@ra2 {json}` lines) | Page to game (exports) |
| --- | --- |
| `mapFinder`: the Find button was pressed; the page opens its panel (default build only) | `ra2_finder_results(tsv)`: the rows, `sha1 TAB flags TAB name` |
| `mapFinderSearch {q}` | `ra2_finder_note(text)`: one line in the list that is no map |
| `mapFinderAdd {sha1}` | `ra2_finder_added(sha1, 1 or 0)` |
| `mapFinderPreview {sha1}` (`""` for none) | `ra2_finder_preview(sha1, file)` |

### Making another screen

1. Build a template; give controls ids the layout knows (`0x608CD0`) if they should be plate buttons.
2. Register a procedure that calls `0x622B50` first.
3. `hle_dialog_resource_forget()`, `CreateDialogIndirectParamA`, then `0x622820` with the layout id, then `0x4A9`.
4. Leave with `slide_out(dialog)` before `DestroyWindow`, and put `0xAC48A8` back.
5. Keep game-window work in the pump; let the page do anything slow.

### Known problem: a flash of the Find button

When the finder opens, one frame (sometimes two) of Customize Battle's **Find** plate appears on the emptied sidebar, about
0.15 s after the slide ends, during the dark phase. Back is clean. The other buttons do not flash. Frames: `finder-transition.mjs`.

What was ruled out, each by a build and frames:

- Hiding Customize Battle sooner (before the finder is made).
- Hiding the Find window (`ShowWindow(find, SW_HIDE)`: its style bit stays cleared throughout, still flashes).
- Moving the Find window off-screen (the plate still shows at its old place).
- Its record: after the slide, Find's record and the other buttons' have the same "showing" bytes (`+0xBD` = 0, `+0xB0` = 1,
  `+0xBE` = 0); the slide changes none of them. Find differs only in `+0x38` (1) and `+0xE8` (0x40), the "hot" fields of the
  button that was pressed, and clearing them did not stop it.
- The pointer (moved away: the plate still shows).

What is left: the plate is drawn by the game's own code from state that none of this touches, on the first repaint of the
finder's slide-in. The game never meets it: its screens are destroyed after the slide. The control is ours (a copy of Random
Map's button, `map_search.c`): it is the only plate on the sidebar with an id `0x606800` does not know. The ways left are to
find the repaint that draws it (trace the draw routine `0x612B70`), or to take the control out of the dialog while the finder is
up, which needs `SetParent` in `win32hle` (`../pcrecomp`), which it does not have.

## 4. Looking at a transition

```bash
node e2e/finder-transition.mjs --url "http://127.0.0.1:5173/?mute" --game E:/Games/Westwood/RA2 --build ../build-proto2/out
```

It presses Find, then Back, and saves a screenshot about every 30 ms as `e2e/shots/tr-find-<ms>.jpg` and
`tr-back-<ms>.jpg`. Put a contact sheet together to read it: crop the sidebar (the right 22% of the picture) and tile 50
frames with their times. Needs the native-finder build (`-DRA2_FINDER_NATIVE=ON`) in `--build`.
