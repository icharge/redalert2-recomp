# Browser frame performance: 60 fps, CPU and memory

Status: design approved in conversation, 26 October 2026. Not implemented.

## Intent and scope

Make the browser build (`web-port`) hold 60 game frames a second from 1280x720
to 2560x1440 with HD vehicles on, in a busy match, while using less CPU when
there is nothing to do and less memory for the picture.

- **In scope:** the browser build only. The frame path from the game thread to
  the screen (`src/web/presenter.c`, `src/runtime/hdvox.c`'s composite,
  `web/src/game/presenter.ts`, `web/src/screens/Play.tsx`), the HLE waits the
  web build uses (`../pcrecomp/runtime/win32hle/kernel32.c`, under
  `__EMSCRIPTEN__`), the memory limits in `CMakeLists.txt`, and a benchmark.
- **Out of scope:** the native Windows (Direct3D 11) and Linux (SDL) builds,
  which keep their behaviour. Networking, which already has its own plan:
  [WOL match latency](../plans/2026-10-25-wol-latency.md) (W13.4–W13.9 in
  `docs/web/tasks.md`), run as written, not repeated here. A render worker with
  OffscreenCanvas (approach B below), unless the benchmark shows the page's main
  thread is the bottleneck after this work.

## What is there today

- **Three copies a picture.** On the game thread `publish()` converts the
  primary surface (RGB565, 8-bit palette or 32-bit BGRX) to RGBA into one of two
  buffers. On the page's main thread `Presenter.draw()` copies those bytes into
  an `ImageData` (a view on shared memory cannot back one) and `putImageData`
  uploads them. Every new picture also redraws a 64x48 blurred backdrop canvas
  with `drawImage`, and CRT mode adds a `fillRect` per third row.
