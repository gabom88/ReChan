@echo off
rem Conversor ReChan: crea el paquete ZIP a partir de tu .bin.
rem Doble clic (busca el .bin solo) o arrastra el .bin sobre este archivo.
rem Uso personal: no compartas el ZIP.
setlocal
chcp 65001 >nul
cd /d "%~dp0"
set "PY="
where py >nul 2>nul && set "PY=py -3"
if not defined PY where python >nul 2>nul && set "PY=python"
if not defined PY (
  echo No encuentro Python.
  echo Instalalo desde https://www.python.org/downloads/ marcando "Add Python to PATH",
  echo o desde la Microsoft Store ^(busca "Python 3"^), y vuelve a abrir este archivo.
  echo.
  pause
  exit /b 1
)
if "%~1"=="" (
  %PY% "%~dp0make_rechan_pack.py"
) else (
  %PY% "%~dp0make_rechan_pack.py" "%~1" %2 %3 %4 %5 %6 %7 %8 %9
)
echo.
pause
