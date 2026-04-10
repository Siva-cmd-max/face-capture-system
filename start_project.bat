@echo off
title FaceVault - Auto Start Engine
echo ============================================================
echo   FaceVault Core - Live Startup Sequence
echo   Closing this window will automatically kill the API
echo ============================================================

cd /d "%~dp0"

echo [1/2] Booting React Frontend (Vite)...
cd Frontend
start /b cmd /c "npm run dev"

cd ..\PyBackend

echo [2/2] Connecting PyBackend (FastAPI)...
if not exist "venv310" (
    echo   [ERROR] Python 3.10 virtual environment 'venv310' not found! 
    echo   Please run PyBackend\start_backend.bat first to initialize.
    pause
    exit /b 1
)

call venv310\Scripts\activate.bat
echo ============================================================
echo   READY. System is fully operational.
echo   FaceVault React App : http://localhost:5173
echo   FaceVault Fast-API  : http://localhost:8000
echo   Press Ctrl+C or simply Close this Window to stop all systems.
echo ============================================================
echo.

uvicorn main:app --host 0.0.0.0 --port 8000

