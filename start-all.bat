@echo off
setlocal
rem Starts all four services, each in its own Windows Terminal tab
rem (or its own window when Windows Terminal is not installed).

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

rem Setup must have run first
set "MISSING="
for %%d in (apkh-api apkh-storage apkh-web) do (
  if not exist "%ROOT%\%%d\node_modules" set "MISSING=1"
)
if not exist "%ROOT%\apkh-search\.venv\Scripts\python.exe" set "MISSING=1"
for %%f in (apkh-api\.env apkh-storage\.env apkh-search\.env) do (
  if not exist "%ROOT%\%%f" set "MISSING=1"
)
if defined MISSING (
  echo Dependencies or .env files are missing. Run setup-all.bat first.
  exit /b 1
)

rem The free AI needs Ollama. Its Windows app normally runs in the background;
rem start the server here if it's installed but not running.
where ollama >nul 2>&1
if not errorlevel 1 (
  curl -s -o nul http://localhost:11434/api/version
  if errorlevel 1 (
    echo Starting Ollama for the free AI...
    start "Ollama" /min ollama serve
  )
)

set "API=npm run start:dev"
set "STORAGE=npm start"
set "WEB=npm run dev"
set "SEARCH=.venv\Scripts\python.exe main.py"

where wt >nul 2>&1
if not errorlevel 1 (
  wt new-tab --title "API" -d "%ROOT%\apkh-api" cmd /k "%API%" ^
   ; new-tab --title "Storage" -d "%ROOT%\apkh-storage" cmd /k "%STORAGE%" ^
   ; new-tab --title "Search" -d "%ROOT%\apkh-search" cmd /k "%SEARCH%" ^
   ; new-tab --title "Web" -d "%ROOT%\apkh-web" cmd /k "%WEB%"
) else (
  start "API" /d "%ROOT%\apkh-api" cmd /k "%API%"
  start "Storage" /d "%ROOT%\apkh-storage" cmd /k "%STORAGE%"
  start "Search" /d "%ROOT%\apkh-search" cmd /k "%SEARCH%"
  start "Web" /d "%ROOT%\apkh-web" cmd /k "%WEB%"
)

echo Starting services:
echo   Web      http://localhost:3002
echo   API      http://localhost:3000   (Swagger: /api)
echo   Storage  http://localhost:3001
echo   Search   http://localhost:8000   (docs: /docs)
