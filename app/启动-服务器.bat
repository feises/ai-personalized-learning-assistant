@echo off
rem Server mode: start and show the public URL for remote access.
setlocal
cd /d "%~dp0"
title AI Learning Assistant - Server
set "PS=powershell"
where pwsh >nul 2>nul
if %errorlevel%==0 set "PS=pwsh"
%PS% -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start.ps1" -Server -NoBrowser %*
