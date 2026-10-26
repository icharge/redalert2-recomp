# Browser Frame Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The browser build holds 60 game fps from 1280x720 to 2560x1440 with HD vehicles on in a busy match, with less idle CPU and less memory for the picture.

**Architecture:** A benchmark records a baseline first. The game thread then publishes the raw screen (16-bit, 8-bit + palette, or 32-bit) into three buffers, and the HD vehicles as two persistent layers plus a list of changed rectangles. A WebGL2 presenter on the page uploads them from shared memory and one shader converts, composites, draws the blurred bars and scales. The 2D presenter stays as a fallback. Then pcrecomp's web waits stop spinning where measurement allows, and buffer lifetimes and memory limits are fixed.

**Tech Stack:** C (Emscripten 32-bit wasm, pthreads), pcrecomp `win32hle` (`../pcrecomp`), TypeScript + React + Vitest (`web/`), WebGL2 / GLSL ES 3.00, Node e2e with `playwright-core` and the Chrome DevTools Protocol (`web/e2e/`), Python checks (`tools/`).

**Spec:** [docs/superpowers/specs/2026-10-26-web-frame-performance-design.md](../specs/2026-10-26-web-frame-performance-design.md)

## Change of target (26 October 2026)

At the user's request, the target is the game with **HD off**; HD vehicles are experimental (and flicker). Consequences:

- **Task 2b (new) runs next:** profile the busy game with HD off. The busy save runs at 18–23 fps at every size, so the limit is not the picture; this profile says what it is before the rendering work starts.
- **Task 5 (HD layers on the GPU) is deferred** to a later HD project (with the flicker and HD buildings/infantry). Task 4's presenter keeps HD working through the 2D fallback when HD is on.
- Task 7 measures and profiles the HD-off busy cases; HD-on rows are recorded only. Task 11's soak runs HD off.
- Order: 2b, 2c, 2d, 2e, 2f, 3, 4, 6, 7, 8, 10, 11, 12 (9 skipped: no spin). Task 2c was added after 2b's profile, 2d after 2c's result, and 2e after 2d found the Thai fix on by default.
- The pass bar is measured with the app's defaults. Until 26 October those had the Thai fix on; at the user's request the fix is now off by default (0bfab6e) because it never shapes text for the game's font, so from Task 2f on the default runs are fix-off. After Task 2e the two cost the same.

### Task 2b: Profile the busy game, HD off

**Files:**
- Create: `web/e2e/profile-game.mjs`
- Modify: `docs/web/testing.md`, this plan's "Probe results"

