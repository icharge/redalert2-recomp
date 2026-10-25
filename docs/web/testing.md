# Testing the browser build

Three levels. The page's own logic is tested alone. The game is tested
under Node without a browser. Then the playtest suite runs in a real
headless browser. The Windows suite stays the reference for lift bugs
([docs/testing.md](../testing.md)), because the browser build runs the same
lifted C.

## The page: Vitest

`web/` runs `pnpm test` (Vitest, jsdom, Testing Library). This covers
everything that doesn't need the game:

- `storage/install.ts`: the allowlist against a real install's file list
  (names only, recorded once and checked in), the PE stamp read from a
  synthetic header, and space estimates.
- `storage/manifest.ts`: resuming, a size mismatch, removal of shared files.
- `game/protocol.ts`: parsing `@ra2` lines, and ignoring other lines.
- `game/store.ts`: phase transitions, including `crashed` from any phase.
- Screens: Import with a mocked directory handle, Library with a manifest,
  and Settings round-tripping IndexedDB (`fake-indexeddb`).

No test touches game files, so CI can run them on every push.

## pcrecomp's selftests: Node, and one in Chrome

`runtime/win32hle/build_selftests_web.py` (pcrecomp) builds each `*_selftest.c`
with emcc and runs it under Node: the PE loader at 0x00400000, the virtual
memory calls, files, the message pump, named kernel objects. All seven pass.
`present_selftest` needs a canvas, which Node has not and Emscripten's SDL has
no dummy driver to stand in for, so it is built as a page and run by
`browser_run.js` in headless Chrome:

```
NODE_PATH=<dir with playwright-core> python3 build_selftests_web.py --chrome /path/to/chrome
```

Without `--chrome` (or `CHROME_PATH`) it says so and skips that one.

## The page and the game together: a local Chrome

`web/e2e/` (Playwright, a Chrome on this machine) runs the page against the dev
server, with a built game and a local game folder, and drives it through the
page's own mouse and keys:

```
cd web && pnpm dev                       # another terminal: serves the page and ../game
node e2e/smoke.mjs                       # waits for the main menu; checks the canvas shows a picture
node e2e/drive.mjs --step "click 719,221@4" --step "click 720,305@7" --step "click 719,263@12" \
                   --step "shot battle@45" --step "state@46"
```

`drive.mjs` takes steps `click X,Y`, `rclick`, `move`, `key CODE`, `shot NAME`,
`picture NAME` (is the canvas lit, and a checksum that changes when it draws) and
`state`, each `@SECONDS` after the main menu opened, with coordinates in the
game's own pixels. The three clicks above are Single Player, Skirmish and Start
Game on Yuri's Revenge's 800x600 menus; a skirmish loads and runs at 60 frames a
second. Screenshots go to `web/e2e/shots/`. `CHROME_PATH` names the browser. The
page exposes its store as `window.ra2Store` in development only, for these
scripts. This is the base `tools/playtest.py --web` grows from (stage 10).

## Exit confirmation: game to web and back

Regenerate the lifts after changing the call patch (`python run_lift.py --all`
and `python run_lift.py --target game --all`), then build both modules
(`cmake --build build-web` and `cmake --build build-web-game`). With Vite
running, from `web/`:

```powershell
$env:CHROME_PATH = 'C:\path\to\chrome.exe'
node e2e/exit-confirm.mjs --game ../game --shots ../work/exit-confirm
node e2e/exit-confirm.mjs --url 'http://127.0.0.1:5173/?target=game' --game ../game --shots ../work/exit-confirm-ra2
```

The test clicks the real main menu's Exit Game button, checks the web dialog
and its request ID, rejects invalid/stale replies, chooses Stay, reopens and
cancels with Escape, then reopens and chooses Exit. Reopening confirms that
Cancel reached the game; the last step requires the game's normal exit
event with code 0. Each reopened prompt must have a new request ID, and the
full log must contain no native Exit dialog creation (`[dialog] open 0x120`)
or calls into an exited runtime. Final Exit must navigate back to the
launcher, discard the module/session globals, and close all game workers.
The game files are streamed locally through the existing
test fixture; the source installation is not modified. Screenshots, a JSON
report, and the complete game log go to `--shots`.

## Installation routing and context paths

