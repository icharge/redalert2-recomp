# The browser host (src/web, on pcrecomp's runtime/win32hle): the lifted C
# compiled to WebAssembly by Emscripten. A wrapper over emsdk's own toolchain
# file, which it finds through $EMSDK, else a sibling emsdk checkout.
#
#   cmake -S . -B build-web -G Ninja -DCMAKE_TOOLCHAIN_FILE=cmake/emscripten.cmake
#
# build-web.sh and build-web.cmd do this; docs/web/toolchain.md says why each
# flag is here.
if(DEFINED ENV{EMSDK})
  set(_emsdk "$ENV{EMSDK}")
else()
  get_filename_component(_emsdk "${CMAKE_CURRENT_LIST_DIR}/../../emsdk" ABSOLUTE)
endif()
set(_platform "${_emsdk}/upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake")
if(NOT EXISTS "${_platform}")
  message(FATAL_ERROR "no Emscripten at ${_emsdk}: install emsdk (docs/web/toolchain.md) and set EMSDK, or put it beside this checkout")
endif()
include("${_platform}")
