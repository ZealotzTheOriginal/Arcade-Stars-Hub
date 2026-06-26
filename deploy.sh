#!/usr/bin/env bash
set -euo pipefail

echo "================================================"
echo "  Arcade Stars Hub - Local Dev Launcher"
echo "================================================"
echo

# ── Check .env exists ─────────────────────────────────
if [ ! -f ".env" ]; then
  echo "[ERROR] .env file not found."
  echo "Copy .env.example to .env and fill in your values."
  exit 1
fi

# ── Backend setup ─────────────────────────────────────
echo "[1/4] Setting up Python virtual environment..."
if [ ! -d "backend/.venv" ]; then
  python -m venv backend/.venv || {
    echo "[ERROR] Failed to create virtual environment. Is Python installed?"
    exit 1
  }
fi

echo "[2/4] Installing backend dependencies..."
source backend/.venv/Scripts/activate 2>/dev/null \
  || source backend/.venv/bin/activate
pip install -r backend/requirements.txt --quiet || {
  echo "[ERROR] Failed to install backend dependencies."
  exit 1
}

# ── Frontend setup ─────────────────────────────────────
echo "[3/4] Installing frontend dependencies..."
if [ ! -d "frontend/node_modules" ]; then
  (cd frontend && npm install --silent) || {
    echo "[ERROR] Failed to install frontend dependencies. Is Node/npm installed?"
    exit 1
  }
else
  echo "  node_modules found, skipping install. Run 'npm install' manually if deps changed."
fi

# ── Launch both servers ────────────────────────────────
echo "[4/4] Launching servers..."
echo
echo "  Backend  > http://localhost:8000"
echo "  Frontend > http://localhost:4200"
echo "  API Docs > http://localhost:8000/docs"
echo

# Activate venv for backend process
source backend/.venv/Scripts/activate 2>/dev/null \
  || source backend/.venv/bin/activate

# Launch backend in background
(cd backend && uvicorn main:app --reload --host 0.0.0.0 --port 8000) &
BACKEND_PID=$!

# Launch frontend in background
(cd frontend && npm run start) &
FRONTEND_PID=$!

echo "Servers started. Press Ctrl+C to stop both."
echo "  Backend  PID: $BACKEND_PID"
echo "  Frontend PID: $FRONTEND_PID"

# Wait and forward Ctrl+C to both processes
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" INT TERM
wait
