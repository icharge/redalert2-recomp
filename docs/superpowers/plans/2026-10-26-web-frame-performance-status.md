# Browser frame performance: execution status

Updated every turn. Plan: [2026-10-26-web-frame-performance.md](2026-10-26-web-frame-performance.md).
Spec: [../specs/2026-10-26-web-frame-performance-design.md](../specs/2026-10-26-web-frame-performance-design.md).
Run: subagent-driven, Haiku implementers and reviewers; fix rounds 4–5 and the final review on Sonnet.
Detailed ledger (rulings, review findings): `.superpowers/sdd/2026-10-26-web-frame-performance/progress.md` (not in git).

## Where it stands (26 October 2026)

| Task | State | Commits |
|---|---|---|
| 1. Benchmark and baseline | **done**, review clean after 5 fix rounds | aa8bb15..1981765 |
| 2. Probes: wait precision, clock calls | **running**: probe build done; clock probe re-running after a fix to how its script reads game events (Haiku implementer; from 1981765) | — |
| 3. Raw publish, three buffers, protocol 8 | pending | |
| 4. WebGL2 presenter | pending | |
| 5. HD layers on the GPU | pending | |
| 6. Scaling modes and bars | pending | |
| 7. Rendering checkpoint | pending | |
| 8. Sleep margin (pcrecomp) | pending | |
| 9. Clock damper (if Task 2 finds a spin) | pending | |
| 10. Critical-section futex, mixer, page frame loop | pending | |
| 11. Memory bounds and limits | pending | |
| 12. Final benchmark and docs | pending | |
| Final whole-branch review | pending | |

## To resume after an interruption

1. `git log --oneline 1981765..HEAD` shows what landed since Task 1.
2. If Task 2 has a commit "Probe worker wait precision and the game's clock calls" and the plan's "Probe results" section is filled, it needs its task review; otherwise re-dispatch Task 2 from its brief (`.superpowers/sdd/2026-10-26-web-frame-performance/task-2-brief.md`).
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
