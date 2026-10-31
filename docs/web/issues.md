# Issues found playing it

What a first play in a local Chrome turned up, whether each is new or already
known, what was behind it, and what was done. Each was reproduced with a script
in `web/e2e/` first (`drive.mjs`, `timeline.mjs`, `save.mjs`), then fixed where
the cause was. The fixes in `win32hle` are pcrecomp's, so the native Linux host
gets them too. Tasks: the W4.1x series in [tasks.md](tasks.md).

| # | What was seen | Known? | Cause | Status |
|---|---|---|---|---|
| 1 | No Bink movies | Known | no decoder yet; `HLE_BINK_SKIP` stubs | fixed: FFmpeg’s Bink decoder is built into `ra2.wasm` (stage 8, [architecture.md](architecture.md), "Movies"); `e2e/movies.mjs` |
| 2 | No animation in the main menu's sidebar | Known: the same as 1 | the menu opens a movie by file handle right after its dialog (`[bink] open (handle)`); the stub played two empty frames | fixed with 1: the menu’s TV and the sidebar animate (`e2e/movies.mjs`) |
| 3 | A drop-down list stays on the screen after a pick (and the skirmish minimap stayed black) | New | `win32hle` painted windows into one picture but never told the windows under a closing one to repaint: the list is a window of its own, and hiding it left its pixels | fixed: `ShowWindow(SW_HIDE)`, `SWP_HIDEWINDOW` and `DestroyWindow` expose what the window covered (pcrecomp `7710d40`) |
| 4a | No loading screen at the start | Partly | the page had a spinner and a file name, no bar, nothing between "files copied" and the menu | fixed: `LoadingScreen` (bytes copied of bytes, file, seconds; then a bar over the usual start-up time) |
| 4b | No loading screen when a game starts: 15 seconds of one frozen picture | New | the game's own loading screen draws without pumping messages, and the picture was made only from the pump | fixed: the primary's `Unlock` calls `hle_dd_unlock_hook`, which publishes the frame (pcrecomp `b6dda7d`, `src/web/presenter.c`) |
| 5 | Holding the right button does not pan | New | the game pans on a right-drag only past the drag threshold, read with `GetSystemMetrics(SM_CXDRAG)`, which answered 0 | fixed: 4, as on Windows (pcrecomp `c9d924a`). Also true of the native host |
| 6 | Saving a game seems to freeze it | New | not a freeze: the save is made (Delete Game appears), then a confirmation box (resource `0xCE`, an OK button) waits for a click, and the box was never visible: the game painted it, then the save list under it (a full-screen sibling dialog the game invalidates) repainted over it | fixed: a window under a newer visible sibling dialog gets no WM_PAINT until that one is gone (pcrecomp `4413f81`). Also true of the native host |
| 7 | The opponent drop-down (Brutal Enemy) does nothing; Options, Set Game Resolution shows an empty list | New | a combo box made no taller than its field has no room for its list: `CB_GETDROPPEDCONTROLRECT` answered a list of height 0, so the game made a 0-high drop window. Windows still shows the items | fixed: such a list shows up to 16 visible rows (pcrecomp `user32.c`). The resolution list includes the shared 26 modes from 640x480 through 5120x1440 |
| 8 | Drop-down lists have no border (the colour list, the resolution list); one edge of the side list only | New | the game draws its own two-pixel frame outside the client rectangle, but the final copy to the primary surface included only the client | **fixed**, W4.17: `run_lift.py` expands the copy rectangles; see below |
| 9 | Pressing a sidebar button shows no pressed ("clicked") frame; hovering shows no highlight | New | the game's own button class gets `WM_LBUTTONDOWN`, paints and locks the primary, and the picture is the same as before | **fixed**, W4.18: owner-draw state transitions notify the parent even when the guest subclass handles paint; `e2e/lobby.mjs` |
| 10 | The lobby's right panel was not finished in an earlier browser build | New | the lobby's panels slide in (`seq-13` in `e2e/shots` is the middle of it); an earlier snapshot failed to repaint the title tab and minimap after the animation | **fixed**, W4.19; `work/web-lobby-idle-40/` shows the full panel after 40 s idle and an identical right-panel crop after opening and closing a drop-down |
| 11 | Can the game change its resolution while running? | Question | the game takes its size from `RA2MD.INI` (Yuri) or `RA2.INI` (Red Alert 2) when a game or mission starts; both have an 800x600 menu shell, and each new game can use a new size ([hires.md](../hires.md), W9.1 and W9.2) | answered |
| 12 | Red Alert 2 looks frozen while loading a saved game (or never reaches the menu when saves exist) | New | the game appends a whole copy of its settings on later writes. The saved `RA2.INI` had grown to 31 MB (19,000 copies), and restoring it made every start-up parse all of it before the menu. Yuri's Revenge was already compacted on restore; Red Alert 2 was not | fixed: `restoreSaves` compacts an oversized `RA2.INI` or `RA2MD.INI` to the copy that edition's reader uses (Red Alert 2 reads the last, Yuri the first), and the save watcher stores the compacted bytes too. With the same 31 MB profile the menu opened in 3.5 s, the store shrank to 1,993 bytes, the last (1920x1080) video setting survived, and Load Saved Game worked |
| 13 | Joining a normal Yuri's Revenge game shows "the resolution will be limited" even though the host set no limit; later the 1920x1080 cap was also unwanted | New | YR kept the stock join check: a room without a resolution flag allows only 1024 wide, so a guest whose `RA2MD.INI` asks for more (the launcher's 2580x1080 here) is prompted before joining | fixed, then removed: the join check now jumps to its accept path, so no room caps a guest and the prompt is unreachable. Red Alert 2's stock skip stays, so both editions use the player's INI size online ([hires.md](../hires.md)) |
| 14 | Hovering the Allied or Soviet emblem on the campaign screen does not light it up (browser and Linux; native Windows is fine) | New | the campaign dialog (`0x94`) runs its hover from `WM_NCHITTEST`, not `WM_MOUSEMOVE`: the handler hit-tests the point, then sends the `0x4D3`/`0x4D4`/`0x4D5` messages the emblem controls animate from. Windows sends `WM_NCHITTEST`, with screen coordinates, ahead of every mouse message; `win32hle`'s mouse input posted only the mouse message | **fixed**, pcrecomp: `hle_input_mouse` sends `WM_NCHITTEST` to the window under the pointer before queueing the mouse message (also while another window holds the capture, as on Windows). `user32_hover_selftest` checks the message, its target and its coordinates; `e2e/campaign-hover.mjs` shows both emblems change and return pixel-exactly in **both editions** (Yuri's Revenge 29,990 and 26,930 pixels; Red Alert 2 36,492 and 30,370). Also true of the native Linux host; W4.20 |
| 15 | World Domination (RA2) is unplayable: the Allied/Soviet logos do not highlight or accept a click, and the mode refuses to start unless the display changes to 640x480 | New | the faction dialog's hover is its own `WM_NCHITTEST` hit test; `[this+0xC]` (the side under the pointer) is set only there and `WM_LBUTTONUP` commits it. The WDT entry also queried the server and called the display-mode switch, whose 0xFB prompt only offered 640x480/No | **fixed**, `wdt_patches` (`run_lift.py`, both editions): `WM_MOUSEMOVE` and `WM_LBUTTONDOWN` run the same hit test with the dialog's client coordinates, so hover and click work even when a client sends no `WM_NCHITTEST`; the 640x480 query/prompt is skipped, and the screen keeps the player's resolution. The online resolution cap is removed in the same change (`ra2/yr_online_patches`). A click then contacts the World Domination server; the local RA2Web bridge still stubs `RequestWDTState`, so without a WDT server it shows the native "Unable to connect" dialog |
| 15 | The launcher sometimes cannot start: "testmap.yrm (or another file) is missing from this browser's copy of the game", and it stays that way | New | the game route trusted the installation record's `complete` flag, but the browser's copy had lost the file (storage pressure, cleared site data), and the manifest kept calling it done; "Resume import" then trusted the same flag, so the file was never copied again. A big archive was only linked, so a lost one surfaced later inside the game instead of at the launcher | fixed: the game route measures every recorded file in OPFS before starting, marks the ones the copy lacks as uncopied, and says which files are missing with a **Resume import** link; the resume measures the copy before trusting the record and copies a lost or truncated file again (`missingGameFiles`, `markFilesMissing`, `beginImport(..., present)`; tests in `opfs.test.ts`, `manifest.test.ts`, `importer.test.ts`, `App.test.tsx`) |
| 16 | Loading a saved game crashes the browser port: `Uncaught RuntimeError: memory access out of bounds` in lifted `sub_006E7EB0` (`Theme::PlaySong`), with `Sov12S.sav` on the guest stack | New | a save made with another install can hold a song id the loaded theme pack does not have (the report's `Sov12S.sav` holds `0x30005C1B`, a pointer-sized value). `Theme::PlaySong` indexes its song array with it, `mov ecx,[eax+edi*4]`: 3.2 GB past the heap, so wasm traps (Windows would fault there too) | fixed: `theme_song_guard` (`run_lift.py`, both editions) turns a non-negative id past the pack's count into -1 ("no song") just after PlaySong loads its argument; the mission loads without that song. Checked with `tools/test_lift_patches.py`, and the report's save now loads to a running battle (1920x1080) |

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

## What was behind 12

`RA2.INI` in the save store had every section and key repeated about 19,000 times. The game's
settings writer appends a full profile on each later write instead of replacing the file, so each
start made the next one slower; at 31 MB the start-up parse stalled long enough to look like a
freeze, and nothing after it (including Load Saved Game) was reachable. Removing only the `.sav`
files did not help because the bloated INI was still restored.

The restore path already had a repair for Yuri's Revenge (`RA2MD.INI`): keep the first section
and key copy, which is what Yuri's reader uses. Red Alert 2's reader uses the **last** copy (a
test `RA2.INI` with 640x480 and then 800x600 started at 800x600), so compacting to the first would
silently revert its video setting from the profile's 1920x1080 to the imported 1280x720. The
repair now picks the copy per edition and writes those bytes back over both the game's file and
the save store; the save watcher compacts the bytes before storing them too. The profile from the
report was used as the check: 31,391,338 bytes in the store, menu in 3.5 s, store at 1,993 bytes,
the last 1920x1080 setting preserved, and Load Saved Game stayed running.

## What was behind 16

The report's saves are from another install (their internal "Last Save Time" is
2011; a save the page makes now says 2026), and `Sov12S.sav` stores `0x30005C1B`
where the Theme keeps the current song. The load runs `Theme::QueueSong(stream)`
over the save (`sub_006E8340`) and passes that value to `Theme::PlaySong`. The
song list has 19 entries, the value is not one, and the out-of-range branch
still reads `[array + id*4]` at `0x6E80C7` before it prints the song's name; on
Windows the address would fault as well. A temporary `[theme-trace]` print in
the lifted body showed `PlaySong arg=30005C1B caller=006E8340 count=19` for the
save, and `arg=FFFFFFFF` for a save made by this build; the crash reproduces in
the imported (OPFS) route at 800x600. The guard turns only positive ids past the
count into -1, leaving the -1/-2/-3 sentinels alone. The report's save then
reaches a running 1920x1080 battle (screenshot `work/perf/repro-fresh`).

