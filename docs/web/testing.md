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
`conformance-web-game.json`. The browser build plays no movies yet, so the
intro milestone of the Windows list is the launcher's answer here. This needs
a local game folder, so it runs on a developer's machine, not in CI.

**MEMFS, as in a browser.** `--memfs` copies the import allowlist
([storage.md](storage.md): `*.mix` but not `.bak`, the sound bags, the data
files, the exe and DLLs) into Emscripten's in-memory file system and runs from
that, instead of reading the folder in place (NODEFS). For Yuri's Revenge that
is 1,039 MB of the 2.6 GB folder, and the main menu opens 9 seconds after
launch with the copy included. `conformance.py --host web --memfs` scores it:
8/8, so the allowlist is enough to reach the menu.

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

## Performance

The frame-time overlay (Settings) and the `fps` event give a number per run.
Stage 5 records skirmish frame times at 800x600 and 1080p here, and stage 9
the same with HD vehicles on. Use Chrome's Performance panel with
`-gseparate-dwarf` builds to see lifted function names.

| Run | 800x600 | 1080p | 1080p, HD vehicles |
|---|---|---|---|
| skirmish, 2 AIs, 5 min, desktop Chromium | | | |
