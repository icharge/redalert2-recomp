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
| 2c. Test the Thai-font wrapper's cost (new) | **done**, review clean after 2 fix rounds. Busy 720p HD off: 26.5 fps with the wrapper, **62** (1% low 55–56, the speed-5 cap) without; work per frame 34 ms vs 12–13 ms | 483d5d7, 5887904, 95ed1b2 |
| 2d. Thai-off path as a plain call | **done** (review clean after 1 fix round); its macro changes were reverted (585ef08): they didn't matter. It found the real cause: **the app turns the Thai font fix on by default**; with it off the busy save already runs at 62 fps (720p). Fix off: 1080p 49–50, 1440p 33 | 533d330, 585ef08, 4c6da57 |
| 2e. The Thai fix without full-font rewrites (new) | **done** (review clean after 1 fix round; one measurement question parked). Rejected fonts are remembered, with the reason re-checked on each use; screenshots identical to the old build. Busy, HD off, Thai on (the default): 720p **61 fps** (1% low 54–55) vs 23–29 before; 1080p 49, 1440p 34. The Thai shaping itself stays inactive for this font | 30f984d, 4303eaf, cb64513 |
| 2f. Profile the busy game at 1440p (new) | **in review**. Game work a frame: 720p 13.0 ms, 1440p 22.7 ms (60 fps allows 16.7). What grows with size at 1440p: the game's own sprite/tile drawing about 5.4 ms, the presenter about 1.9 ms; the rest is simulation. **So Tasks 3/4/6 can save at most about 2 ms at 1440p.** Also found the start-up stall's cause (below) | 9787c04 |
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

The user asked to focus on the game with HD off (HD vehicles are experimental and flicker). The pass bar is now 60 fps median, 55 1% low, 720p–1440p, busy, **HD off**, with the app's defaults (the Thai font fix is now off by default, 0bfab6e); HD on is recorded with no target. New Task 2b profiles the busy save first, since it runs at 18–23 fps at every size (the picture isn't the limit). Order: 2b, 2c, 2d, 2e, 2f, 3, 4, 6, 7, 8, 10, 11, 12.

## What limits the busy game (Tasks 2b–2d)

- **The Thai font fix.** The web app turns it on by default. With it on, every text call tries to set up the Thai state for the font, and for the busy save's font that fails (glyph 29996 is 207 pixels wide, over the check's 16; `thai_font.c:223`) after copying 1.67 MB and scanning 34,151 glyphs. That is the 52% of the game thread the profile showed under `recomp_thai_call`. (An earlier note here blamed the width rewrites; Task 2e's counts showed they never run.) So the Thai shaping itself is inactive for this font: a separate question for the user. Busy save, 720p, HD off: 26 fps with the fix on, 62 (the speed-5 cap) with it off. Task 2e removed that cost (the rejection is remembered). Since the shaping never worked for this font, the user asked to turn the fix off by default for now (0bfab6e); players can still turn it on in the launcher's game settings.
- **Bigger screens cost more game work** (Task 2f: mostly the game's own drawing, not the presenter). With the fix off: 1080p 49–50 fps, 1440p 33 fps; at 1440p the profiling script measured 21.5 ms of game work a frame (60 fps allows 16), but that script's fps differs from the benchmark's, so treat the figure as rough. Profile at 1440p after Task 2e.
- The picture code (presenter) is under 1% of the game thread at 720p; waiting is 16%.
- Separate CPU cost: pcrecomp's `wait_ms` busy-polls the clock on another worker (about 81% of that worker's time in clock reads).
- Earlier wrong turns, for the record: the Thai wrapper call (2c, 2d first try) and the duplicated code at indirect calls (2d revised) were not the cause; the 2c "no wrapper" build was fast only because it skipped the Thai fix entirely.

## To resume after an interruption

1. `git log --oneline 1981765..HEAD` shows what landed since Task 1.
2. Tasks 2–2e are done; 2f is in review (package `review-6429677..9787c04.diff`). Two decisions are with the user: the direction for 1080p/1440p (the picture tasks can't reach 60 there), and fixing the save-store stall (the benchmark can't launch until it is fixed or the profile is cleaned).
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
- **Start-up stall (app bug):** the game stops at the file copy ("cannot map /game/gamemd.exe", 35 of 36 files). Cause (Task 2f): the OPFS save store `/save/slot-1-ra2md` holds wrong copies of `gamemd.exe` (149 MB) and `Blowfish.dll`, restored over `/game` at launch and re-created each run. The benchmark profile now stalls on every launch. Needs a fix in `web/src/storage/saves.ts` (never save or restore install files) plus a repair for stores that already have them.
- `perf.mjs` ignored `--build` (it always measured the published game); fixed in Task 2c (5887904).

- The OPFS profile's RA2MD.INI gains a repeated `[Video]` section per run (a loader INI-rewrite bug).
- `?dev=1` / `?test=1` game folders copy the whole install into wasm memory and crash at the 768 MiB cap.

## Probe results (Task 2)

- Worker waits: p99 lateness 7–15 ms at every target from 1 to 16 ms, so the wait margin stays M = 16 ms (today's value). Task 8 may have little to change.
- Clock calls per second: main menu about 59,000 high-precision clock reads and 93 Sleeps; in a match about 2,000 timeGetTime, 700 clock reads and 667 Sleeps.
- No spin: every second had 91+ Sleep calls, so Task 9 is skipped.

## Ideas raised during the run (separate projects)

- **Thai fix off by default for now** (0bfab6e). The Thai font fix rejects the busy save's font (a glyph wider than 16 pixels), so it never shapes Thai text there; and that font is not the `game.fnt` the app stages, so the staging doesn't reach it. Decide whether it should accept such fonts (changes the picture). A session card was proposed for this.

- HD vehicles flicker when on (reported by the user): fix in the HD project.
- HD buildings and infantry (SHP sprites, not voxels): either a pixel-art scaler in the shader, or pre-upscaled 2x sprites recorded like the HD voxels. Task 5's 2x layer + mask design leaves room for it. To design after this plan.
