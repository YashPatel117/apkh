@echo off
setlocal

set "ROOT=%~dp0"

echo ==========================================
echo   AI-Powered Personal Knowledge Hub Setup
echo ==========================================

call :npm_install "%ROOT%apkh-api" "apkh-api" || goto :error
call :npm_install "%ROOT%apkh-storage" "apkh-storage" || goto :error
call :npm_install "%ROOT%apkh-web" "apkh-web" || goto :error
call :setup_python "%ROOT%apkh-search" || goto :error

echo.
echo Setup completed successfully.
if exist "%ROOT%tesseract-ocr-w64-setup-5.5.0.20241111.exe" (
  echo.
  echo OCR note:
  echo Tesseract is still an OS dependency for image/PDF OCR.
  echo If OCR is needed on this machine, run:
  echo "%ROOT%tesseract-ocr-w64-setup-5.5.0.20241111.exe"
)
echo.
echo Next step: run start-all.bat
exit /b 0

:npm_install
set "TARGET=%~1"
set "NAME=%~2"

if not exist "%TARGET%\package.json" (
  echo.
  echo package.json not found for %NAME% at "%TARGET%"
  exit /b 1
)

echo.
echo [%NAME%] Installing Node dependencies...
pushd "%TARGET%" || exit /b 1
call npm install
set "EXIT_CODE=%ERRORLEVEL%"
popd

if not "%EXIT_CODE%"=="0" (
  echo [%NAME%] npm install failed.
  exit /b %EXIT_CODE%
)

exit /b 0

:setup_python
set "TARGET=%~1"

if not exist "%TARGET%\requirements.txt" (
  echo.
  echo requirements.txt not found for apkh-search at "%TARGET%"
  exit /b 1
)

echo.
echo [apkh-search] Preparing Python virtual environment...
pushd "%TARGET%" || exit /b 1

if not exist ".venv\Scripts\python.exe" (
  where py >nul 2>&1
  if not errorlevel 1 (
    call py -3 -m venv .venv
  ) else (
    where python >nul 2>&1
    if errorlevel 1 (
      echo Python was not found. Install Python 3 first.
      popd
      exit /b 1
    )
    call python -m venv .venv
  )

  if errorlevel 1 (
    echo Failed to create Python virtual environment.
    popd
    exit /b 1
  )
)

echo [apkh-search] Upgrading pip...
call ".venv\Scripts\python.exe" -m pip install --upgrade pip
if errorlevel 1 (
  echo Failed to upgrade pip.
  popd
  exit /b 1
)

echo [apkh-search] Installing Python dependencies...
call ".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 (
  echo Failed to install Python dependencies.
  popd
  exit /b 1
)

popd
exit /b 0

:error
echo.
echo Setup failed. Fix the error above and run setup-all.bat again.
exit /b 1