## What is known about 8, 9 and 10 (parked)

The three are cosmetic and none was a clear fault of the emulation, so they wait for a
reference (a screenshot or a short video of the Windows game at the same moment) to
compare with. What was measured, so the next try need not repeat it:

- **How it was measured.** A debug build (not kept) with a ring of the lifted functions
  entered (`RECOMP_TRACE`, about 5 minutes to build), a log of every primary and back-surface
  `Unlock` with the box of pixels that changed, and a log of `InvalidateRect`, `PAINT` and
  `ValidateRect`. `e2e/diff.mjs` counts what differs between two screenshots; `drive.mjs`
  has `down` and `up`.
- **8, no border on drop-down lists (fixed, W4.17).** `ComboDropWin` draws its
  custom two-pixel frame into the game's `AlternateSurface`, two pixels outside
  the client rectangle. Its final copy to `PrimarySurface` copied only the
  client rectangle. On this host, painting the invalid child does not also
  repaint its parent, so the frame stayed offscreen. `run_lift.py`'s
  `dropdown_frame_patches` recognizes the unique copy/unlock/validate epilogue
  in each shipping executable and injects code immediately before the copy to
  expand both source and destination rectangles by two pixels on every side.
  It leaves same-surface and ambiguous/unrecognized copies untouched. The
  matcher is covered by `tools/test_lift_patches.py` (five tests, including the
  YR and RA2 global layouts). Browser captures show the color-list frame in
  `work/web-dropdown-current/color-open.png` and the resolution-list frame in
  `work/resolution-frame-first/resolution-open.png`; the native color-list
  reference is `work/ui-reference/native-open-dropdown.png`. No generic window
  border is added.
