@echo off
rem One-click start (LAN mode): serves on all network cards so the URL keeps working after IP changes.
setlocal
cd /d "%~dp0"
title AI Learning Assistant - Start
set "PS=powershell"
where pwsh >nul 2>nul
if %errorlevel%==0 set "PS=pwsh"
%PS% -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start.ps1" %*
