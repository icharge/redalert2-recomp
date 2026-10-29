# Browser frame performance: execution status

Updated every turn. Plan: [2026-10-26-web-frame-performance.md](2026-10-26-web-frame-performance.md).
Spec: [../specs/2026-10-26-web-frame-performance-design.md](../specs/2026-10-26-web-frame-performance-design.md).
Run: subagent-driven, Haiku implementers and reviewers; fix rounds 4–5 and the final review on Sonnet.
Detailed ledger (rulings, review findings): `.superpowers/sdd/2026-10-26-web-frame-performance/progress.md` (not in git).

## Where it stands (29 October 2026)

| Task | State | Commits |
|---|---|---|
| 1. Benchmark and baseline | **done**, review clean after 5 fix rounds | aa8bb15..1981765 |
| 2. Probes: wait precision, clock calls | **done**, review clean after 1 fix round. M = 16 ms; no clock spin | d288344, 47ab13b, dba7145, ebee1fa |
| 2b. Profile the busy game, HD off (new) | **done**, review clean after 1 fix round | 5fccff2, 006fcef |
| 2c. Test the Thai-font wrapper's cost (new) | **done**, review clean after 2 fix rounds. Busy 720p HD off: 26.5 fps with the wrapper, **62** (1% low 55–56, the speed-5 cap) without; work per frame 34 ms vs 12–13 ms | 483d5d7, 5887904, 95ed1b2 |
| 2d. Thai-off path as a plain call | **done** (review clean after 1 fix round); its macro changes were reverted (585ef08): they didn't matter. It found the real cause: **the app turns the Thai font fix on by default**; with it off the busy save already runs at 62 fps (720p). Fix off: 1080p 49–50, 1440p 33 | 533d330, 585ef08, 4c6da57 |
| 2e. The Thai fix without full-font rewrites (new) | **done** (review clean after 1 fix round; one measurement question parked). Rejected fonts are remembered, with the reason re-checked on each use; screenshots identical to the old build. Busy, HD off, Thai on (the default): 720p **61 fps** (1% low 54–55) vs 23–29 before; 1080p 49, 1440p 34. The Thai shaping itself stays inactive for this font | 30f984d, 4303eaf, cb64513 |
| 2f. Profile the busy game at 1440p and 720p (new) | **done** (review clean after 2 fix rounds). Game work a frame: 720p 13.0 ms, 1440p 22.7 ms (60 fps allows 16.7). Of the 9.7 ms rise: the game's sprite/tile drawing about 3.7 ms, the presenter about 1.5 ms (1.9 ms in all at 1440p), at least 3.1 ms other game functions. **So Tasks 3/4/6 can save at most about 2 ms at 1440p** | 9787c04, 22ac9c1, a1624f5 |
| 3. Raw publish, three buffers, protocol 8 | **done**, scoped review clean after a third fix: the sequence is odd before pixel writes, and page readers check it again after copying. Both editions build; web tests pass | f438c6c, ba1014f, 9fb8554, 2941553 |
| 4. WebGL2 presenter, HD off | **implemented**; live pixel suite passes for both editions and both presenters. YR and RA2 menu/movie/skirmish checks report 0 pixel differences; the 2D RGBA comparison now copies rows to avoid racing the shared frame sequence | e59ed78, 92669d2, 6979ceb, 8b0af1c, 521db05 |
| 5. HD layers on the GPU | **deferred** to a later HD project | |
| 6. Scaling modes and bars | **implemented**, scoped review clean; full web suite passed (39 files / 324 tests), typecheck/lint/build passed. The live both-edition/presenter pixel suite passes, with 0 differences in all menu and skirmish captures | df45ca4 |
| 7. Rendering checkpoint | **measured; performance pass bar not met**: HD-off busy medians 57/51/40 fps, worst gaps exceed 33 ms, and menu CPU improved 4.2% against a 40% target. Full live YR/RA2 × WebGL/2D menu and skirmish pixel suite now passes. Named worker profile and 720p main-thread profile are recorded; 1080p/1440p main-thread captures remain under Tasks 10/12 | |
| 8. Sleep margin (pcrecomp) | **skipped**: measured M = 16 ms; wake p99 was 7–15 ms at 1–16 ms targets, so Task 8's condition says no change because waits are not precise enough | |
| 9. Clock damper (if Task 2 finds a spin) | **skipped under Task 2's stated gate**: no second had at least 1,000 clock reads with both `Sleep(n)` and `Sleep(0)` at zero. A later profile found `wait_ms` internally polling `clock_gettime`; Task 9's `QueryPerformanceCounter` shim would not affect that separate wait path | |
| 10. Critical-section futex, mixer, page frame loop | **partial**: the cursor overlay reads are cached at setup/resize, with presenter tests passing. The futex candidate passed its targeted Emscripten tests but failed the two-pair browser keep gate (candidate low FPS 53.5 vs 56.5 control; worst-gap median 114.5 ms vs 66 ms), so its source was reverted. The mixer worker measured 13.3% of one core (3.24% in `mix`); its wake changed from 5 ms to 10 ms and the five-minute audio/skirmish check passed with 0 underruns. The high-uptime FPS deadline sentinel was fixed; current YR profiles emit FPS telemetry. Main-thread captures measured 0.789 ms/task frame at 1080p and 1.067 ms at 1440p, under the 4 ms bar. The current-source RA2 Release link remained idle without an optimizer child after compilation and was stopped without replacing its 27 Oct WASM. The existing RA2 binary still passed live menu/skirmish pixel comparisons (0 differing pixels); current-source RA2 runtime verification remains open | |
| 11. Memory bounds and limits | **done for the planned HD-off checks**: source cache bounds and frame-buffer reclamation are tested. The 1440p HD-off soak with `INITIAL_MEMORY=640MB` completed at 640 MiB peak, zero Wasm growth after 60 s, 2,571,580 bytes JS heap growth, and no seconds without a published picture. The 4K soak peaked at 442.5 MiB with zero post-minute Wasm growth. `INITIAL_MEMORY=640MB` and `MAXIMUM_MEMORY=768MB`; the 1440p zero-growth gate now passes | |
| 12. Final benchmark and docs | **partial**: the current YR busy matrix used the sole retained imported-game profile `work/perf/profile-fresh` at 5173. Median FPS: 720p 62 (1% low 60), 1080p 61 (1% low 44), 1440p 50 (1% low 34), and 4K 38 (1% low 23). Worst frame gaps: 33, 127, 57, and 68 ms respectively. Corrected report logic now applies FPS bars to HD-off busy cases: 720p passes median/1% low; 1080p passes median but misses 1% low; 1440p misses both. Every target size misses the 33 ms worst-gap bar except 720p at 33 ms. 4K is record-only. The 1440p ten-minute soak and memory gate are complete. RA2 menu/skirmish pixels passed with 0 differences using the existing RA2 build; current-source RA2 runtime verification remains open because its release link did not complete. The 5173 profile's regenerable caches were cleared (380,258,388 bytes) while its IndexedDB/OPFS was preserved. An accidental empty profile created by the first RA2 pixel attempt was removed (77,537,983 bytes); no game import occurred. Docs reconciliation and final review remain. Do not create another profile or game import | |
| Final whole-branch review | **reviewed at `1981765`**: spec review found no implementation mismatch or scope creep; standards review found a pre-existing untracked `build-web-probe/` tree against CONTRIBUTING's generated-output rule and a possible duplicated frame-lease smell in the two presenters. The untracked build tree was left untouched. Remaining performance and memory acceptance gates are recorded above | |

