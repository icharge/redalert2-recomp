# Changelog

All notable changes to this project. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [SemVer](https://semver.org/).

## [Unreleased]

### Added

- **In-game game resolution**: the F10 menu now has a Resolution choice next
  to Scaling. It writes the host's resolution setting into the game's
  INI/options, so the match that is running keeps its size and the next one
  opens at the new size. "Match browser size" uses the page's own pixel size
  (the window in CSS pixels times the device pixel ratio) and follows a
  resized window until the next match; the launcher's Video tab offers the
  same choice. (`web/src/components/SettingsDialog.tsx`,
  `web/src/screens/Play.tsx`, `web/src/storage/video-preferences.ts`,
  `src/web/video_modes.h`)
- **The game INI says `[Intro] Play=no`**: a fresh profile, an imported
  `RA2.INI`/`RA2MD.INI` and an existing saved file are all written with the
  flag off. The launcher's Skip intro switch remains the host's
  `--intro`/`--no-intro`. On the stock startup-movie path the game's own screen
  ends the logo on Escape or a left click, exactly as the retail engine does.
  (`web/src/storage/game-settings-defaults.ts`,
  `web/src/storage/game-settings.ts`)
- **Start-up logo override**: the launcher ships the original
  `WESTLOGO.BIK` / `EA_WWLOGO.BIK` assets and stages them into the browser's
  game folder when the import has no loose logo. The game then uses the loose
  file before the `LANGUAGE.MIX` / `LANGMD.MIX` copy, and falls back to the MIX
  when the asset is absent. A logo uploaded through the Library file manager,
  or imported from the source folder, wins over both. (`web/public/logos`,
  `web/src/game/loader.ts`, `web/src/storage/install.ts`,
  `web/src/storage/file-manager.ts`)
- **Startup order**: boot screen first is Red Alert 2's stock order and is the
  default for both editions; Yuri's Revenge's stock logo-first order remains
  available. The setting is `[present] startup` in
  `.host/ra2md.ini`/`.host/ra2.ini`; `--startup-order boot-first|logo-first`
  does the same for the native hosts. It is deliberately not shown in the
  launcher UI. (`run_lift.py`'s
  `yr_startup_order_patches`/`ra2_startup_order_patches`,
  `src/runtime/startup_order.c`, `src/web/settings.c`)
- **Launcher display options**: the launcher's resolution defaults to
  1920×1080. The list also detects the desktop's own pixel size (`screen` ×
  `devicePixelRatio`), marks it "(Native)" and adds it when the catalog lacks
  it, so the player can choose it. A Full screen setting enters fullscreen when
  a game starts, with a "Game match only" sub-option that keeps the launcher and
  game menus windowed, enters fullscreen at the match's loading screen and
  restores the window after the score screen. A fullscreen button sits beside
  the in-game volume control.
  (`web/src/storage/video-preferences.ts`,
  `web/src/storage/fullscreen-preferences.ts`,
  `web/src/components/LauncherGameSettings.tsx`, `web/src/screens/Play.tsx`)
