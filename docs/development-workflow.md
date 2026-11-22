# Development outputs and findings

The task that creates an output owns its lifecycle. Finishing work includes
organizing what was learned and removing that task's disposable files.
The user should not have to identify leftovers or run cleanup after each task.

## Before generating files

Read the current Git status and check for existing builds and worktrees.
Choose where outputs belong before running the command. Reuse an existing
compatible build or test fixture when it is idle; do not create another full
build, game copy or browser import just to give a task its own folder name.
The standard edition/mode folders listed below are approved, created only
when needed. Ask the user before creating any other build folder. If the reusable
build is busy, ask whether to wait or create a separate build; do not make
that choice on the user's behalf.
Do not modify or delete outputs another active task is using.

| Kind | Location and lifecycle |
|---|---|
| Reusable build | One Web/Wasm cache per needed edition/mode: `build/ra2/`, `build/ra2md/`, `build/ra2-fast/` or `build/ra2md-fast/`. Keep for incremental builds. |
| Published game modules | `web/public/game/`: the latest complete runnable bundle for each built edition. |
| Shared inputs and expensive analysis | `game/`, `work/functions.json`, `work/rtti*`, `work/game/`, and `src/recomp/gen*`. Preserve; rebuild only when the inputs require it. |
| Persistent browser fixture | Reuse `web/e2e/lib.mjs`'s `sharedProfile`, or the existing profile required by a benchmark. Preserve its imported game, saves and settings. |
| Task scratch | `work/tasks/<task>/`. Remove when the task ends, after recording useful results. |
| Findings | Update the existing document for that topic; see the destinations below. Keep the explanation and reproduction steps, not a directory of dumps. |

For a command or test, prefer a context-managed temporary directory and
cleanup in `finally`, including failure paths. For work spanning several
commands, use one task scratch directory. Avoid loose root logs, timestamped
build backups and separate output folders for every attempt. When a tool
needs an explicit output path, point it into the task directory.

Do not turn all of `work/` into disposable scratch: it also holds expensive
analysis and persistent fixtures. Existing paths outside this convention
are not permission to remove them.

## Builds

This workflow builds only the web/Wasm target. Organize reusable builds by
edition and mode, not by task, feature, date or attempt:

| Edition | Production cache | Fast cache | CMake target |
|---|---|---|---|
| Red Alert 2 | `build/ra2/` | `build/ra2-fast/` | `RA2_TARGET=game` |
| Yuri's Revenge | `build/ra2md/` | `build/ra2md-fast/` | `RA2_TARGET=gamemd` |

Each edition folder is the CMake build directory itself; do not add
`windows/`, `linux/` or `web/` subfolders. Other supported editions follow
the same `build/<edition>/` and `build/<edition>-fast/` convention.

Both modes use `CMAKE_BUILD_TYPE=Release`. Production leaves
`WEB_LINK_OPT` empty (`-DWEB_LINK_OPT=`), using the release `-O3` link and
Wasm optimization pass. Fast uses `-DWEB_LINK_OPT=-O1` to skip the expensive
pass for iteration; generated C still defaults to `GEN_OPT=-O2` in both.
This is a Wasm link setting; the page's `pnpm build:prod` is a separate
frontend build.

The user has approved separate production and fast caches. Create only the
edition/mode actually needed, and reuse it for every feature. Do not build
all four just because the layout allows them. If the required mode already
has a compatible idle legacy cache, reuse it during the transition rather
than creating a duplicate. Explicitly clear a cached `WEB_LINK_OPT` when
configuring production; omitting the option leaves its old value in place. See
[the toolchain](web/toolchain.md) for build options.

