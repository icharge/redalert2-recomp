# =============================================================================
# Red Alert 2: Yuri's Revenge - static recompilation host (32-bit, MSVC x86)
#
#   py -3 run_lift.py        # -> src/recomp/gen/  (needs work/functions.json)
#   build.cmd                # vcvarsall x86 + CMake + Ninja -> build/ra2.exe
#   build\ra2.exe --run --watchdog 60
# =============================================================================
cmake_minimum_required(VERSION 3.20)
# The C runtime linked in (/MT): ra2.exe runs on a PC without the x86 Visual
# C++ redistributable (a clean test PC had none, and neither may a player).
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
project(ra2 C)

if(NOT CMAKE_SIZEOF_VOID_P EQUAL 4)
  message(FATAL_ERROR "the host must be 32-bit: use build.cmd (vcvarsall x86), or on Linux build-linux.sh")
endif()
if(NOT CMAKE_BUILD_TYPE)
  # -g on the browser build makes wasm-opt run limited passes and, on this
  # much code, crash: debug info there is -gseparate-dwarf (docs/web/toolchain.md)
  if(EMSCRIPTEN)
    set(CMAKE_BUILD_TYPE Release)
  else()
    set(CMAKE_BUILD_TYPE RelWithDebInfo)
  endif()
endif()

# ../pcrecomp, or ../tools where older setups put it
if(NOT EXISTS "${CMAKE_SOURCE_DIR}/../pcrecomp" AND EXISTS "${CMAKE_SOURCE_DIR}/../tools/runtime")
  set(PCRECOMP "${CMAKE_SOURCE_DIR}/../tools" CACHE PATH "pcrecomp checkout")
else()
  set(PCRECOMP "${CMAKE_SOURCE_DIR}/../pcrecomp" CACHE PATH "pcrecomp checkout")
endif()
# RA2_TARGET: gamemd (Yuri's Revenge, the default) or game (Red Alert 2), the
# lift run_lift.py --target made; build each in its own folder.
set(RA2_TARGET "gamemd" CACHE STRING "gamemd (Yuri's Revenge) or game (Red Alert 2)")
if(RA2_TARGET STREQUAL "game")
  set(GEN_DIR src/recomp/gen_game)
else()
  set(GEN_DIR src/recomp/gen)
endif()
file(GLOB GEN_SOURCES CONFIGURE_DEPENDS "${CMAKE_SOURCE_DIR}/${GEN_DIR}/*.c")
if(NOT GEN_SOURCES)
  message(FATAL_ERROR "${GEN_DIR} is empty -- run ./setup.sh (Setup.cmd on Windows) first: it lifts each game")
endif()

# ---- native Linux: the lifted C on runtime/win32hle (cmake/linux-i386.cmake)
if(CMAKE_SYSTEM_NAME STREQUAL "Linux")
  find_package(PkgConfig REQUIRED)
  pkg_check_modules(SDL2 REQUIRED IMPORTED_TARGET sdl2)
  pkg_check_modules(SDL2_TTF REQUIRED IMPORTED_TARGET SDL2_ttf)
  pkg_check_modules(FFMPEG REQUIRED IMPORTED_TARGET libavformat libavcodec libavutil libswresample)
  set(HLE ${PCRECOMP}/runtime/win32hle)
  file(GLOB HLE_SOURCES CONFIGURE_DEPENDS "${HLE}/*.c")
  list(FILTER HLE_SOURCES EXCLUDE REGEX "_selftest\.c$")
  add_executable(ra2 src/linux/main.c src/linux/launcher.c src/linux/blowfish.c src/linux/script.c src/linux/mods.c src/runtime/hdvox.c src/runtime/queuefive.c src/runtime/thai_font.c ${HLE_SOURCES} ${GEN_SOURCES})
  target_include_directories(ra2 PRIVATE src/linux src/runtime ${GEN_DIR} ${HLE} ${PCRECOMP}/runtime/recomp32)
  target_compile_definitions(ra2 PRIVATE RECOMP_RETADDR=0u RECOMP_FLAT_MEMORY RECOMP_LOCAL_REGS HLE_WITH_FFMPEG)
  set(GEN_OPT "-O2" CACHE STRING "optimisation for the generated C")
  set_source_files_properties(${GEN_SOURCES} PROPERTIES COMPILE_OPTIONS "-w;${GEN_OPT};-fno-strict-aliasing;-fwrapv")
  target_compile_options(ra2 PRIVATE -fno-strict-aliasing -fwrapv)
  target_link_libraries(ra2 PRIVATE PkgConfig::SDL2 PkgConfig::SDL2_TTF PkgConfig::FFMPEG pthread m)
  return()
