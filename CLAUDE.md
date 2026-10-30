- Docs index: docs/web/README.md (browser port), docs/testing.md (native playtests).
- The host runtime (win32hle: dsound.c, ddraw.c, user32.c…) is the sibling repo ../pcrecomp.
  Only the web and Linux builds compile it; build.cmd (Windows) uses native32 and real DirectX.
  A change there is its own commit in that repo, and this repo won't link without it.
- Iterating on C in the web build: use a separate BUILD_DIR with -DWEB_LINK_OPT=-O1 (links in
  seconds, not ~10 min) and -DWEB_OUT set outside web/public/game, or the fast wasm replaces the
  one the page serves. See docs/web/toolchain.md. Rebuild without it for release.
  A web build compiles both editions by default; set RA2_TARGET=gamemd (or game) to build one.
- Running the wasm under Node: docs/web/testing.md, "The game without a browser".
  getenv doesn't see the shell's environment there; pass --env NAME=VALUE.
