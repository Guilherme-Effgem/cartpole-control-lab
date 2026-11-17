@echo off
setlocal
cd /d "%~dp0"
echo ================================================
echo  CARTPOLE CONTROL LAB - BUILD PARA WINDOWS
echo ================================================
echo.
where py >nul 2>nul
if errorlevel 1 (
  echo ERRO: Python Launcher nao encontrado.
  echo Instale Python 3.12 x64 em https://www.python.org/downloads/windows/
  pause
  exit /b 1
)
py -3.12 --version >nul 2>nul
if errorlevel 1 (
  echo ERRO: Python 3.12 nao encontrado.
  echo Instale Python 3.12 x64 e execute este arquivo novamente.
  pause
  exit /b 1
)
if not exist .build-venv (
  py -3.12 -m venv .build-venv
  if errorlevel 1 goto :error
)
call .build-venv\Scripts\activate.bat
python -m pip install --upgrade pip setuptools wheel
if errorlevel 1 goto :error
python -m pip install -r requirements.txt pyinstaller==6.16.0
if errorlevel 1 goto :error
python -m PyInstaller --noconfirm --clean CartPoleControlLab.spec
if errorlevel 1 goto :error
echo.
echo BUILD CONCLUIDO!
echo O executavel unico esta em:
echo %CD%\dist\CartPoleControlLab.exe
echo Basta enviar esse arquivo (ou um ZIP com ele).
pause
exit /b 0
:error
echo.
echo O BUILD FALHOU. Leia a mensagem de erro acima.
pause
exit /b 1
