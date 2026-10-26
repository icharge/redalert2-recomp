# Browser frame performance: execution status

Updated every turn. Plan: [2026-10-26-web-frame-performance.md](2026-10-26-web-frame-performance.md).
Spec: [../specs/2026-10-26-web-frame-performance-design.md](../specs/2026-10-26-web-frame-performance-design.md).
Run: subagent-driven, Haiku implementers and reviewers; fix rounds 4–5 and the final review on Sonnet.
Detailed ledger (rulings, review findings): `.superpowers/sdd/2026-10-26-web-frame-performance/progress.md` (not in git).

## Where it stands (26 October 2026)

| Task | State | Commits |
|---|---|---|
| 1. Benchmark and baseline | **done**, review clean after 5 fix rounds | aa8bb15..1981765 |
| 2. Probes: wait precision, clock calls | **done**, review clean after 1 fix round. M = 16 ms; no clock spin | d288344, 47ab13b, dba7145, ebee1fa |
| 2b. Profile the busy game, HD off (new) | **done**, review clean after 1 fix round | 5fccff2, 006fcef |
| 2c. Test the Thai-font wrapper's cost (new) | **fix round 2 in re-review**. Busy 720p HD off: 26.5 fps with the wrapper, **62** (1% low 55–56, the speed-5 cap) without; game-thread work per frame about 34 ms vs 12–13 ms | 483d5d7, 5887904, 95ed1b2 |
| 2d. Thai-off path as a plain call (the fix) | pending, after 2c; in the plan (1022509) | |
| 3. Raw publish, three buffers, protocol 8 | pending | |
| 4. WebGL2 presenter | pending | |
| 5. HD layers on the GPU | **deferred** to a later HD project | |
| 6. Scaling modes and bars | pending | |
| 7. Rendering checkpoint | pending | |
| 8. Sleep margin (pcrecomp) | pending | |
| 9. Clock damper (if Task 2 finds a spin) | **skipped**: no spin found | |
| 10. Critical-section futex, mixer, page frame loop | pending | |
| 11. Memory bounds and limits | pending | |
| 12. Final benchmark and docs | pending | |
| Final whole-branch review | pending | |

## Change of target (26 October)

The user asked to focus on the game with HD off (HD vehicles are experimental and flicker). The pass bar is now 60 fps median, 55 1% low, 720p–1440p, busy, **HD off**; HD on is recorded with no target. New Task 2b profiles the busy save first, since it runs at 18–23 fps at every size (the picture isn't the limit). Order: 2b, 3, 4, 6, 7, 8, 10, 11, 12.

## Busy profile, HD off (Task 2b)

- The game thread is about 84% busy at 25 fps (about 34 ms of work a frame; 60 fps allows 16).
- The picture code (presenter group) is 0.8% of the game thread; waiting is 16%, which caps what Tasks 8 and 10 can gain there.
- 52% of the samples land in `recomp_thai_call`, the Thai font wrapper around the game's text functions (the Thai fix itself is off). Why is not known yet: the compiled wrapper just calls the original, and the text function shows only about 2 s of the 20 s. (An earlier note here said the compiler had merged the text drawing into the wrapper; the review disproved that.) Task 2c tests it with a build that skips the wrapper: confirmed with the fixed benchmark: 26.5 → 62 fps median, 1% low 21–22 → 55–56 (busy, 720p, HD off). Task 2d makes that the real build.
- Separate CPU cost: pcrecomp's `wait_ms` busy-polls the clock on another worker (about 81% of that worker's time in clock reads), which the clock probe's spin rule missed. A second worker was 42% busy in uncategorised time, not confirmed as clock reads.

## To resume after an interruption

1. `git log --oneline 1981765..HEAD` shows what landed since Task 1.
2. Tasks 2 and 2b are done. If Task 2c has a commit touching `src/runtime/thai_font.h`, it needs its task review; otherwise re-dispatch it from `.superpowers/sdd/2026-10-26-web-frame-performance/task-2c-brief.md`.
3. Builds for tests go in their own BUILD_DIR with `-DWEB_OUT` outside `web/public/game` (CLAUDE.md); e2e loads them with `--build`. Benchmark profile: `work/perf/profile-fresh`; busy save: `work/perf/busy.sav`; baseline: `work/perf/baseline/run.json`.

## Baseline (Task 1, published Release build ef2b94fc673f9950, headed Chrome)

- Early match, game fps median: 720p 62 (HD off) / 39–62 (HD on); 1080p 62 / 33–36; 1440p 62 / 19–24.
- Busy save: 18–23 fps HD off, 11–17 HD on, at every size: bound by the AIs' game work.
- Idle main menu: about 2.5 CPU cores busy.
- 10-minute soak, 1440p HD on: wasm memory reaches the 768 MiB cap; no picture for 483 of 600 s.
- 4K cannot be set in the browser build (settings.c stops at 2560x1440).

## Decisions taken while running (full list in the ledger)

- Work in this checkout on `web-port`, staging only this plan's hunks (other sessions share the tree).
- Busy save: Team Alliance, human + 6 Brutal AIs vs 1 Easy AI, speed 5; clicks release pointer lock first (the cause of the earlier failures).
- Game speed pinned at 5; the game's resolution set with `ra2_setting(4)` before each skirmish; mismatched sizes fail the case.
- The busy 60 fps bar stays the target; Task 7 profiles whether the gap is the game's own simulation and reports it.

## Found along the way (outside this plan)

- `perf.mjs` ignored `--build` (it always measured the published game); fixed in Task 2c (5887904).

- The OPFS profile's RA2MD.INI gains a repeated `[Video]` section per run (a loader INI-rewrite bug).
- `?dev=1` / `?test=1` game folders copy the whole install into wasm memory and crash at the 768 MiB cap.

## Probe results (Task 2)

- Worker waits: p99 lateness 7–15 ms at every target from 1 to 16 ms, so the wait margin stays M = 16 ms (today's value). Task 8 may have little to change.
- Clock calls per second: main menu about 59,000 high-precision clock reads and 93 Sleeps; in a match about 2,000 timeGetTime, 700 clock reads and 667 Sleeps.
- No spin: every second had 91+ Sleep calls, so Task 9 is skipped.

## Ideas raised during the run (separate projects)

- HD vehicles flicker when on (reported by the user): fix in the HD project.
- HD buildings and infantry (SHP sprites, not voxels): either a pixel-art scaler in the shader, or pre-upscaled 2x sprites recorded like the HD voxels. Task 5's 2x layer + mask design leaves room for it. To design after this plan.
