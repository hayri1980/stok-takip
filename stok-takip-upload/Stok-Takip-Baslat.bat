@echo off
title Stok Takip
cd /d "%~dp0"
echo ============================================
echo   STOK TAKIP BASLATILIYOR...
echo   Tarayicida ac: http://localhost:3000
echo   Kapatmak icin bu pencereyi kapat.
echo ============================================
node server.js
pause
