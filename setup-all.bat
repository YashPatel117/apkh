@echo off
setlocal
rem One-time setup: checks prerequisites, creates missing .env files and
rem installs the dependencies of all four services. Safe to run again.

set "ROOT=%~dp0"
cd /d "%ROOT%"

echo ==========================================
echo   AI-Powered Personal Knowledge Hub Setup
echo ==========================================

echo.
echo [1/4] Checking prerequisites...
where node >nul 2>&1 || (echo   Node.js was not found. Install Node.js 20+ from https://nodejs.org & goto :error)
where npm >nul 2>&1 || (echo   npm was not found. Reinstall Node.js with npm. & goto :error)
for /f "delims=" %%v in ('node --version') do echo   Node.js %%v

set "PYTHON="
where py >nul 2>&1 && set "PYTHON=py -3"
if not defined PYTHON (
  where python >nul 2>&1 && set "PYTHON=python"
)
if not defined PYTHON (
  echo   Python 3 was not found. Install Python 3.11+ from https://www.python.org
  goto :error
)
for /f "delims=" %%v in ('%PYTHON% --version') do echo   %%v

echo.
echo [2/4] Creating missing .env files...
node "%ROOT%scripts\init-env.mjs" || goto :error

echo.
echo [3/4] Installing Node dependencies...
call :npm_install apkh-api || goto :error
call :npm_install apkh-storage || goto :error
call :npm_install apkh-web || goto :error

echo.
echo [4/4] Setting up the Python environment for apkh-search...
pushd "%ROOT%apkh-search" || goto :error
if not exist ".venv\Scripts\python.exe" (
  echo   Creating .venv...
  %PYTHON% -m venv .venv || (popd & goto :error)
)
".venv\Scripts\python.exe" -m pip install --upgrade pip --quiet || (popd & goto :error)
".venv\Scripts\python.exe" -m pip install -r requirements.txt --quiet || (popd & goto :error)
popd
echo   apkh-search ready

echo.
echo ==========================================
echo   Setup completed.
echo ==========================================
echo   1. Check apkh-api\.env (MONGODB_URI) and the other .env files.
echo   2. Optional, MongoDB Atlas only: cd apkh-api ^&^& npm run search:vector-index
echo   3. Start everything: start-all.bat
exit /b 0

:npm_install
echo   [%~1] npm install...
pushd "%ROOT%%~1" || exit /b 1
call npm install --no-fund --no-audit --loglevel=error
set "EXIT_CODE=%ERRORLEVEL%"
popd
if not "%EXIT_CODE%"=="0" echo   [%~1] npm install failed.
exit /b %EXIT_CODE%

:error
echo.
echo Setup failed. Fix the error above and run setup-all.bat again.
exit /b 1