`node e2e/import.mjs --url http://127.0.0.1:4177/emu/?e2e=1 --game ../game --both`
imports the same folder twice, checks both editions in one slot and separate
data in another, opens and refreshes a direct game URL, verifies save
restoration/isolation, then removes the installations independently.
Use a production build and preview configured with `--base=/emu/`.

`node e2e/router-offline.mjs --url http://127.0.0.1:4177/emu/` verifies that
build metadata is actually cached, then exercises an offline deep route and
its base-relative launcher link. The initial installation requires network
access and the server's clean-route HTML fallback.

Unit tests cover v1 metadata migration (including retained legacy data after
removal), repeated editions, nonreused IDs, interruption between editions,
explicit resume, namespaced preferences, cancelled-import launcher refresh,
startup abort rejection, and persistence failure/retry before navigation.

## LAN transport: two real browsers

With the Vite dev server running, `node e2e/lan-peer.mjs` opens two Chrome
instances, exchanges the WebRTC offer and answer directly, and checks binary
datagrams in both directions. This covers the browser's host-candidate
connectivity and `LanPeer`; the game/HLE IPX path is exercised separately by
`e2e/lan.mjs` with a local game folder.

For the full game path, run
`node e2e/lan.mjs --url http://127.0.0.1:5178/ --game ../game --shots ../work/web-lan-match`
with the Vite server on port 5178. The test exchanges SDP manually, joins and
starts a LAN lobby match, then waits for active game frame reports and checks
that both clients render non-black match frames. It saves each client's
offer/lobby/match screenshots and full log under `--shots`. Before entering
the lobby it checks that each HLE runtime has a different 128-digit random
`woldata.key`; both clients then join the same match.

More steps and switches, from chasing the first play's issues ([issues.md](issues.md)):

- `down X,Y` presses the left button and keeps it down, `up` lets go; `node e2e/diff.mjs A.png B.png` counts the pixels that differ (`RECT=x0,y0,x1,y1` to look at one area).
- `rdrag X,Y,X2,Y2` presses the right button, moves over a second, holds, releases.
- `HOLD_MS=300` holds each click that long (a person holds it for a moment).
- `LOG_GREP=REGEX` prints, at the end, every game log line that matches, with a `###`
  line per step and the log's length then. The page keeps the last 3000 lines.
- `--arg --heartbeat --arg 3` (the page passes `arg=` values to the game) prints the
  machine's state every 3 s; add `--arg --windows` to list every window each time, and
  `--arg --msgtrace --arg N` to trace the messages to windows numbered N and up;
  `--arg --env --arg NAME=VALUE` sets an environment variable for the game.
