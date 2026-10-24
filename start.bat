@echo off
chcp 65001 > nul
title PR Masker - ローカルサーバー起動
echo ========================================================
echo  PR Masker (PRマスカー) を起動しています...
echo  ブラウザが自動的に開きます: http://localhost:3000/
echo ========================================================
powershell -NoProfile -ExecutionPolicy Bypass -File .\server.ps1
pause
