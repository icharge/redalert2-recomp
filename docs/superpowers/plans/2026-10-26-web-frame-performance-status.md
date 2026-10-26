# Browser frame performance: execution status

Updated every turn. Plan: [2026-10-26-web-frame-performance.md](2026-10-26-web-frame-performance.md).
Spec: [../specs/2026-10-26-web-frame-performance-design.md](../specs/2026-10-26-web-frame-performance-design.md).
Run: subagent-driven, Haiku implementers and reviewers; fix rounds 4–5 and the final review on Sonnet.
Detailed ledger (rulings, review findings): `.superpowers/sdd/2026-10-26-web-frame-performance/progress.md` (not in git).

## Where it stands (26 October 2026)

| Task | State | Commits |
|---|---|---|
| 1. Benchmark and baseline | **done**, review clean after 5 fix rounds | aa8bb15..1981765 |
| 2. Probes: wait precision, clock calls | **fix round 1** (review: commit the clock-probe script, 6 small fixes). M = 16 ms; no clock spin | d288344, 47ab13b |
| 2b. Profile the busy game, HD off (new) | pending, next after Task 2 | |
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

## To resume after an interruption

1. `git log --oneline 1981765..HEAD` shows what landed since Task 1.
2. Task 2 is committed (d288344, 47ab13b); if no "Task 2: complete" line is in the ledger, re-run its review from `review-1981765..47ab13b.diff`. Otherwise resume at the first task without a complete line.
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

- The OPFS profile's RA2MD.INI gains a repeated `[Video]` section per run (a loader INI-rewrite bug).
- `?dev=1` / `?test=1` game folders copy the whole install into wasm memory and crash at the 768 MiB cap.

## Probe results (Task 2)

- Worker waits: p99 lateness 7–15 ms at every target from 1 to 16 ms, so the wait margin stays M = 16 ms (today's value). Task 8 may have little to change.
- Clock calls per second: main menu about 59,000 high-precision clock reads and 93 Sleeps; in a match about 2,000 timeGetTime, 700 clock reads and 667 Sleeps.
- No spin: every second had 91+ Sleep calls, so Task 9 is skipped.

## Ideas raised during the run (separate projects)

- HD vehicles flicker when on (reported by the user): fix in the HD project.
- HD buildings and infantry (SHP sprites, not voxels): either a pixel-art scaler in the shader, or pre-upscaled 2x sprites recorded like the HD voxels. Task 5's 2x layer + mask design leaves room for it. To design after this plan.