- `save.mjs` plays a skirmish to the in-game menu and Save, then shoots 8 frames
  (`SLOW=1.8` on a slow run, `LOG_FILE=path` keeps the game's log). `timeline.mjs
  --every 1 --skirmish` shoots the page from its load on.
- `node e2e/movies.mjs` (stage 8): the game decodes the main menu’s Bink movies out of `ra2md.mix` (the log
  says which, with its size and frame count) and the sidebar’s gauge changes from one picture to the next.
  Needs a build with FFmpeg (`tools/build-ffmpeg-web.sh` first) and the dev server up.
- `node e2e/audio.mjs [--skirmish --minutes 5]` (stage 7): a sine through the worklet in a page with no
  game, then the game: the sound runs after a click, the game's music is in the ring, volume 0 is silent, and
  the mixer and the worklet keep 44.1 kHz with no underrun at the menu. With `--skirmish` it plays
  skirmishes (an idle player loses in about two minutes, so it clicks Continue and starts another) until
  there are `--minutes` of battle, printing every 10 s the frames mixed and played, the ring's fill and low
  point, the underruns and the game's frame rate. Needs the dev server up.
- Stage 6, in a real Chrome with a fresh profile: `node e2e/import.mjs` imports `../game` through the
  page's file input, checks the Library, plays from the copy in OPFS to the main menu, checks that a file
  the game wrote survives a reload, and removes the game (`--movies` brings the real movie archives; `--keep`
  leaves the profile to look at). With both browser modules built, `node e2e/import.mjs --both` also checks
  that one folder imports and launches both games while shared files are stored once. `node e2e/opfs.mjs --mb 300` streams a large file into the real OPFS and
  checks the live JS heap stays flat. The other scripts add `?dev` so they go straight to Play with the dev
  server's folder.
- `node e2e/offline.mjs` (after `pnpm build`, which makes `dist/` with the worker): serves `dist/` with no
  isolation headers, and checks the page isolates itself after one reload, the game starts through the
  worker and its three files are kept by build id, a changed `sw.js` + `build.json` offers the update and
  leaves only the new build's files, and, with the server shut down, the page and the game still start.
- The battle is not 800x600: it runs at the size in the game folder's own settings
  (2580x1080 for the author's), so give battle clicks in that size.
- A click a moment before the next screen is up is lost; leave a few seconds between
  steps.

## The game without a browser: Node

```
node build-web/ra2.js --run --game ./game --headless --mute --debuglog
```

The same arguments as the Linux build. `tools/conformance.py --host web` runs
it and scores eight boot milestones from the lines the host prints (the image
mapped and bound, the entry point, the launcher's answer, the display mode, the
primary surface, the first frame, the game's init, the main menu's dialog
0xE2), stopping as soon as the menu opens. Its baseline is
`conformance-web.json`; `RA2_TARGET=game` uses `build-web-game/` and
`conformance-web-game.json`. This check stops at the main menu before starting
the game's intro movie, so the intro milestone of the Windows list is the
launcher's answer here. Bink playback is covered separately by
`e2e/movies.mjs`. This needs a local game folder, so it runs on a developer's
machine, not in CI.

**/game laid out as in a browser.** `--memfs` makes `/game` the way the page does
([storage.md](storage.md), "How the game reads its files"): only the import allowlist
(`*.mix` but not `.bak`, the sound bags, the data files, the exe and DLLs), the files of 1 MiB or
more as links read in place from the folder, and the small ones copied into the in-memory file
system. For Yuri's Revenge that is about 8 MB copied and 1,085 MB linked, and the main menu opens
after the same time as a plain run. `conformance.py --host web --memfs` scores it, so the allowlist is enough
to reach the menu.

**A trap, on purpose.** `--trap N` makes the game's thread trap on its Nth
trip through the pump hook. `src/web/pre.js` catches the exception on the main
thread and calls `ra2_crash_report`, which prints the lifted function that was
running, the last import, the registers, the last 40 indirect calls and the
top of the guest stack; the process exits with code 3. (The label reads
`uncaught: unreachable`: the error loses its type crossing from the worker.)
In a page the same report goes to the console through `window.onerror`.

**V8's limits.** `node tools/wasm-sizes.js build-web/ra2.wasm` lists the
largest function bodies and local counts. In Yuri's Revenge's 27,884 functions
the largest body is 312 KB (V8 refuses 7.6 MB) and the most locals in one is
1,450 (it refuses 50,000), so the lifter need not split anything. Chrome 155
validates and compiles the whole 105 MB module (`WebAssembly.compile`, served
with COOP/COEP).

## The suite in a browser: Playwright

`tools/playtest.py --web` runs the existing cases ([docs/testing.md](../testing.md))
against the browser build. The cases don't change. Only the way the game is
started and observed does:

| Linux and Windows | Browser |
|---|---|
| start the exe with arguments | Playwright opens `http://localhost:4173/?test=1&arg=...` (the built page on `vite preview`, with COOP/COEP) |
| game folder on disk | under `?test=1`, the page mounts a folder Playwright serves from the local `game/`, instead of OPFS, so no import is needed per run |
| `--press DLG:CTRL@s` and the other script events | the same strings, passed as `arg=` and handled by `src/linux/script.c`, unchanged |
| `--waitlog TEXT` | the same, inside the game |
| the log, read by `playtest.py` | Playwright collects the console (`print`, `printErr`) into the same log file |
| `--record`, the contact sheet | Playwright's screenshots of the canvas at fixed times, and its video |
| exit code | the `exit` event ([protocol.md](protocol.md)) |

Playwright runs Chromium headless, with GPU or SwiftShader for WebGL2.
`--jobs N` runs N browser contexts, as `playtest.py` runs N games today.
Use `--headed` with `--web` to show Chromium for a local interactive run.
The default target is Yuri's Revenge. To run the same suite on Red Alert 2,
build its module with `RA2_TARGET=game` and use `RA2_TARGET=game` when invoking
`tools/playtest.py --web`; the page then loads `/game/ra2.js`.

A case fails in the browser and passes on Linux: then it's a browser bug
(the host, `win32hle` under Emscripten, or the page), not a lift bug.

## The Linux host shares sources with this one

`src/linux/` (`launcher.c`, `script.c`, `mods.c`, `blowfish.c`) and pcrecomp's
`win32hle` build both hosts, so a change to either is checked on both. From
Windows, a throwaway container does it, with nothing installed on the machine:
Ubuntu 24.04 with `gcc-multilib` and the i386 SDL2, SDL2_ttf and ffmpeg
libraries (the packages `setup.sh` lists), the two repos mounted read-only,
and the build in a Docker volume:

```
cmake -S /src/redalert2-recomp -B /build -G Ninja       -DCMAKE_TOOLCHAIN_FILE=/src/redalert2-recomp/cmake/linux-i386.cmake -DPCRECOMP=/src/pcrecomp
cmake --build /build
SDL_VIDEODRIVER=dummy SDL_AUDIODRIVER=dummy /build/ra2 --run --headless --mute --game /game
sh pcrecomp/runtime/win32hle/build_selftests.sh
```

Run the game from the container's own file system, not a Windows folder
mounted into it: a 32-bit program's `stat` fails with `EOVERFLOW` on Docker
Desktop's 9p mounts (the inode numbers are wider than 32 bits), so the host
reports "no gamemd.exe" with the file in plain sight. Copy the import
allowlist into a volume first (1.1 GB, seconds).

## What runs where

| Check | CI | Developer machine |
|---|---|---|
| `pnpm lint`, `pnpm typecheck`, `pnpm test` | yes | yes |
| `pnpm build` (page only, no game) | yes | yes |
| Node boot (`conformance.py --host web`) | no (needs game files) | yes |
| `playtest.py --web` | no (needs game files) | yes |

## WOLAPI bridge

The COM/protocol selftest runs without game assets. From the repository root in
PowerShell, with the sibling pcrecomp and emsdk checkouts:

```powershell
$env:EMCC_DEBUG = '1'
foreach ($target in @('yr', 'ra2')) {
  $defines = @()
  if ($target -eq 'ra2') { $defines = @('-DRA2_TARGET_GAME=1') }
  & ../emsdk/upstream/emscripten/emcc.exe src/web/wolapi_selftest.c `
    -I../pcrecomp/runtime/win32hle -I../pcrecomp/runtime/recomp32 `
    -DRECOMP_FLAT_MEMORY @defines -sENVIRONMENT=node -sEXIT_RUNTIME=1 `
    -o "build-web/wolapi-selftest-$target.js"
  if ($LASTEXITCODE) { throw "WOLAPI $target compilation failed" }
  node "build-web/wolapi-selftest-$target.js"
  if ($LASTEXITCODE) { throw "WOLAPI $target selftest failed" }
}
```

This exercises x86 COM stack cleanup, connection points, discovery/login,
locale, the initial untyped lobby directory for each edition, room creation,
listing, opaque option bytes, compatibility metadata, MOTD and logout events.
`pnpm test` also checks the browser protocol client and cancellation during
HTTP login or WebSocket opening.

With Vite on `http://localhost:5173`, local RA2Web on `127.0.0.1:19090`, and the
game modules built, run the original menu smoke check from `web/`:

