# Plan: Red Alert 2 (`game.exe`) menu and resolution, like Yuri's Revenge

Status: implemented 2026-10-24; the browser saved-game, layout, no-launcher-size and
online-lobby checks ran 2026-10-25 (see the handoff). Written from a static reading of the lifted code
(`src/recomp/gen_game`, `src/recomp/gen`), the host and pcrecomp sources, and
headless runs (`work/tests-game/`).

Done and how it was checked:

- Step 1: `ra2_shell_patches` (toggle forced, 800x600 shell and switch-backs),
  `ra2_confirm_patches` (no 0xD9 confirm; the size is only stored). Playtests:
  menus at 800x600 and games at the chosen size and back
  (`work/tests-game/finish/`: menu-idle, menu-options, back-options,
  skirmish-start, options-pick-size, 13 of 13 pass); `--original` skirmish-start
  and menu-idle pass (the shipping code does not toggle: it stays at the INI size).
- Step 2: host `EnumDisplayModes` hook, pcrecomp table, `ra2_hires_patches` and
  `ra2_mode_cap_patches`, browser dropdown; `tools/test_resolution_lists.py`
  keeps the four lists identical. Native resolution playtests cover 1280x720
  through 5120x1440. The 5120x1440 return-to-shell cycle passes without frame
  recording; headless recording is very slow at that size. Browser
  `res-1280x720 --web` passes against a fresh Vite preview; the earlier
  `Error: unwind` run was caused by a stale/broken preview and is superseded.
- Step 3: `ra2_online_patches` and the `wolapi` flag round trip (RA2 and YR
  self-tests, run by the Codex session). Run in real two-player
  lobbies on 2026-10-25 (`web/e2e/wol.mjs --expect-size`, `--room-flags`): the unflagged,
  0x200 and 0x400 rooms clamp as intended; see the handoff. The run found that the join check
  compared the 800-wide shell width, fixed in `ra2_online_patches`.
- Step 4: playtest cases, `tools/test_lift_patches.py` (29 tests),
  `docs/hires.md` (new section), `docs/presenter.md`, README.
- Host (not in the plan): this Windows would not start the ~480 MB host image at
  `/BASE:0x60000000` (error 308), and a 16 MB main stack sat on the guest's
  0x00400000 range. The host links at 0x10000000 with a 1 MB stack and runs the
  game on a 16 MB thread (`CMakeLists.txt`, `host.c`). Yuri's Revenge was
  rebuilt and passes menu-idle and skirmish-start.

## Decisions

- Menus run at 800x600 like Yuri; the game switches to the chosen size for a
  match and back at the end.
- The mode toggle is forced on by a lift patch, not by writing `RA2.INI`.
- Picking a size opens no confirm. The "The display mode will be changed..."
  dialog (0xD9, Ok/Cancel) is treated as Ok: Options stores the size for the
  next game and no live switch runs; Display Options keeps the current mode.
  Lift patch `ra2_confirm_patches` (run_lift.py) at the two callers
  (0x00542719, 0x00543B0C).
- The Options resolution list shows every size.
- Online matches are held to 1024x768 to 1920x1080; `wolapi` carries the limit
  in the room flags.

## What was found

- Both games share the Options screen (dialog `0xD5`, resolution combo 1773)
  and Display Options (dialog `0xD8`, list 1497). The code is identical.
- Yuri switches modes: 800x600 shell, the INI size in a match, "Toggle display
  mode to %d x %d" and "back to shell res". RA2 has the same code, gated by
  `[Video] AllowModeToggle` (byte `0xA40D0B`), default off. Off, RA2 runs its
  menus in the INI's mode (a small centred menu in a 1920x1080 frame).
- RA2's menus have a native 800x600 layout that fills the frame
  (`work/tests-game/r800-menu/sheet.png`).
- Turning the toggle on in a private copy faulted: the shell opened at 640x400
  (the video-memory check at `0x00495AD0` came out low) and the intro Bink
  movie crashed in `binkw32` (`work/tests-game/tog-menu/run.log`).
- Startup (Startup.CPP) hard-codes 640 and 400/480 at `0x00690150` to
  `0x00690197`; the switch back hard-codes 640x480 at `0x0065D959` to
  `0x0065D971`; the match-start toggle is at `0x0065BF98`.
- The resolution list comes from `EnumDisplayModes` (callback `0x4961F0`,
  filter `0x4962A0`): 16-bit only, 640x480 up to 1024x768 without
  `AllowHiResModes`, up to 4096x4096 with it. The native host does not hook
  it, so the list is whatever the Windows driver reports; the web table in
  `pcrecomp/runtime/win32hle/ddraw.c` has 17 sizes up to 1920x1200.
- The combo selects the entry matching the current size exactly; no match
  leaves it blank (likely cause of the blank list; not confirmed on a real
  run). Picking a size opens a confirm dialog (`0xD9`); with the toggle off it
  switches the display live (`0x543A70`), with it on it only stores the size.
