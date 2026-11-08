# Stop a build whose lifted C is older than the lifter and patches that should
# have made it. run_lift.py writes lifter_stamp() to <gen>/lift_stamp.txt: a
# SHA-1 of pcrecomp's lift32.py and generate.py and of run_lift.py itself, with
# CRLF read as LF. This script computes the same hash, so a patch edited in
# run_lift.py fails the build until that edition is lifted again.
#
#   cmake -DGEN_DIR=src/recomp/gen_game -DEDITION=game -DPCRECOMP=../pcrecomp
#         -DRUN_LIFT=run_lift.py [-DALLOW_STALE=ON] -P lift_check.cmake
#   cmake -DPCRECOMP=... -DRUN_LIFT=... -DPRINT=ON -P lift_check.cmake   (prints the hash)
#
# tools/test_lift_patches.py checks that this hash equals lifter_stamp().
set(_hashed "")
foreach(_file "${PCRECOMP}/tools/lift/lift32.py" "${PCRECOMP}/tools/lift/generate.py" "${RUN_LIFT}")
  if(NOT EXISTS "${_file}")
    message(FATAL_ERROR "lift check: ${_file} is missing")
  endif()
  file(READ "${_file}" _text)
  string(REPLACE "\r\n" "\n" _text "${_text}")
  string(APPEND _hashed "${_text}")
endforeach()
string(SHA1 _sha "${_hashed}")
string(SUBSTRING "${_sha}" 0 16 _want)

if(PRINT)
  message("${_want}")
  return()
endif()

set(_have "none")
if(EXISTS "${GEN_DIR}/lift_stamp.txt")
  file(READ "${GEN_DIR}/lift_stamp.txt" _have)
  string(STRIP "${_have}" _have)
endif()
if(_have STREQUAL _want)
  return()
endif()

set(_why "${GEN_DIR} was lifted by another run_lift.py or pcrecomp lifter (stamp ${_have}, now ${_want}). Re-lift it first:\n  run_lift.py --target ${EDITION} --all   (with the Python you lift with)\nor build only the other edition (RA2_TARGET). To build the old lift anyway, configure with -DRA2_ALLOW_STALE_LIFT=ON.")
if(ALLOW_STALE)
  message(WARNING "lift check (allowed by RA2_ALLOW_STALE_LIFT): ${_why}")
else()
  message(FATAL_ERROR "lift check: ${_why}")
endif()