endif()

# ---- the browser: the same on Emscripten (cmake/emscripten.cmake, docs/web)
if(EMSCRIPTEN)
  set(HLE ${PCRECOMP}/runtime/win32hle)
  file(GLOB HLE_SOURCES CONFIGURE_DEPENDS "${HLE}/*.c")
  list(FILTER HLE_SOURCES EXCLUDE REGEX "_selftest\.c$")
  add_executable(ra2 src/web/main.c src/web/read_cache.c src/web/wolapi.c src/web/presenter.c src/web/settings.c src/web/modern.c src/linux/launcher.c src/linux/blowfish.c src/linux/script.c src/linux/mods.c src/runtime/hdvox.c src/runtime/queuefive.c src/runtime/thai_font.c ${HLE_SOURCES} ${GEN_SOURCES})
  target_include_directories(ra2 PRIVATE src/web src/linux src/runtime ${GEN_DIR} ${HLE} ${PCRECOMP}/runtime/recomp32)
  target_compile_definitions(ra2 PRIVATE RECOMP_RETADDR=0u RECOMP_FLAT_MEMORY RECOMP_LOCAL_REGS)
  # Movies: with FFmpeg's Bink decoder (tools/build-ffmpeg-web.sh configures FFmpeg in ../ffmpeg-src/build and lists
  # the files; -DFFMPEG_WEB_DIR names another), else empty and short, see pcrecomp bink.c
  set(FFMPEG_WEB_DIR "${CMAKE_SOURCE_DIR}/../ffmpeg-src/build" CACHE PATH "a configured FFmpeg build (tools/build-ffmpeg-web.sh); without it movies are skipped")
  if(FFMPEG_WEB_DIR AND EXISTS "${FFMPEG_WEB_DIR}/ffmpeg_sources.cmake")
    include("${FFMPEG_WEB_DIR}/ffmpeg_sources.cmake")
    add_library(ffmpeg_web STATIC ${FFMPEG_SOURCES})
    target_include_directories(ffmpeg_web PUBLIC ${FFMPEG_BUILD} ${FFMPEG_SRC})
    target_include_directories(ffmpeg_web PRIVATE ${FFMPEG_SRC}/compat/stdbit)
    target_compile_definitions(ffmpeg_web PRIVATE HAVE_AV_CONFIG_H _ISOC11_SOURCE _FILE_OFFSET_BITS=64 _LARGEFILE_SOURCE _POSIX_C_SOURCE=200112 _XOPEN_SOURCE=600)
    target_compile_options(ffmpeg_web PRIVATE -w -O2 -std=c17 -pthread -msimd128 -fwasm-exceptions -fno-math-errno -fno-signed-zeros -fomit-frame-pointer)
    target_link_libraries(ra2 PRIVATE ffmpeg_web)
    target_compile_definitions(ra2 PRIVATE HLE_WITH_FFMPEG)
  else()
    set_source_files_properties(${HLE}/bink.c PROPERTIES COMPILE_DEFINITIONS HLE_BINK_SKIP)
  endif()
  set(GEN_OPT "-O2" CACHE STRING "optimisation for the generated C")
  set(WEB_COMPILE -pthread -msimd128 -fwasm-exceptions -sSUPPORT_LONGJMP=wasm -sUSE_SDL=2 -sUSE_SDL_TTF=2)
  set_source_files_properties(${GEN_SOURCES} PROPERTIES COMPILE_OPTIONS "-w;${GEN_OPT};-fno-strict-aliasing;-fwrapv;${WEB_COMPILE}")
  target_compile_options(ra2 PRIVATE -fno-strict-aliasing -fwrapv ${WEB_COMPILE})
  # The link flags, and why: docs/web/toolchain.md. GLOBAL_BASE keeps the
  # guest's 0x00400000..0x00B93000 clear of the host's own data and stack.
  target_link_options(ra2 PRIVATE
    -pthread -fwasm-exceptions -sSUPPORT_LONGJMP=wasm -sPROXY_TO_PTHREAD -sPTHREAD_POOL_SIZE=8
    -sUSE_SDL=2 -sUSE_SDL_TTF=2
    -sGLOBAL_BASE=16MB
    -sINITIAL_MEMORY=256MB -sALLOW_MEMORY_GROWTH -sMAXIMUM_MEMORY=768MB
    -sSTACK_SIZE=8MB -sDEFAULT_PTHREAD_STACK_SIZE=8MB
    -sEXIT_RUNTIME=1 -sENVIRONMENT=web,worker,node
    -sFORCE_FILESYSTEM -sWASMFS
    --js-library ${CMAKE_SOURCE_DIR}/src/web/opfs_read.js
    "-sEXPORTED_RUNTIME_METHODS=ccall,cwrap,FS,callMain,HEAP8,HEAPU8,HEAP32,HEAPU32"
    "SHELL:--preload-file ${CMAKE_SOURCE_DIR}/web/fonts/LiberationSans-Regular.ttf@/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"
    "SHELL:--preload-file ${CMAKE_SOURCE_DIR}/web/fonts/LiberationSans-Bold.ttf@/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"
    "SHELL:--preload-file ${CMAKE_SOURCE_DIR}/web/fonts/LiberationSans-Italic.ttf@/usr/share/fonts/truetype/liberation/LiberationSans-Italic.ttf"
    "SHELL:--preload-file ${CMAKE_SOURCE_DIR}/web/fonts/LiberationSans-BoldItalic.ttf@/usr/share/fonts/truetype/liberation/LiberationSans-BoldItalic.ttf"
    --pre-js ${CMAKE_SOURCE_DIR}/src/web/pre.js
    --extern-pre-js ${CMAKE_SOURCE_DIR}/src/web/extern-pre.js)
  # wasm-opt at -O3 takes about ten minutes on this much code: -DWEB_LINK_OPT=-O1 skips it,
  # for a quick link while trying a change (the release build leaves it empty)
  set(WEB_LINK_OPT "" CACHE STRING "an optimisation level to link with instead of the build type's, e.g. -O1")
  if(WEB_LINK_OPT)
    target_link_options(ra2 PRIVATE ${WEB_LINK_OPT})
  endif()
  set_target_properties(ra2 PROPERTIES SUFFIX ".js" LINK_DEPENDS "${CMAKE_SOURCE_DIR}/src/web/pre.js;${CMAKE_SOURCE_DIR}/src/web/extern-pre.js;${CMAKE_SOURCE_DIR}/src/web/opfs_read.js")
  # Keep the two classic Emscripten modules separate. The expansion retains
  # its original URL; base RA2 lives below ra2/ in the same page build.
  set(WEB_OUT ${CMAKE_SOURCE_DIR}/web/public/game CACHE PATH "root of the page's game modules")
  set(_module_out ${WEB_OUT})
  if(RA2_TARGET STREQUAL "game")
    set(_module_out ${WEB_OUT}/ra2)
  endif()
  add_custom_command(TARGET ra2 POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E make_directory ${_module_out}
    COMMAND ${CMAKE_COMMAND} -E copy_if_different $<TARGET_FILE:ra2> $<TARGET_FILE_DIR:ra2>/ra2.wasm $<TARGET_FILE_DIR:ra2>/ra2.data ${_module_out})
  # build.json: which game this build runs, the exe it was lifted from, and an id for this build
  # (cmake/build_json.cmake). Written when cmake configures, and again after each link, which is when
  # there is a ra2.wasm to take the id from. A change to the lifted target header configures again.
  set(_target_h ${CMAKE_SOURCE_DIR}/${GEN_DIR}/recomp_target.h)
  set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS ${_target_h})
  set(_build_json ${CMAKE_COMMAND} -DTARGET_H=${_target_h} -DOUT=${WEB_OUT}/build.json -DLOCK=${CMAKE_SOURCE_DIR}/.build-json.publish-lock)
  # Advertise a module only after a successful link and copy.
  add_custom_command(TARGET ra2 POST_BUILD
    COMMAND ${_build_json} -DWASM=$<TARGET_FILE_DIR:ra2>/ra2.wasm -P ${CMAKE_SOURCE_DIR}/cmake/build_json.cmake)
  return()
