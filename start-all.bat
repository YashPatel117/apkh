@echo off
echo Starting AI-Powered Personal Knowledge Hub...

echo Starting API...
start "APKH API" cmd /k "cd apkh-api && npm run start:dev"

echo Starting Storage...
start "APKH Storage" cmd /k "cd apkh-storage && npm start"

echo Starting Web...
start "APKH Web" cmd /k "cd apkh-web && npm run dev"

echo Starting Search...
start "APKH Search" cmd /k "cd apkh-search && .\.venv\Scripts\python.exe main.py"

echo All services are starting up in separate windows!
pause
