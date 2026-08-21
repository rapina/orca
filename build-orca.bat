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

rem build:unpack calls pnpm again from inside the package scripts, so pnpm has to
rem be on PATH by name. When only corepack is installed, put a shim in front of it.
where pnpm >nul 2>&1
if not errorlevel 1 goto :build
where corepack >nul 2>&1
if errorlevel 1 goto :no_pnpm
set "PNPM_SHIM=%TEMP%\orca-pnpm-shim"
if not exist "%PNPM_SHIM%" mkdir "%PNPM_SHIM%"
> "%PNPM_SHIM%\pnpm.cmd" echo @echo off
>> "%PNPM_SHIM%\pnpm.cmd" echo corepack pnpm %%*
set "PATH=%PNPM_SHIM%;%PATH%"
echo Using corepack for pnpm (shim: "%PNPM_SHIM%").

:build
echo Building - this takes a few minutes...
call pnpm run build:unpack
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

:no_pnpm
echo Neither pnpm nor corepack is on PATH.
echo Install Node.js (corepack ships with it) or pnpm, then run this again.
endlocal
exit /b 1

:failed
echo.
echo Build failed. See the output above.
endlocal
exit /b 1
