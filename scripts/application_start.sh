#!/bin/bash
set -e  # Exit on any error

# CodeDeploy ApplicationStart hook
# This script runs to start the application

cd /home/ec2-user/chatty-backend
echo "[$(date)] Changed to /home/ec2-user/chatty-backend"

GLOBAL_NPM_BIN="$(npm bin -g 2>/dev/null || true)"
if [ -n "$GLOBAL_NPM_BIN" ] && ! echo "$PATH" | grep -q "$GLOBAL_NPM_BIN"; then
  export PATH="$GLOBAL_NPM_BIN:$PATH"
fi

PM2_BIN="$(command -v pm2 || true)"
if [ -z "$PM2_BIN" ] && [ -x /usr/local/bin/pm2 ]; then
  PM2_BIN="/usr/local/bin/pm2"
fi

if [ -z "$PM2_BIN" ]; then
  echo "[$(date)] pm2 not found, installing..."
  sudo npm install -g pm2 --unsafe-perm
  if [ -n "$GLOBAL_NPM_BIN" ] && ! echo "$PATH" | grep -q "$GLOBAL_NPM_BIN"; then
    export PATH="$GLOBAL_NPM_BIN:$PATH"
  fi
  PM2_BIN="$(command -v pm2 || true)"
fi
if [ -z "$PM2_BIN" ]; then
  echo "[$(date)] ERROR: pm2 still not found after install"
  exit 1
fi

# Build should already be done in CI/CD and included in deployment package
# Verify build directory exists
if [ ! -d "./build" ]; then
  echo "[$(date)] WARNING: build directory not found, attempting to build..."
  if ! sudo npm run build; then
    echo "[$(date)] ERROR: Build failed"
    exit 1
  fi
else
  echo "[$(date)] Using pre-built application from deployment package"
fi

# Start the application with PM2
echo "[$(date)] Starting application with PM2..."
if [ -f ./build/src/app.js ]; then
  "$PM2_BIN" delete chatty-backend || true
  "$PM2_BIN" start ./build/src/app.js -i 1 --name "chatty-backend"
  "$PM2_BIN" save
  echo "[$(date)] Application started with PM2"
else
  echo "[$(date)] ERROR: build/src/app.js not found"
  exit 1
fi

# Wait a moment and check if PM2 process is running
sleep 2
if "$PM2_BIN" list | grep -q "chatty-backend.*online"; then
  echo "[$(date)] Application is running successfully"
else
  echo "[$(date)] ERROR: Application failed to start"
  sudo pm2 logs chatty-backend --lines 20
  exit 1
fi

