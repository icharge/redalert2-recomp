#!/bin/sh
# Web/Wasm: --mode prod|fast|all --edition ra2|ra2md|both. See docs/web/toolchain.md.
set -e
cd "$(dirname "$0")"
PYTHON=${PYTHON:-python3}
for arg in "$@"; do
  case "$arg" in
    --help|-h|--dry-run) exec "$PYTHON" -B tools/build_web.py "$@" ;;
  esac
done
if ! command -v emcc >/dev/null 2>&1; then
  EMSDK=${EMSDK:-$(cd .. && pwd)/emsdk}
  [ -f "$EMSDK/emsdk_env.sh" ] || { echo "no emcc, and no emsdk at $EMSDK (docs/web/toolchain.md)" >&2; exit 1; }
  EMSDK_QUIET=1 . "$EMSDK/emsdk_env.sh"
fi
have=$(emcc --version | sed -n '1s/.* \([0-9][0-9.]*\) (.*/\1/p')
[ "$have" = "6.0.12" ] || echo "note: Emscripten $have; this was built with 6.0.12" >&2
exec "$PYTHON" -B tools/build_web.py "$@"
