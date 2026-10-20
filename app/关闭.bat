@echo off
rem One-click stop: kills only the process that listens on this project's port.
setlocal
cd /d "%~dp0"
title AI Learning Assistant - Stop
set "PS=powershell"
where pwsh >nul 2>nul
if %errorlevel%==0 set "PS=pwsh"
%PS% -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop.ps1" %*