- Online join check: `sub_00745780` (wonline.cpp). Room flags `[+0x20]`:
  `0x400` limits to 800 wide, `0x200` to 640, neither to 1024; compared with
  the current width (`0x8523E0`). In this `game.exe` an unconditional `jmp` at
  `0x007457CC` skips the comparison, so there is no online limit today.

## Steps

### 1. Shell and mode toggle

1. Patch the shell size to 800x600 at the three places above. First find out
   what the compare near `0x0065BF98` reads (the globals at `0x839648/4C` held
   a string address, not a size).
2. Force `AllowModeToggle` on by patching right after the options load at
   `0x005D8E2D`. Check whether the game writes it back to the INI on exit; if
   so, patch the uses instead. `--original` will not toggle.
3. Options applies to the next game: with the toggle on, picking a size only
   stores it; the live switch at `0x543A70` must not run. Per the later decision
   above, the `0xD9` confirm is skipped too: `ra2_confirm_patches` pops the
   dialog's argument and treats it as Ok at both callers (Options 0x00542719,
   Display Options 0x00543B0C). Playtest `options-pick-size` checks that no
   0xD9 opens and that the next skirmish starts at the picked size.
4. Presenter check across 800x600 to game size and back: window aspect, mouse
   mapping, recorder (Yuri already uses this path).

### 2. Unlock the resolution list

1. Add a log line printing the modes the native host's DirectDraw returns.
2. Hook `EnumDisplayModes` in `host.c` and extend the pcrecomp table. One entry
   per size at 16-bit, no refresh-rate duplicates: standard sizes to 4K,
   ultrawides (2560x1080, 3440x1440, 3840x1600, 5120x1440), the monitor's
   native size, and the size `RA2.INI` currently holds so the box is never
   blank.
3. Lift patch: force `AllowHiResModes` on (same override as the toggle); raise
   the 4096 cap in both dialogs (`0x00543D56`) if above 4K is wanted.
4. Web: raise the dropdown's 8-item cap; keep the F10 list and the dropdown in
   sync.

### 3. Online range, 1024x768 to 1920x1080

Room flag to limit (max width), replacing the stock 640/800/1024:

| Room flag | Stock | New |
|---|---|---|
| `0x200` ("ResolutionLimited640") | 640 | 1024 (1024x768) |
| `0x400` ("ResolutionLimited800") | 800 | 1920 (1920x1080) |
| neither | 1024 | 1920 (1920x1080) |

- Below 1024x768 online is raised to 1024x768 when the match starts.
- Lift patch: change the constants in the limit arithmetic
  (`0x007457AA` to `0x007457C4`); replace the dead `jmp` at `0x007457CC` with
  a real check; replace the live display switch (`0x00745864` on) with storing
  the clamped size for the next game. Also clamp at the match-start toggle
  site (`0x0065BF98`) using a session-type check. Skirmish and campaign stay
  unrestricted.
- `wolapi.c`: keep the existing flag bits; set them when a room is created
  (`m_chat_request_channel_create`) and read them in `parse_room_line`
  (`channel->flags`). The RA2Web server must pass the flags through; for real
  enforcement it must check sizes itself (a patched client can ignore the
  clamp).
- Notes: the game's "Resolution limited to 640/800" text comes from its
  language data and would be wrong, but the quiet clamp never shows it.
  1920x1080 shows more map than 1024x768, so a size range is not an equal
  view.

### 4. Tests and docs

- RA2 playtests (lift and `--original`): menu surface is 800x600; skirmish
  switches to the chosen size and back; picking a size in Options; the list is
  never blank and lists 1366x768, 2560x1440, 3440x1440, 3840x2160; online
  matches at 800x600, 1366x768, 1920x1080, 2560x1440 (two-player lobby)
  checking the clamp.
- Web: a matching browser case and a `wolapi` self-test for the flags.
- Docs: fix `docs/hires.md` and `docs/presenter.md` ("menus are always
  800x600" is only true for Yuri), the README table, the web docs.

## Order and open points

Do 1, then 2, then 3; each can be tested on its own.

### Browser runtime follow-up

The launcher-size override is reapplied after browser settings are restored, so
an older saved `RA2.INI` should not override the launcher's choice. Automated
web tests pass; confirm the behavior in the browser before closing this item:

- [ ] Browser RA2: choose a launcher resolution, start the game, load an
  existing save, and confirm the game switches to the chosen size.
- [ ] In the loaded match, check that the pause menu and command bar align with
  the game viewport; resume and confirm the return to the 800x600 shell.
- [ ] With no launcher resolution selected, inspect the in-game list and
  confirm the available sizes/current selection are handled correctly. The
  user's screenshot showed only 640x480, 800x600, and 1024x768.

- `gamemd.exe`: not checked for the same bypassed join check or the same
  enumeration behaviour (the dialog code is identical).
- The 640x400 and "back to 640 X 400" branches go away with the 800x600 patch;
  confirm nothing else reads them.
- Unflagged rooms are assumed to allow up to 1920x1080; change the table row if
  the stock 1024 should stay.
