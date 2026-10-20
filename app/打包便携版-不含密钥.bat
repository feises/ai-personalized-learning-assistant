@echo off
rem Build a portable zip WITHOUT the API key (recipient fills in their own key).
setlocal
cd /d "%~dp0"
title AI Learning Assistant - Package (no key)
set "PS=powershell"
where pwsh >nul 2>nul
if %errorlevel%==0 set "PS=pwsh"
%PS% -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\pack.ps1" -WithoutKey %*
