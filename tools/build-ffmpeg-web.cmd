@echo off
rem Configure FFmpeg's Bink decoder for the browser build (tools/build-ffmpeg-web.sh): the source goes in
rem ..\ffmpeg-src\ffmpeg-7.1.1 (download ffmpeg-7.1.1.tar.xz from https://ffmpeg.org/releases/). Needs emsdk, node
rem and a sh (Git for Windows').
rem   tools\build-ffmpeg-web.cmd [source dir] [build dir]
setlocal
if not defined EMSDK set "EMSDK=%~dp0..\..\emsdk"
if not exist "%EMSDK%\emsdk_env.bat" (echo no emsdk at %EMSDK% ^(docs/web/toolchain.md^) & exit /b 1)
set EMSDK_QUIET=1
call "%EMSDK%\emsdk_env.bat" >nul || exit /b 1
set "SH="
for %%g in (git.exe) do if not "%%~$PATH:g"=="" for %%d in ("%%~dp$PATH:g..") do if exist "%%~fd\bin\sh.exe" set "SH=%%~fd\bin\sh.exe"
if not defined SH (echo no sh.exe: install Git for Windows & exit /b 1)
"%SH%" "%~dp0build-ffmpeg-web.sh" %*
