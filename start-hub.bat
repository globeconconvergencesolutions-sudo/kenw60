@echo off
title KENW60 Project Hub
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install the LTS version from https://nodejs.org then run this file again.
  pause
  exit /b 1
)
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=12)?0:1)"
if errorlevel 1 (
  echo This hub needs Node.js 22.12 or newer. Install the current LTS from https://nodejs.org then run this file again.
  pause
  exit /b 1
)
if not exist node_modules\sanitize-html (
  echo Installing packages, please wait...
  call npm.cmd install --no-audit --no-fund
)
echo Starting KENW60 Project Hub... keep this window open while using the site.
start "" /min cmd /c "timeout /t 3 >nul & start http://localhost:3000"
node server.js
pause
