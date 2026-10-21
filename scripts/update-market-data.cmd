@echo off
rem Daily market snapshot refresh (registered in Windows Task Scheduler as "USMarketBrief - Market Data").
rem Runs scripts\fetch-market-data.mjs from the project root and appends output to logs\market-data.log.
setlocal
cd /d "%~dp0.."
if not exist logs mkdir logs
set "PYTHONIOENCODING=utf-8"
set "PYTHON=C:\Users\iskim\AppData\Local\Programs\Python\Python313\python.exe"
echo ===== %date% %time% ===== >> logs\market-data.log
"C:\Program Files\nodejs\node.exe" scripts\fetch-market-data.mjs >> logs\market-data.log 2>&1
echo exit code %errorlevel% >> logs\market-data.log
exit /b %errorlevel%
