- Docs index: docs/web/README.md (browser port), docs/testing.md (native playtests),
  docs/reverse-engineering.md (what an address is: tools/vera_lookup.py, the names/ ledger).
- Game string tables (CSF, label lookup): docs/csf.md, tools/csf_dump.py. The text stays in work/csf/.
- Before generating outputs, read docs/development-workflow.md: reuse builds and fixtures,
  own and remove task scratch, and organize findings in the existing topic docs before finishing.
- Any edit to run_lift.py fails every build until both editions are lifted again
  (cmake/lift_check.cmake hashes it). Check with `run_lift.py --target gamemd --check`.
- The host runtime (win32hle: dsound.c, ddraw.c, user32.c…) is the sibling repo ../pcrecomp.
  Only the web and Linux builds compile it; build.cmd (Windows) uses native32 and real DirectX.
  A change there is its own commit in that repo, and this repo won't link without it.
- Build only the web/Wasm target for this workflow. Reuse the edition's CMake cache
  directly in build/ra2/ or build/ra2md/ for production; the approved fast caches are
  build/ra2-fast/ and build/ra2md-fast/. Create these only when needed; reuse by edition
  and mode (no host subfolders). Ask before creating any other build folder; if busy, ask
  whether to wait or create a separate one. See docs/development-workflow.md for the
  layout, existing-folder transition and cleanup rules.
- Publish every successful build's complete runtime files to web/public/game/;
  WEB_OUT must point there. Use CMAKE_BUILD_TYPE=Release with WEB_LINK_OPT=-O1 in fast
  caches; explicitly clear WEB_LINK_OPT for production (-O3). See docs/web/toolchain.md.
  Use build-web.cmd --mode prod|fast|all --edition ra2|ra2md|both (build-web.sh on Unix).
  The default builds both production editions; all modes finishes by publishing production.
- Running the wasm under Node: docs/web/testing.md, "The game without a browser".
  getenv doesn't see the shell's environment there; pass --env NAME=VALUE.
