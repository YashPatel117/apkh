@echo off
setlocal
rem One-time setup: checks prerequisites, creates missing .env files and
rem installs the dependencies of all four services, then downloads the free AI
rem models if Ollama is installed. Safe to run again.

set "ROOT=%~dp0"
cd /d "%ROOT%"

echo ==========================================
echo   AI-Powered Personal Knowledge Hub Setup
echo ==========================================

echo.
echo [1/5] Checking prerequisites...
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
echo [2/5] Creating missing .env files...
node "%ROOT%scripts\init-env.mjs" || goto :error

echo.
echo [3/5] Installing Node dependencies...
call :npm_install apkh-api || goto :error
call :npm_install apkh-storage || goto :error
call :npm_install apkh-web || goto :error

echo.
echo [4/5] Setting up the Python environment for apkh-search...
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
echo [5/5] Free AI models (open-source, run by Ollama on this machine)...
call :free_ai

echo.
echo ==========================================
echo   Setup completed.
echo ==========================================
echo   1. Check apkh-api\.env (MONGODB_URI) and the other .env files.
echo   2. Optional, MongoDB Atlas only: cd apkh-api ^&^& npm run search:vector-index
echo   3. Start everything: start-all.bat
exit /b 0

:free_ai
where ollama >nul 2>&1
if errorlevel 1 (
  echo   Ollama was not found, so the free AI is not set up. Users can still add their own keys.
  echo   To add it: install Ollama from https://ollama.com/download ^(or: winget install Ollama.Ollama^)
  echo   and run setup-all.bat again. To hide the free AI instead, set FREE_AI=off in apkh-api\.env.
  exit /b 0
)
rem Ollama's default context window is too small for note summaries.
if not defined OLLAMA_CONTEXT_LENGTH (
  setx OLLAMA_CONTEXT_LENGTH 8192 >nul && echo   Set OLLAMA_CONTEXT_LENGTH=8192 ^(restart Ollama for it to apply^)
)
for %%m in (qwen3.5:4b qwen3-embedding:0.6b) do (
  echo   Downloading %%m...
  ollama pull %%m || (
    echo   Could not download %%m. Make sure Ollama is running, then run setup-all.bat again.
    exit /b 0
  )
)
echo   Free AI ready
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
