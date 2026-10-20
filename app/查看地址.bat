@echo off
rem Show current access URLs (local + LAN). Use this after the network / IP changes.
setlocal
cd /d "%~dp0"
title AI Learning Assistant - Current URLs
set "PS=powershell"
where pwsh >nul 2>nul
if %errorlevel%==0 set "PS=pwsh"
%PS% -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\url.ps1" %*