Use `build-web.cmd --mode prod|fast|all --edition ra2|ra2md|both` on Windows,
or `./build-web.sh` with the same options on Unix. The choices separated
by `|` are alternatives, not literal shell syntax. The default is both
production editions. `--mode all` finishes with production published.
See [build commands](web/toolchain.md#build-commands) for runnable examples,
additional CMake settings and `--dry-run`.

After every successful build, publish all files needed to run that edition
to `web/public/game/`, with `WEB_OUT` set to that directory's absolute
path. Use the existing CMake post-build steps: copy the edition's `.js`,
`.wasm` and `.data`, generate `.wasm.br` and `.wasm.gz`, publish its required
`runtime/<edition>/` executable, `Blowfish.dll` and `runtime.json`, then
merge its entry into `build.json` while preserving the other edition.
Keep required compiler-emitted sidecars with the bundle if build options
introduce them. A build is ready for the page only after publication
succeeds. Keep compiler/linker outputs in the reusable cache so the next
incremental build does not relink simply because its outputs were moved.
Do not create an extra `published/` copy or a private module folder for
ordinary iteration. Fast builds publish to this same destination.

Check the existing CMake configuration and whether the directory is in use
before reusing or reconfiguring it. Two tasks must not build into the same
directory concurrently. Build only the edition needed for the change.
Compare the source directory, toolchain, edition, compile/link flags,
runtime path and publication path before reuse. A matching folder name
does not establish compatibility. Another worktree's cache may refer to
different sources; inspect it rather than pointing a new checkout at it.

If the reusable cache is busy, tell the user which build is running and
ask whether to wait or create a separate build. Continue independent work
while awaiting the answer. Do not automatically wait, reconfigure a busy
cache, stop another task's build, or create a fallback folder.

An incompatible comparison or concurrent task may justify an exception
such as `build/ra2md-feature-a/`. Before creating it, explain the
reason, proposed path, expected disk cost and cleanup point, and obtain
the user's approval. This also applies to builds hidden under task
scratch or a new worktree. A failed build is not permission to start a
fresh folder. Publication still targets `web/public/game/` unless the user
approves an isolated comparison destination. Coordinate builds of the same
edition so they do not publish over each other. Remove the exception after
recording useful results and checking that
no task still uses it. Retain configuration, revision, hashes and
reproduction commands instead of a full build as evidence.

### Existing-folder transition

The web build wrappers now default to the edition/mode layout. Older
procedures still name paths such as `build-web/` and `build-web-game/`;
they do not authorize creating more root build folders. Reuse a compatible
idle legacy cache with `--build-dir` and one explicit edition/mode rather
than creating a duplicate solely to match the new layout. The web
conformance runner prefers the selected module in `web/public/game/` and
retains legacy fallback paths.
The previously proposed shared fast cache, host subfolders and private
publication paths are superseded by this web-only edition-based policy.

Inventory existing caches and their consumers before consolidating them.
Do not move CMake cache directories: they contain absolute paths. Record
the configuration, update the web build/test paths together,
and arrange any required regeneration and retirement of old builds with
the user first. Check ownership, active processes, saves, profiles and
untracked files before deleting an older directory. This policy update
does not itself migrate or authorize deletion of existing artifacts.

Do not create a new worktree solely as a place to store outputs. When
isolation is needed, track the worktree as part of the task. Once its work
has been integrated and no task uses it, remove it through Git after
checking for uncommitted and untracked work; do not force removal to hide
unfinished changes.

### Build-folder review: outstanding gaps

Local inspection on 2026-11-11, in the dirty working tree based on
`292930fa`, found the following gaps. These are recommendations; this
review did not reconfigure, move or delete existing builds.

1. **Generated files can enter Git.** `git ls-files --others
   --exclude-standard -- build-web-live build-web-ra2live` lists `.wasm`
   and `.data` files. `.gitignore` covers the standard builds and several
   older private builds, but misses these two. Cover the existing folders
   and add a deterministic staged-file check for generated build outputs;
   new builds belong under ignored `build/`, following the edition layout
   and approval rules above.
2. **Publication already has a reusable implementation.** CMake's
   post-build steps publish the module trio, compressed Wasm, runtime
   bundle and merged manifest to `web/public/game/`. Use that destination
   for fast and release builds, as requested by the user. The earlier
   recommendation to reject fast publication there is superseded. The
   manifest lock does not coordinate two builds of the same edition;
   wrapper commands add an edition lock and check Ninja activity markers.
   Direct process inspection is still required for builds outside them.
3. **The edition/mode command is implemented.** `build-web.cmd` and
   `build-web.sh` use `tools/build_web.py` to select the standard caches,
   stop on a busy edition and publish even an up-to-date selected cache.
   Older instructions in `docs/web/testing.md`, `docs/wol/handoff-wolapi.md`
   and `docs/web/handoff-zerocopy.md` still demonstrate separate root builds
   or private publication paths. Migrate the entry points and current
   procedures together, using `web/public/game/`. Preserve special WOL
   memory settings when reusing those caches; the standard command refuses
   to overwrite custom link settings. An additional incompatible cache
   requires user approval.
4. **Cleanup does not implement task ownership.** `cleanup.cmd` hardcodes
   older build names, omits the edition layout and `work/tasks/`, and
   offers group deletion of `work/tests-pcx-*`, which may contain profiles
   or evidence. Prefer a dry-run inventory of task-owned outputs with
   resolved-path and junction checks, retention metadata and active-use
   checks before deletion. Shared incremental builds remain preserved.

Validation used Git status/worktree inventory, local CMake caches, build
wrappers, `.gitignore`, the cleanup script, and current build instructions.
At the initial inspection, the pre-commit hook and web CI ran frontend
checks without checking build-folder placement or publication.
The initial inspection ran no builds or tests; it does not establish
artifact freshness or ownership. Command validation now covers all four
edition/mode selections, busy/failing builds, cache compatibility,
Windows argument handling and cached production/fast publication with a
small synthetic CMake/Node fixture. These checks are wired into the web CI
workflow. No full game builds ran. Older folders require a separate
ownership audit.

Command verification passed all 128 Python tests with
`python -B -m unittest discover -s tools -p 'test_*.py'`, both tests in
`node --test tools/test_compress_wasm.mjs`, launcher help/dry runs and shell
syntax validation. The Python suite emits existing lifter file-handle
ResourceWarnings. Temporary synthetic fixtures are removed
by their context managers. The broader `pnpm test` run reported 843 passes
and four failures outside the command changes, reproduced in a focused run:

- `cursor-preferences.test.ts`: cursor choice keeps the launcher's choice
  per installation (`page` returned where the test expects `game`).
- `changelog.test.ts`: newestRelease reads the browser build's own
  changelog, at package.json's version (four entries; expects more than ten).
- `SettingsScreen.test.tsx`: stores the software-cursor choice for the next
  launch (missing Cursor radiogroup).
- `SettingsScreen.test.tsx`: hints are tooltips (missing cursor tooltip).

Frontend source files were not changed by the build-command task. These
failures do not establish a failure of Wasm configuration or publication;
they remain unresolved. Full game compilation and browser play were not
part of command verification.

## Organize findings as they become useful

Search for the topic's existing document before creating another status or
handoff file. Update that document with the current conclusion instead of
accumulating dated copies of the same finding.

| Finding | Destination |
|---|---|
| Identified function | `names/gamemd.json` or `names/game.json`, following [the evidence rules](reverse-engineering.md). |
| Bring-up failure and fix | The relevant section in `docs/bringup.md`. |
| Browser behavior, architecture or build constraint | The existing topic linked from [the browser docs index](web/README.md). |
| Reusable command or procedure | The existing toolchain or testing guide beside related commands. |
| Unresolved investigation | The topic's existing issue, plan or handoff: current hypothesis, evidence, next discriminating check, and any retained local artifact. |

A useful finding states the symptom or question, conclusion, evidence,
affected edition and source revision/configuration, reproduction command,
and limitations. Distinguish observations from hypotheses. Summarize long
logs, profiles and failed attempts once their relevant facts are extracted.
Keep only screenshots or small authored fixtures that materially explain
the result. Follow [CONTRIBUTING.md](../CONTRIBUTING.md): generated game
code, retail files and binary-analysis dumps remain local.

If a new topic needs a new document, link it from the relevant index.
Create a separate handoff only when unfinished work needs one, and link it
to the topic document so the next agent can find the current state.

## Finish the task

1. Put useful findings in their destination and record meaningful validation.
2. Stop the task's own temporary servers and processes, then remove its
   scratch builds, duplicate published modules, recordings, dumps and logs.
   Remove generated distributions created only for a one-off check once no
   server or follow-up step needs them. Preserve shared incremental builds.
3. If an unresolved problem genuinely requires a retained artifact, keep the
   smallest reproducer under `work/tasks/<task>/` and add a `README.md` there
   with its purpose, approximate size, owning issue/document, and the event
   after which it can be removed. Link it from the investigation document.
   Retention for a future task must be explicit, not an unexplained folder.
4. Check the final Git status and the outputs created during this task.
   Report any substantial retained task artifacts with path, size and reason.
   Do not claim the workspace is clean if interrupted cleanup left files.

Deletion applies to artifacts created by the current task. Verify resolved
paths stay within that task's intended directory; do not follow junctions
into shared data. Older artifacts, user files, other worktrees, saves and
browser storage require their own inspection and are not a task cleanup
shortcut. A forced termination may bypass `finally`; inspect a resumed
task's scratch directory before generating another set of outputs.
