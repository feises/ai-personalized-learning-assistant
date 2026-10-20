@echo off
rem One-click start (local only): binds 127.0.0.1, not reachable from other devices.
setlocal
cd /d "%~dp0"
title AI Learning Assistant - Start (local only)
set "PS=powershell"
where pwsh >nul 2>nul
if %errorlevel%==0 set "PS=pwsh"
%PS% -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start.ps1" -Local %*
