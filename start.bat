@echo off
cd /d "%~dp0"
title Stream Overlay — Admin

echo Cerrando instancia anterior (si existe)...
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":3001 "') do (
  taskkill /F /PID %%a >nul 2>&1
)
timeout /t 1 /nobreak >nul

echo.
echo  Stream Overlay
echo  ==============
echo  Config UI    ^>  http://localhost:3001
echo  Overlay test ^>  http://localhost:3001/overlay
echo.
echo  Cerra esta ventana para detener el servidor.
echo.
node admin.js
pause
