@echo off
setlocal
title Lightshow Studio
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install LTS from https://nodejs.org
  pause
  exit /b 1
)

if not exist package.json (
  echo [ERROR] Run this from the extracted lightshow-studio folder.
  pause
  exit /b 1
)

rem --- Install dependencies if needed ---
if not exist node_modules\electron\package.json (
  echo Installing dependencies - first run takes a few minutes...
  call npm install --include=dev --no-audit --no-fund > install-log.txt 2>&1
  if errorlevel 1 (
    echo [ERROR] npm install failed - see install-log.txt
    pause
    exit /b 1
  )
)

rem --- Download Electron's runtime if needed ---
if not exist node_modules\electron\dist\electron.exe (
  echo Fetching the Electron runtime...
  node node_modules\electron\install.js
)

if not exist node_modules\electron\dist\electron.exe (
  echo [ERROR] Electron runtime missing - run "Diagnose and Repair.bat"
  echo and send the report to Claude.
  pause
  exit /b 1
)

rem --- Self-heal: restore path.txt if the installer was interrupted ---
if not exist node_modules\electron\path.txt (
  echo Restoring missing path.txt...
  node -e "require('fs').writeFileSync(require('path').join('node_modules','electron','path.txt'),'electron.exe')"
)

echo Starting Lightshow Studio...
call npx electron .
if errorlevel 1 (
  echo.
  echo [ERROR] The app exited with an error - details above.
)
echo.
pause