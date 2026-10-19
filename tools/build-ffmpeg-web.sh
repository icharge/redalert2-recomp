#!/bin/sh
# Configure FFmpeg for the browser build: only the Bink video and audio decoders, the Bink demuxer and the
# `file` protocol, no assembly, no network, LGPL. This makes config.h and the codec lists in a build directory
# and tools/ffmpeg-web.mjs turns the Makefiles' object lists into ffmpeg_sources.cmake there;
# the main build (build-web.sh / build-web.cmd, CMakeLists.txt) compiles them, there being no GNU make
# on the Windows machine this is built on.
#
#   tools/build-ffmpeg-web.sh [ffmpeg source dir] [build dir]
#   FFMPEG_SRC=../ffmpeg-src/ffmpeg-7.1.1 FFMPEG_BUILD=../ffmpeg-src/build   (the defaults)
#
# The source is not in the repository: download ffmpeg-7.1.1.tar.xz from https://ffmpeg.org/releases/ and
# unpack it into ../ffmpeg-src. Needs emsdk (EMSDK, else ../emsdk), sh and node. On Windows use
# tools/build-ffmpeg-web.cmd.
set -e
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/.." && pwd)
src=${1:-${FFMPEG_SRC:-$root/../ffmpeg-src/ffmpeg-7.1.1}}
build=${2:-${FFMPEG_BUILD:-$root/../ffmpeg-src/build}}
[ -f "$src/configure" ] || { echo "no FFmpeg source at $src (see the top of $0)" >&2; exit 1; }
if ! command -v emcc >/dev/null 2>&1; then
  EMSDK=${EMSDK:-$root/../emsdk}
  [ -f "$EMSDK/emsdk_env.sh" ] && EMSDK_QUIET=1 . "$EMSDK/emsdk_env.sh"
fi
command -v emcc >/dev/null 2>&1 || { echo "no emcc, and no emsdk (docs/web/toolchain.md)" >&2; exit 1; }
case $(uname -s) in MINGW*|MSYS*) export TMPDIR=/tmp TEMP=/tmp TMP=/tmp ;; esac   # configure runs its tests in $TMPDIR
mkdir -p "$build"
cd "$build"
rm -rf ./*
# -pthread: the game's memory is shared, so every object has to be built for it
"$src/configure" --target-os=none --arch=x86_32 --enable-cross-compile \
  --cc=emcc --cxx=em++ --ar=emar --ranlib=emranlib --nm=emnm --host-cc=emcc \
  --disable-all --disable-asm --disable-autodetect --disable-doc --disable-programs --disable-network \
  --disable-debug --disable-stripping --disable-pthreads --disable-runtime-cpudetect \
  --enable-avcodec --enable-avformat --enable-avutil --enable-swresample \
  --enable-decoder=bink,binkaudio_dct,binkaudio_rdft --enable-demuxer=bink --enable-protocol=file \
  --extra-cflags="-O2 -pthread -msimd128 -fwasm-exceptions" > configure.log 2>&1 \
  || { tail -20 configure.log >&2; echo "configure failed: $build/configure.log" >&2; exit 1; }
node "$here/ffmpeg-web.mjs" "$src" "$build"
echo "FFmpeg is configured in $build: build the game with -DFFMPEG_WEB_DIR=$build"