- [ ] **Step 1: Release-link with function names**: the default edition, `-O3` (`-DWEB_LINK_OPT=` empty) plus Emscripten's `--profiling-funcs`, in its own BUILD_DIR with `WEB_OUT` under `work/` (never `web/public/game`).
- [ ] **Step 2: Write `profile-game.mjs`**: opens that build with `--build` and the `work/perf/profile-fresh` profile, loads `work/perf/busy.sav` at 1280x720 with HD off and game speed 5 (perf-nav.mjs helpers), waits 10 s, then records a 20 s CPU profile of the game's worker thread over CDP (auto-attach to workers, `Profiler.start` / `Profiler.stop`), and writes `work/perf/profile-busy.cpuprofile` plus `work/perf/profile-busy.json`: the 20 heaviest functions by self time, and the share of self time in four groups: the recompiled game code, the runtime (pcrecomp HLE and src/runtime), the presenter (`src/web`), and waiting (`Atomics.wait`, idle).
- [ ] **Step 3: Run it** twice and record in "Probe results": the four shares, the top 10 functions, and the game fps during the sample. Then a one-paragraph reading: which group bounds the busy fps, and which later tasks (3/4/6 picture, 8/10 waits and locks, or none: the game's own simulation) can move it.
- [ ] **Step 4: Document** the command in `docs/web/testing.md`, then commit `profile-game.mjs`, `testing.md` and the plan.

### Task 2c: Test the Thai-font wrapper's cost

Task 2b's profile puts 52% of the busy game thread's samples in `recomp_thai_call` (src/runtime/thai_font.c:371), the wrapper the lifter puts around the three font entry points; with the Thai fix off it only calls the original. This task finds out whether that time is real.

**Files:**
- Modify: `src/runtime/thai_font.h` (an opt-in `RA2_NO_THAI_HOOK` switch), this plan's "Probe results"

- [ ] **Step 1: Add the switch.** With `RA2_NO_THAI_HOOK` defined, `RECOMP_THAI_CALL(va, fn)` expands to `RECOMP_CALL(fn)` and `RECOMP_THAI_ICALL(va)` to `RECOMP_ICALL(va)` (pcrecomp `runtime/recomp32/recomp_types.h:1135`); without it, nothing changes. A comment says it exists to measure the wrapper.
- [ ] **Step 2: Build B**: the default edition, `-DWEB_LINK_OPT="-O3;--profiling-funcs"`, `-DCMAKE_C_FLAGS=-DRA2_NO_THAI_HOOK` (or the build's existing way to add a define), in `work/build-web-nothai`, `WEB_OUT` under `work/`. Build A is Task 2b's `work/build-web-prof`, unchanged (rebuild it only if it is gone).
- [ ] **Step 3: Measure.** Alternate A, B, A, B: the busy case at 1280x720, HD off, with `perf.mjs --build <dir>` (or `profile-game.mjs`'s fps sample), and record each run's fps median and 1% low. Then run `profile-game.mjs` once on B and record its group shares and top 10.
- [ ] **Step 4: Decide and record** in "Probe results": if B's fps median is at least 3 above A's (beyond run-to-run spread), the wrapper is a real cost: say how much, and propose the fix (for example, testing the Thai flag inline in the macro before calling the wrapper). Otherwise it is a profiler artefact: say where B's profile puts the time instead.
- [ ] **Step 5: Commit** `thai_font.h` and the plan.

### Task 2d: The Thai-off path is a plain call

> **Superseded.** Both versions of this task's macro change were measured and reverted (585ef08): with the Thai fix on (the app default) neither moved fps, and with it off build A already reaches the cap. What remains is `profile-game.mjs --size` and the frame count, and the measurements in "Results". Task 2e fixes the cost.

Task 2c measured the busy save at 1280x720, HD off: 26.5 fps median (1% low 21–22) with the Thai-font wrapper, 62 (55–56) without it. With the Thai fix off (the default), the wrapper only calls the original, so this task makes the off path skip it. Why the wrapper costs so much is not known; with the fix on, the wrapper runs as today.

**Files:**
- Modify: `src/runtime/thai_font.h`, `src/runtime/thai_font.c`, this plan's "Results"

**Interfaces:**
- Produces: `extern int g_thai_font_on;` (thai_font.c; set only by `thai_font_set_enabled`, which `src/web/main.c:741` calls once at startup, before the game runs).

- [ ] **Step 1: One call sequence at every indirect call.** (Revised after the first attempt: an inline flag check in both macros gave 23.5 fps against A's 25.5, so the wrapper call was not the cost. `RECOMP_THAI_ICALL` is the lifter's form of *every* indirect call, 54,638 sites, and each carried a second inlined call sequence for the Thai branch; build B had one.) `RECOMP_THAI_ICALL(va)` becomes pcrecomp's `RECOMP_ICALL` body (`runtime/recomp32/recomp_types.h:1146`, trace, lookup chain, one call sequence, the unresolved branch) with a single step after the lookup: `if (__builtin_expect(g_thai_font_on, 0) && RECOMP_THAI_TARGET(_va)) _fn = recomp_thai_trampoline(_va);`. `recomp_thai_trampoline(va)` (thai_font.c) returns one of three small functions, each `recomp_thai_call(VA, original)` with the original found by the lookup chain; `recomp_thai_indirect_call` goes (its trace is the shared body's). `RECOMP_THAI_CALL(va, fn)` (37 direct sites) keeps the inline flag check: `if (!g_thai_font_on) RECOMP_CALL(fn); else` today's body. thai_font.c's `g_enabled` becomes `g_thai_font_on`. Remove Task 2c's `RA2_NO_THAI_HOOK` switch. The off path matches build B's call sites except for one load and branch per indirect call; native builds behave the same.
- [ ] **Step 2: Build** both editions with a release link (default; `$env:RA2_TARGET='game'`), each in its own BUILD_DIR with `WEB_OUT` under `work/`. Run `python -m unittest tools/test_lift_patches.py` (the lifter's Thai replacement tests).
- [ ] **Step 3: Measure** the default edition with `perf.mjs --build <dir>`: busy, HD off, at 1280x720, 1920x1080 and 2560x1440, two runs each, against Task 2c's build A numbers at 720p. Expected: 720p median ≥ 60. 62 is the speed-5 frame cap, so also record the game thread's work per frame from one `profile-game.mjs` run at 2560x1440 as the headroom measure. Record the table in "Results".
- [ ] **Step 4: Check the fix still works when on**: start the default edition with `?arg=--thai-font-fix` (and the Thai font settings `main.c:738` needs, from `web/src/storage/thai-fonts.ts`; if no Thai font is available in the profile, say so) and confirm it reaches the main menu with no errors in the console. Also run the browser suite's smoke test for both editions (`docs/web/testing.md`).
- [ ] **Step 5: Commit** `thai_font.h`, `thai_font.c` and the plan.

### Task 2e: The Thai fix without full-font rewrites

Task 2d found that the web app turns the Thai font fix on by default (`web/src/storage/thai-fonts.ts:29-30`, and older saved preferences are switched on at `:99-101`), so every busy measurement so far ran with it on. With it off, builds A and 2d both reach 62 fps at 720p; with it on, 24–26. The cost is the fix itself: `begin_layout` calls `apply_metrics` and `end_layout` calls `restore_metrics` (`src/runtime/thai_font.c:249-262, 346-367`), and each rewrites the width of every glyph record in the font (`state->count`, up to 0x10000) on every text call. The default stays on; this task makes it cheap. The macros are back to their pre-2c form (585ef08).

**Files:**
- Modify: `src/runtime/thai_font.c`
- Create: `web/e2e/thai-shots.mjs`
- Modify: `docs/web/testing.md`, this plan's "Results"

- [ ] **Step 1: Measure the calls.** In a scratch `-O1` build (not committed), count per second in the busy save with the fix on: layout entries, full `apply_metrics` / `restore_metrics` rewrites, the glyph count of each font state, and the spacing values seen. Record them in "Results".
- [ ] **Step 2: Write the picture check.** `thai-shots.mjs --build <dir> --out <dir>` starts the game with the fix on (the app default), and saves PNGs of the main menu, the skirmish setup screen, and the busy save's in-game options menu (the game paused, so the battlefield and sidebar behind it are still). `--compare <dirA> <dirB>` reports the differing pixels per image and exits non-zero on any. Take the reference shots from build A (`work/build-web-prof`, which has the original macros and metrics code).
- [ ] **Step 3: Make the rewrites proportional to what changes.** Choose from Step 1's numbers and say why. If nearly every call has spacing 0, the spacing-0 apply and restore touch only the marked records (`mark_count`, the zero-width marks); otherwise each font state remembers the spacing its records hold and skips a rewrite when it is unchanged. The result must not depend on how many glyphs the font has, and the Step 2 check must pass against build A's shots with zero differing pixels.
- [ ] **Step 4: Measure** with `perf.mjs --build`, busy, HD off, fix on and off (the fix's setting: `?arg=--thai-font-fix` and the font id, or the stored preference; say which), at 1280x720 (two runs each, against build A's fix-on 26.0 / 21.3), 1920x1080 and 2560x1440 (one run each). Expected: fix on at 720p median ≥ 60. Record the table in "Results".
- [ ] **Step 5: Commit** `thai_font.c`, `thai-shots.mjs`, `testing.md` and the plan.

### Task 2f: Profile the busy game at 1440p, Thai on

After Task 2e the busy save reaches 61 fps at 720p (HD off, Thai on), but 49 at 1080p and 34 at 1440p. The game thread's work grows with the picture size, and this profile finds where, before the picture tasks (3, 4, 6) are started.

**Files:**
- Modify: this plan's "Results"

- [ ] **Step 1: Profile** Task 2e's release build (`work/build-web-thai2e`, function names kept) with `profile-game.mjs --size 2560x1440`, then `--size 1280x720`, two runs each, the Thai fix on (the default). Record per size: the group shares (game, hook, runtime, presenter, waiting), the top 15 functions by self time, and the work per frame.
- [ ] **Step 2: Compare** 1440p against 720p: which functions grow with the pixel count (the drawing of the battlefield, the presenter's conversion and publish) and which don't (the simulation). Say which later tasks can move the 1440p number: the presenter group is Tasks 3/4; the game's own drawing is not in this plan.
- [ ] **Step 3: If a launch stalls** at the file copy ("cannot map /game/gamemd.exe" with 35 of 36 files, seen in Task 2e), record the page errors and the steps before it, check whether an earlier Chrome is still running on the profile (`work/perf/profile-fresh`), and say what clears it. Don't change the loader in this task.
- [ ] **Step 4: Commit** the plan.

## Global Constraints

- Browser build only. Native Windows and Linux builds keep their behaviour; pcrecomp changes stay under `#ifdef __EMSCRIPTEN__`, and `hdvox_compose` stays for the native builds and the 2D fallback.
- Both editions build and pass: Yuri's Revenge (default) and Red Alert 2 (`$env:RA2_TARGET='game'`).
- Measure release links only (`-DWEB_LINK_OPT=` empty, `-O3`); an `-O1` link is not a measure of the release. Headed Chrome, browser in front.
- Pass bar, verbatim from the spec: game fps median ≥ 60 and 1% low ≥ 55 (720p–1440p, HD off, busy; HD on recorded, no target); worst frame gap ≤ 33 ms in a 60 s sample; main-thread time per animation frame ≤ 4 ms; idle main-menu CPU at least 40% below the baseline; in-match CPU no higher than the baseline at the same fps; wasm memory no growth after the first minute of a 10-minute busy run at 1440p HD off with mode switches; 3840x2160 runs, recorded, no target.
- Every CPU change (Tasks 8–10) is kept only if the benchmark shows median fps, 1% low and worst gap no worse than before it.
- Shared struct changes go after `pointer_y` in `ra2_shared_t`, with `_Static_assert`s on their offsets; `RA2_WEB_PROTOCOL` goes from 7 to 8 in `src/web/web_api.h` and `web/src/game/protocol.ts` together.
- Preserve other sessions' uncommitted work here and in `../pcrecomp`: stage only this plan's hunks (`git add -p`). Agree before publishing to `web/public/game/`.
- The game's data and the busy save game are not committed; fixtures live outside version control.
- Networking is out of scope (it is [the WOL latency plan](2026-10-25-wol-latency.md)).

## Review Focus

1. **The screen size changes mid-run** (the 800x600 menu shell to the match size, a resolution change in Settings, HD toggled with F10): buffers must be reallocated, the old ones freed only once the page has let go, and the textures resized, with no stale-size picture or crash. Tests: Task 3 `resize_frees_only_after_release`, Task 4 `reallocates textures when the size changes`, Task 11's mode-switch soak.
2. **Wasm memory grows while the page holds views** (the game allocates, `HEAPU8.buffer` is replaced): the presenter must take fresh views every frame, never cache one. Test: Task 4 `takes fresh memory views each frame`.
3. **More unit records than the rectangle list holds** (a big battle, 256+ records): the page must upload the whole layers, not drop rectangles. Tests: Task 5 `overflow_marks_whole_layer` and `uploads whole layers when the list overflowed`.
4. **WebGL context lost** (GPU reset, the tab backgrounded on some drivers): the last picture stays, and on restore the textures come back and a republish is asked for. Test: Task 4 `asks for a republish after the context is restored`.
5. **The page reads a buffer while the game would write it** (a slow animation frame): with three buffers the game never picks the one in `read_index`. Test: Task 3 `pick_skips_reading_and_newest`.

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `web/e2e/perf.mjs` | create | the benchmark matrix runner (CLI) |
| `web/e2e/perf-report.mjs` | create | pure: summarise samples, compare with a baseline |
| `web/e2e/perf-report.test.mjs` | create | `node:test` for the above |
| `web/e2e/wait-probe.mjs` + `web/e2e/wait-probe.html` | create | worker wait-precision probe |
| `src/web/frame_buffers.c/.h` | create | the three picture buffers: pick, publish, release, free |
| `src/web/frame_buffers_selftest.c` | create | emcc + Node selftest |
| `src/web/hd_layers.c/.h` | create | the two HD layers and the changed-rectangle list |
| `src/web/hd_layers_selftest.c` | create | emcc + Node selftest |
| `src/runtime/hdvox.c/.h` | modify | add `hdvox_visit_published` (records read-only, under the publish lock) |
| `src/web/presenter.c` | modify | raw publish through `frame_buffers`, HD layers, `presentMode`, clock stats |
| `src/web/web_api.h` | modify | protocol 8 fields |
| `src/web/main.c` | modify | `--clockstats`, clock damper |
| `web/src/game/protocol.ts` | modify | protocol 8 words, `PixelFormat` |
| `web/src/game/presenter.ts` | modify | becomes `Presenter2d`, implements `GamePresenter` |
| `web/src/game/gl-presenter.ts` | create | the WebGL2 presenter |
| `web/src/game/gl-shaders.ts` | create | GLSL sources and the scale-mode numbering |
| `web/src/game/choose-presenter.ts` | create | WebGL2 or 2D |
| `web/src/game/gl-presenter.test.ts`, `choose-presenter.test.ts` | create | Vitest with a recording fake `WebGL2RenderingContext` |
| `web/e2e/gl-pixels.mjs` | create | browser check: `capture()` against CPU reference conversions |
| `web/src/screens/Play.tsx`, `web/e2e/lib.mjs`, `lobby.mjs`, `movies.mjs` | modify | presenter choice, backdrop removal, `capture()` in tests |
| `../pcrecomp/runtime/win32hle/kernel32.c` | modify | `wait_ms` margin, critical-section futex |
| `CMakeLists.txt`, `tools/test_web_memory_budget.py` | modify | new sources; memory limits from measured peaks |
| `docs/web/{testing,protocol,architecture,progress}.md` | modify | as each task says |

---

### Task 1: Benchmark and baseline

**Files:**
- Create: `web/e2e/perf-report.mjs`, `web/e2e/perf-report.test.mjs`, `web/e2e/perf.mjs`
- Modify: `docs/web/testing.md` (a "Performance" section: how to make the busy save, how to run, where results go)

**Interfaces:**
- Produces: `summarize(samples: Sample[]): CaseSummary` and `compare(run: Run, baseline: Run): Row[]` in `perf-report.mjs`.
  - `Sample = { fps: number, worstMs: number|null, late: number|null, publishMs: number|null, drawMs: number|null, cpuPct: number|null, wasmBytes: number, jsHeapBytes: number|null, textureBytes: number|null }`
  - `CaseSummary = { fpsMedian, fps1Low, worstGapMs, late, publishMsMedian, drawMsMedian, cpuPctMedian, wasmPeakBytes, wasmGrowthAfter60s, jsHeapGrowthBytes }`
  - `Run = { date, build, cases: Record<string /* "1920x1080/hd/busy" */, CaseSummary> }`
  - `Row = { case, measure, baseline, now, change /* fraction */, pass: boolean|null }`, where `pass` applies the pass bar from Global Constraints and is null for measures without one.
- Produces: CLI `node e2e/perf.mjs [--sizes 1280x720,1920x1080,2560x1440] [--hd off,on] [--moments early,busy] [--seconds 60] [--save <path to the busy save>] [--out work/perf/<date>] [--baseline <run.json>] [--soak-minutes 10]`, which writes `run.json` and prints the `compare` table when `--baseline` is given.

- [ ] **Step 1: Write the failing tests** in `perf-report.test.mjs` (`node:test`, `node:assert/strict`):
  - `fps1Low is the 1st percentile`: samples with fps 1..100 → `fps1Low === 1`, `fpsMedian === 50`.
  - `worst gap is the max of worstMs`: worstMs `[10, 40, 12]` → `worstGapMs === 40`.
  - `wasm growth counts only after the first 60 samples`: wasmBytes 100 for samples 0–59, then 100, 100, 120 → `wasmGrowthAfter60s === 20`.
  - `compare marks the fps bar`: an HD/busy case with `fpsMedian 59` → that row `pass === false`; with `60` and `fps1Low 55` → `true`.
  - `compare marks idle CPU at -40%`: baseline menu `cpuPctMedian 100`, now `61` → `pass === false`; `60` → `true`.
  - `null-valued samples are ignored in medians`.
- [ ] **Step 2: Run** `cd web; node --test e2e/perf-report.test.mjs`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement `summarize` and `compare`** in `perf-report.mjs`. Pure functions, no I/O.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Implement `perf.mjs`.** Reuse `startPage`, `clickGame` and `rdrag` from `lib.mjs`, and `measure.mjs`'s menu path (Single Player > Skirmish > Start Game) for `early`. For `busy`, load the save the way `e2e/save.mjs` does. Sample once a second:
  - `fps`, `pacing` from `ra2Store.getSnapshot()`;
  - `drawMs` from `presenter.counters()` (exposed on `window.ra2Presenter` in Task 4; null until then);
  - `cpuPct` from the CDP session (`page.context().newCDPSession(page)`, `SystemInfo.getProcessInfo`; the sum of `cpuTime` deltas over one second, as a percentage of one core);
  - `wasmBytes = Module.HEAPU8.buffer.byteLength`;
  - `jsHeapBytes` from CDP `Runtime.getHeapUsage`;
  - `textureBytes` from `window.ra2Presenter?.textureBytes?.()`.
  Also add one `menu/idle` case: 30 s in the main menu, untouched. Set the resolution with `?video=WxH`, HD with `ra2_setting(2, on, 0)` as `measure.mjs` does. `--soak-minutes N` runs the busy case for N minutes, switching resolution twice and HD off and on once, and keeps every sample.
- [ ] **Step 6: Make the busy save** in a release build: a 7-AI skirmish at Fastest, played to about 10 minutes with many units on screen, saved. Write its location and how to make it in `docs/web/testing.md`. It is not committed.
- [ ] **Step 7: Record the baseline** with the current release build (Yuri's Revenge): `node e2e/perf.mjs --save <busy save> --soak-minutes 10 --out work/perf/baseline`. Expected: `run.json` with all 15 cases (3 sizes × 2 HD × 2 moments, plus 4K × 2 HD × busy, plus `menu/idle`); `cpuPct`, `wasmBytes` and `fps` are non-null. Copy the headline numbers (fps per case, menu CPU, wasm peak) into the spec's "What is there today" as a dated "Baseline" table.
- [ ] **Step 8: Commit**

```bash
git add web/e2e/perf.mjs web/e2e/perf-report.mjs web/e2e/perf-report.test.mjs docs/web/testing.md docs/superpowers/specs/2026-10-26-web-frame-performance-design.md
git commit -m "Add the browser performance benchmark and record its baseline"
```

### Task 2: Probes: wait precision and clock calls

**Files:**
- Create: `web/e2e/wait-probe.html`, `web/e2e/wait-probe.mjs`
- Modify: `src/web/main.c` (`--clockstats`), `docs/web/testing.md`
- Modify: this plan's "Probe results" section at the end

**Interfaces:**
- Produces: the event `{"e":"clock","qpc":N,"tgt":N,"gtc":N,"sleep":N,"sleep0":N}` once a second while `--clockstats` is on (counts in that second). `web/src/game/protocol.ts` ignores unknown events, so no page change is needed. Tasks 8 and 9 read these numbers.
- Produces: the wait margin `M` (ms), written in "Probe results" and used by Task 8.

- [ ] **Step 1: Write `wait-probe.html`.** A dedicated Worker loops 200 times for each target of 1, 2, 4, 8 and 16 ms: `Atomics.wait` on a `SharedArrayBuffer` with that timeout (the primitive Emscripten's `usleep` uses in a worker), recording `performance.now()` lateness. It posts `{ target, p50, p95, p99, max }` for each target. The page needs COOP/COEP; serve it from the Vite dev server, which already sends them.
- [ ] **Step 2: Write `wait-probe.mjs`**, which opens the page in headed Chrome (`lib.mjs`'s launcher), prints the table and writes `work/perf/wait-probe.json`.
- [ ] **Step 3: Run** `cd web; node e2e/wait-probe.mjs`. Expected: five rows. Record them in "Probe results" and set **M = the smallest of 1, 2, 4, 8, 16 whose p99 lateness is ≤ 1 ms, plus 1**, or 16 (today's value) if none is.
- [ ] **Step 4: Add `--clockstats` in `main.c`.** Counters are incremented in `ra2_QueryPerformanceCounter` and in new shims for `timeGetTime` and `GetTickCount` added to `g_ra2_shims[]`. They call the HLE's own implementation (look up the HLE's original by name, as the existing shims chain to it) and count. `Sleep` is counted in the same table: `Sleep(0)` as `sleep0`, others as `sleep`. `web_presenter_pump` prints the event once a second when the flag is on. Counting costs one increment; with the flag off, the shims are not installed.
- [ ] **Step 5: Build** (an `-O1` link is fine for counting) and **run** a menu and a skirmish with `?arg=--clockstats`. Record in "Probe results": calls per second in the main menu and in a match, and whether there is a run of ≥ 1000 clock reads in a second with `sleep` + `sleep0` = 0 (a spin). Task 9 runs only if there is one.
- [ ] **Step 6: Commit**

```bash
git add web/e2e/wait-probe.html web/e2e/wait-probe.mjs src/web/main.c docs/web/testing.md docs/superpowers/plans/2026-10-26-web-frame-performance.md
git commit -m "Probe worker wait precision and the game's clock calls"
```

### Task 3: Raw publish, three buffers, protocol 8

**Files:**
- Create: `src/web/frame_buffers.h`, `src/web/frame_buffers.c`, `src/web/frame_buffers_selftest.c`
- Modify: `src/web/web_api.h`, `src/web/presenter.c`, `CMakeLists.txt:70` (add `src/web/frame_buffers.c`), `web/src/game/protocol.ts`, `docs/web/protocol.md`, `docs/web/testing.md` (the selftest command, beside the WOLAPI one)

**Interfaces:**
- Produces (C, `frame_buffers.h`):
  - `typedef struct { uint32_t *ptr[3]; size_t cap[3]; int newest; } frame_bufs_t;`
  - `int frame_pick(int newest, int reading)`: the index that is neither; `newest`/`reading` may be -1.
  - `uint8_t *frame_acquire(frame_bufs_t *b, int reading, size_t bytes)`: picks with `frame_pick`, makes sure it holds `bytes`, returns it.
  - `void frame_publish(frame_bufs_t *b, int index)`: marks it newest.
  - `void frame_collect(frame_bufs_t *b, int reading)`: frees buffers that are smaller than the current size and neither newest nor `reading` (called at each publish).
  - The current-size rule: `frame_acquire` with a larger `bytes` than a buffer holds allocates a new one for that slot and queues the old pointer; the old pointer is freed by `frame_collect` once it is neither `reading`'s pointer nor newest.
- Produces (shared struct, protocol 8, words after `pointerY` = 1043):
  - `format` 1044 (`RA2_FMT_RGBA = 0`, `RA2_FMT_RGB565 = 1`, `RA2_FMT_PAL8 = 2`, `RA2_FMT_BGRX = 3`)
  - `framePitch` 1045 (bytes)
  - `palettePtr` 1046 (256 × `uint32` r|g<<8|b<<16, valid for PAL8)
  - `readIndex` 1047 (written by the page: the buffer index it is reading, -1 for none)
  - `frameIndex` 1048 (the index of `framePtr`)
  - `hdLayer1x` 1049, `hdLayer2x` 1050, `hdRects` 1051, `hdRectCount` 1052, `hdSeq` 1053 (filled in Task 5; 0 until then)
  - `republish` 1054 (the page sets it to 1 to ask for a full republish; the game clears it)
  - `presentMode` 1055 (written by the page, read by the game at each publish: 0 = RGBA as today, the default, so today's page keeps working; 1 = raw)
- Produces (page): `export const PixelFormat = { Rgba: 0, Rgb565: 1, Pal8: 2, Bgrx: 3 } as const` and the new `Shared` words above in `protocol.ts`; `RA2_WEB_PROTOCOL = 8`.

- [ ] **Step 1: Write the failing selftest** `frame_buffers_selftest.c` (plain `main`, `assert`, prints `frame_buffers selftest: ok`):
  - `pick_skips_reading_and_newest`: `frame_pick(0, 1) == 2`, `frame_pick(2, 0) == 1`, `frame_pick(1, 1)` is 0 or 2, `frame_pick(-1, -1)` is in 0..2.
  - `acquire_never_returns_the_read_buffer`: publish 0, reading 0, acquire → not `ptr[0]`; publish that, reading 0, acquire → not `ptr[0]` and not the newest.
  - `resize_frees_only_after_release`: publish at 100 bytes in all three slots, reading 1, acquire 400 bytes three times with publishes. The old `ptr[1]` must still be allocated (check it is still listed as pending) until `frame_collect(b, -1)`; afterwards there is no pending pointer. Count frees with a test `free` hook (`frame_bufs_set_free_hook(void (*)(void *))`, compiled only under `FRAME_BUFFERS_SELFTEST`).
- [ ] **Step 2: Build and run it**, failing:

```powershell
& ../emsdk/upstream/emscripten/emcc.exe src/web/frame_buffers_selftest.c src/web/frame_buffers.c -DFRAME_BUFFERS_SELFTEST -sENVIRONMENT=node -sEXIT_RUNTIME=1 -o build-web/frame-buffers-selftest.js
node build-web/frame-buffers-selftest.js
```
Expected: compile error (no `frame_buffers.c`).
- [ ] **Step 3: Implement `frame_buffers.c`.**
- [ ] **Step 4: Run** the same commands. Expected: `frame_buffers selftest: ok`.
- [ ] **Step 5: Change `publish()` in `presenter.c`.** In raw mode (`present_mode == 1`) it copies the surface rows unconverted into `frame_acquire(&bufs, g_sh.read_index, pitch_out * h)`, with `pitch_out = w * bytes per pixel` (2 for RGB565, 1 for PAL8 plus the palette copied into a 1 KiB static that `palette_ptr` points at, 4 for BGRX). It sets `format`, `frame_pitch`, `frame_index`, `frame_ptr`, `frame_w/h`, `game_w/h` (= `frame_w/h` in raw mode: HD no longer doubles the frame), then `frame_publish`, `frame_collect` and the `frame_seq` increment. RGBA mode keeps today's conversion and the `hdvox_compose` path, but through `frame_bufs_t` too, so the leak is fixed in both modes. Remove `g_buf`, `g_cap` and `g_front`. In `present_now`, a set `republish` word does what `g_republish` does, then clears it.
- [ ] **Step 6: Add the protocol fields** to `ra2_shared_t` with `_Static_assert(offsetof(ra2_shared_t, format) == 1044 * 4, ...)` and one for `republish`, set `RA2_WEB_PROTOCOL 8`, and mirror the words in `protocol.ts`. Update `docs/web/protocol.md`'s struct table.
- [ ] **Step 7: Run the page tests**: `cd web; pnpm test; pnpm typecheck`. Expected: PASS (`store.test.ts` reads `RA2_WEB_PROTOCOL` from `protocol.ts`, so it follows).
- [ ] **Step 8: Build Yuri's Revenge and Red Alert 2** (`-O1` link) and run the existing browser smoke (`node e2e/smoke.mjs`). Expected: menu reached and picture lit in both, with the 2D presenter in RGBA mode.
- [ ] **Step 9: Commit**

```bash
git add src/web/frame_buffers.* src/web/presenter.c src/web/web_api.h src/web/main.c CMakeLists.txt web/src/game/protocol.ts docs/web/protocol.md docs/web/testing.md
git commit -m "Publish the screen raw into three buffers, freed once the page lets go"
```

### Task 4: WebGL2 presenter, HD off

**Files:**
- Create: `web/src/game/gl-presenter.ts`, `web/src/game/gl-shaders.ts`, `web/src/game/choose-presenter.ts`, `web/src/game/gl-presenter.test.ts`, `web/src/game/choose-presenter.test.ts`, `web/e2e/gl-pixels.mjs`
- Modify: `web/src/game/presenter.ts` (class renamed `Presenter2d`, implements `GamePresenter`), `web/src/game/presenter.test.ts` (follows the rename), `web/src/screens/Play.tsx:100-105,175-205`, `web/e2e/lib.mjs:187-199`, `web/e2e/lobby.mjs:22-29`, `web/e2e/movies.mjs:22-29`

**Interfaces:**
- Consumes: Task 3's `Shared` words (including `presentMode`) and `PixelFormat`.
- Produces (`presenter.ts`):

```ts
export interface GamePresenter {
  start(): void;
  stop(): void;
  draw(): void;
  configure(scale: Scale, bars: boolean): void;
  redraw(): void;
  counters(): PresenterCounters;
  gameSize(): { width: number; height: number };
  cursorWarp(): { seq: number; x: number; y: number };
  /** the game-sized picture as RGBA, as the game sees it (HD composite included, no bars, no scaling) */
  /** hd: render at 2w x 2h with the HD layers, for Task 5's check */
  capture(options?: { hd?: boolean }): Promise<{ width: number; height: number; data: Uint8Array }>;
  /** bytes held in textures; 0 for the 2D presenter */
  textureBytes(): number;
}
```
- Produces (`choose-presenter.ts`): `presenterKind(search: URLSearchParams, hasWebGl2: boolean): "gl" | "2d"` (`?presenter=2d` forces 2D).
- Produces (`gl-presenter.ts`): `new GlPresenter(canvas, memory, shared, cursorOverlay, capturePointer, onFallback: (why: "format" | "context") => void)`. `start()` writes `presentMode = 1`; `Presenter2d.start()` writes `presentMode = 0`.
- Produces (`gl-shaders.ts`): `SCALE_MODE: Record<Scale, number>` = `{ nearest: 0, smooth: 1, sharp: 2, integer: 3, crt: 4 }`, and `VERTEX_SOURCE` / `FRAGMENT_SOURCE` strings. In this task the fragment shader does format conversion and nearest/smooth only; Task 6 adds the rest.
- Produces (page): `window.ra2Presenter` = the active presenter, set where `ra2Store` is exposed (tests only).

- [ ] **Step 1: Write the failing tests** in `choose-presenter.test.ts`: `presenterKind(new URLSearchParams(""), true) === "gl"`; `("presenter=2d", true) === "2d"`; `("", false) === "2d"`.
- [ ] **Step 2: Write the failing tests** in `gl-presenter.test.ts`, with a recording fake `WebGL2RenderingContext` (an object whose methods push `[name, ...args]` onto a list, returning stub objects from `create*`; `getContext("webgl2")` mocked as `presenter.test.ts` mocks `"2d"`):
  - `uploads a 565 picture with texSubImage2D as RGB565 / UNSIGNED_SHORT_5_6_5`: format word 1, frame 4x2 → a `texSubImage2D` call with those enums, width 4, height 2, and a `Uint16Array` whose `byteOffset` is the frame pointer.
  - `uploads PAL8 as R8 plus a 256x1 palette texture`.
  - `does not upload when frameSeq has not moved`: two `draw()`s → one `texSubImage2D`.
  - `writes readIndex before uploading and -1 after`: `Atomics.store` order seen through the shared words.
  - `reallocates textures when the size changes`: 4x2 then 8x4 → a second `texImage2D` with 8x4.
  - `takes fresh memory views each frame`: the `memory()` callback is called once per `draw()`, and a replaced buffer is used on the next draw.
  - `asks for a republish after the context is restored`: dispatch `webglcontextlost` then `webglcontextrestored` on the canvas → textures recreated, `Shared.republish` word = 1, no `texSubImage2D` while lost.
  - `falls back on an unknown format`: format word 9 → no upload, `onFallback("format")` called once, and an error line logged once.
  - `falls back when no WebGL2 context is given`: `getContext("webgl2")` returns null → `onFallback("context")`.
  - `start writes presentMode 1`.
  - `sizes the backing store to CSS size × devicePixelRatio`: a `ResizeObserver` entry 400x300 with dpr 2 → `canvas.width === 800`, `height === 600`.
- [ ] **Step 3: Run** `cd web; pnpm vitest run src/game/gl-presenter.test.ts src/game/choose-presenter.test.ts`. Expected: FAIL, modules not found.
- [ ] **Step 4: Implement `choose-presenter.ts`, `gl-shaders.ts` and `GlPresenter` in `gl-presenter.ts`.** Context options `{ alpha: false, antialias: false, desynchronized: true, preserveDrawingBuffer: false, powerPreference: "high-performance" }`. Upload from `new Uint16Array(HEAPU8.buffer, ptr, pitch / 2 * h)` with `UNPACK_ROW_LENGTH = pitch / bytesPerPixel`; textures `RGB565` (16-bit), `R8` + 256x1 `RGBA8` palette (PAL8), `RGBA8` (BGRX and RGBA, swizzled in the shader by a `format` uniform). Before the upload, `Atomics.store(readIndex, frameIndex)`; after it, `-1`. The draw is one full-canvas triangle; the letterbox rectangle is computed with the same "contain" math as `input.ts`'s pointer mapping (`Math.min(box.w / pic.w, box.h / pic.h)`, centred), passed as a uniform. `capture()` renders the picture at game size with nearest into a framebuffer and reads it with `readPixels` (flipped to top-down). The cursor code (`setCursor`, `drawCursorOverlay`) moves into a shared helper used by both presenters, unchanged in behaviour.
- [ ] **Step 5: Run** the same command. Expected: PASS. Then `pnpm test` (the renamed `Presenter2d` tests still pass) and `pnpm typecheck`.
- [ ] **Step 6: Wire it in.** `Play.tsx` builds `GlPresenter` or `Presenter2d` from `presenterKind(location search, !!document.createElement("canvas").getContext("webgl2"))`; `onFallback` stops the GL presenter and starts a `Presenter2d` on a fresh canvas element (a canvas that had a WebGL context cannot give a 2D one), which writes `presentMode = 0`. `configure(settings.scale, settings.bars)` replaces `configure(settings.scale)`. The 2D presenter also writes `readIndex`, so both modes use the three-buffer guarantee. Expose `window.ra2Presenter` beside `ra2Store`.
- [ ] **Step 7: Switch the tests' pixel reads to `capture()`.** `lib.mjs`'s `picture(page)` and the checksums in `lobby.mjs` and `movies.mjs` call `await window.ra2Presenter.capture()` instead of `getContext("2d").getImageData`, and take `w`/`h` from its result.
- [ ] **Step 8: Write and run `e2e/gl-pixels.mjs`.** For the main menu (16-bit), a movie frame (PAL8 if the game uses it; otherwise skip with a note) and a skirmish frame, with the game paused on a still frame, it reads the raw buffer through `Module.HEAPU8` at `framePtr`, converts it on the CPU with the same expansion `presenter.c` uses (`r << 3 | r >> 2`, `g << 2 | g >> 4`), and compares with `capture()`. Run: `node e2e/gl-pixels.mjs`. Expected: `0 differing pixels` for each.
- [ ] **Step 9: Run the browser suite on both presenters**: `node e2e/playtest.mjs` and `node e2e/playtest.mjs --url "<page>?presenter=2d"` (the `lib.mjs` `--url` option). Expected: the same pass count as before this task.
- [ ] **Step 10: Commit**

```bash
git add web/src/game/gl-presenter.ts web/src/game/gl-shaders.ts web/src/game/choose-presenter.ts web/src/game/*.test.ts web/src/game/presenter.ts web/src/game/loader.ts web/src/screens/Play.tsx web/e2e/lib.mjs web/e2e/lobby.mjs web/e2e/movies.mjs web/e2e/gl-pixels.mjs
git commit -m "Draw the game with WebGL2 from its raw screen, the 2D canvas as fallback"
```

### Task 5: HD vehicles as two layers

**Files:**
- Create: `src/web/hd_layers.h`, `src/web/hd_layers.c`, `src/web/hd_layers_selftest.c`
- Modify: `src/runtime/hdvox.h`, `src/runtime/hdvox.c` (add the visitor next to `hdvox_compose`), `src/web/presenter.c`, `CMakeLists.txt:70`, `web/src/game/gl-presenter.ts`, `web/src/game/gl-shaders.ts`, `web/src/game/gl-presenter.test.ts`, `web/e2e/gl-pixels.mjs`

**Interfaces:**
- Produces (`hdvox.h`):
  - `typedef void (*hdvox_visit_fn)(void *ctx, int x, int y, int w, int h, const uint16_t *expected, const uint16_t *hd4, const uint8_t *mask);` (`hd4` is four 565 pixels per 1x pixel: top-left, top-right, bottom-left, bottom-right, the order `hdvox_compose` reads)
  - `int hdvox_visit_published(hdvox_visit_fn fn, void *ctx);` visits the published record set under `g_pub_lock` and returns the number of records, or -1 when HD is not live.
  - `unsigned hdvox_published_frames(void);` (the existing `g_published_frames`), so a caller can tell a new set from the same one.
- Produces (`hd_layers.h`):
  - `#define HD_RECTS_MAX 256`
  - `typedef struct { int16_t x, y, w, h; } hd_rect_t;` (1x pixels)
  - `typedef struct { int w, h; uint32_t *layer1x; uint16_t *layer2x; hd_rect_t rects[HD_RECTS_MAX]; int rect_count; /* -1 = whole layer */ hd_rect_t prev[HD_RECTS_MAX]; int prev_count; } hd_layers_t;`
  - `layer1x` packs each 1x pixel as `expected565 | mask << 16`; `layer2x` is 2w × 2h 565.
  - `int hd_layers_resize(hd_layers_t *l, int w, int h);` (frees and reallocates both; 0 on allocation failure)
  - `void hd_layers_begin(hd_layers_t *l);` clears the 1x mask over `prev` and starts a new rectangle list with those cleared rectangles in it.
  - `void hd_layers_add(void *ctx /* hd_layers_t* */, int x, int y, int w, int h, const uint16_t *expected, const uint16_t *hd4, const uint8_t *mask);` is an `hdvox_visit_fn`: it writes the clipped record into both layers and appends its rectangle; past `HD_RECTS_MAX` it sets `rect_count = -1`.
  - `void hd_layers_end(hd_layers_t *l);` makes this set's own rectangles the next `prev`.
  - `void hd_layers_compose_ref(const hd_layers_t *l, const uint16_t *frame, int pitch_px, uint32_t *out_bgrx);` is the CPU reference of the shader rule, for the selftest only (`HD_LAYERS_SELFTEST`).
- Produces (shared words, from Task 3): `hdLayer1x`, `hdLayer2x` (pointers), `hdRects` (pointer to `rects`), `hdRectCount` (-1 = whole layer), `hdSeq` (moves when the layers change).
- The page rule (shader): at output pixel `p`, with 1x texel `t = floor(p / 2)` in game pixels: if `layer1x[t] >> 16 != 0` and `layer1x[t] & 0xFFFF == frame[t]`, show `layer2x[p]`; otherwise `frame[t]`.

- [ ] **Step 1: Write the failing selftest** `hd_layers_selftest.c`:
  - `one_record_matches_hdvox_rule`: a 4x4 frame of colour A; one 2x2 record at (1,1) with expected A, mask all 1, hd4 = B, C, D, E. `hd_layers_compose_ref` → the 8x8 output has B C / D E at each of those four 1x pixels, and A elsewhere.
  - `drawn_over_keeps_1x`: same, but frame pixel (1,1) is F ≠ A → output at (2..3, 2..3) is F four times.
  - `begin_clears_previous_masks`: add a record, `end`, `begin`, add nothing → `compose_ref` gives the plain 2x upscale, and `rect_count == 1` (the cleared rectangle).
  - `clips_records_at_edges`: a record at (-1, 3) of 3x3 on a 4x4 frame writes only the inside pixels, and its rectangle is clipped.
  - `overflow_marks_whole_layer`: 257 records → `rect_count == -1`.
- [ ] **Step 2: Build and run it**, failing (same `emcc` form as Task 3 with `src/web/hd_layers.c` and `-DHD_LAYERS_SELFTEST`). Expected: compile error.
- [ ] **Step 3: Implement `hd_layers.c`**, and `hdvox_visit_published` in `hdvox.c`. The visitor walks the arena exactly as `hdvox_compose`'s record loop does (`rec_t`, `E`, `O`, `m`, the 8-byte rounding) and only reads.
- [ ] **Step 4: Run** the selftest. Expected: `hd_layers selftest: ok`.
- [ ] **Step 5: Use it in `presenter.c`.** In `raw` mode with `ra2_vox_hd_on && ra2_vox_hd_show`, each publish whose `hdvox_published_frames()` moved runs `hd_layers_resize` (on a size change), `hd_layers_begin`, `hdvox_visit_published(hd_layers_add, &layers)`, `hd_layers_end`, then sets the HD words and bumps `hdSeq`. HD off: `hdLayer1x = 0`. The time this takes is added to `g_pub_ms` so the `fps` event's `pubms` includes it.
- [ ] **Step 6: Write the failing page tests** in `gl-presenter.test.ts`:
  - `uploads only the listed rectangles of both layers`: `hdRectCount 2` with rectangles (1,1,2,2) and (5,0,1,1) → four `texSubImage2D` calls: two on the 1x layer at those rectangles, two on the 2x layer at the doubled rectangles (UNPACK_SKIP_PIXELS/ROWS set to match).
  - `uploads whole layers when the list overflowed`: `hdRectCount -1` → one full upload of each layer.
  - `skips HD uploads when hdSeq has not moved`.
- [ ] **Step 7: Implement them** in `gl-presenter.ts`: a 1x `R32UI` texture (`RED_INTEGER`, `UNSIGNED_INT`) and a 2x `RGB565` texture, both created at the frame's size when `hdLayer1x` is non-zero. Add the composite rule to `FRAGMENT_SOURCE` (`usampler2D` for the 1x layer, `texelFetch` for both). Run `pnpm vitest run src/game/gl-presenter.test.ts`. Expected: PASS.
- [ ] **Step 8: Add an HD check to `gl-pixels.mjs`.** In a skirmish with HD on and the game paused, call a debug export `ra2_debug_compose_reference()` (added to `presenter.c`, used only in raw mode: it runs `hdvox_compose` on the current picture into a scratch buffer and returns its pointer; the size is 2w × 2h BGRX). Then compare it with a 2x `capture()` (`capture({ hd: true })` renders at 2w × 2h). Run `node e2e/gl-pixels.mjs --hd`. Expected: `0 differing pixels`.
- [ ] **Step 9: Run the HD playtests** (`node e2e/playtest.mjs --hd` as `docs/web/testing.md` gives it) on both editions. Expected: same pass count as before.
- [ ] **Step 10: Commit**

```bash
git add src/web/hd_layers.* src/runtime/hdvox.c src/runtime/hdvox.h src/web/presenter.c CMakeLists.txt web/src/game/gl-presenter.ts web/src/game/gl-shaders.ts web/src/game/gl-presenter.test.ts web/e2e/gl-pixels.mjs
git commit -m "Composite HD vehicles on the GPU from two layers and their changed rectangles"
```

### Task 6: Scaling modes and the blurred bars in the shader

**Files:**
- Modify: `web/src/game/gl-shaders.ts`, `web/src/game/gl-presenter.ts`, `web/src/game/gl-presenter.test.ts`, `web/src/screens/Play.tsx` (remove the backdrop canvas at lines 63, 179, 317-319 and its CSS class), `web/src/screens/Play.module.css` (the `.backdrop` rule)

**Interfaces:**
- Consumes: `SCALE_MODE`, `GamePresenter.configure(scale, bars)`.
- The modes, matching `docs/presenter.md`:
  - **nearest**: `texelFetch` at `floor(uv * size)`.
  - **smooth**: hardware bilinear (`LINEAR` filter).
  - **sharp** (sharp-bilinear): integer prescale `k = max(1, floor(min(scaleX, scaleY)))`, then bilinear from the prescaled position: `uv = (floor(p) + clamp((fract(p) - 0.5) * k + 0.5, 0, 1)) / size`, with `p = uv * size`.
  - **integer**: the letterbox rectangle shrinks to `floor(scale)` × picture size, then nearest.
  - **crt**: nearest, then rows darkened by 22% on every third output row of the picture (the 2D presenter's `rgba(0,0,0,0.22)` every 3rd row), in picture pixels.
- **Bars**: with `bars` on, outside the letterbox rectangle the shader samples the picture texture at mip level 5 (`textureLod`, mipmaps regenerated with `generateMipmap` once per new picture, only when bars are on and there is space beside the picture), stretched to fill the canvas, times 0.5. With `bars` off, black.

- [ ] **Step 1: Write the failing tests** in `gl-presenter.test.ts`:
  - `configure sets the mode uniform`: each of the five scales → `uniform1i(modeLocation, SCALE_MODE[scale])`.
  - `integer shrinks the letterbox to a whole multiple`: picture 800x600, box 2000x1300 → rectangle uniform 1600x1200, centred.
  - `regenerates mipmaps only when bars are on and visible`: bars off → no `generateMipmap`; bars on with a box of the picture's aspect → none; bars on and a wider box → one per new picture.
- [ ] **Step 2: Run** `pnpm vitest run src/game/gl-presenter.test.ts`. Expected: FAIL on the three new tests.
- [ ] **Step 3: Implement** the uniforms, the letterbox rule and the mipmap rule in `gl-presenter.ts`, and the five modes plus bars in `FRAGMENT_SOURCE`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Remove the backdrop canvas** from `Play.tsx` and its CSS; `configure` receives `settings.bars`. The 2D presenter keeps its own backdrop behaviour by drawing its 64x48 blur into its own canvas's surroundings; if that would need the removed element, `Presenter2d` creates a backdrop canvas itself, so `Play.tsx` holds none.
- [ ] **Step 6: Check visually** in headed Chrome at 1920x1080 in the main menu (800x600 in a wide window): each of the five modes from Settings, bars on and off. Save a screenshot of each in `work/perf/scales/`. Expected: the picture looks as the 2D presenter's does for nearest, smooth and CRT; sharp is crisp with soft pixel edges; integer has a whole-multiple picture with wider bars; bars on shows a dark blur of the picture.
- [ ] **Step 7: Run** `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `node e2e/remaster.mjs` (it switches scales and bars). Expected: PASS.
- [ ] **Step 8: Commit**

```bash
git add web/src/game/gl-shaders.ts web/src/game/gl-presenter.ts web/src/game/gl-presenter.test.ts web/src/game/presenter.ts web/src/screens/Play.tsx web/src/screens/Play.module.css
git commit -m "Scale the picture and draw the blurred bars in the WebGL2 shader"
```

### Task 7: Rendering checkpoint

**Files:**
- Modify: this plan's "Results" section

- [ ] **Step 1: Release-link both editions** (`$env:CMAKE_ARGS='-DWEB_LINK_OPT='; cmd /c build-web.cmd`, then the same with `$env:RA2_TARGET='game'`).
- [ ] **Step 2: Run the benchmark** against the baseline: `node e2e/perf.mjs --save <busy save> --out work/perf/after-render --baseline work/perf/baseline/run.json`. Expected: the HD-on rows show higher fps than the baseline at every size, and main-thread time per frame ≤ 4 ms. Record the table in "Results".
- [ ] **Step 3: Decide.** If any 720p–1440p HD busy case is below a 60 fps median, profile it in Chrome DevTools (Performance panel, the game's worker thread) and record the three heaviest functions in "Results". If the page's main thread is the bottleneck, record that as the case for the spec's approach B (render worker) and tell the user; do not start it in this plan. Continue with Task 8 either way: CPU and memory work is independent of the remaining gap.
- [ ] **Step 4: Commit** the plan's updated "Results".

### Task 8: `Sleep` sleeps all but a margin (pcrecomp)

**Files:**
- Modify: `../pcrecomp/runtime/win32hle/kernel32.c:299-318` (`wait_ms`)
- Test: `../pcrecomp/runtime/win32hle/kernel32_ext_selftest.c`

**Interfaces:**
- Consumes: margin `M` from Task 2's "Probe results".
- Produces: `#define HLE_WAIT_SPIN_MS M` (web only) and `static void wait_ms(uint32_t ms)` with the rule: if `ms > HLE_WAIT_SPIN_MS`, `usleep((ms - HLE_WAIT_SPIN_MS) * 1000)`; then spin with `sched_yield()` until the deadline. When `M == 16`, the behaviour is today's except for 17–19 ms waits, so skip this task and record "no change: waits are not precise enough" in "Results".

- [ ] **Step 1: Write the failing test** in `kernel32_ext_selftest.c` under `__EMSCRIPTEN__`: `sleep_is_not_early`: 50 calls of `Sleep(5)` through the HLE entry; each takes ≥ 5.0 ms. `sleep_mostly_sleeps`: over those 50, the summed thread CPU time (`clock_gettime(CLOCK_THREAD_CPUTIME_ID)` if Emscripten provides it, else the count of spin iterations exposed by a selftest-only counter `hle_wait_spins`) is below 50% of the wall time.
- [ ] **Step 2: Run** `python3 build_selftests_web.py` in `../pcrecomp/runtime/win32hle` (as `docs/web/testing.md` gives it). Expected: `sleep_mostly_sleeps` FAILS (today a 5 ms wait is spun entirely).
- [ ] **Step 3: Implement** the margin in `wait_ms`.
- [ ] **Step 4: Run** the selftests. Expected: PASS, the others unchanged.
- [ ] **Step 5: Benchmark.** Rebuild (release link), run `perf.mjs` with `--baseline work/perf/after-render/run.json`. Expected: `menu/idle` CPU lower, and median fps, 1% low and worst gap no worse in every case. If any is worse, revert, record the numbers and "reverted" in "Results", and continue.
- [ ] **Step 6: Commit** in pcrecomp (stage only this hunk):

```bash
git -C ../pcrecomp add -p runtime/win32hle/kernel32.c runtime/win32hle/kernel32_ext_selftest.c
git -C ../pcrecomp commit -m "web: sleep all but the last few milliseconds of a wait"
```

### Task 9: Clock damper (only if Task 2 found a spin)

**Files:**
- Modify: `src/web/main.c` (`ra2_QueryPerformanceCounter` and the `timeGetTime`/`GetTickCount` shims from Task 2)

**Interfaces:**
- Produces: `#define DAMP_READS 1000` and `#define DAMP_SLEEP_US 1000`. After the menu has opened once (`web_menu_seen`), when `DAMP_READS` clock reads arrive in a row with no other HLE call between them, the next read `usleep(DAMP_SLEEP_US)` inside `hle_block_begin`/`hle_block_end`, and the run counter resets. "No other HLE call" is a counter that every clock shim increments, and that `hle_block_begin` (called by every blocking HLE call) clears; check `win32hle.h` for a cheaper existing per-call hook first and use it if there is one. `--intro` and the splash skip are unchanged. Skip this task (record "no spin found") if Task 2 found none.

- [ ] **Step 1: Run** a menu and a skirmish with `?arg=--clockstats` and record the reads per second (the "before").
- [ ] **Step 2: Implement** the damper.
- [ ] **Step 3: Run** the same and record the "after". Expected: fewer clock reads per second in the menu.
- [ ] **Step 4: Benchmark** as in Task 8, Step 5, with the same keep-or-revert rule.
- [ ] **Step 5: Run the timing-sensitive checks**: `node e2e/audio.mjs --skirmish --minutes 5` (zero underruns) and `node e2e/playtest.mjs`. Expected: PASS.
- [ ] **Step 6: Commit** `git add -p src/web/main.c`, message "Give up a millisecond when the game spins on the clock".

### Task 10: Critical sections wait on a futex; mixer and page per-frame work

**Files:**
- Modify: `../pcrecomp/runtime/win32hle/kernel32.c:341-373` (`hle_enter_cs`, `hle_leave_cs`, `k_TryEnterCriticalSection`)
- Test: `../pcrecomp/runtime/win32hle/kernel32_ext_selftest.c`
- Modify: `web/src/game/presenter.ts` / the shared cursor helper from Task 4 (the overlay's `getBoundingClientRect` moves to a `ResizeObserver`), `web/src/screens/FrameStats.tsx` and `web/src/game/store.ts` only if Step 6 finds per-frame React updates

**Interfaces:**
- Produces (web only): the owner word is taken with `__atomic_compare_exchange_n(&CS_OWNER(cs), &zero, me, ...)`. A waiter calls `emscripten_futex_wait(&CS_OWNER(cs), owner_seen, 1.0 /* ms */)` between `hle_block_begin`/`hle_block_end`, and `hle_leave_cs` calls `emscripten_futex_wake(&CS_OWNER(cs), 1)` when the owner becomes 0. The 1 ms timeout bounds any missed wake. Recursion count and `LockCount` (`cs + 4`) keep their meanings.

- [ ] **Step 1: Write the failing tests** in `kernel32_ext_selftest.c`:
  - `cs_mutual_exclusion`: 4 pthreads × 100,000 enter/increment/leave on one guest `CRITICAL_SECTION` → the counter is exactly 400,000.
  - `cs_recursion`: enter twice, leave once, a second thread's `TryEnterCriticalSection` fails; leave again, and it succeeds.
  - `cs_waiter_wakes_fast`: thread A holds for 10 ms while thread B waits to enter; B's enter returns ≤ 2 ms after A's leave (both times from `emscripten_get_now()`), in each of 20 rounds.
- [ ] **Step 2: Run** the web selftests. Expected: `cs_mutual_exclusion` may already pass; `cs_waiter_wakes_fast` fails or is flaky with today's 50 µs sleep loop, and must pass after. If all three pass before the change, keep the tests and still make the change only if Step 4's benchmark shows a CPU drop.
- [ ] **Step 3: Implement** the futex wait.
- [ ] **Step 4: Run** the selftests (PASS), rebuild, and benchmark with the keep-or-revert rule from Task 8.
- [ ] **Step 5: Mixer.** In a DevTools profile of the busy case, read the mixer thread's share of CPU (the worker running `dsound.c`'s 5 ms loop, line 263). If it is above 5% of one core, change the wake to 10 ms, run `node e2e/audio.mjs --skirmish --minutes 5`, and keep it only with 0 underruns. Record the share and the decision in "Results".
- [ ] **Step 6: Page per-frame work.** Record a 10 s DevTools Performance profile of the main thread in the busy case. Move the cursor overlay's `getBoundingClientRect` to a `ResizeObserver` (test in `presenter.test.ts` or `gl-presenter.test.ts`: `does not read layout during draw`, a spy on `getBoundingClientRect` called 0 times across 10 `draw()`s after the first). Any React component re-rendering every animation frame (seen in the profile) is changed to update only when its shown value changes.
- [ ] **Step 7: Run** `pnpm test`, `pnpm typecheck`, and the benchmark. Expected: main-thread time per frame ≤ 4 ms in every case.
- [ ] **Step 8: Commit** pcrecomp's hunks (`git -C ../pcrecomp add -p ...`, "web: wait for a critical section on a futex") and this repository's (`git add -p ...`, "Keep layout reads and React updates out of the frame loop").

### Task 11: Memory: bounded caches and limits from measured peaks

**Files:**
- Modify: `src/web/read_cache.c`, `src/runtime/hdvox.c` (the memo, `memo_t`, around line 142), `CMakeLists.txt:98`, `tools/test_web_memory_budget.py`, `docs/web/memory.md`

**Interfaces:**
- Produces: documented upper bounds, one line each in `docs/web/memory.md` ("Bounded caches"): `read_cache.c` blocks (count × 1 MiB), the HD record arenas (2 × 24 MiB, `ARENA` in `hdvox.c`), the 2x image memo (entries × typical size), the picture buffers (3 × w × h × bytes per pixel), the HD layers (w × h × 4 + 4w × h × 2).
- Produces: `INITIAL_MEMORY` and `MAXIMUM_MEMORY` set from Step 4.

- [ ] **Step 1: Read** each cache's growth rule. For any with no upper bound, add one and write the test that pins it: `read_cache.c` in a new `read_cache_selftest.c` (`cache_stays_bounded`: 1000 distinct 1 MiB reads → block count ≤ the bound); the memo in `hdvox.c` gets an entry limit with eviction of the oldest, checked by its counter in the `[hdvox]` log line during the soak.
- [ ] **Step 2: Build and run** the new selftests (same `emcc` form as Task 3). Expected: PASS.
- [ ] **Step 3: Run the soak**: `node e2e/perf.mjs --sizes 2560x1440 --hd on --moments busy --soak-minutes 10 --save <busy save> --baseline work/perf/baseline/run.json`, and the same at 3840x2160 for the record. Expected: `wasmGrowthAfter60s === 0` at 1440p; the peak is recorded.
- [ ] **Step 4: Set the limits.** `INITIAL_MEMORY` = the main menu's measured wasm size rounded up to the next 16 MB; `MAXIMUM_MEMORY` = the larger of 768 MB and the 4K soak peak + 25%, rounded up to 64 MB, and no more than 1 GB unless the 4K peak needs it (then record why in `docs/web/memory.md`). Update `tools/test_web_memory_budget.py`'s expected values to match.
- [ ] **Step 5: Run** `python tools/test_web_memory_budget.py`. Expected: PASS.
- [ ] **Step 6: Commit**

```bash
git add -p src/web/read_cache.c src/runtime/hdvox.c CMakeLists.txt tools/test_web_memory_budget.py docs/web/memory.md
git commit -m "Bound the web build's caches and size its memory from measured peaks"
```

### Task 12: Final benchmark and docs

**Files:**
- Modify: `docs/web/progress.md`, `docs/web/architecture.md` ("Rendering"), `docs/web/protocol.md` (final check), `docs/web/tasks.md` (a row per finished task under a new "Frame performance" heading), this plan's "Results"

- [ ] **Step 1: Release-link both editions** and run the full matrix with the soak against the baseline: `node e2e/perf.mjs --save <busy save> --soak-minutes 10 --out work/perf/final --baseline work/perf/baseline/run.json`, then the same for Red Alert 2 with its own busy save.
- [ ] **Step 2: Check every row of the pass bar.** Expected: every `pass` is `true` (4K rows have `pass: null`). Any `false` is reported to the user with its numbers, not hidden.
- [ ] **Step 3: Run the whole browser suite** on the WebGL2 presenter and with `?presenter=2d`, HD off and on, for both editions, and `pnpm test`, `pnpm typecheck`, `pnpm lint`. Expected: all pass.
- [ ] **Step 4: Update the docs.** `architecture.md`'s "Rendering" describes the raw publish, the three buffers, the HD layers and the WebGL2 presenter, with the 2D presenter as the fallback. `progress.md` gets the before/after table. `tasks.md` gets the rows.
- [ ] **Step 5: Commit**

```bash
git add docs/web/progress.md docs/web/architecture.md docs/web/protocol.md docs/web/tasks.md docs/superpowers/plans/2026-10-26-web-frame-performance.md
git commit -m "Record the frame performance results and the new rendering path"
```

---

## Probe results

| Target wait | p50 late | p95 late | p99 late | max late |
|---|---|---|---|---|
| 1 ms | 1.00 | 11.66 | 14.67 | 14.83 |
| 2 ms | 0.52 | 2.91 | 13.41 | 14.93 |
| 4 ms | 0.52 | 2.00 | 11.16 | 14.60 |
| 8 ms | 0.50 | 1.42 | 7.04 | 12.34 |
| 16 ms | 0.52 | 1.38 | 7.17 | 13.18 |

(Late = the wait's real duration less its target, in ms; 200 waits per target, in a worker in headed Chrome on this Windows machine, `e2e/wait-probe.mjs`, the second of two runs (`work/perf/wait-probe.json`). The first run's p99 was 15.12, 10.49, 6.34, 12.19 and 10.49 ms for 1 to 16 ms; both runs give M = 16.)

Margin `M`: 16 ms. No target has a p99 of 1 ms or less, so M is today's 16: the wake is quantised to the system timer tick (about 15.6 ms) from 1 ms up.

Clock calls per second, main menu / match: main menu (25 s, median per second): QueryPerformanceCounter 58,933, GetTickCount 22, timeGetTime 0; Sleep(n) 93, Sleep(0) 0. Match (skirmish, 36 s of battle after the setup and load, median per second): QueryPerformanceCounter 704, timeGetTime 2,035, GetTickCount 0; Sleep(n) 667, Sleep(0) 0. During the skirmish's setup and load, up to about 125,000 QueryPerformanceCounter reads a second, with about 100 Sleep(n) in each.

Spin found: no. No second had 1,000 or more clock reads with no Sleep: every second of the menu and the battle had 91 or more Sleep(n) calls, so Task 9 does not run. (Measured with the -O1 probe build, headed Chrome, the profile work/perf/profile-fresh, the default skirmish. A re-run with the committed `e2e/clock-probe.mjs` (`work/perf/clock-probe.json`) gave a menu median of 41,788 clock reads a second and 612+ Sleep(n) a second in the battle, still no spin; the menu rate varies 42k–59k between runs.)

### Busy profile (HD off)

Task 2b, `e2e/profile-game.mjs` (docs/web/testing.md, "Profiling the busy game"): the busy save at 1280x720, HD vehicles off, game speed 5 recorded as assumed (`"speed": "assumed 5 (busy.sav)"`: the page exposes no game-speed getter, so it is not read back), 10 s settle, then 20 s of CPU profile on the game's worker. Release link with names: `-O3;--profiling-funcs` (not the `-O2` fallback), in `work/build-web-prof`. Two separate browser sessions; both are in `work/perf/profile-busy.json` and `profile-busy-2.json`.

| Share of the game thread's self time | Run 1 | Run 2 |
|---|---|---|
| recompiled game (`src/recomp`) | 28.0% | 27.9% |
| hook (`recomp_*`: `recomp_thai_call`, `recomp_lookup`) | 55.0% | 54.6% |
| runtime (pcrecomp `win32hle`, `src/runtime`, not `recomp_*`) | 0.1% | 0.1% |
| presenter (`src/web`) | 0.8% | 0.8% |
| waiting (idle, `emscripten_futex_wait`, `wait_ms`) | 15.7% | 16.1% |
| other (libc, JS glue, FFmpeg) | 0.3% | 0.5% |

Fps during the sample (one reading a second): run 1 median 25, lowest 17; run 2 median 25, lowest 16. The game's thread had 17.1 s and 17.0 s of game work in the 20.3 s, 84% busy. The Task 1 baseline (`work/perf/baseline/run.json`, 1280x720, HD off, busy, the same save) has a median of 23 and a lowest of 22, with an earlier build (`ef2b94fc…`). This profiling build (`-O3`, with names) runs at 25 on the same save and size. The difference is unexplained.

Top 10 by self time (run 1 / run 2):

| # | Run 1 | Group | Share | Run 2 | Group | Share |
|---|---|---|---|---|---|---|
| 1 | `recomp_thai_call` | hook | 52.0% | `recomp_thai_call` | hook | 51.8% |
| 2 | `emscripten_futex_wait` | waiting | 15.7% | `emscripten_futex_wait` | waiting | 16.1% |
| 3 | `recomp_lookup` | hook | 3.0% | `recomp_lookup` | hook | 2.8% |
| 4 | `RLEBlitTransXlatAlphaZRead_G__virtual_1` | game | 1.8% | `RLEBlitTransXlatAlphaZRead_G__virtual_1` | game | 2.3% |
| 5 | `TechnoClass__virtual_23` | game | 1.5% | `TechnoClass__virtual_23` | game | 1.3% |
| 6 | `present_now` | presenter | 0.8% | `present_now` | presenter | 0.8% |
| 7 | `sub_00437A10` | game | 0.7% | `sub_007258D0` | game | 0.7% |
| 8 | `RLEBlitTransXlat_E__virtual_1` | game | 0.6% | `sub_00437A10` | game | 0.6% |
| 9 | `TechnoClass__virtual_10` | game | 0.6% | `TechnoClass__virtual_10` | game | 0.6% |
| 10 | `sub_006F8960` | game | 0.5% | `BuildingClass__virtual_23` | game | 0.5% |

Classification. A function's group is the source tree of the object file that defines it (`llvm-nm` over `work/build-web-prof/CMakeFiles/ra2.dir`): `src/recomp/` is the game, `pcrecomp/` and `src/runtime/` the runtime, `src/web/` the presenter. The `sub_XXXXXXXX` names are the lifted game's and count as game. Functions named `recomp_*` are the hook group (the runtime's call wrappers and dispatch: `recomp_thai_call`, `recomp_lookup`), checked before the object map, so the runtime group keeps the other pcrecomp and runtime functions (0.1%). Waiting is the idle node, `emscripten_futex_wait`, `Atomics`, `wait_ms`'s own self time and the thread-sleep calls. Other is everything else. 740 names are defined in more than one object (mostly `static` helpers); a name takes the first object's group. Each name in the top ten is defined in one object only, so that does not change the table.

Spin. pcrecomp's `wait_ms` (the game's `Sleep`) polls the clock until its deadline, so much of its time is clock reads, not waiting. In the first profile I took (superseded: `work/perf/superseded-profile-busy-picked-spin.json`, selected before the spin was excluded), the selected worker's four clock-named functions are 16.5 s of its 20.3 s, 81%: `_emscripten_get_now` 13.2 s, `now` 2.1 s, `_clock_time_get` 0.9 s, `__clock_gettime` 0.3 s, all under `wait_ms`. With the JS helpers on those calls (`bigintToI53Checked` 0.9 s, `wasm-to-js` 0.6 s, `growMemViews` 0.6 s, `get buffer` 0.2 s) it is 18.9 s, 93%; non-waiting time under `wait_ms` is 93% of that worker. A second pool worker had 96% under `wait_ms`: about 42% in "other", which is not confirmed as clock reads (its profile was not saved), and the rest futex waits. The clock probe's spin verdict missed this, because it counts `Sleep` calls and each of these calls is one. The game thread does not spin: 0% of its time is non-waiting time under `wait_ms`, and its `wait_ms` time is in waiting.

Reading. The game's thread is the bound: it is 84% busy at 25 fps, about 34 ms of its own work a frame where 60 fps allows about 16 ms. The 52% in `recomp_thai_call` (the hook group, 55% with `recomp_lookup`) is not yet attributed: it is either a runtime wrapper's real cost or a profiler artefact. The review found that the wrapper's early path is one indirect call to the original, and that `sub_00434500` is a separate function with about 2 s on the stack, so the self time does not yet add up. Task 2c tests it. The game's own code is 28%, spread over many functions. The presenter group is 0.8%. Waiting (`emscripten_futex_wait` on the game thread) is 16%, which caps Tasks 8 and 10 at about that share of the frame.

### Thai wrapper A/B (Task 2c)

Switch: `RA2_NO_THAI_HOOK` in `src/runtime/thai_font.h` maps `RECOMP_THAI_CALL` and `RECOMP_THAI_ICALL` onto pcrecomp's `RECOMP_CALL` and `RECOMP_ICALL`. Build A is `work/build-web-prof` (unchanged from Task 2b). Build B is `work/build-web-nothai` (`-DWEB_LINK_OPT=-O3;--profiling-funcs`, `-DCMAKE_C_FLAGS=-DRA2_NO_THAI_HOOK`, which is in all 273 compile lines of its `build.ninja`).

Benchmark: `web/e2e/perf.mjs --build <dir>` at 1280x720, HD off, the busy save, 60 s (30 s untouched, then panned), headed Chrome, one browser session per run, A, B, A, B. Median is `fpsMedian`; 1% low is `fps1Low`, the nearest-rank first percentile, which over 60 one-second samples is the minimum. Each run's `run.json` names its build directory, the build id and the SHA-256 prefix of the `ra2.wasm` it served (A `b0fb263feb7d`, B `28aa805ebe19`, matching the files in the two build directories).

| Run | Build | Median fps | 1% low | Worst gap (ms) |
|---|---|---|---|---|
| A1 | A | 29 | 21 | 164 |
| B1 | B | 62 | 55 | 36 |
| A2 | A | 24 | 22 | 73 |
| B2 | B | 62 | 56 | 43 |

Pair rule: A's two medians average 26.5 (spread 5); B's average 62.0 (spread 0). B is 35.5 fps above A, about 2.3 times A, far beyond the spread. B's median meets the 60 target and its 1% low (55 and 56) meets the 55 bar; A meets neither.

An earlier set of four `perf.mjs` runs (medians 29, 22, 23, 23 for A and B alternating) did not show this, because `perf.mjs` ignored `--build` and measured the published game in `web/public/game` for every run. That bug is fixed in `perf.mjs`; those runs are void.

`profile-game.mjs` (`--build`, 20 s CPU profile after a 10 s settle, with the profiler attached) agrees on the direction: A median 29 (min 26), B median 62 (min 61) in two runs. Under the profile, A's `recomp_thai_call` has 55.2% of the game worker's self time (`work/perf/profile-A-2c.json`). B has none, and its time is in the game's own code (65 to 69%), the `wait_ms` clock spin (11 to 15%) and `recomp_lookup` (8 to 9%); Frame cap. 62 fps is the frame cap at game speed 5, not a measure of headroom: Task 1's early-match baseline at 1280x720, HD off is also 62 (`work/perf/baseline/run.json`, median 62, 1% low 62). So B's fps shows only that it reaches the cap. The headroom measure is the game thread's work per frame: the game, hook, runtime and presenter self time, divided by the frames in the 20 s profile. From the profiles: A about 34 ms (19.3 s over 565 frames, `work/perf/profile-A-2c.json`); B about 12 to 13 ms (15.3 s over 1238 frames and 16.3 s over 1236 frames, `profile-nothai.json` and `profile-nothai-2.json`). The waiting and `wait_ms` spin time is left out.

B's top 10 by self time of the game worker (first profile, `work/perf/profile-nothai.json`): 1 `_emscripten_get_now` 15.2% (other, the `wait_ms` clock spin; 11.3% in the repeat), 2 `recomp_lookup` 7.8% (hook; 8.9% in the repeat), 3 `RLEBlitTransXlatAlphaZRead_G__virtual_1` 4.8% (game), 4 `TechnoClass__virtual_23` 3.1% (game), 5 `emscripten_futex_wait` 2.6% (waiting), 6 `now` 2.4% (other), 7 `present_now` 2.2% (presenter), 8 `sub_007258D0` 1.7% (game), 9 `sub_00437A10` 1.6% (game), 10 `TechnoClass__virtual_10` 1.5% (game).

Verdict: the build without the wrapper runs the busy case about 2.3 times faster (26.5 to 62 fps median). The mechanism is not measured. The wrapper's off path is a flag test and one call, so the cost may come from what the direct call lets the optimiser do (inlining, layout) rather than the call itself. Task 2d's measurement is the test of whether the inline flag check reproduces it. B is a measurement build, not a shipped one: B's picture check passed, but its output was not compared with A's beyond that.

Proposed fix (Task 2d Step 1 does it; not implemented here): test the Thai switch inline in `RECOMP_THAI_CALL` and `RECOMP_THAI_ICALL`, so that when the fix is off the macro is a plain `RECOMP_CALL(fn)` or `RECOMP_ICALL(va)`. The check is one read of a flag that `thai_font.c` owns (`g_thai_font_on`, set by `thai_font_set_enabled`). With the fix on, the existing wrapper path runs unchanged. Task 2d also removes the `RA2_NO_THAI_HOOK` switch that this subsection's build B used, so it cannot be used to repeat the measurement after 2d. The benchmark for the inline version is the four-run protocol with A = the build before 2d and B = the inline build.

## Results

(Filled in by Tasks 1, 7–12.)

### Task 2d: the Thai-off path

**The premise was wrong.** The web page's default Thai preference is on: `DEFAULT_THAI_FONT_PREFERENCE` in `web/src/storage/thai-fonts.ts` is `enabled: true`, and the Play screen reads it when nothing is stored, so the game starts with `--thai-font-fix --thai-font-id builtin-westwood-improved`. The benchmark profile (`work/perf/profile-fresh`) stores no preference, so every benchmark run before this subsection ran with the Thai fix on. "The Thai fix off (the default)" in Tasks 2c and 2d was the wrong default. Build B of Task 2c (`RA2_NO_THAI_HOOK`) ignored the fix entirely, so its 62 fps is the fix-off path, and its A (26.5 fps) was the fix-on path.

**Reverted.** The macro code of both designs was reverted in 585ef08: `thai_font.h` and `thai_font.c` are back to their pre-2c state (byte-identical to ce94c2e), because neither design moved fps. The first attempt added an inline flag check to both macros; the revision made `RECOMP_THAI_ICALL` a copy of pcrecomp's `RECOMP_ICALL` with a trampoline step. The real cost is the Thai metrics code, which Task 2e addresses. What remains of Task 2d is the `--size` and frame count in `web/e2e/profile-game.mjs` (docs/web/testing.md) and the measurements below.

The measurements were taken on the revised build, before the revert: `work/build-web-thai2d` (gamemd, `-O3;--profiling-funcs`, wasm f5875bbff7b8) and `work/build-web-thai2d-ra2` (RA2, `WEB_LINK_OPT=-O1`, a build check, wasm 435dfc8cef9051f1). Since the revert the builds no longer match the code, so the fix-off figures show what build A and the revised build did with the Thai fix off, and the fix-on figures show the default's cost.

Setup. Build A is `work/build-web-prof` (wasm b0fb263feb7d, the code before Task 2d). "Fix off" stores `ra2.thai-font.*` with `enabled: false` in the benchmark profile: `work/perf/task2d/set-thai-off.mjs` (one-off, not committed) writes `ra2.thai-font.{slot-1-ra2md,ra2md,slot-1-ra2,ra2}` with `enabled: false` and the built-in font id. "Fix on" is the default: `work/perf/task2d/set-thai-on.mjs` (one-off) removes those keys. Every run is `perf.mjs --sizes WxH --hd off --moments busy --repeats 1 --seconds 60 --headed --build <dir>`; the wasm SHA-256 is in each run.json.

720p, busy save, HD off (fpsMedian, 1% low, worst gap in ms):

| Build | Thai fix | Run | Median | 1% low | Worst gap |
|---|---|---|---|---|---|
| A | on | A1 | 28 | 16 | 141 |
| A | on | A2 | 23 | 22 | 115 |
| A | on | A3 | 24 | 22 | 82 |
| A | on | A4 | 29 | 25 | 65 |
| revised | on | rev1 | 24 | 22 | 78 |
| revised | on | rev2 | 24 | 21 | 111 |
| A | off | offA1 | 62 | 54 | 60 |
| A | off | offA2 | 62 | 51 | 49 |
| revised | off | offrev1 | 62 | 56 | 46 |
| revised | off | offrev2 | 62 | 57 | 70 |

Means (A on is the mean of four runs: 28, 23, 24, 29): A on 26.0 (1% low 21.3), revised on 24.0 (21.5), A off 62.0 (52.5), revised off 62.0 (56.5). With the fix off the revised build is no faster than A.

Revised build, fix off, the other sizes (two runs each):

| Size | Median | 1% low | Worst gap |
|---|---|---|---|
| 1920x1080 | 49, 50 | 29, 35 | 91, 62 |
| 2560x1440 | 33, 33 | 26, 26 | 70, 81 |

Headroom (`profile-game.mjs`, fix off, revised build, 10 s settle then the sample, with the profiler attached). Frames are the fps events' frames (`window.seconds` is the measured window):

| Run | Size | Frames | Fps events | Sum of per-second readings | Window | Busy ms | Work per frame | Median |
|---|---|---|---|---|---|---|---|---|
| fixround-off-profile-rev-1440 | 2560x1440 | 801 | 20 | 801 | 20.67 s | 17,225 | **21.5 ms** | 41 |
| fixround-off-profile-rev-720 | 1280x720 | 807 | 20 | 807 | 20.73 s | 16,913 | 21.0 ms | 41 |

The frames equal the sum of the per-second readings in both runs. The earlier headroom numbers used a state-counting method that double-counts (each store update makes a new state carrying the last fps), and they are superseded (`superseded-old-count`): 1440p counted 889 frames against a per-second sum of 806 (reported 20.7 ms a frame; 22.9 by the sum); 720p counted 1,272 against 1,210 (reported 12.5 ms; 13.1 by the sum), median 62. The 720p re-run's median of 41, with per-second values from 22 to 63, does not match the earlier fix-off 720 profile's 62 throughout. The cause is not explained (same build and preference, a different run); treat the 720p headroom as unsettled.

Fix on, first attempt at 720p: `recomp_thai_call` took 51.5% of self time (`superseded-first-attempt`), the wrapper running with the fix on.

Headroom window. The 1440p headroom sample is 10 s of settle and then 20.7 s at 41 fps. The 60 s perf.mjs runs at the same size (30 s untouched, then 30 s of panning) read 33 fps: the profile has no panning, so the two are not the same sample.

Thai-on check (default, fix on, revised builds): the game opens from the profile, runs, and shows the main menu with a lit picture. Yuri's Revenge (`work/build-web-thai2d`, -O3) at 800x600, 1,894 of 4,948 sampled pixels lit (`work/perf/task2d/thai-on-yr.log`). Red Alert 2 (`work/build-web-thai2d-ra2`, a -O1 build) with `edition=ra2` at 800x600, title "Red Alert 2", 3,823 lit (`thai-on-ra2.log`). No console errors in either. The fix-on busy runs (rev1, rev2) loaded the save and drew at 720p. Not run: `node e2e/smoke.mjs`. Its page loads `../game` through the dev server's memory copy and crashed at `ra2.mix (26 of 36)` with `unwind` (`work/perf/task2d/smoke-yr.log`), which `perf-nav.mjs` documents for Yuri's Revenge (768 MB limit). The profile-based menu check is the equivalent that was run; the RA2 smoke in its documented form was not run for the same reason.

Decision needed. With the default on, the busy save runs at 24 fps; with it off, 62 (both builds). Task 2d's code change does not speed up the off path (build A is already at 62 there), and the trampoline did not help the fix-on path. The 35 fps is the cost of the Thai fix, which the web app turns on by default. Either the default becomes off (a product decision: `DEFAULT_THAI_FONT_PREFERENCE.enabled`), or the fix-on path has to become fast. The first should be decided before the fix-on path is tuned.

Run accounting (all under `work/perf/task2d/` unless noted):
- Kept, valid (revised build before the revert, or build A): `A1`–`A4` (build A, fix on), `rev1`, `rev2` (revised, fix on), `offA1`, `offA2`, `offrev1`, `offrev2` (fix off, 720p), `offrev-1920x1080-1/2`, `offrev-2560x1440-1/2` (revised, fix off), `fixround-*` (`work/perf/fixround-off-profile-rev-*.json`, the new count), `thai-on-yr.log`, `thai-on-ra2.log`, `smoke-yr.log`.
- Superseded, first attempt (inline flag check, wasm 0af3b98e8ca0): `superseded-first-attempt/` (`2d1`, `2d2` at 720p, `2d-2560x1440-1/2` at 1440p, `profile-2d-720.json/log`, `profile-2d-1440.log`), and `work/perf/superseded-first-attempt/` (`profile-2d-720.cpuprofile`, `profile-2d-1440.json/.cpuprofile`).
- Superseded, old count: `superseded-old-count/` (`off-profile-rev-720.log`, `off-profile-rev-1440.log`) and `work/perf/superseded-old-count/`.
- Deleted, not in the record: the first attempt's `2d-1920x1080-1` (exit 0) and `2d-1920x1080-2` (exit 1). I deleted both folders and logs during the cancellation before reading them. The exit-1 run's cause is not recorded; it may have been killed by the `pkill` I ran then, which I did not verify.

### Task 2e: the Thai fix's cost

**Status: DONE, pass bar not met.**

**What changed.** `create_state` rejected the busy save's font on every text call, so the fix's metrics never ran, and each call cloned and scanned the font first (1.67 MB and 34,151 glyphs, about 90 times a second). Now a rejected font is cached by its header values together with the check that failed (the first failing check, with its glyph or code index). A later call re-checks that one condition (one glyph record, or a fixed set of map entries) and returns NULL if it still fails. An allocation failure is never cached. `src/runtime/thai_font.c`, commit 4303eaf (round 0) and the fix-round commit.

**What the fix does not do.** The Thai fix is inactive for the busy save's font (the rejection is one glyph of width 207, and the game's font is not the staged `game.fnt`). So the picture check and the fix-on rows exercise only the rejection path. The accepted-font apply and restore cost (O(glyphs) per text call) is unchanged and unmeasured: no run here has an accepted font.

**Step 1: counts (fix on, busy save, 1280x720; `work/perf/task2e/count-*.log`).** Scratch `-O1` counting build, instrumentation in `work/perf/task2e/count-instrumentation.diff` (not committed), 20 s after the load, the app default. Before the cache: 54 to 114 text entries a second (`THAI_TEXT_VA`), 0 layout entries, 486 to 1020 render entries a second, 0 `apply_metrics`, 0 `restore_metrics`, and about 90 `create_state` calls a second, every one rejected. The rejected font: count 34151, stride 49, height 16, data at 0x067d9530; glyph 29996 has width 207. Every text entry has spacing 1 (`hist[1]`), read from `font+0x2c`. With the round-0 cache: one `create_state` attempt for the whole session (menu and busy-save load), then cache hits. The page's `/game/game.fnt` is the staged built-in font (29,796 glyphs, no over-wide records). The menu and the busy save reject the same single font; no Red Alert 2 count was run (its full build takes about an hour).

**Step 2: the picture check (`web/e2e/thai-shots.mjs`).** Reference A (`work/build-web-prof`, wasm b0fb263feb7d). The check is of 1280x960 page captures (the page, not only the 800x600 game shell), so the mask fractions are of the page.
- Masks: `menu.png`, the radar screen (40,60)-(1000,900) and the bar-graph monitor (1040,40)-(1240,200), together 840,562 of 1,228,800 pixels (68.4% of the page). The menu check compares only the buttons and frame. `busy-menu.png`: the stats overlay (0,0)-(260,90), 23,751 pixels (1.9%). `skirmish.png`: no mask.
- A vs A2 (second run of A): zero differing pixels with the masks (unmasked: 185,847 pixels in `menu.png`, 88 in `busy-menu.png`).
- A vs 2e, round 0 (wasm 0c570ddbf3ff): zero with the masks. A vs 2e, fix round 1 (wasm 42d918d29ad8): zero with the masks (`work/perf/task2e/fix1/shots-AvsE-fix1.log`).

**Step 4: measurements.** `perf.mjs --build <dir> --sizes WxH --hd off --moments busy --repeats 1 --seconds 60 --headed`, busy save, 1280x720 unless noted. Each case records `thaiFix`: the game's `[thaifont]` line when printed; `off: no [thaifont] line (launched with --thai-fix off)` when declared off and no line; otherwise `unknown`. Round 0 runs were declared by the stored preference only (their records read `off: no [thaifont] line`).

| Round | Run | Build (wasm) | Fix | Median fps | 1% low | Worst gap (ms) | Thai flag |
|---|---|---|---|---|---|---|---|
| 0 | 720-A-on-1 | A (b0fb263feb7d) | on | 26 | 12 | 184 | on |
| 0 | 720-A-on-2 | A | on | 29 | 21 | 69 | on |
| 0 | 720-2e-on-1 | 2e (0c570ddbf3ff) | on | 61 | 55 | 44 | on |
| 0 | 720-2e-on-2 | 2e | on | 59 | 42 | 50 | on |
| 0 | 720-2e-off-1 | 2e | off | 61 | 39 | 44 | off |
| 0 | 720-2e-off-2 | 2e | off | 61 | 40 | 132 | off |
| 0 | 1080-2e-on-1 | 2e | on, 1080p | 49 | 42 | 54 | on |
| 0 | 1080-2e-off-1 | 2e | off, 1080p | 50 | 42 | 56 | off |
| 0 | 1440-2e-on-1 | 2e | on, 1440p | 34 | 26 | 85 | on |
| 0 | 1440-2e-off-1 | 2e | off, 1440p | 31 | 25 | 85 | off |
| 1 | 720-2e-on-a | 2e (42d918d29ad8) | on | 61 | 54 | 60 | on |
| 1 | 720-2e-on-b | 2e (42d918d29ad8) | on | 61 | 55 | 84 | on |
| 1 | 720-A-on-a | A (b0fb263feb7d) | on | 23 | 21 | 96 | on |

Fix round 1 also tried A (fix on, second run), A (fix off) and 2e (fix off). All three ended with `timed out waiting for the main menu`: the game stopped at its copy step (35 of 36 files) with `cannot map /game/gamemd.exe`. Four launches before them had worked. The cause is not identified; the failed runs are kept as `work/perf/task2e/fix1/superseded-failed-launch-*`. So the fix-off pair that would settle the 1% low question was not measured.

**Against the pass bar** (median ≥ 60, 1% low ≥ 55, worst gap ≤ 33 ms): 720p fix on, 2e medians 61, 61, 61, 59 (the 59 run has 1% low 42); its 1% lows are 55, 55, 54, 42. No run meets the 33 ms worst gap. 1080p and 1440p miss the median bar with the fix on and off alike (CPU-bound).

**The 1% low question.** Task 2d's build A with the fix off: 62 and 62 median, 1% low 54 and 51. Round 0's 2e with the fix off: 61 and 61, 1% low 39 and 40. The two builds' CMake caches are the same configuration: `WEB_LINK_OPT=-O3;--profiling-funcs`, `RA2_TARGET=gamemd`, empty `CMAKE_C_FLAGS`, `CMAKE_C_FLAGS_RELEASE=-O3 -DNDEBUG`, the same PCRECOMP and toolchain file. Only the paths, and how the toolchain file is written, differ. So the difference is not a configuration difference that I could find. Whether it is noise or real is unresolved: the fix-off pair did not run.

**Concerns.**
- The fix is inactive for the busy save's font, so the fix-on numbers measure the rejection path only (see above).
- The game stopped loading in three of six perf launches in fix round 1, with a cause not identified; the fix-off pair and a second build A fix-on run are not measured.
- The rejected font is not the staged `game.fnt`; the game loads it from elsewhere.
- The cache keys on header values plus one checked condition; a font whose header is unchanged but whose content changes elsewhere is re-checked only at that condition.
- A full cache (64 fonts) falls back to the early width scan each call.
- `perf.mjs --out` is repo-relative (`--out ../x` lands outside the repo); the first round-0 run was written outside and moved in.
- The native MSVC compile of `thai_font.c` at `/W4` (`cl`, native build flags) exits 0 with no warnings. The RA2-define compile exits 0 with two warnings in code that predates this change (`read8`/`write8` unused).