- **Two buffers, and a race.** The page may still be reading the buffer the game
  thread starts writing two pictures later. A buffer that is too small is
  replaced with `malloc` and the old one is never freed (`presenter.c`, "the old
  one is left"), so every size change leaks.
- **HD vehicles on the game thread.** `hdvox_compose` writes a full 2x picture
  (every 1x pixel four times, then each unit record's 2x pixels where the frame
  still shows the colour the unit wrote), and `publish()` swizzles it again to
  RGBA. `docs/voxels.md` measured 4.8 ms a picture against 0.8 ms for a plain
  copy. At 2560x1440 that is a 5120x2880 picture, every frame.
- **Last measurement** (`e2e/measure.mjs`, 1280x720, headless Chrome,
  `docs/web/progress.md`): 62 game fps and 16 ms with HD off, 47 fps and 21 ms
  with HD on; publish cost 0.33 ms off, 1.59 ms on. Nothing was measured at
  1080p, 1440p or 4K, in a busy match, or for CPU and memory.
- **Baseline, 26 October 2026** (`perf.mjs`, the release build `ef2b94fc673f9950`, Yuri's Revenge build
  `53959836c46852af`, build type Release, headed Chrome on the developer's Windows machine). Each early case ran
  twice, each run a new launch, 60 s a sample: 30 s untouched, then 30 s of panning. Every skirmish set game speed 5
  on the setup screen (the setup screen's normal speed, the value it starts at). `work/perf/baseline/run.json` holds
  the second run and each case's `firstRun`. The early skirmish is the default one: one Brutal AI.
  **Not measured:** the busy matrix (1280x720 to 3840x2160) and the 10-minute soak. The busy save was not made: two
  attempts failed (see `docs/web/testing.md`, "The frame benchmark").
  **Caveats:** the two runs of an HD-on case differ by more than 5 fps (the table shows both); the picture the game
  reported differs from the requested size for the 1920x1080 and 2560x1440 cases (it reported 1280x720 and 1920x1080),
  so those rows are not at the size their names say; the machine was shared with other sessions' Chrome and dev
  servers while these ran.

  | Case (early skirmish, speed 5) | game picture reported | fps median, run 2 (run 1) | 1% low fps, run 2 (run 1) | worst gap ms | late | publish ms | draw ms | CPU % | wasm MiB |
  |---|---|---|---|---|---|---|---|---|---|
  | 1280x720, HD off | 1280x720 | 62 (62) | 59 (57) | 70 | 6 | 0.35 | 0.22 | 266 | 545 |
  | 1280x720, HD on | 1280x720 | 48 (60) | 37 (35) | 53 | 361 | 1.69 | 0.73 | 263 | 545 |
  | 1920x1080, HD off | 1280x720 | 62 (62) | 61 (62) | 32 | 9 | 0.88 | 0.50 | 264 | 710 |
  | 1920x1080, HD on | 1280x720 | 25 (42) | 20 (36) | 75 | 1494 | 4.09 | 0.94 | 260 | 710 |
  | 2560x1440, HD off | 1920x1080 | 62 (62) | 62 (61) | 25 | 1 | 0.20 | 0.13 | 259 | 768 |
  | 2560x1440, HD on | 1920x1080 | 60 (31) | 51 (22) | 48 | 46 | 1.01 | 0.41 | 260 | 768 |
  | main menu, idle (30 s, one run) | 800x600 | - | - | - | - | 1.04 | 0.48 | 263 | 568 |

  The CPU column is the Chrome processes' CPU time over the sample, as a percentage of one core. The menu is idle yet
  uses about 2.6 cores; the spin described below is the likely cause, not yet confirmed by the probes in section 3.
  With HD vehicles on, fps is 25 to 60 in these runs; the target is 60 at 720p to 1440p.

- **CPU spin, on purpose.** pcrecomp's web `wait_ms` spins out any `Sleep` under
  20 ms and the last 16 ms of a longer one (`kernel32.c`, around line 299),
  because a worker's timed wait on Windows woke on the 15.6 ms system tick and
  frames came unevenly. Critical sections wait with `sched_yield(); usleep(50)`.
  The game's splash wait polls `QueryPerformanceCounter` 20,000 times in 20 ms
  (`src/web/main.c`, `SPIN_POLLS`).
- **Memory:** 256 MB initial, 768 MB maximum; 256 MB at the menu, 307 MB in a
  skirmish. Two RGBA buffers at 1440p with HD are about 118 MB; at 4K with HD
  about 265 MB.

## Approaches

**A. WebGL2 on the page's main thread (chosen).** The game thread publishes the
raw screen and the HD layers; the page uploads them as textures straight from
shared memory and one shader converts, composites and scales. It removes the
game thread's conversion and the main thread's two full-picture copies, and
brings back the native presenter's scaling modes.

**B. The same in a dedicated render worker (OffscreenCanvas).** Frees the main
thread from drawing, at the cost of another thread and cross-thread cursor and
input coordination. D10's finding (a GL context on a thread that never yields
never presents) means it could only be a new worker, never the game thread.
Kept as a follow-up: A's WebGL code moves to a worker unchanged if needed.

**C. Keep the 2D canvas, cheaper copies.** SIMD conversion, dirty rows, skip the
backdrop when nothing changed. Smallest change, but the HD composite stays on
the game thread's CPU, so 60 fps at 1440p with HD on is unlikely. Rejected.

## 1. Benchmark and pass bar

Built first; a baseline run is recorded before any other change, and every
later step is compared with it.

**Tool.** A new `web/e2e/perf.mjs`, built from `measure.mjs`'s steps;
`measure.mjs` stays as it is for the W5.2 and W9.3 checks. It runs headed Chrome on the
developer's machine with the browser in front (a hidden or throttled page makes
the numbers meaningless, `handoff-zerocopy.md`).

**Matrix.** 1280x720, 1920x1080, 2560x1440 (and 3840x2160, recorded with no
target) × HD vehicles off / on × two moments:

- **early:** a new skirmish, idle and then panning (as `measure.mjs` does);
- **busy:** one dedicated save game, made for this, with many units on screen,
  loaded the same way every run. The save lives with the other test fixtures
  outside version control (the game's own data is not distributed); its name and
  how to make it go in `docs/web/testing.md`.

**Recorded per case,** one JSON file per run under `work/perf/<date>/`:

- game fps: median and 1% low; worst frame gap; late frames;
- game-thread time per frame, split into the game's own work, publish, and the
  HD layer update;
- main-thread time per animation frame (upload and draw);
- CPU: the browser's CPU use from the DevTools protocol, idle in the main menu
  and during the match;
- memory: wasm memory size, JS heap, and the presenter's texture bytes.

A compare mode prints each measure against a chosen baseline file.

**Pass bar** (the definition of done):

| Measure | Target |
|---|---|
| Game fps, 720p–1440p, HD on, busy | median ≥ 60, 1% low ≥ 55 |
| Worst frame gap in a 60 s sample | ≤ 33 ms |
| Main-thread time per animation frame | ≤ 4 ms |
| CPU, main menu, idle | at least 40% below the baseline |
| CPU, in a match | no higher than the baseline at the same fps |
| Wasm memory, 10 minutes busy at 1440p HD with mode switches | no growth after the first minute; peak recorded |
| 3840x2160 | runs; numbers recorded, no target |

## 2. The frame path

### Game thread (`src/web/presenter.c`)

- **No pixel conversion.** A 16-bit screen's rows are copied as they are
  (`memcpy`, 2 bytes a pixel) into one of **three** picture buffers. An 8-bit
  screen is copied as bytes with its 256-entry palette; a 32-bit screen as BGRX.
  The format is published with the picture.
- **Three buffers, never the one being read.** `ra2_shared_t` gains the index of
  the buffer the page is reading (written by the page with `Atomics.store`); the
  game thread writes the third buffer that is neither that one nor the newest.
- **HD vehicles as two layers.** `hdvox_compose` no longer builds a 2x picture
  in the web build. The game thread keeps, in wasm memory and at the game's
  size, a 1x layer of expected colour (16-bit) and mask (8-bit), and a 2x colour
  layer (16-bit). At each publish it clears the rectangles written for the
  picture before last, writes this picture's unit records into both layers, and
  publishes the list of changed rectangles (cleared and written, up to 256;
  past that it publishes "whole layer" and the page uploads both layers whole). The rule is the same as
  today's: a 2x pixel shows only where the mask is set and the 1x picture still
  has exactly the expected colour. The native builds keep `hdvox_compose`.
- Unchanged: the 15 ms publish throttle, the 250 ms republish of an unchanged
  picture, `g_republish` when the page returns, the `mode` event, and the
  cursor, input ring and pause logic.
- **Protocol.** New fields go after `pointer_y` in `ra2_shared_t` (pixel format,
  palette pointer, the three buffer pointers and the read index, the HD layer
  pointers, the rectangle list and its count), with `_Static_assert`s for their
  offsets as today, and `RA2_WEB_PROTOCOL` goes up by one. `web/src/game/protocol.ts`
  and `docs/web/protocol.md` change with it.

### Page (`web/src/game/presenter.ts`)

- A WebGL2 presenter behind the existing `Presenter` interface (`start`, `stop`,
  `draw`, `configure`, `redraw`, `counters`, `gameSize`, `cursorWarp`), so
  `Play.tsx` and the frame-time overlay change little.
- **Context:** `alpha: false`, `antialias: false`, `desynchronized: true`,
  `preserveDrawingBuffer: false`. The canvas fills the game area, and its backing
  size is its CSS size × `devicePixelRatio` (it is no longer the game's size, and
  `object-fit` no longer does the fit).
- **Upload:** on an animation frame with a new sequence number, the picture goes
  up with `texSubImage2D` straight from a view on the wasm memory: `RGB565` /
  `UNSIGNED_SHORT_5_6_5` for 16-bit, `R8` plus a 256x1 palette texture for 8-bit,
  `RGBA8` for 32-bit (swizzled in the shader). For HD only the changed rectangles
  of the two layers go up (`UNPACK_ROW_LENGTH`, `UNPACK_SKIP_*`). The views are
  taken from the current memory each frame, since memory growth replaces the
  buffer.
- **One draw, in order:**
  1. **The blurred bars**, from a small mipmap level of the picture texture.
     The separate backdrop canvas in `Play.tsx` goes away.
  2. **The picture,** composited with the HD layers and scaled with the
     selected mode: **sharp-bilinear** (the default), **smooth**, **nearest**,
     **integer** and **CRT**, matching the native presenter (`docs/presenter.md`).
- **No per-frame garbage or layout reads.** The cursor overlay's
  `getBoundingClientRect` moves to a `ResizeObserver`; nothing in the frame loop
  allocates.
- **Cursor:** CSS cursor, overlay image and Pointer Lock unchanged.

### Fallbacks and errors

- **No WebGL2, or `?presenter=2d`:** the page tells the game to publish RGBA
  (a `presentMode` word in `ra2_shared_t`, read at each publish, so the switch
  can also happen mid-run), and today's 2D presenter runs unchanged (the game thread's RGBA
  conversion and `hdvox_compose` stay compiled in for this case).
- **Context lost:** the presenter stops uploading, keeps the last picture, and
  on `webglcontextrestored` recreates its textures and asks the game for a full
  republish (the same path as the page returning).
- **A format the shader does not know:** logged once as an `error` event, and
  the page switches to the 2D path.

### Tests

- `window.ra2Presenter.capture()` draws the game-sized picture (HD composite
  included, nearest filtering, no bars) into an offscreen framebuffer and returns
  its RGBA. `e2e/lib.mjs`'s lit and distinct-frame check, `lobby.mjs` and
  `movies.mjs` read pixels through it instead of a 2D context, so the raw-pixel
  checks stay exact.
- A browser unit test feeds recorded frames and unit records to both today's
  `hdvox_compose` and the shader and requires the same pixels.
- `presenter.test.ts` covers the triple-buffer read index, the format switch and
  the fallback choice; the existing browser suite (`e2e/playtest.mjs`) passes on
  the WebGL2 presenter and with `?presenter=2d`.

## 3. CPU

Measured first, then each change kept only if the benchmark shows frame pacing
no worse (median, 1% low and worst gap):

1. **Wait precision.** A small probe runs timed waits of 1–16 ms
   (`usleep`, `Atomics.wait`) in a worker on the developer's machine and records
   how late each wakes.
2. **Spin sites.** A counter, reported each second like `--heartbeat`, of clock
   calls (`QueryPerformanceCounter`, `timeGetTime`, `GetTickCount`) and `Sleep`
   calls, in the menu and in a match.

Changes:

- **`wait_ms` (pcrecomp, `__EMSCRIPTEN__` only):** sleep all but a margin and
  spin only the margin. The margin comes from probe 1: small (for example 2 ms)
  if waits are precise, today's 16 ms if they are not.
- **Clock-polling loops:** if probe 2 shows the game spinning on the clock in
  menus or between frames, the clock calls give up about a millisecond after a
  long run of reads with no other call between them. Same detection as the
  splash skip in `src/web/main.c`, but it sleeps instead of moving the clock.
  `--intro`'s behaviour and the splash skip stay as they are.
- **Critical sections:** the `sched_yield(); usleep(50)` loop in `hle_enter_cs`
  becomes a futex wait on the owner word, woken on leave.
- **Audio mixer:** the 5 ms wake stays unless its measured cost is significant;
  then 10 ms is tried, and kept only with zero underruns in
  `e2e/audio.mjs --skirmish --minutes 5`.
- **Page:** a React state update only when a value on screen changes; the frame
  loop does no work beyond the upload and draw.

## 4. Memory

- **Picture buffers** are allocated once per screen size and freed when it
  changes, but only after the page's read index shows it is not reading them.
  This ends today's leak.
- **Expected size,** 2560x1440 with HD on: three 16-bit buffers (22 MB) plus the
  two HD layers (11 MB at 1x, 29.5 MB at 2x), about 63 MB, against about 118 MB
  today plus leaks. At 3840x2160, about 141 MB against 265 MB. The 2D fallback
  keeps today's RGBA sizes.
- **Bounded caches:** the limits of `read_cache.c`'s blocks, the HD record
  arenas and the 2x image memo are checked and written down; any without a limit
  gets one.
- **Memory limits:** wasm memory cannot shrink, so the aim is a lower peak.
  `INITIAL_MEMORY` and `MAXIMUM_MEMORY` are set from the benchmark's measured
  peaks with headroom, and `tools/test_web_memory_budget.py` changes with them.
- **JS heap:** the benchmark records heap growth over the 10-minute busy case;
  the presenter adds none per frame.

## Order of work

1. Benchmark and baseline (section 1).
2. Probes (section 3, 1 and 2), since they decide section 3's changes.
3. WebGL2 presenter with the raw publish and three buffers, HD off (section 2).
4. HD layers and the shader composite (section 2).
5. CPU changes (section 3).
6. Memory: buffer lifetime, cache limits, memory limits (section 4).
7. Final benchmark against the baseline; results in `docs/web/progress.md`, and
   `docs/web/architecture.md` ("Rendering") updated.

## Constraints

- Native builds keep their behaviour; pcrecomp changes stay under
  `__EMSCRIPTEN__`.
- Both editions (Yuri's Revenge and `RA2_TARGET=game`) build and pass the suite.
- Preserve other sessions' uncommitted work in this repository and in
  `../pcrecomp`; stage only this work's hunks. Agree before publishing to
  `web/public/game/`, which other sessions also write.
- Measure release `-O3` links only; an `-O1` link is not a measure of the release.
