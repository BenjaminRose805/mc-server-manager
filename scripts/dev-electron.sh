#!/usr/bin/env bash
# Sequential dev startup: backend first (to discover actual port), then frontend + electron.
# Solves port-mismatch issues when 3001 is occupied by a zombie / TIME_WAIT socket.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT_FILE="$ROOT_DIR/data/backend.port"
VITE_PORT=5173

cleanup() {
  echo ""
  echo "Shutting down..."
  # Kill the whole process group so children (tsx, vite, electron) die too
  kill -- -$$ 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# ── 0. Kill stale processes on our ports ─────────────────────────────────
for port in 3001 $VITE_PORT; do
  pid=$(lsof -ti :$port 2>/dev/null || true)
  if [ -n "$pid" ]; then
    echo "Killing stale process on port $port (pid $pid)"
    kill $pid 2>/dev/null || true
  fi
done
sleep 0.5

# ── 1. Start backend (tsx watch) in background ──────────────────────────
echo "Starting backend..."
npm run dev -w @mc-server-manager/backend &
BACKEND_PID=$!

# ── 2. Wait for backend to write its actual port ────────────────────────
echo "Waiting for backend to be ready..."
TIMEOUT=30
ELAPSED=0
while [ $ELAPSED -lt $TIMEOUT ]; do
  if [ -f "$PORT_FILE" ]; then
    BACKEND_PORT=$(cat "$PORT_FILE")
    # Verify the port is actually listening (not stale from a previous run)
    if ss -tlnp 2>/dev/null | grep -q ":${BACKEND_PORT} "; then
      break
    fi
  fi
  sleep 0.5
  ELAPSED=$((ELAPSED + 1))
done

if [ $ELAPSED -ge $TIMEOUT ]; then
  echo "ERROR: Backend did not start within ${TIMEOUT}s"
  exit 1
fi

echo "Backend ready on port $BACKEND_PORT"

# ── 3. Start frontend (Vite) with the correct backend port ─────────────
echo "Starting frontend (proxying to backend on $BACKEND_PORT)..."
VITE_BACKEND_PORT=$BACKEND_PORT npm run dev -w @mc-server-manager/frontend &
FRONTEND_PID=$!

ELAPSED=0
while [ $ELAPSED -lt 15 ]; do
  if ss -tlnp 2>/dev/null | grep -q ":${VITE_PORT} "; then
    break
  fi
  sleep 0.5
  ELAPSED=$((ELAPSED + 1))
done
echo "Frontend ready on port $VITE_PORT"

# ── 4. Start Electron pointing at Vite dev server ──────────────────────
echo "Starting Electron..."
ELECTRON_DISABLE_GPU=1 BACKEND_PORT=$BACKEND_PORT npm run dev -w @mc-server-manager/electron &
ELECTRON_PID=$!

# ── 5. Wait for any child to exit (usually Electron closing) ───────────
wait -n $BACKEND_PID $FRONTEND_PID $ELECTRON_PID 2>/dev/null || true
