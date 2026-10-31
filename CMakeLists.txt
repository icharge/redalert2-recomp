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
# RA2_TARGET: gamemd (Yuri's Revenge) or game (Red Alert 2), the lift
# run_lift.py --target made. The browser build compiles both modules in one tree
# ("both", its default); the native host takes one.
if(EMSCRIPTEN)
  set(_ra2_target_default both)
else()
  set(_ra2_target_default gamemd)
endif()
set(RA2_TARGET "${_ra2_target_default}" CACHE STRING "gamemd (Yuri's Revenge), game (Red Alert 2), or both (web build)")
if(RA2_TARGET STREQUAL "both")
  if(NOT EMSCRIPTEN)
    message(FATAL_ERROR "RA2_TARGET=both is for the web build; set gamemd or game for the native host")
  endif()
  set(RA2_EDITIONS gamemd game)
elseif(RA2_TARGET STREQUAL "gamemd" OR RA2_TARGET STREQUAL "game")
  set(RA2_EDITIONS ${RA2_TARGET})
else()
  message(FATAL_ERROR "RA2_TARGET must be gamemd, game or both")
endif()

# The lifted C for one edition: gen/ is Yuri's Revenge, gen_game/ is Red Alert 2.
function(ra2_gen_dir edition out_var)
  if(edition STREQUAL "game")
    set(${out_var} src/recomp/gen_game PARENT_SCOPE)
  else()
    set(${out_var} src/recomp/gen PARENT_SCOPE)
  endif()
endfunction()

