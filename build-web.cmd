@echo off
rem Configure and build the browser host: the lifted C on Emscripten
rem (cmake/emscripten.cmake, docs/web/toolchain.md). Both editions by default,
rem into build-web/: ra2md.js/.wasm/.data and ra2.js/.wasm/.data.
rem Needs emsdk (EMSDK, else a checkout beside this one), cmake and ninja.
rem   build-web.cmd                 (both editions)
rem   set RA2_TARGET=gamemd
rem   build-web.cmd                 (Yuri's Revenge only)
rem   set RA2_TARGET=game
rem   build-web.cmd                 (Red Alert 2 only)
setlocal
rem The Emscripten this was built and tested with.
set "EMSCRIPTEN_VERSION=6.0.12"
if not defined EMSDK set "EMSDK=%~dp0..\emsdk"
if not exist "%EMSDK%\emsdk_env.bat" (echo no emsdk at %EMSDK% ^(docs/web/toolchain.md^) & exit /b 1)
set EMSDK_QUIET=1
call "%EMSDK%\emsdk_env.bat" >nul || exit /b 1
if exist "%ProgramFiles%\CMake\bin\cmake.exe" set "PATH=%ProgramFiles%\CMake\bin;%PATH%"
if not defined RA2_TARGET set "RA2_TARGET=both"
if not "%RA2_TARGET%"=="game" if not "%RA2_TARGET%"=="gamemd" if not "%RA2_TARGET%"=="both" (echo RA2_TARGET must be gamemd, game or both & exit /b 1)
if not defined BUILD_DIR if "%RA2_TARGET%"=="game" (set "BUILD_DIR=build-web-game") else (set "BUILD_DIR=build-web")
if not defined PCRECOMP set "PCRECOMP=%~dp0..\pcrecomp"
for /f "tokens=10" %%v in ('emcc --version ^| findstr /b emcc') do set "HAVE=%%v"
if not "%HAVE%"=="%EMSCRIPTEN_VERSION%" echo note: Emscripten %HAVE%; this was built with %EMSCRIPTEN_VERSION%
cmake -S . -B "%BUILD_DIR%" -G Ninja "-DCMAKE_TOOLCHAIN_FILE=cmake/emscripten.cmake" "-DPCRECOMP=%PCRECOMP:\=/%" "-DRA2_TARGET=%RA2_TARGET%" %CMAKE_ARGS% || exit /b 1
cmake --build "%BUILD_DIR%" %*
