@echo off
rem Build a portable zip that can be copied to another computer.
setlocal
cd /d "%~dp0"
title AI Learning Assistant - Package
set "PS=powershell"
where pwsh >nul 2>nul
if %errorlevel%==0 set "PS=pwsh"
%PS% -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\pack.ps1" %*
