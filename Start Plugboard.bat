@echo off
title Plugboard
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto nonode
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)"
if errorlevel 1 goto oldnode
node src\cli.ts %*
if errorlevel 1 goto crashed
exit /b 0

:nonode
echo.
echo Plugboard needs a free program called Node.js, and it is not installed yet.
echo   1. Open https://nodejs.org in your web browser.
echo   2. Click the big green download button and run the installer.
echo   3. Double-click "Start Plugboard" again.
goto end

:oldnode
echo.
echo Your copy of Node.js is too old for Plugboard.
echo   1. Open https://nodejs.org in your web browser.
echo   2. Click the big green download button and run the installer.
echo   3. Double-click "Start Plugboard" again.
goto end

:crashed
echo.
echo Plugboard stopped. If you did not close it on purpose, see "Troubleshooting" in README.md.

:end
echo.
pause
