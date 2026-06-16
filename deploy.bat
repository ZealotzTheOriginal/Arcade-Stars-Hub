@echo off
setlocal enabledelayedexpansion

echo ================================================
echo   Arcade Stars Hub - Local Dev Launcher
echo ================================================
echo.

REM ── Check .env exists ─────────────────────────────────
if not exist ".env" (
    echo [ERROR] .env file not found.
    echo Copy .env.example to .env and fill in your values.
    pause
    exit /b 1
)

REM ── Backend setup ─────────────────────────────────────
echo [1/4] Setting up Python virtual environment...
if not exist "backend\.venv" (
    python -m venv backend\.venv
    if errorlevel 1 (
        echo [ERROR] Failed to create virtual environment. Is Python installed?
        pause & exit /b 1
    )
)

echo [2/4] Installing backend dependencies...
call backend\.venv\Scripts\activate.bat
pip install -r backend\requirements.txt --quiet
if errorlevel 1 (
    echo [ERROR] Failed to install backend dependencies.
    pause & exit /b 1
)

REM ── Frontend setup ─────────────────────────────────────
echo [3/4] Installing frontend dependencies...
cd frontend
call npm install --silent
if errorlevel 1 (
    echo [ERROR] Failed to install frontend dependencies. Is Node/npm installed?
    cd ..
    pause & exit /b 1
)
cd ..

REM ── Launch both servers ────────────────────────────────
echo [4/4] Launching servers...
echo.
echo   Backend  ^> http://localhost:8000
echo   Frontend ^> http://localhost:4200
echo   API Docs ^> http://localhost:8000/docs
echo.

start "ASH Backend" cmd /k "cd backend && .venv\Scripts\activate && uvicorn main:app --reload --host 0.0.0.0 --port 8000"
start "ASH Frontend" cmd /k "cd frontend && npm run start"

echo Both servers are starting in separate windows.
echo Press any key to exit this launcher.
pause >nul
