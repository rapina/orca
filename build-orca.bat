@echo off
setlocal
rem Build this checkout into dist\win-unpacked, the folder run-orca.bat launches.
rem Takes several minutes: typecheck, relay, cli, electron-vite, native, package.
rem The local build must be closed first - Windows keeps its files open and the
rem packager cannot overwrite them (an installed Orca elsewhere does not matter).

cd /d "%~dp0"
set "ORCA_LOCAL_EXE=%~dp0dist\win-unpacked\Orca.exe"

powershell -NoProfile -Command "if (Get-Process -Name Orca -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $env:ORCA_LOCAL_EXE }) { exit 1 } else { exit 0 }"
if errorlevel 1 goto :running

rem pnpm ships through corepack here, so fall back to it when pnpm is not on PATH.
set "PNPM=pnpm"
where pnpm >nul 2>&1
if errorlevel 1 set "PNPM=corepack pnpm"

echo Building with "%PNPM%" - this takes a few minutes...
call %PNPM% run build:unpack
if errorlevel 1 goto :failed

echo.
echo Build done: "%ORCA_LOCAL_EXE%"
echo Launch it with run-orca.bat (or run-orca-isolated.bat).
endlocal
exit /b 0

:running
echo The local build is running: "%ORCA_LOCAL_EXE%"
echo Close that window first, then run this again.
endlocal
exit /b 1

:failed
echo.
echo Build failed. See the output above.
endlocal
exit /b 1
