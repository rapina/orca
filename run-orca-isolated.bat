@echo off
setlocal
rem Launch the locally built Orca against its own profile directory, so it can run
rem next to an installed Orca without sharing workspaces, accounts or terminals.
rem The first run starts empty (you sign in again); the profile then persists in
rem .orca-profile\ and is git-ignored. Delete that folder to start clean.

set "ORCA_EXE=%~dp0dist\win-unpacked\Orca.exe"
set "ORCA_PROFILE=%~dp0.orca-profile"

if not exist "%ORCA_EXE%" (
  echo Build not found: "%ORCA_EXE%"
  echo Run "pnpm build:unpack" first.
  exit /b 1
)

if not exist "%ORCA_PROFILE%" mkdir "%ORCA_PROFILE%"

start "Orca (isolated profile)" "%ORCA_EXE%" --user-data-dir="%ORCA_PROFILE%" %*
endlocal
