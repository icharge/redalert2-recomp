# Writes build.json for the page: which game this build runs and the exe it was lifted from (the import's
# checks, web/src/storage/install.ts), and an id for the build (the start of ra2.wasm's SHA-256), which the
# service worker keys its cache of the game's files by (web/src/sw.ts). Run by CMakeLists.txt when it
# configures and after each link:
#
#   cmake -DTARGET_H=<recomp_target.h> -DOUT=<build.json> [-DWASM=<ra2.wasm>] -P build_json.cmake
#
# Without a ra2.wasm there is no id yet; the page and the worker cope with that.
file(READ "${TARGET_H}" _target)
string(REGEX MATCH "define RA2_EXE_NAME \"([^\"]+)\"" _m "${_target}")
set(_exe "${CMAKE_MATCH_1}")
string(REGEX MATCH "define RA2_INI_NAME \"([^\"]+)\"" _m "${_target}")
set(_ini "${CMAKE_MATCH_1}")
string(REGEX MATCH "define RA2_TITLE \"([^\"]+)\"" _m "${_target}")
set(_title "${CMAKE_MATCH_1}")
string(REGEX MATCH "define RA2_EXE_STAMP (0x[0-9A-Fa-f]+)u" _m "${_target}")
math(EXPR _stamp "${CMAKE_MATCH_1}" OUTPUT_FORMAT DECIMAL)
if(_target MATCHES "RA2_TARGET_GAMEMD")
  set(_id ra2md)
else()
  set(_id ra2)
endif()
set(_build "")
if(WASM AND EXISTS "${WASM}")
  file(SHA256 "${WASM}" _sha)
  string(SUBSTRING "${_sha}" 0 16 _short)
  set(_build ",\"build\":\"${_short}\"")
endif()
file(WRITE "${OUT}"
  "{\"games\":{\"${_id}\":{\"title\":\"${_title}\",\"exe\":\"${_exe}\",\"ini\":\"${_ini}\",\"stamp\":${_stamp}}}${_build}}\n")
