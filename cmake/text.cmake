# Shared CPU text engine. Keep Cargo output inside the selected CMake build tree
# so Windows, Linux and browser archives cannot overwrite one another.
include_guard(GLOBAL)
get_filename_component(_ra2_text_root "${CMAKE_CURRENT_LIST_DIR}/.." ABSOLUTE)
set(RA2_TEXT_ROOT "${_ra2_text_root}" CACHE INTERNAL "Text engine source root")
option(RA2_TTF_TEXT "Build the optional CPU TTF UI renderer" OFF)
set(RA2_TEXT_RUST_TOOLCHAIN "1.99.0" CACHE STRING "Rust toolchain for native text builds")
set(RA2_TEXT_WEB_RUST_TOOLCHAIN "nightly-2026-10-13" CACHE STRING "Rust with rust-src for the Emscripten text engine")

function(ra2_enable_ttf target)
  if(NOT RA2_TTF_TEXT)
    return()
  endif()
  if(NOT TARGET ra2_text_engine)
    find_program(RA2_CARGO cargo REQUIRED)
    if(EMSCRIPTEN)
      set(rust_target wasm32-unknown-emscripten)
      set(toolchain "${RA2_TEXT_WEB_RUST_TOOLCHAIN}")
      # Rebuild std with the game's shared-memory/exception ABI. A prebuilt
      # Rust std archive does not prove compatibility with this emsdk version.
      set(cargo_extra -Zbuild-std=std,panic_abort)
      set(rust_flags "-C target-feature=+atomics,+bulk-memory,+mutable-globals -C panic=abort")
      set(archive_name libra2_text.a)
    elseif(WIN32)
      set(rust_target i686-pc-windows-msvc)
      set(toolchain "${RA2_TEXT_RUST_TOOLCHAIN}")
      set(rust_flags "-C target-feature=+crt-static")
      set(archive_name ra2_text.lib)
    elseif(CMAKE_SYSTEM_NAME STREQUAL "Linux")
      set(rust_target i686-unknown-linux-gnu)
      set(toolchain "${RA2_TEXT_RUST_TOOLCHAIN}")
      set(archive_name libra2_text.a)
    else()
      message(FATAL_ERROR "TTF text supports the Windows x86, Linux i386 and Emscripten game hosts")
    endif()
    set(cargo_dir "${CMAKE_BINARY_DIR}/cargo-text")
    set(archive "${cargo_dir}/${rust_target}/release/${archive_name}")
    file(GLOB_RECURSE text_sources CONFIGURE_DEPENDS
      "${RA2_TEXT_ROOT}/text/src/*.rs" "${RA2_TEXT_ROOT}/assets/fonts/*")
    add_custom_command(OUTPUT "${archive}"
      COMMAND "${CMAKE_COMMAND}" -E env "CARGO_TARGET_DIR=${cargo_dir}"
              "RUSTFLAGS=${rust_flags}"
              "${RA2_CARGO}" "+${toolchain}" rustc ${cargo_extra}
              --manifest-path "${RA2_TEXT_ROOT}/text/Cargo.toml"
              --locked --release --target "${rust_target}" --lib --crate-type staticlib
      DEPENDS ${text_sources} "${RA2_TEXT_ROOT}/text/Cargo.toml" "${RA2_TEXT_ROOT}/text/Cargo.lock"
      COMMENT "Building CPU TTF engine (${rust_target})" VERBATIM)
    add_custom_target(ra2_text_archive DEPENDS "${archive}")
    add_library(ra2_text_engine STATIC IMPORTED GLOBAL)
    set_target_properties(ra2_text_engine PROPERTIES IMPORTED_LOCATION "${archive}"
      INTERFACE_INCLUDE_DIRECTORIES "${RA2_TEXT_ROOT}/src/runtime")
    add_dependencies(ra2_text_engine ra2_text_archive)
    if(WIN32)
      set_property(TARGET ra2_text_engine PROPERTY INTERFACE_LINK_LIBRARIES
        "advapi32;bcrypt;ntdll;userenv;ws2_32")
    elseif(NOT EMSCRIPTEN)
      set_property(TARGET ra2_text_engine PROPERTY INTERFACE_LINK_LIBRARIES "dl;pthread;m;rt;util;gcc_s")
    endif()
  endif()
  target_link_libraries(${target} PRIVATE ra2_text_engine)
  target_compile_definitions(${target} PRIVATE RA2_TTF_TEXT=1)
endfunction()
