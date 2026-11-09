cmake_minimum_required(VERSION 3.20)
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
project(ra2_text_abi C)
if(NOT CMAKE_SIZEOF_VOID_P EQUAL 4)
  message(FATAL_ERROR "The game C ABI harness must use the 32-bit host toolchain")
endif()
set(RA2_TTF_TEXT ON CACHE BOOL "Build text engine" FORCE)
include(../cmake/text.cmake)
enable_testing()
add_executable(text_c_abi tests/c_abi.c)
# The harness deliberately checks actual C calls with assert, including Release.
if(MSVC)
  target_compile_options(text_c_abi PRIVATE /UNDEBUG)
else()
  target_compile_options(text_c_abi PRIVATE -UNDEBUG)
endif()

# Feature-off behavior is tested without linking the Rust engine.
add_executable(text_guest_off tests/guest_off.c ../src/runtime/text_guest.c)
target_include_directories(text_guest_off PRIVATE ../src/runtime)
if(MSVC)
  target_compile_options(text_guest_off PRIVATE /UNDEBUG)
else()
  target_compile_options(text_guest_off PRIVATE -UNDEBUG)
endif()
add_test(NAME text_guest_off COMMAND text_guest_off)
ra2_enable_ttf(text_c_abi)
if(EMSCRIPTEN)
  target_compile_options(text_c_abi PRIVATE -pthread -fwasm-exceptions)
  target_link_options(text_c_abi PRIVATE -pthread -fwasm-exceptions
    -sPROXY_TO_PTHREAD -sPTHREAD_POOL_SIZE=2 -sEXIT_RUNTIME=1
    -sENVIRONMENT=node -sINITIAL_MEMORY=128MB -sALLOW_MEMORY_GROWTH)
  find_program(NODE_EXECUTABLE node REQUIRED)
  add_test(NAME text_c_abi COMMAND "${NODE_EXECUTABLE}" "$<TARGET_FILE:text_c_abi>")
else()
  add_test(NAME text_c_abi COMMAND text_c_abi)
endif()

# Guest adapter harness: real Rust engine, fake guest font objects in flat
# 32-bit memory. Shares the adapter source with the game build.
add_executable(text_guest_abi tests/guest_abi.c ../src/runtime/text_guest.c)
target_include_directories(text_guest_abi PRIVATE ../src/runtime)
target_compile_definitions(text_guest_abi PRIVATE RA2_TTF_TEXT_TESTING=1)
if(MSVC)
  target_compile_options(text_guest_abi PRIVATE /UNDEBUG)
else()
  target_compile_options(text_guest_abi PRIVATE -UNDEBUG)
endif()
ra2_enable_ttf(text_guest_abi)
if(EMSCRIPTEN)
  target_compile_options(text_guest_abi PRIVATE -pthread -fwasm-exceptions)
  target_link_options(text_guest_abi PRIVATE -pthread -fwasm-exceptions
    -sPROXY_TO_PTHREAD -sPTHREAD_POOL_SIZE=2 -sEXIT_RUNTIME=1
    -sENVIRONMENT=node -sINITIAL_MEMORY=128MB -sALLOW_MEMORY_GROWTH)
  add_test(NAME text_guest_abi COMMAND "${NODE_EXECUTABLE}" "$<TARGET_FILE:text_guest_abi>")
else()
  add_test(NAME text_guest_abi COMMAND text_guest_abi)
endif()

# Production lift bridge with generated dispatch/function headers replaced by
# the smallest fixture, while using the real pcrecomp register/flat-memory ABI.
foreach(_edition IN ITEMS ra2 gamemd)
  set(_lift_target text_guest_lift_${_edition})
  add_executable(${_lift_target} tests/guest_lift_abi.c
    ../src/runtime/text_guest.c ../src/runtime/text_guest_lift.c ../src/runtime/thai_font.c)
  target_include_directories(${_lift_target} PRIVATE
    tests/guest ../src/runtime ../../pcrecomp/runtime/recomp32)
  target_compile_definitions(${_lift_target} PRIVATE RA2_TTF_TEXT=1 RA2_TTF_TEXT_TESTING=1 RECOMP_FLAT_MEMORY=1)
  if(_edition STREQUAL "ra2")
    target_compile_definitions(${_lift_target} PRIVATE RA2_TARGET_GAME=1)
  endif()
  if(MSVC)
    target_compile_options(${_lift_target} PRIVATE /UNDEBUG)
    target_link_options(${_lift_target} PRIVATE /BASE:0x10000000 /DYNAMICBASE:NO)
  else()
    target_compile_options(${_lift_target} PRIVATE -UNDEBUG)
  endif()
  ra2_enable_ttf(${_lift_target})
  if(EMSCRIPTEN)
    target_compile_options(${_lift_target} PRIVATE -pthread -fwasm-exceptions)
    target_link_options(${_lift_target} PRIVATE -pthread -fwasm-exceptions
      -sPROXY_TO_PTHREAD -sPTHREAD_POOL_SIZE=2 -sEXIT_RUNTIME=1
      -sENVIRONMENT=node -sINITIAL_MEMORY=128MB -sALLOW_MEMORY_GROWTH -sGLOBAL_BASE=16MB)
    add_test(NAME ${_lift_target} COMMAND "${NODE_EXECUTABLE}" "$<TARGET_FILE:${_lift_target}>")
  else()
    add_test(NAME ${_lift_target} COMMAND ${_lift_target})
  endif()
endforeach()
