@echo off
chcp 65001 >nul
setlocal

set "KAYNAK=C:\Users\hayri\OneDrive\Belgeler\Default Project\stok-takip"
set "HEDEF=D:\StokTakip-Yedek"

echo =============================================
echo   STOK TAKIP - USB YEDEKLEME
echo =============================================
echo.

if not exist "D:\" (
  echo HATA: D surucusu bulunamadi. USB belleği tak ve tekrar dene.
  pause
  exit /b 1
)

if not exist "%HEDEF%" mkdir "%HEDEF%"

echo [1/3] Veriler kopyalaniyor...
if not exist "%HEDEF%\kod\data" mkdir "%HEDEF%\kod\data"
if exist "%KAYNAK%\data\store.json" (
  copy /y "%KAYNAK%\data\store.json" "%HEDEF%\kod\data\store.json" >nul
  echo  OK: store.json kopyalandi
) else (
  echo  UYARI: store.json bulunamadi, veri kaybinin kontrol edilmesi gerekebilir
)

echo [2/3] Kod dosyalari kopyalaniyor...
if not exist "%HEDEF%\kod" mkdir "%HEDEF%\kod"
copy /y "%KAYNAK%\db.js" "%HEDEF%\kod\" >nul
copy /y "%KAYNAK%\server.js" "%HEDEF%\kod\" >nul
copy /y "%KAYNAK%\package.json" "%HEDEF%\kod\" >nul
copy /y "%KAYNAK%\package-lock.json" "%HEDEF%\kod\" >nul
copy /y "%KAYNAK%\render.yaml" "%HEDEF%\kod\" >nul
copy /y "%KAYNAK%\README.md" "%HEDEF%\kod\" >nul
copy /y "%KAYNAK%\.env.example" "%HEDEF%\kod\" >nul
copy /y "%KAYNAK%\Stok-Takip-Baslat.bat" "%HEDEF%\kod\" >nul

if not exist "%HEDEF%\kod\src" mkdir "%HEDEF%\kod\src"
copy /y "%KAYNAK%\src\*.js" "%HEDEF%\kod\src\" >nul

if not exist "%HEDEF%\kod\public" mkdir "%HEDEF%\kod\public"
copy /y "%KAYNAK%\public\*.*" "%HEDEF%\kod\public\" >nul
if exist "%KAYNAK%\public\magaza" (
  if not exist "%HEDEF%\kod\public\magaza" mkdir "%HEDEF%\kod\public\magaza"
  copy /y "%KAYNAK%\public\magaza\*.*" "%HEDEF%\kod\public\magaza\" >nul
)

echo [3/3] Bagimliliklar kopyalaniyor (node_modules)...
if not exist "%HEDEF%\kod\node_modules" mkdir "%HEDEF%\kod\node_modules"
xcopy /e /i /q /y "%KAYNAK%\node_modules\*.*" "%HEDEF%\kod\node_modules\" >nul

echo.
echo =============================================
echo   YEDEKLEME TAMAMLANDI
echo   Tarih: %date% - %time%
echo   Hedef: %HEDEF%
echo =============================================
echo.
pause