- **9, hover and pressed frames (fixed).** The earlier references were extracted
  from a lossy H.264 recording: small changes across unrelated buttons were
  compression noise. A fresh FFV1/BGR0 recording of the original machine code
  proves that hover equals idle pixel-for-pixel. Holding Start Game changes
  5,095 pixels in that button, while Customize Battle, Back and the panel stay
  identical. Its native selected appearance is an orange/yellow blank frame;
  release restores the text. The guest saves `DRAWITEMSTRUCT.itemState` at
  button-record `+0xE8` in `0x006213A0`, then repaints the subclass. HLE previously
  sent `WM_DRAWITEM` only from its built-in `WM_PAINT`, which this subclass
  consumes, so the guest never learned that selection changed. HLE now sends
  `ODA_SELECT` on selection transitions and `ODA_FOCUS` on focus transitions.
  `user32_button_selftest` covers a subclass consuming paint and a parent
  storing state and repainting it. The existing hover and paint selftests also
  pass. `e2e/lobby.mjs` compares raw 800x600 game pixels: hover is unchanged,
  held changes only the target, captured drag-out/in clears/restores selection,
  and release restores idle. Evidence: `work/native-lossless/diff-report.json`
  and `work/lobby-button-acceptance/report.json`.
- **10, the lobby panel's last frame.** The map preview is drawn into the back surface in the
  dialog's first paint (644,37 to 788,125); the 14-frame slide-in then redraws the panel
  top (632,0 to 799,198) over it; the game's own last repaint (`InvalidateRect` of the dialog)
  copies only x below 632 to the screen. Any later repaint of the whole dialog (a drop-down
  closing) draws the preview again and copies it. Ruled out: the older-dialog rule from W4.15
  (`HLE_NOUNDER` test), the 15 ms publish throttle (publishing from the idle pump changed
  nothing), the pointer position (`GetCursorPos` is right). The current browser build passes
  the acceptance check: after 40 seconds idle, the right panel, minimap and title tab are
  pixel-identical after a dropdown is opened and closed. Evidence is in
  `work/web-lobby-idle-40/`.

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
