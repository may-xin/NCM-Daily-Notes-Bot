#!/bin/sh

cleanup() {
  echo "[start] Shutting down..."
  kill $(jobs -p) 2>/dev/null || true
  wait
  exit 0
}
trap cleanup INT TERM

echo "[start] Starting NCM API on :3000..."
cd /app/api-enhanced
node app.js &

echo "[start] Starting frontend on :8080..."
cd /app
node server.js &

echo "[start] Both services running (API :3000, Frontend :8080)"

wait
