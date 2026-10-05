@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 20 or newer first, then run this file again.
  pause
  exit /b 1
)
if not exist "app\node_modules\express\package.json" (
  call npm run setup
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
call npm start
pause
