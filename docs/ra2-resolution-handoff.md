# Handoff: RA2 menu and resolution toggle

Plan: [ra2-resolution-plan.md](ra2-resolution-plan.md). Updated 2026-10-25.
The implementation and evidence are in the current working tree on `web-port`;
there are unrelated in-progress changes in this checkout, so preserve them.

## Current status

The main-menu toggle and resolution-list work is implemented. RA2 starts in an
800x600 shell, stores a size chosen in Options for the next match without the
0xD9 confirmation, switches to that size for the match, then returns to the
shell. The native playtest batch recorded in `work/tests-game/finish/` passed
13/13 cases, including the resolution range through 5120x1440 and the Options
size picker. `--original` menu and skirmish smoke cases passed as well.

Additional checks recorded in the working session:

- `tools/test_lift_patches.py`: 29 passed.
- `tools/test_resolution_lists.py`: passed; it compares the native, presenter,
  pcrecomp HLE, and browser mode lists.
- The 5120x1440 match and return-to-800x600 cycle passed with recording disabled.
  Frame recording is extremely slow at this size, so the no-record run is the
  relevant 5K evidence.
- Browser `res-1280x720 --web` passed against a fresh local Vite preview. The
  earlier `Error: unwind` results against another preview are superseded.
- RA2 and Yuri's Revenge WOLAPI self-tests pass and check preservation of
  room flag bits `0x200` and `0x400` through create and room-list parsing.

## Status, 2026-10-25 (end of session)

Committed as `b555f0a`. Done and verified: the shell/match switch, the saved-game switch,
the Options list, the in-game menu alignment, the return to 800x600 (native and browser),
and the browser `--web` cases (5 of 5 on a private 1 GB / 4 GB-cap build, run with
`playtest.py --web --web-url http://localhost:<port>/`; `skirmish-start`, `res-1280x720`,
`res-1920x1080`, `options-pick-size`, `res-pause-menu-1280x720`). The published build's
768 MB cap still cannot run that suite (zero-copy work). The online clamp ran in real
two-player lobbies (unflagged, 0x200, 0x400; below) and `skirmish-build` passes natively and in the browser (below).
Nothing is left open except what is under "Remaining verification".

## Final checks on the build with the join-check fix (2026-10-25, 15:0x)

Published `web/public/game/ra2` rebuilt 15:04 and a private 1 GB / 4 GB-cap build of the same
sources (15:08, served by `vite preview --outDir` on its own port):

- Published build, dev server: `web/e2e/resolution-load-saved.mjs` passes (800x600 ->
  1280x720 on load, the Escape menu aligned: `work/runtime-resolution-load/shots-final3/`).
- Private wide build, `playtest.py --web`: `skirmish-start`, `res-1280x720`,
  `res-1920x1080`, `options-pick-size`, `res-pause-menu-1280x720` and `skirmish-build` all
  pass (6 of 6; modes 800x600 -> chosen size -> 800x600, no 0xD9 dialog).
- The published build cannot run that `--web` suite in its default test mode: its 768 MB cap is
  below what the page's test mode (copy every game file into memory) needs. `playtest.py
  --web --web-import --web-url http://localhost:5173/` imports the case's folder into OPFS the
  way the launcher does and plays from there (the game is read in place), so it runs on the
  published build; `res-1280x720` passed that way on it (800x600 -> 1280x720). The rest of
  the suite was not run in that mode (each case imports about 1 GB, so it is slow).

## Online clamp in a real two-player lobby (run 2026-10-25)

Two browsers through the local RA2Web server (`127.0.0.1:19090`), a private 1 GB / 4 GB-cap
build served with `--build`, the dev server's game folder, accounts `woltst1`/`woltst2`.
`web/e2e/wol.mjs` gained `--expect-size WxH`: after both simulations pass frame 300 it
asserts both clients' canvas size.

