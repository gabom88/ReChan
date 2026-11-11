@echo off
rem Genera rechan-pack.zip a partir de tu .bin (arrastra el .bin sobre este archivo).
rem Requiere Python 3.9+ y ffmpeg en el PATH. Uso personal: no compartas el ZIP.
setlocal
if "%~1"=="" (
  echo Arrastra tu imagen .bin de Jackie Chan Stuntmaster ^(SLUS-00684^) sobre este archivo,
  echo o ejecuta: make_rechan_pack.bat "ruta\al\juego.bin"
  pause
  exit /b 1
)
set "PY=python"
where py >nul 2>nul && set "PY=py -3"
%PY% "%~dp0make_rechan_pack.py" "%~1" -o "%~dpn1-rechan-pack.zip" %2 %3 %4 %5 %6 %7 %8 %9
echo.
pause
