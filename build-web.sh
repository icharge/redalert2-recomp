#!/bin/sh
# Configure and build the browser host: the lifted C on pcrecomp's
# runtime/win32hle, compiled to WebAssembly by Emscripten (src/web,
# cmake/emscripten.cmake, docs/web/toolchain.md).
#
#   ./build-web.sh            # both editions into build-web/: ra2md.* and ra2.*
#   RA2_TARGET=gamemd ./build-web.sh # Yuri's Revenge only
#   RA2_TARGET=game ./build-web.sh   # Red Alert 2 only (build-web-game/)
#   node build-web/ra2md.js --run --game ./game --headless --mute
#
# Needs a lift (run_lift.py), cmake, ninja and emsdk, which it finds through
# $EMSDK, else ../emsdk. On Windows use build-web.cmd.
set -e
cd "$(dirname "$0")"
# The Emscripten this was built and tested with: another one may work, but a
# bug report should say which.
EMSCRIPTEN_VERSION=6.0.12
RA2_TARGET=${RA2_TARGET:-both}
case "$RA2_TARGET" in
  gamemd) BUILD_DIR=${BUILD_DIR:-build-web} ;;
  game) BUILD_DIR=${BUILD_DIR:-build-web-game} ;;
  both) BUILD_DIR=${BUILD_DIR:-build-web} ;;
  *) echo "RA2_TARGET must be gamemd, game or both" >&2; exit 1 ;;
esac
if [ -z "$PCRECOMP" ]; then
  if [ ! -d ../pcrecomp ] && [ -d ../tools/runtime/win32hle ]; then PCRECOMP=$(cd ../tools && pwd)
  else PCRECOMP=$(cd .. && pwd)/pcrecomp; fi
fi
if ! command -v emcc >/dev/null 2>&1; then
  EMSDK=${EMSDK:-$(cd .. && pwd)/emsdk}
  [ -f "$EMSDK/emsdk_env.sh" ] || { echo "no emcc, and no emsdk at $EMSDK (docs/web/toolchain.md)" >&2; exit 1; }
  EMSDK_QUIET=1 . "$EMSDK/emsdk_env.sh"
fi
have=$(emcc --version | sed -n '1s/.* \([0-9][0-9.]*\) (.*/\1/p')
[ "$have" = "$EMSCRIPTEN_VERSION" ] || echo "note: Emscripten $have; this was built with $EMSCRIPTEN_VERSION" >&2
# shellcheck disable=SC2086  # CMAKE_ARGS is a list of flags
cmake -S . -B "$BUILD_DIR" -G Ninja -DCMAKE_TOOLCHAIN_FILE=cmake/emscripten.cmake -DPCRECOMP="$PCRECOMP" -DRA2_TARGET="$RA2_TARGET" $CMAKE_ARGS
cmake --build "$BUILD_DIR" "$@"
