@echo off
rem Daily market snapshot refresh (registered in Windows Task Scheduler as "USMarketBrief - Market Data").
rem 1) Runs scripts\fetch-market-data.mjs from the project root (output appended to logs\market-data.log).
rem    Then runs scripts\fetch-semi-data.mjs for the 반도체 tab (js\semiData.js).
rem 2) Commits ONLY js\marketData.js and js\semiData.js and pushes to origin/master so GitHub Pages
rem    redeploys with fresh data. Skipped when the market fetch failed, when not on master, or when
rem    neither snapshot changed.
setlocal
cd /d "%~dp0.."
if not exist logs mkdir logs
set "LOG=logs\market-data.log"
set "PYTHONIOENCODING=utf-8"
set "PYTHON=C:\Users\iskim\AppData\Local\Programs\Python\Python313\python.exe"
set "GIT=C:\Program Files\Git\cmd\git.exe"
rem Never block on a credential prompt in an unattended run.
set "GIT_TERMINAL_PROMPT=0"
set "GCM_INTERACTIVE=never"

echo ===== %date% %time% ===== >> "%LOG%"
"C:\Program Files\nodejs\node.exe" scripts\fetch-market-data.mjs >> "%LOG%" 2>&1
set "FETCH_RC=%errorlevel%"
echo fetch exit code %FETCH_RC% >> "%LOG%"
rem The semi snapshot keeps its previous data on failure, so its exit code does not gate publishing.
"C:\Program Files\nodejs\node.exe" scripts\fetch-semi-data.mjs >> "%LOG%" 2>&1
echo semi fetch exit code %errorlevel% >> "%LOG%"
if not "%FETCH_RC%"=="0" goto :done

for /f "delims=" %%b in ('"%GIT%" rev-parse --abbrev-ref HEAD') do set "BRANCH=%%b"
if /i not "%BRANCH%"=="master" (
  echo publish skipped: current branch is %BRANCH%, not master >> "%LOG%"
  goto :done
)

"%GIT%" diff --quiet -- js/marketData.js js/semiData.js
if not errorlevel 1 (
  echo publish skipped: snapshots unchanged >> "%LOG%"
  goto :done
)

for /f %%d in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"') do set "TODAY=%%d"
rem "-- <paths>" commits only the snapshots, leaving any other local edits untouched.
"%GIT%" commit -m "data: market snapshot %TODAY%" -- js/marketData.js js/semiData.js >> "%LOG%" 2>&1
if errorlevel 1 (
  echo publish failed: commit error >> "%LOG%"
  goto :done
)
"%GIT%" push origin master >> "%LOG%" 2>&1
if errorlevel 1 (
  echo publish failed: push rejected or offline - commit kept locally, next run will push it >> "%LOG%"
) else (
  echo published to origin/master - GitHub Pages will redeploy >> "%LOG%"
)

:done
echo exit code %FETCH_RC% >> "%LOG%"
exit /b %FETCH_RC%