- **The game's cursor on a page layer** (the browser's default; `?cursor=game`
  or the launcher's Cursor setting “Game's own (software, traditional)” keeps the
  game's own; `RA2_PAGE_CURSOR=1` for the presenter): the game's own cursor - the
  MOUSE.SHA frame it loaded and MOUSEPAL.PAL's colours in a match, the Win32
  arrow it sets in the menus and over the pause dialog - is decoded once per
  cursor change and drawn on one canvas above the picture, at the pointer's own
  rate, while the game skips its own blit. The cursor therefore moves at display
  refresh rate instead of the game's frame rate, everywhere. With the game's own
  cursor chosen, nothing changes: CSS cursor and pause overlay included. The
  first design (reading the primary surface under a DirectDraw lock on the
  game's mouse thread) froze the game and is not used: the host reads only the
  cursor object the game already has, never the screen.
  (`src/runtime/page_cursor.c`, `src/web/presenter.c`, `src/runtime/present.c`,
  `web/src/game/cursor-layer.ts`, `web/src/game/presenter.ts`,
  `web/src/game/gl-presenter.ts`, `web/src/storage/cursor-preferences.ts`,
  `run_lift.py`'s `page_cursor_patches` and `page_cursor_palette_patches`,
  protocol 10.)
- **Web links**: the browser build no longer hands WOL-era links to the
  system browser. `run_lift.py`'s `web_url_patches` intercepts the three
  routines that write a probe `.html`, find the default browser and start it
  (RA2 `0x0073C580`; YR `0x0077DC90` and `0x00551630`), logs the URL unchanged
  and emits an `open` event (protocol 9). YR's embedded WOL browser
  (`DoWebPageDialog`, `HTML\frame.htm`) is intercepted by page key too, before
  the embedded browser is created. The page maps the URL to a topic and
  shows our dialog: a sandboxed iframe for a configured page, otherwise a
  confirmation with the original URL. "Open in browser" is a
  `target="_blank"`/`rel="noopener noreferrer"` anchor and only `http(s)` URLs
  can become one. YR's registry `URL\Community` value is seeded so those
  buttons reach the hook; Windows native32 keeps its current behavior.
  (`src/web/presenter.c`, `src/linux/main.c`, `web/src/game/link-targets.ts`,
  `web/src/components/LinkDialog*.tsx`, `VITE_RA2WEB_SITE_URL`.)
- **Mods**: a mod is a folder in `mods/yr/` or `mods/ra2/`, laid over the
  game's folder without changing it (its files read first, what the game
  writes going into it, its maps and `expandmd*.mix` listed with the game's).
  `--mod NAME`; the settings menu (F10) on Windows and F9 at the main menu on
  Linux switch mods by restarting the game; the choice is remembered
  (`src/runtime/mods.c`, `src/linux/mods.c`, `mods/README.md`). Tried with
  R.O.T.K., a rules-only mod and a Red Alert 2 map pack.
- **Readable lifted C**: `run_lift.py` names functions from what the binary
  says (pcrecomp's `tools/lift/name_lift.py`: RTTI classes and vtable slots,
  constructors and destructors, debug messages) and gives each a header (its
  strings, Windows calls, `this` class, callers); 7,167 of Yuri's Revenge's
  functions and a share of Red Alert 2's are named. An older pcrecomp leaves
  the address names.
- **Linux, natively** (no Wine): `build-linux/ra2` (Yuri's Revenge) and
  `build-linux-game/ra2` (Red Alert 2), the same lifted C on pcrecomp's
  `runtime/win32hle` (pcrecomp #62): its own kernel32, a window manager with
  the dialogs the menus use, DirectDraw and DirectSound on SDL2, the Bink
  movies on ffmpeg, Winsock with IPXEmu's IPX over UDP, COM, and compound
  files for saves. `src/linux`: the host (`main.c`), Blowfish.dll's cipher
  for the MIX headers (`blowfish.c`, its tables read from the game's DLL) and
  the Windows host's scripted input (`script.c`); `src/runtime/hdvox.c`
  builds for it. `build-linux.sh` and `cmake/linux-i386.cmake` (gcc -m32,
  SDL2, SDL2_ttf, ffmpeg); `setup.sh` builds natively on Linux (`--wine` for
  the Windows exes) and lists the packages; `tools/playtest.py` runs the
  native build when it is there. On Debian 13 in
  Docker the playtest suite passes 30 of 30 for Yuri's Revenge and 30 of 30
  for Red Alert 2.
- **Linux**: the same cross build as the Mac's, played with `wine`. `setup.sh`
  lists the packages to install, offers xwin's release binary, and finds the
  game in your Steam libraries; `play.sh` and the playtests run plain `wine`;
  the toolchain finds clang-cl in Debian's and Ubuntu's `/usr/lib/llvm-*/bin`.
  Under Wine the game's IPXEmu `wsock32.dll` is loaded
  (`WINEDLLOVERRIDES=wsock32=n,b`), so the network screens work, and the
  playtests run those cases one at a time (they share one IPX port). Yuri's
  Revenge passes 30 of 30 under Wine 10.0 on Debian 13, Red Alert 2 29 of 30
  (`skirmish-build`, which the AI often wins on Windows too: it is unseeded).
- **macOS**: cross-compiled with clang-cl and xwin and played under CrossOver
  (`setup.sh`, `build.sh`, `play.sh`, `cmake/clang-cl-x86.cmake`), with the
  playtests and conformance run through Wine. 27 of 30 cases for each game
  on an Apple Silicon Mac. (#1, by [@cpressland](https://github.com/cpressland))
- `run_lift.py` and the host refuse an exe that is not the Steam build
  (`gamemd.exe` 0x3BDF544E, `game.exe` 0x3B1EBBED, their PE timestamps):
  another build lifts, but the patches land in the wrong code and it crashes
  in game. The host says so in a message box.
- `CONTRIBUTORS.md`.
- Setup.cmd builds both games: Yuri's Revenge, then Red Alert 2, each with
  its own shortcut (`Yuri's Revenge (recomp).cmd`, `Red Alert 2
(recomp).cmd`); `-Games yr` or `-Games ra2` builds one. `Red Alert 2
(recomp).cmd` used to start Yuri's Revenge; it now starts Red Alert 2.
- Red Alert 2 itself (`game.exe`) as a second target: `run_lift.py --target
game`, CMake `RA2_TARGET=game`, `recomp_target.h` for what the host needs
  to know about the binary; the sidebar fix, the options object and HD
  vehicles found again by shape; the playtest suite and conformance with
  `RA2_TARGET=game`.
- `--record`'s checksum line prints the game's own frame count, its frame
  rate over each 10 s (bringup.md, section 13).
- `--select` sets a slider; `RA2_PROFILE=1` samples which lifted function
  is running and prints the top 40 when the watchdog ends the run.
- RA2 against RA2 over the LAN, scripted on both PCs (`tools/lan/`, the
  host's and the joiner's side), checked in the game's log and pictured from
  its own frames (docs/testing.md).
- Builds with clang-cl (x86) as well as MSVC; the C runtime is linked in
  (`/MT`), so `ra2.exe` runs without the Visual C++ redistributable, and
  pcrecomp #47 fixes native32's bridge under clang-cl.
- `--mute` (the process's audio session at zero; the playtest suite and
  conformance use it), `--args FILE`, scripts in the presenter, and
  `RA2_EXE` for testing another build.
- `skirmish-build`: deploy, build a power plant and a barracks, train a GI,
  by mouse, checked in the game's event log; `log=` expectations in the
  playtest runner. A `--waitlog` also sees a line printed since the previous
  step began (an order's echo lands while its key is still held).
- Setup.cmd proven from a clean folder (the ZIP download): two bugs fixed on
  the way, a variable that clobbered the toolkit path and a locked log.
- HD voxel animations and debris (VoxelAnimClass), opt-in with
  `RA2_HD_VOXEL_ANIMS=1` until a test puts one on screen (docs/voxels.md).
- Scripted input: `--drag x1,y1,x2,y2@s` (band selection) and modifier
  clicks, `--click c+x,y@s` (Ctrl+click is force-fire); the
  `skirmish-forcefire` case deploys the MCV, selects everything and
  force-fires.
- HD voxels for shadows and aircraft: a unit's shadow at 2x (solid, with a
  2x edge, where RA2's own is a 1x stipple), and voxels drawn straight onto
  the battlefield (aircraft, buildings' voxel parts). 2x images are
  remembered by their 1x pixels, so the extra passes run only for new
  images. `RA2_FRAME_STATS=1` prints the time between frames.
- HD vehicles: voxel units drawn at twice the resolution of the picture.
  The render's last stage runs three more times at half-pixel offsets and
  the four images interleave into one at 2x; the host follows each unit's
  image through the game's own blits and the presenter shows the 2x pixels
  wherever the finished frame still shows the unit (docs/voxels.md). In the
  settings menu, on by default; `--hd-voxels` for headless runs, and
  `--hd-voxels-dump DIR` for 1x/2x renders and 2x frames.
- The voxel renderer, mapped (docs/voxels.md): the draw path from
  TechnoClass's vtable to the rasterizers, the 256x256 colour and depth
  buffers, the shade table and the cache, as groundwork for HD voxels.
- `RA2_HOST_ARGS`: extra host flags for every playtest case.
- The presenter, now the default display: the game in its own Direct3D 11
  window with sharp-bilinear, smooth, CRT, nearest and integer scaling (F12),
  borderless fullscreen (F11, Alt+Enter), native resolution on high-DPI
  screens, and input mapped through the scaling. `--classic` keeps the
  original exclusive-fullscreen DirectDraw.
- A virtual screen: every screen coordinate the game sees is relative to its
  main window, so the game's windows can sit anywhere (offstage moves them).
- High resolution and widescreen: 1280x720, 1920x1080 and 2560x1440 tested
  and 3840x2160 tested in game (`res-*` playtest cases, which set
  `RA2MD.INI` per case). 4K faulted in RA2's own sidebar layout, on the
  shipping code too; the lift caps the sidebar's rows at 30 (docs/hires.md).
- Remaster patches in `run_lift.py`: a line of C after a named instruction,
  for fixes the original cannot have; `--original` stays unpatched.
- The presenter's settings menu (F10, or right-click beside the picture):
  scaling, bars, fullscreen, and the game's resolution, without editing the
  INI. Blurred bars beside the 4:3 menus. Settings and the window's place are
  kept in `build
a2.ini`.
- `tools/present_drive.ps1`: clicks the presenter window like a player, for
  testing it.
- The pipeline for Yuri's Revenge `gamemd.exe` 1.001: RTTI (954 classes), the
  function catalog (24,940 functions), and the lift driver `run_lift.py`
  (24,954 functions, 0 lift errors).
- `run_lift.py --seeds`: entries a run found that the catalog lacks.
- The host, `build/ra2.exe`, on pcrecomp `native32`. Boots through the CRT,
  WinMain, COM registration and DirectDraw setup.
- Headless mode: hidden window, DirectDraw kept out of fullscreen with the
  mode remembered and not applied, `--record out.mp4 --frames N` from the
  primary surface.
- Registration-free COM: `Blowfish.dll` is served from the game folder when it
  is not registered, so no admin step is needed.
- Conformance harness, `tools/conformance.py`: 7/7 boot milestones, up to
  the intro movie playing.
- The Westwood logo and the Yuri's Revenge intro play headless, drawn by Bink
  into the game's primary surface; screenshots in the README.
- The main menu: the recompiled game reaches it after the full intro and draws
  it completely. Conformance 8/8.
- `--debuglog`: the game's own debug log, through `run_lift.py` `HOOKS` (a
  lifted function given a host body).

- `tools/playtest.py`, the playtest suite (civ3's framework adapted): every
  menu screen and way back, a skirmish from setup to the score screen, both
  campaigns into their first mission, in parallel with per-case game folders,
  logs, recordings and contact sheets. 23 of 23 cases passing.
- Scripted input for headless runs: `--press DLG:CTRL@s` presses a menu button
  by dialog and control ID once that dialog is open, `--select`, `--waitlog`,
  `--key`, `--move`, `--click`, `--wait`. `tools/dialogs.py` maps all 98 menu
  dialogs to their controls.
- `--original`: the shipping machine code under the same host, shims and
  script, to tell lift bugs from host bugs.

### Fixed

- Escape in fullscreen now opens the game's pause menu instead of leaving
  fullscreen with no menu. The keyboard lock asked for the function keys but
  not Escape, so Chromium treated the press as its fullscreen exit before the
  page could pass it to the game. Escape is in the lock list now (a short
  press reaches the game; Chromium's two-second hold still leaves fullscreen),
  and the pointer lock is released for the menu as before.
  (`web/src/game/browser-controls.ts`)
- Leaving a match from the reconnection screen's "Leave Game" button returns
  to the 800x600 shell. That path skips the score screen, whose switch back
  was the only place the display mode was restored, so the WOL lobby and the
  menus after it stayed at the match size (1920x1080 and so on). The lift
  now puts the shell size back when the reconnection handler returns 8 or 9
  (`run_lift.py`'s `reconnect_patches`, both editions).
- The page's cursor no longer jumps when the mouse is flicked quickly into a
  screen edge under Pointer Lock. The lock asks Chrome for raw
  (`unadjustedMovement`) input, so the hidden OS cursor cannot be recentred at
  a desktop edge and arrive as one large delta; browsers that refuse it keep the
  plain lock. A new cursor frame is also drawn with the hot spot published with
  it, never the previous frame's. (`web/src/game/browser-controls.ts`,
  `web/src/game/cursor-layer.ts`)
- The intro is on by default for both editions, and the launcher's Skip intro
  switch now skips only the intro: the logo still plays. The game's intro
  branch follows the host (`--intro`/`--no-intro`) instead of `[Intro] Play` in
  the INI, so Red Alert 2 and Yuri's Revenge behave the same. (`run_lift.py`'s
  `intro_patches`, `src/runtime/startup_order.c`, `src/web/main.c`,
  `web/src/storage/intro-preferences.ts`)
- "No menu music" now survives a match and starts when a game starts loading:
  the music gate follows the game's own state (`About to load a %d player game.`
  through `Release_Mouse()`/a shell dialog) instead of the frame count, which
  keeps moving on the score and setup screens. The launcher's Audio → Music tab
  now offers the same switch as the in-game speaker popover
  (`src/web/presenter.c`, `src/web/main.c`,
  `web/src/components/LauncherGameSettings.tsx`).
- Built with Visual Studio 2026 (MSVC 19.50 and later), every skirmish and
  campaign crashed as the map loaded (issue #2). That compiler's optimiser
  drops the sign test of a 16-bit value moved to the top of a register, so a
  -1 index got past a bounds check. The lifted C is now built with its older
  optimiser there (`/d2SSAOptimizer-`).
- `setup.sh` no longer offers pcrecomp's unmerged win32hle branch: that work
  is on pcrecomp's `main` now, and an older clone is offered a `git pull`.
- `Setup.cmd` from a folder inside the game's install copied the install
  into itself until the disk filled; that folder is now left out. A path
  with `&` in it, which the build cannot handle, is refused with a message.
- The menus had no cursor on Linux: they are Win32 dialogs that use the
  Windows cursor the game sets, and the window showed none. It now shows the
  game's own arrow (from its resources) while the mouse is not captured, as
  the Windows presenter does (#2's symptom; the Windows build had the fix
  from 2026-10-07).
- `setup.sh` on Linux stopped at "predates win32hle's DirectDraw and Bink"
  with a fresh pcrecomp: #62 is not merged yet, and it now offers the pull
  request's branch (#3). Fedora's packages are named right
  (`sdl2-compat-devel`, the `*-free-devel` ffmpeg libraries, `libgcc`,
  `libatomic` and `libavutil` for i686), its 32-bit libraries are found, and
  the check counts only 32-bit ones. `setup.sh yr` runs to a playable build
  on Fedora 44.
- `skirmish-build` sets 640x480 itself: its sidebar coordinates are
  640x480's, and a CnCNet install's 3440x1440 INI made every click miss.
  (#1, by [@cpressland](https://github.com/cpressland))
- The playtests' per-case game folder falls back to symlinks when hard links
  fail (`game/` on another drive, as a Steam library often is).
- `--record` opened at the game's first mode, and a game that starts at 4K
  was encoded at three frames a second; recordings are at most 1280 wide.
- A press on a button inside a panel of a dialog was always sent a second
  time by hand: the watcher only heard commands sent to the dialog itself.
  It now hears the button's own parent, and the fallback goes there too.
- A timer callback could run after its timer was killed (the callback waits
  for the machine, which the game gives up inside timeKillEvent); Tiberian
  Sun crashed on it under load. The host owns the multimedia timers and
  waits out callbacks in flight. DirectDraw is asked for
  `DDSCL_MULTITHREADED`.
- A scripted press could fire a button twice: when nothing changed within
  3 s of the click, the runner sent the button's BN_CLICKED by hand, and on a
  busy machine the click was only queued, so both arrived; two Start Game
  presses hung a skirmish looking for start positions for players that were
  not there. The runner now watches the dialog's thread and sends it only
  for a click that was taken and produced no command.
- A clean exit lost the last 4 KB of the log once the C runtime was linked in
  (`/MT`: ExitProcess flushes nothing); stderr is unbuffered.
- Every vehicle was invisible: the voxel rasterizers' table entries had no
  function, because MASM's alignment fillers before them read as a hot-patch
  prologue (pcrecomp #44). The playtest suite now fails a run on an
  unresolved `ICALL`, which is how 28/28 passed without them
  (docs/bringup.md 12).
- A race between the recorder writing a frame and the watchdog closing the
  recording ended some runs with 0xC0000409; the pipe is now locked.
- Exit Game hung on a spin-wait for the sound thread (pcrecomp #42), and the
  LAN game setup screen crashed on a mis-lifted `push; jmp` (pcrecomp #43).
- The recorder faulted at the mode switch and at exit, locking surfaces the
  game had released; it now holds its own reference.
- In-game recordings were sheared: frames are scaled to the recording's size.
- Two window procedures were missing from the catalog (seeded).
- Movies froze for good at a timing-dependent moment: the game pauses Bink
  while its window is not active, and a hidden window never is. Headless
  delivers every activation message as "active".
- The main menu returned at once: its dialog resource was looked up in the
  host, because a NULL module means the process exe. Resource and dialog calls
  now map NULL to the guest image.
- The menu drew no buttons: hidden windows get no `WM_PAINT`. Headless windows
  are now layered at alpha 0 instead of hidden.
- The insert-disc box: a lift bug dropped init's strcat after `call sprintf`,
  so the CD search path was empty. Fixed in pcrecomp #41.
- Headless: the intro movie was centred on the real desktop and Bink wrote
  past the primary. After `SetDisplayMode` the hidden window takes the mode's
  size, `GetSystemMetrics` reports it, and `ClientToScreen` is identity.
- `--record` held the primary's lock across the pipe write and starved the
  game's own `Lock`; it now copies the frame out first.
- 66 functions missing from the catalog, among them a static constructor,
  because their catalog entry started in the alignment padding before them.
  Fixed in pcrecomp #32.
