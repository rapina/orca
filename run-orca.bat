@echo off
setlocal
rem Launch the locally built Orca (dist\win-unpacked) with the normal profile.
rem Quit the installed Orca first: both use %APPDATA%\orca, so the second launch
rem only focuses the first one instead of starting this build.
rem Use run-orca-isolated.bat to run next to an installed Orca.

set "ORCA_EXE=%~dp0dist\win-unpacked\Orca.exe"

if not exist "%ORCA_EXE%" (
  echo Build not found: "%ORCA_EXE%"
  echo Run "pnpm build:unpack" first.
  exit /b 1
)

start "Orca (local build)" "%ORCA_EXE%" %*
endlocal
