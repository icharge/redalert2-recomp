@echo off
rem Configure and build the browser host: the lifted C on Emscripten
rem (cmake/emscripten.cmake, docs/web/toolchain.md). Build\ra2.js and ra2.wasm.
rem Needs emsdk (EMSDK, else a checkout beside this one), cmake and ninja.
rem   build-web.cmd
rem   set BUILD_DIR=build-web-game& set CMAKE_ARGS=-DRA2_TARGET=game& build-web.cmd
setlocal
rem The Emscripten this was built and tested with.
set "EMSCRIPTEN_VERSION=6.0.12"
if not defined EMSDK set "EMSDK=%~dp0..\emsdk"
if not exist "%EMSDK%\emsdk_env.bat" (echo no emsdk at %EMSDK% ^(docs/web/toolchain.md^) & exit /b 1)
set EMSDK_QUIET=1
call "%EMSDK%\emsdk_env.bat" >nul || exit /b 1
if exist "%ProgramFiles%\CMake\bin\cmake.exe" set "PATH=%ProgramFiles%\CMake\bin;%PATH%"
if not defined BUILD_DIR set "BUILD_DIR=build-web"
if not defined PCRECOMP set "PCRECOMP=%~dp0..\pcrecomp"
for /f "tokens=10" %%v in ('emcc --version ^| findstr /b emcc') do set "HAVE=%%v"
if not "%HAVE%"=="%EMSCRIPTEN_VERSION%" echo note: Emscripten %HAVE%; this was built with %EMSCRIPTEN_VERSION%
if not exist %BUILD_DIR%\build.ninja cmake -S . -B %BUILD_DIR% -G Ninja "-DCMAKE_TOOLCHAIN_FILE=cmake/emscripten.cmake" "-DPCRECOMP=%PCRECOMP:\=/%" %CMAKE_ARGS% || exit /b 1
cmake --build %BUILD_DIR% %*
