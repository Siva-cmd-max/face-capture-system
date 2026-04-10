@echo off
echo ============================================================
echo   FaceVault - Backend Startup (Python 3.10 + InsightFace)
echo ============================================================

cd /d "%~dp0"

if not exist "venv310" (
    echo [1/4] Creating Python 3.10 virtual environment...
    py -3.10 -m venv venv310
    if errorlevel 1 (
        echo ERROR: Python 3.10 not found. Install from https://www.python.org
        pause & exit /b 1
    )
)

echo [2/4] Activating venv310...
call venv310\Scripts\activate.bat

echo [3/4] Checking / installing dependencies...
pip install --upgrade pip --quiet
pip install -r requirements.txt --quiet

echo [4/4] Starting FastAPI on http://localhost:8000
echo.
echo   Swagger UI : http://localhost:8000/docs
echo   Health     : http://localhost:8000/health
echo.
uvicorn main:app --host 0.0.0.0 --port 8000 --timeout-keep-alive 300 --log-level info

pause