```
node e2e/wol.mjs --url 'http://localhost:5173/?target=game' --build <private build>/ra2 \
  --shots ../work/wol-clamp-A --arg --intro --play --expect-size 1920x1080
```

- Both clients with `RA2.INI` 2560x1440, an unflagged room: the lobby, STARTG handoff and
  FRAMESYNC all worked, and both clients played at 1920x1080 (host and guest `size`
  1920x1080 at frame ~540; their settings still said 2560x1440). The upper clamp holds live.
- Both clients with `RA2.INI` 640x480 (`--expect-size 1024x768`): both played at 1024x768
  (frame ~540, FRAMESYNC), so the lower bound holds live too.
- Room flag 0x200, `--room-flags 0x200 --expect-size 1920x1080,1024x768` (RA2.INI 2560x1440 on
  both): the host's room is published with the flag (the first WOLAPI2 number, the game's
  `[room + 0x20]`; the test rewrites the host's topic line, since the game only sets it from
  its own shell mode), the guest's join check clamped its stored size to 1024x768 and the
  match ran with the host at 1920x1080 and the guest at 1024x768. Flag 0x400: both clients at
  1920x1080. The unflagged room is the first run above.
- **Bug found by this run and fixed**: the join check compared the room's limit with the
  *current display width* (`[0x8523E0]`), which under the toggle is the 800-wide shell, so no
  limit was ever exceeded and the guest was never clamped at join. It now compares the match
  size (`[0xA40B38]`) when the toggle is on (`ra2_online_patches`, `jmp_check`; unit test
  updated). Before the fix the guest played at 1920x1080 in the 0x200 room.
- `RA2.INI` in `game/` was changed for these runs and restored.

## `skirmish-build` (fixed 2026-10-25)

