#!/bin/bash
# ULTRA-FAST BeforeInstall - minimal operations, no blocking
set +e

echo "[$(date)] Starting BeforeInstall (ultra-fast mode)"

# Step 1: Kill processes instantly (parallel, non-blocking, no waits)
pkill -9 -f "node.*build/src/app.js" 2>/dev/null &
pkill -9 -f "node.*rotten-corn" 2>/dev/null &
pkill -9 -f pm2 2>/dev/null &
fuser -k 5000/tcp 2>/dev/null &
echo "[$(date)] Step 1: Process kill commands sent (non-blocking)"

# Step 2: Clean directory (FAST - only remove what's needed)
DIR="/home/ec2-user/rotten-corn-backend"
if [ -d "$DIR" ]; then
  cd "$DIR"
  # Remove only source/build - keep node_modules (saves 30+ seconds)
  rm -rf src build .env* package.json package-lock.json tsconfig.json appspec.yml 2>/dev/null || true
  echo "[$(date)] Step 2: Directory cleaned (node_modules preserved)"
else
  mkdir -p "$DIR"
fi

echo "[$(date)] ✓ BeforeInstall completed (< 2 seconds)"

