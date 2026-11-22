# Share publication between a successful link and an explicitly selected cached mode.
function(ra2_add_web_publication target target_h exe_source exe_name blowfish_source module_dir)
  get_filename_component(publish_tools "${CMAKE_CURRENT_FUNCTION_LIST_DIR}/.." ABSOLUTE)
  set(publish_script "${CMAKE_CURRENT_BINARY_DIR}/publish-${target}.cmake")
  configure_file("${CMAKE_CURRENT_FUNCTION_LIST_DIR}/publish_web.cmake.in" "${publish_script}.in" @ONLY)
  file(GENERATE OUTPUT "${publish_script}" INPUT "${publish_script}.in")
  # POST_BUILD does not run for an up-to-date executable. Always republish the
  # requested cache so switching fast/prod does not leave the other mode served.
  add_custom_target(${target}_publish
    COMMAND ${CMAKE_COMMAND} -P "${publish_script}"
    DEPENDS ${target}
    VERBATIM)
endfunction()