```powershell
node e2e/wol.mjs --url 'http://localhost:5173/?target=game' --shots e2e/shots/wol-ra2
node e2e/wol.mjs --url 'http://localhost:5173/?target=game' --shots e2e/shots/wol-ra2-two --two --interactive
node e2e/wol.mjs --url 'http://localhost:5173/?target=game' --shots e2e/shots/wol-ra2-start --start
node e2e/wol.mjs --url 'http://localhost:5173/' --shots e2e/shots/wol-yr-password --start --wrong-password
node e2e/wol.mjs --url 'http://localhost:5173/?target=game' --build ../build-web-udp --shots ../build-web/wol-ra2-play --arg --intro --play
node e2e/wol.mjs --url 'http://localhost:5173/' --build ../build-web-wol-yr --shots ../build-web/wol-yr-finish --arg --intro --part-race --finish
```

Omit `?target=game` for Yuri's Revenge. The test uses the development game
folder, the native 800x600 menus and temporary accounts `woltst1`/`woltst2`,
with password `wolpass1` (override with `WOL_TEST_PASSWORD`). The default check
logs in, joins the edition's lobby, leaves it and logs out to Main Menu;
`--two` creates a room and joins from a second native client, checking the
join acknowledgement and host options. `--start` also toggles Short Game,
accepts, starts, and checks both STARTG handoffs, native game-ID fields, and the
full session retained in WASM memory for the packet adapter.
`--play` goes further: both native simulations must receive FRAMESYNC, reach
frame 300, and continue advancing for another five seconds. It verifies local
two-browser gameplay through the RA2Web native relay; separate-network play
still needs validation. `--part-race` adds a forced early host PART/NAMES update
after STARTG, covering the guest's NET_GO identity-validation race.
`--build` pins a private build without replacing the
shared game assets. It streams js/wasm/data through a temporary loopback HTTP
server because the debug WASM exceeds Chrome's DevTools fulfillment-buffer limit.
Use the private `build-web-udp` memory configuration and `--arg --intro` described
in [handoff-wolapi.md](handoff-wolapi.md#build-and-test-recipes).
For YR, `--finish` additionally drives the known 640x480 guest quit-menu fixture,
checks the remote victory and score continuation, waits for both native lobby
callbacks, and asserts that old relay sockets and native sessions are cleared.
It is currently a YR-only fixture; general RA2/YR play checks use `--play`.
`--password` creates a protected room; `--wrong-password` submits an incorrect
key, acknowledges the native failure dialog, then retries successfully. Both
imply two clients. Room keys are redacted from the wire capture. For YR with
an imported widescreen setting, the test accepts its original resolution prompt.
`--start` alone establishes only the session handoff. Screenshots, game logs and
redacted WebSocket captures are saved under
`--shots`. `--interactive` accepts JSON actions such as
`{"client":"host","click":[720,557],"shot":"back"}` and `{"quit":true}`;
send carriage return when driving an interactive Windows PTY.

Do not build while another `run_lift.py` is regenerating the same edition's
sources. If compiling all objects with `EMCC_DEBUG=1` is slow, compile object
targets with it disabled, then enable it for the final link; debug mode avoids
the local Emscripten JS symbol-cache lock hang during linking.

## Performance

The frame-time overlay (Alt+Shift+F, or `?stats` in the address) and the `fps` event give
a number per run. `node e2e/measure.mjs [--video WxH] [--seconds N]` plays a skirmish and
prints them (`?video=WxH` puts the picture size into RA2MD.INI in memory; the game folder
is not touched). Stage 9 records the same with HD vehicles on. Use Chrome's Performance
panel with `-gseparate-dwarf` builds to see lifted function names.

Measured on the author's machine (desktop Chrome, a game folder whose own setting is
2580x1080), the full-speed build, one skirmish against one Brutal AI:

