@echo off
setlocal EnableExtensions DisableDelayedExpansion
pushd "%~dp0" || (echo Cannot open the project folder. & exit /b 1)
:menu
cls
echo Project cleanup: %CD%
echo.
echo 1. Python caches and old root logs/object file
echo 2. Web distribution build ^(web\dist^)
echo 3. PCX test runs ^(work\tests-pcx-*^)
echo 4. Select a build directory
echo 5. Exit
echo.
choice /c 12345 /n /m "Choose an option: "
if errorlevel 5 goto end
if errorlevel 4 goto builds
if errorlevel 3 goto pcx
if errorlevel 2 goto dist
if errorlevel 1 goto temp
:temp
set "group=Python caches and old root logs/object file"
echo.
echo Candidates:
for %%P in ("__pycache__" "tools\__pycache__" "allocprobe.obj" "build-web-wol-yr-configure.log" "build-web.log" "setup.log") do if exist "%%~P" echo   %%~P
call :confirm || goto menu
for %%P in ("__pycache__" "tools\__pycache__") do if exist "%%~P\" rd /s /q "%%~P"
for %%P in ("allocprobe.obj" "build-web-wol-yr-configure.log" "build-web.log" "setup.log") do if exist "%%~P" del /f /q "%%~P"
goto done
:dist
set "target=web\dist"
goto single
:pcx
set "group=PCX test runs"
echo.
echo Candidates ^(may include test evidence and profiles^):
for /d %%P in ("work\tests-pcx-*") do if exist "%%~P\" echo   %%~P
call :confirm || goto menu
for /d %%P in ("work\tests-pcx-*") do if exist "%%~P\" rd /s /q "%%~P"
goto done
:builds
cls
echo Select a build directory. Rebuilding may take a long time.
echo Do not remove a build while it is in use.
echo.
echo 1. build              2. build-game
echo 3. build-web          4. build-web-game
echo 5. build-web-live     6. build-web-ra2live
echo 7. build-web-probe    8. build-web-udp
echo 9. build-web-wol-yr  A. work\build-task7-yr-escalated
echo B. Back
choice /c 123456789AB /n /m "Choose a build: "
if errorlevel 11 goto menu
if errorlevel 10 (set "target=work\build-task7-yr-escalated" & goto single)
if errorlevel 9 (set "target=build-web-wol-yr" & goto single)
if errorlevel 8 (set "target=build-web-udp" & goto single)
if errorlevel 7 (set "target=build-web-probe" & goto single)
if errorlevel 6 (set "target=build-web-ra2live" & goto single)
if errorlevel 5 (set "target=build-web-live" & goto single)
if errorlevel 4 (set "target=build-web-game" & goto single)
if errorlevel 3 (set "target=build-web" & goto single)
if errorlevel 2 (set "target=build-game" & goto single)
if errorlevel 1 (set "target=build" & goto single)
:single
if not exist "%target%\" (echo. & echo Not found: %target% & pause & goto menu)
set "group=%target%"
echo.
echo Candidate: %target%
call :confirm || goto menu
rd /s /q "%target%"
goto done
:confirm
echo.
echo This permanently deletes: %group%
choice /c YN /n /m "Continue? [Y/N]: "
if errorlevel 2 exit /b 1
exit /b 0
:done
echo.
echo Cleanup attempted. Check any errors above.
pause
goto menu
:end
popd
endlocal