## Change of target (26 October)

The user asked to focus on the game with HD off (HD vehicles are experimental and flicker). The pass bar is now 60 fps median, 55 1% low, 720p–1440p, busy, **HD off**, with the app's defaults (the Thai font fix is now off by default, 0bfab6e); HD on is recorded with no target. New Task 2b profiles the busy save first, since it runs at 18–23 fps at every size (the picture isn't the limit). Order: 2b, 2c, 2d, 2e, 2f, 3, 4, 6, 7, 8, 10, 11, 12.

## What limits the busy game (Tasks 2b–2d)

- **The Thai font fix.** The web app turns it on by default. With it on, every text call tries to set up the Thai state for the font, and for the busy save's font that fails (glyph 29996 is 207 pixels wide, over the check's 16; `thai_font.c:223`) after copying 1.67 MB and scanning 34,151 glyphs. That is the 52% of the game thread the profile showed under `recomp_thai_call`. (An earlier note here blamed the width rewrites; Task 2e's counts showed they never run.) So the Thai shaping itself is inactive for this font: a separate question for the user. Busy save, 720p, HD off: 26 fps with the fix on, 62 (the speed-5 cap) with it off. Task 2e removed that cost (the rejection is remembered). Since the shaping never worked for this font, the user asked to turn the fix off by default for now (0bfab6e); players can still turn it on in the launcher's game settings.
- **Bigger screens cost more game work** (Task 2f: the game's own drawing and other game functions; the presenter is the smaller part). With the fix off: 1080p 49–50 fps, 1440p 33 fps; at 1440p the profiling script measured 21.5 ms of game work a frame (60 fps allows 16), but that script's fps differs from the benchmark's, so treat the figure as rough. Profile at 1440p after Task 2e.
- The picture code (presenter) is under 1% of the game thread at 720p; waiting is 16%.
- Separate CPU cost: pcrecomp's `wait_ms` busy-polls the clock on another worker (about 81% of that worker's time in clock reads).
- Earlier wrong turns, for the record: the Thai wrapper call (2c, 2d first try) and the duplicated code at indirect calls (2d revised) were not the cause; the 2c "no wrapper" build was fast only because it skipped the Thai fix entirely.

## To resume after an interruption

1. `git log --oneline 1981765..HEAD` shows what landed since Task 1.
2. Task 6 is committed as `df45ca4`; its ledger row is reconciled. The save-store start-up bug is fixed and checked against the affected Chrome profile. Task 7's 60/55 FPS target remains unmet at 1080p/1440p. Task 8 is skipped under its M = 16 ms rule. Task 9 is skipped because Task 2's gate requires a second with 1,000+ clock reads and both sleep counters at zero, but every observed second had at least 91 `Sleep(n)` calls. The later `wait_ms` `clock_gettime` polling is a separate wait path that Task 9's `QueryPerformanceCounter` shim would not affect. Task 10's futex candidate was rejected and reverted; the 10 ms mixer wake passed the audio gate. Task 11's 1440p zero-growth gate passes after the 640 MiB rebuild. The current YR matrix and 1440p soak are recorded above. The single reusable profile remains at `work/perf/profile-fresh`; do not create another profile/import. RA2 current-source browser checks, cache cleanup, docs reconciliation, and whole-branch review remain. Task 5 remains deferred.
3. Builds for tests go in their own BUILD_DIR with `-DWEB_OUT` outside `web/public/game` (CLAUDE.md); e2e loads them with `--build`. Benchmark profile: `work/perf/profile-fresh`; busy save: `work/perf/busy.sav`; baseline: `work/perf/baseline/run.json`.

## Baseline (Task 1, published Release build ef2b94fc673f9950, headed Chrome)

- Early match, game fps median: 720p 62 (HD off) / 39–62 (HD on); 1080p 62 / 33–36; 1440p 62 / 19–24.
- Busy save: 18–23 fps HD off, 11–17 HD on, at every size: bound by the AIs' game work.
- Idle main menu: about 2.5 CPU cores busy.
- 10-minute soak, 1440p HD on: wasm memory reaches the 768 MiB cap; no picture for 483 of 600 s.
- At the time of the baseline, 4K could not be set in the browser build. Task 11 now accepts 3840x2160, but a 4K run has not yet been measured.

## Decisions taken while running (full list in the ledger)

- Work in this checkout on `web-port`, staging only this plan's hunks (other sessions share the tree).
- Busy save: Team Alliance, human + 6 Brutal AIs vs 1 Easy AI, speed 5; clicks release pointer lock first (the cause of the earlier failures).
- Game speed pinned at 5; the game's resolution set with `ra2_setting(4)` before each skirmish; mismatched sizes fail the case.
- The busy 60 fps bar stays the target; Task 7 profiles whether the gap is the game's own simulation and reports it.

## Found along the way (outside this plan)
- One Thai-on launch of Task 2e's build crashed at 720p (memory access out of bounds in `sub_00407680`, in `LeaveCriticalSection`; `work/perf/task2f/task2f-720-1.log`). Task 2e's other Thai-on runs completed; the fix is off by default now. Watch for it.
- **Start-up stall (app bug, fixed):** the save watcher started before `stageRuntimeBundle` wrote the build's executable and `Blowfish.dll`, so it copied those newly staged files into `/save/slot-1-ra2md`. The next launch restored the stale binaries into `/game` and could stop at "cannot map /game/gamemd.exe". The watcher now starts after runtime staging; save sync skips these binaries; restore removes old copies without reading them into Wasm. A live check of `work/perf/profile-fresh` found `gamemd.exe` (149 MB) and `Blowfish.dll` (36 MB) before launch, reached Yuri's Revenge's menu in about 6 s, and found neither file afterward. The original profile was repaired by this check.
- `perf.mjs` ignored `--build` (it always measured the published game); fixed in Task 2c (5887904).

- The reusable profile's runtime `/game/RA2MD.INI` is 174,053,108 bytes with 11,810,230 lines and 64,854 `[Video]` headers. The OPFS import copy is 2,145 bytes; its saved overlay at `/save/slot-1-ra2md/RA2MD.INI` is 86,991,815 bytes. Two normal menu launches left runtime size and section counts unchanged, so startup alone did not reproduce growth. `kernel32_ext.c`'s `WritePrivateProfileStringA` is append-only, but the path that produced this saved overlay is not yet proven; preserve the profile until that is traced.
- `?dev=1` / `?test=1` game folders copy the whole install into wasm memory and crash at the 768 MiB cap.

## Probe results (Task 2)

- Worker waits: p99 lateness 7–15 ms at every target from 1 to 16 ms, so the wait margin stays M = 16 ms (today's value). Task 8 may have little to change.
- Clock calls per second: main menu about 59,000 high-precision clock reads and 93 Sleeps; in a match about 2,000 timeGetTime, 700 clock reads and 667 Sleeps.
- Task 9's gate was not met: every second had 91+ `Sleep(n)` calls, so no second had 1,000+ clock reads with both sleep counters at zero. This does not rule out internal polling in `wait_ms`, which was identified separately from a worker profile.

## Ideas raised during the run (separate projects)

- **Thai fix off by default for now** (0bfab6e). The Thai font fix rejects the busy save's font (a glyph wider than 16 pixels), so it never shapes Thai text there; and that font is not the `game.fnt` the app stages, so the staging doesn't reach it. Decide whether it should accept such fonts (changes the picture). A session card was proposed for this.

- HD vehicles flicker when on (reported by the user): fix in the HD project.
- HD buildings and infantry (SHP sprites, not voxels): either a pixel-art scaler in the shader, or pre-upscaled 2x sprites recorded like the HD voxels. Task 5's 2x layer + mask design leaves room for it. To design after this plan.