endif()

if(NOT MSVC)
  message(FATAL_ERROR "runtime/native32 is MSVC x86 inline assembly")
endif()

add_executable(ra2
  src/runtime/host.c
  src/runtime/input.c
  src/runtime/mods.c
  src/runtime/oracle.c
  src/runtime/present.c
  src/runtime/hdvox.c
  src/runtime/queuefive.c
  src/runtime/thai_font.c
  ${PCRECOMP}/runtime/native32/native32.c
  ${PCRECOMP}/runtime/recomp32/image_loader.c
  ${PCRECOMP}/runtime/recomp32/recomp_trace.c
  ${GEN_SOURCES}
)
target_include_directories(ra2 PRIVATE
  src/runtime ${GEN_DIR} ${PCRECOMP}/runtime/native32 ${PCRECOMP}/runtime/recomp32)
# RECOMP_RETADDR=0u: a stack imbalance during bring-up leaks a harmless 0, not
# 0xDEAD0000 into a size argument (forcecommander).
target_compile_definitions(ra2 PRIVATE RECOMP_RETADDR=0u _CRT_SECURE_NO_WARNINGS
                                    RECOMP_FLAT_MEMORY RECOMP_LOCAL_REGS)
# Linked high and not relocatable, so the guest's 0x00400000..0x00B7A000 is
# free.
target_link_options(ra2 PRIVATE /BASE:0x60000000 /FIXED:NO /DYNAMICBASE:NO
                               /NXCOMPAT /LARGEADDRESSAWARE /STACK:0x1000000
                               /MANIFESTUAC:NO)
set(GEN_OPT "/O2" CACHE STRING "optimisation for the generated C")
# Visual Studio 2026's compiler (19.50 and later) drops the sign test of a
# 16-bit value shifted to the top of a register (test ax,ax; jl), so a -1
# index got past a bounds check and a skirmish crashed as it started (issue
# #2). Its older optimiser compiles it correctly.
if(MSVC_VERSION GREATER_EQUAL 1950)
  string(APPEND GEN_OPT ";/d2SSAOptimizer-")
endif()
set_source_files_properties(${GEN_SOURCES} PROPERTIES COMPILE_OPTIONS "/w;${GEN_OPT}")
set_source_files_properties(src/runtime/host.c src/runtime/input.c src/runtime/mods.c src/runtime/oracle.c src/runtime/present.c src/runtime/hdvox.c src/runtime/queuefive.c PROPERTIES COMPILE_OPTIONS "/W3")
target_link_libraries(ra2 PRIVATE user32 gdi32 kernel32 ole32 uuid ddraw dxguid winmm d3d11 dxgi shell32)

option(RA2_TRACE "record a ring buffer of lifted function entries" OFF)
if(RA2_TRACE)
  target_compile_definitions(ra2 PRIVATE RECOMP_TRACE=1)
endif()