if(NOT EMSCRIPTEN)
  ra2_gen_dir(${RA2_EDITIONS} GEN_DIR)
  file(GLOB GEN_SOURCES CONFIGURE_DEPENDS "${CMAKE_SOURCE_DIR}/${GEN_DIR}/*.c")
  if(NOT GEN_SOURCES)
    message(FATAL_ERROR "${GEN_DIR} is empty -- run ./setup.sh (Setup.cmd on Windows) first: it lifts each game")
  endif()
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
  add_executable(ra2 src/linux/main.c src/linux/launcher.c src/linux/blowfish.c src/linux/script.c src/linux/mods.c src/runtime/hdvox.c src/runtime/queuefive.c src/runtime/thai_font.c src/runtime/woltext.c ${HLE_SOURCES} ${GEN_SOURCES})
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
  set(WEB_SOURCES
    src/web/main.c src/web/read_cache.c src/web/wolapi.c src/web/presenter.c
    src/web/frame_buffers.c src/web/settings.c src/web/modern.c
    src/linux/launcher.c src/linux/blowfish.c src/linux/script.c src/linux/mods.c
    src/runtime/hdvox.c src/runtime/queuefive.c src/runtime/thai_font.c src/runtime/woltext.c)
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
  else()
    set_source_files_properties(${HLE}/bink.c PROPERTIES COMPILE_DEFINITIONS HLE_BINK_SKIP)
  endif()
  set(GEN_OPT "-O2" CACHE STRING "optimisation for the generated C")
  set(WEB_COMPILE -pthread -msimd128 -fwasm-exceptions -sSUPPORT_LONGJMP=wasm -sUSE_SDL=2 -sUSE_SDL_TTF=2)
  # The link flags, and why: docs/web/toolchain.md. GLOBAL_BASE keeps the
  # guest's 0x00400000..0x00B93000 clear of the host's own data and stack.
  set(WEB_LINK_FLAGS
    -pthread -fwasm-exceptions -sSUPPORT_LONGJMP=wasm -sPROXY_TO_PTHREAD -sPTHREAD_POOL_SIZE=8
    -sUSE_SDL=2 -sUSE_SDL_TTF=2
    -sGLOBAL_BASE=16MB
    -sINITIAL_MEMORY=640MB -sALLOW_MEMORY_GROWTH -sMAXIMUM_MEMORY=768MB
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
  # Both classic Emscripten modules go in one flat served directory, each named
  # after its edition's module stem (ra2md.* for Yuri's Revenge, ra2.* for Red
  # Alert 2; docs/web/deploy.md). Find the runtime inputs once.
  set(WEB_OUT ${CMAKE_SOURCE_DIR}/web/public/game CACHE PATH "root of the page's game modules")
  set(RA2_GAME_DIR "${CMAKE_SOURCE_DIR}/game" CACHE PATH "local licensed game install used for runtime inputs")
  file(GLOB _runtime_candidates LIST_DIRECTORIES false "${RA2_GAME_DIR}/*")
  find_program(NODE_EXECUTABLE node REQUIRED)

  # One module per listed edition: its own lifted C, its own runtime bundle, and
  # its own publish step. "all" builds every edition in RA2_EDITIONS.
  function(ra2_add_web_module edition)
    if(edition STREQUAL "game")
      set(target ra2)
      set(exe_name game.exe)
    else()
      set(target ra2md)
      set(exe_name gamemd.exe)
    endif()
    ra2_gen_dir(${edition} gen_dir)
    file(GLOB gen_sources CONFIGURE_DEPENDS "${CMAKE_SOURCE_DIR}/${gen_dir}/*.c")
    if(NOT gen_sources)
      message(FATAL_ERROR "${gen_dir} is empty -- run ./setup.sh (Setup.cmd on Windows) first: it lifts each game")
    endif()
    add_executable(${target} ${WEB_SOURCES} ${HLE_SOURCES} ${gen_sources})
    target_include_directories(${target} PRIVATE src/web src/linux src/runtime ${gen_dir} ${HLE} ${PCRECOMP}/runtime/recomp32)
    target_compile_definitions(${target} PRIVATE RECOMP_RETADDR=0u RECOMP_FLAT_MEMORY RECOMP_LOCAL_REGS)
    if(TARGET ffmpeg_web)
      target_link_libraries(${target} PRIVATE ffmpeg_web)
      target_compile_definitions(${target} PRIVATE HLE_WITH_FFMPEG)
    endif()
    set_source_files_properties(${gen_sources} PROPERTIES COMPILE_OPTIONS "-w;${GEN_OPT};-fno-strict-aliasing;-fwrapv;${WEB_COMPILE}")
    target_compile_options(${target} PRIVATE -fno-strict-aliasing -fwrapv ${WEB_COMPILE})
    target_link_options(${target} PRIVATE ${WEB_LINK_FLAGS})
    if(WEB_LINK_OPT)
      target_link_options(${target} PRIVATE ${WEB_LINK_OPT})
    endif()
    set_target_properties(${target} PROPERTIES SUFFIX ".js" LINK_DEPENDS "${CMAKE_SOURCE_DIR}/src/web/pre.js;${CMAKE_SOURCE_DIR}/src/web/extern-pre.js;${CMAKE_SOURCE_DIR}/src/web/opfs_read.js;${CMAKE_SOURCE_DIR}/tools/compress-wasm.mjs")
    # The browser maps the original PE image and reads the Blowfish tables at
    # runtime. Package those exact build inputs alongside the generated module.
    # Resolve names case-insensitively because supported installs differ in case.
    set(exe_source "")
    set(blowfish_source "")
    foreach(candidate IN LISTS _runtime_candidates)
      get_filename_component(candidate_name "${candidate}" NAME)
      string(TOLOWER "${candidate_name}" candidate_lower)
      if("${candidate_lower}" STREQUAL "${exe_name}")
        set(exe_source "${candidate}")
      elseif("${candidate_lower}" STREQUAL "blowfish.dll")
        set(blowfish_source "${candidate}")
      endif()
    endforeach()
    if(NOT exe_source OR NOT blowfish_source)
      message(FATAL_ERROR "Runtime bundle inputs are missing from ${RA2_GAME_DIR}: need ${exe_name} and Blowfish.dll")
    endif()
    add_custom_command(TARGET ${target} POST_BUILD
      COMMAND ${CMAKE_COMMAND} -E make_directory ${WEB_OUT}
      COMMAND ${CMAKE_COMMAND} -E copy_if_different $<TARGET_FILE:${target}> ${WEB_OUT}/${target}.js
      COMMAND ${CMAKE_COMMAND} -E copy_if_different $<TARGET_FILE_DIR:${target}>/${target}.wasm ${WEB_OUT}/${target}.wasm
      COMMAND ${CMAKE_COMMAND} -E copy_if_different $<TARGET_FILE_DIR:${target}>/${target}.data ${WEB_OUT}/${target}.data
      COMMAND ${NODE_EXECUTABLE} ${CMAKE_SOURCE_DIR}/tools/compress-wasm.mjs
              ${WEB_OUT}/${target}.wasm
              ${WEB_OUT}/${target}.wasm.br
              ${WEB_OUT}/${target}.wasm.gz
      VERBATIM)
    if(edition STREQUAL "game")
      add_custom_command(TARGET ${target} POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E rm -rf ${WEB_OUT}/ra2
        VERBATIM)
    endif()
    # build.json: which games this build runs, the exe each was lifted from, and
    # an id for each build (cmake/build_json.cmake). Written when cmake
    # configures, and again after each link, which is when there is a module to
    # take the id from; the lock lets both editions publish in either order.
    set(target_h ${CMAKE_SOURCE_DIR}/${gen_dir}/recomp_target.h)
    set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS
      ${target_h} "${exe_source}" "${blowfish_source}")
    set(build_json ${CMAKE_COMMAND} -DTARGET_H=${target_h} -DOUT=${WEB_OUT}/build.json -DLOCK=${CMAKE_SOURCE_DIR}/.build-json.publish-lock -DRUNTIME_EXE_SOURCE=${exe_source} -DRUNTIME_EXE_NAME=${exe_name} -DRUNTIME_BLOWFISH_SOURCE=${blowfish_source} -DRUNTIME_DIR=${WEB_OUT}/runtime/${target})
    # Advertise a module only after a successful link and copy.
    add_custom_command(TARGET ${target} POST_BUILD
      COMMAND ${build_json} -DWASM=$<TARGET_FILE_DIR:${target}>/${target}.wasm -P ${CMAKE_SOURCE_DIR}/cmake/build_json.cmake)
  endfunction()

  foreach(edition IN LISTS RA2_EDITIONS)
    ra2_add_web_module(${edition})
  endforeach()
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
  src/runtime/woltext.c
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
# Prefer a high base, and keep relocations for systems that force ASLR even
# with /DYNAMICBASE:NO. native32_hold_image reserves the guest image's fixed
# range in a suspended child before its runtime dependencies are loaded.
# The image is 480 to 490 MB; at a base of 0x60000000 Windows refused to start it
# ("subsystem needed to support the image type", error 308), so it links lower.
# Its stack is small: a 16 MB one at process start sat on the guest's 0x00400000
# range, so host.c runs the game on a thread with the large stack.
target_link_options(ra2 PRIVATE /BASE:0x10000000 /FIXED:NO /DYNAMICBASE:NO
                               /NXCOMPAT /LARGEADDRESSAWARE /STACK:0x100000
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
