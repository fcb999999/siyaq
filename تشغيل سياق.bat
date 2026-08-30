@echo off
chcp 65001 >nul
title سياق
cd /d "%~dp0"

if not exist "node_modules\electron" (
  echo جاري تثبيت المكوّنات لأول مرة... انتظر قليلاً
  call npm install
)

start "" /b cmd /c "npx electron ."
exit