It failed on the recomp build because the case clicked where Yuri's MCV starts; Red Alert 2's
start position is random, so the deploy never happened and no cameo was built. The case now
drags a band over the view before pressing D, and asks for two builds and two placements, not
a surviving player (Red Alert 2's Brutal AI beats an idle player in the run). It passed three
times on the recomp build (`produce x3, place x11`; `produce x2, place x17`) and in the
browser (`select_mcv`: a click there, because its start position is fixed and a band does not
select; a band natively). `--original`
still fails it (the shipping build starts at 640x480 with no 800x600 shell and never builds),
which is not a regression of this work.

## Remaining verification

The online clamp has been exercised in real two-player lobbies (section above): both
clamps at match start and at join, with unflagged, 0x200 and 0x400 rooms.

RA2Web (`../ra2web/server/src`, read 2026-10-25): it stores a room's topic, WOLAPI2 metadata
included, as an opaque string and relays it; it does not read the resolution flags or any
player's size. The range is therefore enforced by the clients, as the original game does
with `ResolutionLimited640/800`; a modified client that skipped the check would not be
stopped by the server. Enforcing it there would be a change in that separate checkout (parse
the first WOLAPI2 number on `topic` and refuse a `joingame` whose client reports a size
outside the range) and needs the protocol to carry the client's size, which it does not
today. Not done here. The published browser build was rebuilt for the join fix (15:04).

The browser saved-game resolution fix is implemented and covered by the web
tests, but still needs this runtime check:

- [x] (done 2026-10-25, see "Fixed" below) In Browser RA2, set a target size in the launcher, start the game, then
  load an existing saved game. Confirm the game changes to that size and that
  the pause menu and command bar align with the game viewport; resume and
  confirm returning to the 800x600 shell.
- [x] (done 2026-10-25) Start with no launcher size selected and inspect the in-game resolution
  list. Confirm the available sizes and that the current size is selected or
  otherwise handled cleanly (the reported screenshot showed only three sizes).

Yuri's Revenge's join check was inspected at `0x789960`: unlike RA2's shipping
code, it retains its comparison (`jle 0x789a58` at `0x7899aa`), so the RA2
online patch is not applied to YR.

## Working tree notes

Nothing is committed. The checkout contains unrelated LAN, Thai-font, web, and
presenter work; do not revert or clean those changes while continuing this
task. The host startup fix is adjacent but outside the resolution plan:
`CMakeLists.txt` links at `0x10000000` with a 1 MB main stack, and `host.c`
runs the game on a 16 MB thread and skips a suspended-child range hold when the
range is already free. Yuri's Revenge menu and skirmish smoke cases passed
after its rebuild.

## Browser runtime checks, 2026-10-25 (saved game verified)

- Gap found and fixed: a loaded saved game never switched to the chosen size (natively
  too), because the match-start switch (0x0065BF98) is Start_Scenario's and the loader
  has none. `ra2_load_patches` (run_lift.py) runs the same switch (`sub_005434E0` to the
  INI size, when the toggle is on and the size differs) after the loader's last call
  (0x00656B1E); `RA2LoadPatchTests` covers it. Native: `SetDisplayMode(1280x720)` during
  the load, then in game. Browser: `web/e2e/resolution-load-saved.mjs` passes on the dev
  server (800x600 -> 1280x720 on load; the check now waits for the size, not a log line).
  Not looked at: the pause menu on that screen, and the return to the 800x600 shell
  after a loaded game. 
- Native suite after the patch (`work/tests-game/load-patch`): 34 cases, 8 failed. Four
  fail the same on the shipping code (`--original`): menu-network, back-network, lan-new,
  skirmish-build. The other four (menu-moviesandcredits, back-movies, sp-skirmish,
  sp-campaign) passed when rerun with `--jobs 1`; they failed only in the parallel run.
- Why the earlier browser runs failed, none of it the resolution code: (1) `playtest.py
  --web` copies all game files into memory and the zero-copy work cut the cap to 768 MB
  (`Error: unwind` at about 570 MB); fix with that work. (2) Codex's `ra2-small` test
  folder lacked `Movies01.mix`/`Movies02.mix`; the game stops with "Failed to
  initialize" without them (a real install has them, and the importer stubs them).
  (3) The fixture save was made by the native build and crashes in `OleLoadFromStream`
  in the browser build; a browser-made save loads. The fixed fixtures are in
  `work/runtime-resolution-load/` (`saves-web.zip`).
- Web unit tests (267) and typecheck pass; `build-web-game` and `web/dist` were rebuilt.
- No launcher size selected, Options screen (browser, 2026-10-25, screenshots in
  `work/runtime-resolution-load/shots-opts/`): the 800x600 menu fills the frame, the
  combo shows `1920 x 1080 x 16` selected, and the opened list shows 640x480 up to
  1920x1080 (18 visible entries with a scroll bar for more), not three. The second
  checklist item is done.
- Another session was relinking `build-web-game` at 09:54-10:10; the browser tests above
  used the 09:38 build in `web/public/game/ra2/`.
- Loaded game at 1280x720 (browser, `work/runtime-resolution-load/shots-pause/`): the map
  and sidebar fill a 16:9 area, the sidebar flush with the right edge and the picture
  120..840 high in the 960-high canvas, no offset. The in-game options/pause menu was
  not opened: Escape (scripted key and page key) and a click at the radar did not show
  it, so its alignment is unchecked; open it by hand. The return to the 800x600 shell
  after a loaded game is unchecked too.
- Browser `playtest.py --web`, 2026-10-25 10:2x: a private build with the old 1 GB / 4 GB
  memory cap (`CMAKE_ARGS='-DWEB_OUT=... -DWEB_LINK_OPT=-O1;-sINITIAL_MEMORY=1GB;-sMAXIMUM_MEMORY=4GB'`,
  its own `BUILD_DIR`, served by `vite preview --outDir` on its own port; removed after) ran
  skirmish-start, res-1280x720, res-1920x1080 and options-pick-size: 4 of 4 pass, modes
  800x600 -> chosen size (-> 800x600 at the end), no 0xD9 dialog
  (`work/tests-game/web-wide/summary.web.txt`). The published 768 MB-cap build still cannot
  run this suite, so the page's test mode needs the zero-copy layout (see above).

## Fixed: the in-game menu was misaligned at the toggled size (2026-10-25)

Cause: the game keeps two sets of layout rectangles. The display profile (0xAC1184..,
rects 0xAC11B4..) was already rebuilt by `RA2_PROFILE_RESET` after the switch, but the
in-game set (0xAC11A0.., rects 0xAC11D4..0xAC1200 built by sub_006F4C90, flag 0xAC11B0,
lazily built by sub_006F4620) stayed built for the 800x600 shell. A memory scan in the
browser build showed 0xAC11F4 = x 632 (width 800 minus 168) at 1280x720. The fix adds
`RECOMP_CALL(sub_006F44D0)` (tear down and rebuild that set with the current size) to
`RA2_PROFILE_RESET`, which runs after the match-start switch and after the saved-game
switch. Native `res-pause-menu-1280x720` (new playtest case) passes and its last frame
matches the shipping layout (sidebar piece at the right edge, buttons inside it):
`work/runtime-resolution-load/shots-pause/native-skirmish-esc-1280x720-fixed.png`. Native
batch `work/tests-game/profile2`: skirmish-start, res-1280x720/1920x1080/2560x1440,
options-pick-size and the menu cases pass; menu-network fails (it also fails on the
shipping code).

Browser (published `build-web-game` rebuilt 12:27, `web/e2e/resolution-load-saved.mjs` on
the dev server, `work/runtime-resolution-load/shots-final2/`): the saved game loads at
1280x720, the Escape menu (a guest key after the load-complete log line; the page's own
Escape only releases the pointer) is aligned like the shipping layout, and Abort Mission
-> confirm (0xB6:1737) -> score Continue (0xBC6:1745) returns the canvas to 800x600. A
memory scan of the published module at menu time shows the rectangles rebuilt for 1280x720
(0xAC11F4 x = 1112, bottom bar 1112 wide). The e2e script now checks the pause menu
screenshot by hand (`pause-menu.png`) rather than asserting on it.

The original defect notes follow for the record.

Press Escape in a match (Keyboard.ini `Options=27`; the dialog is 0xB5). At 1280x720 the
menu's backdrop is drawn at the left (0..856), but the sidebar-shaped piece is drawn at
the 800-wide shell position (x 632..800), while the buttons are at the right edge
(x 1133..1258, inside where the sidebar should be). The dialog window itself is 1280x720
and its buttons use the right layout; only the drawn pieces use the stale 800-wide
position. Evidence, in `work/runtime-resolution-load/shots-pause/`:

- `esc-menu2.png`: browser, saved game loaded at 1280x720 (the defect).
- `native-skirmish-esc-1280x720.png`: native, a plain skirmish at 1280x720: same defect,
  so it is not from the saved-game load patch. (Native frames are scaled to 800x600.)
- `shipping-esc-1280x720.png`: `--original` at 1280x720 with the toggle off: correct,
  sidebar piece at the right edge with the buttons inside it.
- `yuri-esc-2580x1080.png`: Yuri's Revenge, which has the same toggle: correct.

So it comes from RA2's toggle-on path (the 800x600 shell patches or the code around them),
not from the game's own layout. Not found yet. Ruled out: the saved-game patch;
`sub_005434E0` does write `0x8523E0/E4` and `0x839648/4C` (0x54357A, 0x54356E). Next
steps: find what places the menu's sidebar piece (the dialog draw code uses a
reference size at 0x7ADD68..0x7ADD78 for centring; check what those hold in RA2),
and compare memory at menu time against Yuri; the pause menu check in the checklist
above fails until this is fixed. Disassembly helper: `work/ra2disasm.py ADDR LEN`.
The shipping build with `AllowModeToggle=yes` crashes at start (segfault at the 640x400
shell), so it cannot serve as a comparison.
