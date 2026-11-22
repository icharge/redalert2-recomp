@echo off
rem Web/Wasm: --mode prod|fast|all --edition ra2|ra2md|both. See docs/web/toolchain.md.
setlocal EnableExtensions
pushd "%~dp0" || exit /b 1
if not defined PYTHON set "PYTHON=python"
rem Planning and help do not activate or modify the SDK.
for %%A in (%*) do if "%%~A"=="--help" goto run
for %%A in (%*) do if "%%~A"=="-h" goto run
for %%A in (%*) do if "%%~A"=="--dry-run" goto run
if not defined EMSDK set "EMSDK=%~dp0..\emsdk"
if not exist "%EMSDK%\emsdk_env.bat" (
  echo No emsdk at %EMSDK% ^(docs/web/toolchain.md^)
  popd
  exit /b 1
)
set "EMSDK_QUIET=1"
call "%EMSDK%\emsdk_env.bat" >nul
if errorlevel 1 (popd & exit /b 1)
if exist "%ProgramFiles%\CMake\bin\cmake.exe" set "PATH=%ProgramFiles%\CMake\bin;%PATH%"
emcc --version | findstr /b emcc | findstr /c:"6.0.12" >nul
if errorlevel 1 echo Note: this repository was tested with Emscripten 6.0.12.
:run
"%PYTHON%" -B tools\build_web.py %*
set "BUILD_EXIT=%errorlevel%"
popd
exit /b %BUILD_EXIT%
