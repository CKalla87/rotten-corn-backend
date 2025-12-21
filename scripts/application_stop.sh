#!/bin/bash
# ULTRA-FAST ApplicationStop - must complete in < 4 seconds
# CodeDeploy timeout is 5 seconds, so we leave 1 second buffer
set +e

echo "[$(date)] Starting ApplicationStop"

# Quick check if anything is running - exit immediately if not
if ! pgrep -f "node.*build/src/app.js" >/dev/null 2>&1 && \
   ! pgrep -f "node.*rotten-corn" >/dev/null 2>&1 && \
   ! pgrep -f pm2 >/dev/null 2>&1 && \
   ! lsof -ti:5000 >/dev/null 2>&1; then
  echo "[$(date)] No application processes found - nothing to stop"
  echo "[$(date)] ✓ ApplicationStop completed (nothing running)"
  exit 0
fi

# Fast kill sequence - all commands use background execution with immediate kill to prevent hanging
echo "[$(date)] Stopping application processes..."

# Find PM2 and stop it quickly
if command -v pm2 >/dev/null 2>&1; then
  PM2_BIN=$(command -v pm2)
elif [ -x "/usr/local/bin/pm2" ]; then
  PM2_BIN="/usr/local/bin/pm2"
elif [ -x "/usr/bin/pm2" ]; then
  PM2_BIN="/usr/bin/pm2"
fi

if [ -n "$PM2_BIN" ]; then
  # Stop PM2 processes with timeout protection
  if command -v timeout >/dev/null 2>&1; then
    timeout 1 "$PM2_BIN" delete all 2>/dev/null || true
    timeout 1 "$PM2_BIN" kill 2>/dev/null || true
  else
    # Fallback: run in background and kill after short delay
    ("$PM2_BIN" delete all 2>/dev/null &)
    sleep 0.5
    ("$PM2_BIN" kill 2>/dev/null &)
    sleep 0.3
  fi
fi

# Force kill all node processes (immediate, no waiting)
pkill -9 -f "node.*build/src/app.js" 2>/dev/null || true
pkill -9 -f "node.*rotten-corn" 2>/dev/null || true
pkill -9 -f "node.*app.js" 2>/dev/null || true

# Free port 5000 - direct kill of processes using the port
PIDS=$(lsof -ti:5000 2>/dev/null | head -20)
if [ -n "$PIDS" ]; then
  for pid in $PIDS; do
    kill -9 "$pid" 2>/dev/null || true
  done
fi

# Try fuser with timeout protection (optional, PIDS already killed above)
if command -v timeout >/dev/null 2>&1; then
  timeout 0.5 fuser -k 5000/tcp 2>/dev/null || true
else
  (fuser -k 5000/tcp 2>/dev/null &)
  sleep 0.3
fi

# Kill PM2 daemon processes
pkill -9 -f pm2 2>/dev/null || true

# Final cleanup - kill any remaining node processes related to the app
pkill -9 -f "node.*build" 2>/dev/null || true

echo "[$(date)] ✓ ApplicationStop completed"
exit 0
