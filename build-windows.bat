@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Get it from https://nodejs.org & pause & exit /b 1)
echo Installing dependencies...
call npm install || goto :fail
call npm install-scripts approve electron >nul 2>nul
echo Building Uiable Connect for Windows...
call npm run dist:win || goto :fail
echo.
echo Done. Your build is in the "dist" folder.
start "" "%~dp0dist"
pause
exit /b 0
:fail
echo Build failed - see the messages above.
pause
exit /b 1