| | game fps (median, worst second) | late frames a second | pictures a second |
|---|---|---|---|
| 800x600, 15 s idle, before the Sleep fix | 62, 61 | 3.5 | 59 |
| 1920x1080, 15 s idle, before the Sleep fix | 62, 61 | | 53 to 55 |
| 2580x1080, 3 minutes to the end of the match | 62, 60 | 0.3 | 62 |
| 2580x1080, 5 minutes, before the Sleep fix | 55 to 62, 41 | 4 | 54 |
| 2580x1080, 15 s idle, after | 62, 57 | 0.4 | 61 |

A "late frame" is one that came more than 25 ms after the one before. The last row is why
it exists: the browser's timed wait woke on the system tick (15.6 ms on Windows), the game's
frame loop waits with `Sleep(1)`, and a quarter of its sleeps ran 16 ms over (pcrecomp
`kernel32.c`, `wait_ms`). The picture costs about 1 ms a frame to publish at 2580x1080 and
0.2 ms at 800x600, and about 0.5 ms for the page to draw. A headless Chrome has no vertical
sync, so its page numbers (165 frames a second) are not a real window's.

| Run | 800x600 | 1080p | 1080p, HD vehicles |
|---|---|---|---|
| skirmish, 2 AIs, 5 min, desktop Chromium | | | |

The W9.3 comparison in headless Chromium at 1280x720 measured 62 game fps
(16 ms/frame) with HD vehicles off and 47 fps (21 ms/frame) with them on.
The host publish cost was 0.33 ms per frame off and 1.59 ms on. Page canvas
draw time rose from 0.17 ms to 0.52 ms. This short idle-battle measurement
was collected on 23 October 2026; the headless page rate is not a monitor's
refresh rate.
