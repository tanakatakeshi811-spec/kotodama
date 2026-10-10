@echo off
chcp 65001 >nul
cd /d "%~dp0"
title コトダマ中継サーバー
where node >nul 2>nul || (echo Node.js が見つかりません。https://nodejs.org から入れてください。 & pause & exit /b 1)
where claude >nul 2>nul || (echo claude コマンドが見つかりません。Claude Code を入れてログインしてください。 & pause & exit /b 1)
node server.mjs
pause
