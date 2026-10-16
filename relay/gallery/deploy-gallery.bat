@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "PATH=%PATH%;%ProgramFiles%\nodejs;%LOCALAPPDATA%\Programs\nodejs;%APPDATA%\npm"
where node >nul 2>nul
if errorlevel 1 goto nonode
node deploy-gallery.mjs
pause
exit /b 0
:nonode
echo [ERROR] node was not found.
pause
exit /b 1
