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
  # Delete any existing process
  "$PM2_BIN" delete chatty-backend || true

  # Start the application (PM2 runs in daemon mode by default)
  echo "[$(date)] Launching application..."

  # First, try to run the app directly to capture any immediate errors
  echo "[$(date)] Testing app startup (will timeout after 5 seconds)..."
  timeout 5 node ./build/src/app.js 2>&1 | head -50 || APP_ERROR=$?

  if [ -n "$APP_ERROR" ] && [ "$APP_ERROR" != "124" ]; then
    echo "[$(date)] App failed to start directly. Error code: $APP_ERROR"
    echo "[$(date)] This usually indicates a database/Redis connection issue or missing env vars"
  fi

  # Now start with PM2
  "$PM2_BIN" start ./build/src/app.js -i 1 --name "chatty-backend" || {
    echo "[$(date)] ERROR: PM2 start command failed"
    exit 1
  }

  # Save PM2 process list
  "$PM2_BIN" save || echo "[$(date)] Warning: PM2 save failed (non-critical)"

  echo "[$(date)] PM2 start command completed, waiting for application to initialize..."
else
  echo "[$(date)] ERROR: build/src/app.js not found"
  exit 1
fi

# Wait for application to start with retries (app needs time to connect to DB/Redis)
MAX_WAIT=60  # Maximum wait time in seconds
WAIT_INTERVAL=2  # Check every 2 seconds
ELAPSED=0

while [ $ELAPSED -lt $MAX_WAIT ]; do
  # Check if PM2 shows the app as online
  if "$PM2_BIN" list | grep -q "chatty-backend.*online"; then
    echo "[$(date)] PM2 reports app as online, verifying HTTP response..."

    # CRITICAL: Actually test if the app responds to HTTP requests
    # PM2 might say "online" but app could be crashing or not listening
    # Try multiple times as the app might be starting up
    HTTP_CHECK_SUCCESS=false
    for check_attempt in 1 2 3; do
      if curl -f -s --max-time 5 http://localhost:5000/health > /dev/null 2>&1; then
        HTTP_CHECK_SUCCESS=true
        break
      else
        echo "[$(date)] ⚠ HTTP check attempt $check_attempt failed, waiting 2 seconds..."
        sleep 2
      fi
    done
    
    if [ "$HTTP_CHECK_SUCCESS" = true ]; then
      echo "[$(date)] ✓ Application is running and responding to HTTP requests (verified after ${ELAPSED}s)"
      exit 0
    else
      echo "[$(date)] ⚠ PM2 says online but app not responding to HTTP (waited ${ELAPSED}s)"
      echo "[$(date)] Checking if port 5000 is listening..."
      if ! netstat -tln 2>/dev/null | grep -q ":5000 " && ! ss -tln 2>/dev/null | grep -q ":5000 "; then
        echo "[$(date)] ERROR: Port 5000 is not listening - app may have crashed"
        echo "[$(date)] PM2 status:"
        "$PM2_BIN" list | grep chatty-backend || true
        echo "[$(date)] PM2 error logs (last 50 lines):"
        "$PM2_BIN" logs chatty-backend --err --lines 50 --nostream 2>&1 || true
        echo "[$(date)] PM2 output logs (last 50 lines):"
        "$PM2_BIN" logs chatty-backend --out --lines 50 --nostream 2>&1 || true
        echo "[$(date)] Checking if .env file exists and has required vars:"
        if [ -f .env ]; then
          echo "[$(date)] .env file exists"
          grep -E "DATABASE_URL|REDIS_HOST|NODE_ENV" .env | sed 's/=.*/=***/' || echo "Required vars not found in .env"
        else
          echo "[$(date)] ERROR: .env file not found!"
        fi
        echo "[$(date)] Checking process status:"
        ps aux | grep -E "node|pm2" | grep -v grep || true
        exit 1
      else
        # Port is listening, give it a bit more time to fully initialize
        echo "[$(date)] Port 5000 is listening, waiting additional time for app to fully initialize..."
        sleep 5
        if curl -f -s --max-time 5 http://localhost:5000/health > /dev/null 2>&1; then
          echo "[$(date)] ✓ Application is now responding to HTTP requests"
          exit 0
        fi
      fi
    fi
  fi

  # Check if process exists but is not online (might be starting, errored, or stopped)
  if "$PM2_BIN" list | grep -q "chatty-backend"; then
    STATUS=$("$PM2_BIN" list | grep "chatty-backend" | awk '{print $10}')
    RESTARTS=$("$PM2_BIN" list | grep "chatty-backend" | awk '{print $12}')
    echo "[$(date)] Application status: $STATUS, restarts: $RESTARTS (waited ${ELAPSED}s)"

    # Check for crash loop (too many restarts)
    if [ -n "$RESTARTS" ] && [ "$RESTARTS" -gt 5 ]; then
      echo "[$(date)] ERROR: App is in crash loop (${RESTARTS} restarts)"
      echo "[$(date)] Showing last 50 lines of logs:"
      "$PM2_BIN" logs chatty-backend --lines 50 --nostream || true
      exit 1
    fi

    # If it's errored or stopped, show logs and exit
    if [ "$STATUS" = "errored" ] || [ "$STATUS" = "stopped" ]; then
      echo "[$(date)] ERROR: Application status is $STATUS"
      echo "[$(date)] PM2 error logs (last 50 lines):"
      "$PM2_BIN" logs chatty-backend --err --lines 50 --nostream 2>&1 || true
      echo "[$(date)] PM2 output logs (last 50 lines):"
      "$PM2_BIN" logs chatty-backend --out --lines 50 --nostream 2>&1 || true
      exit 1
    fi
  else
    echo "[$(date)] Application process not found in PM2 list (waited ${ELAPSED}s)"
  fi

  sleep $WAIT_INTERVAL
  ELAPSED=$((ELAPSED + WAIT_INTERVAL))
done

# If we get here, the app didn't start within the timeout
echo "[$(date)] ERROR: Application did not come online and respond to HTTP within ${MAX_WAIT} seconds"
echo "[$(date)] Current PM2 status:"
"$PM2_BIN" list || true
echo "[$(date)] Port 5000 status:"
netstat -tln 2>/dev/null | grep ":5000 " || echo "Port 5000 not listening"
echo "[$(date)] PM2 error logs (last 100 lines):"
"$PM2_BIN" logs chatty-backend --err --lines 100 --nostream 2>&1 || true
echo "[$(date)] PM2 output logs (last 100 lines):"
"$PM2_BIN" logs chatty-backend --out --lines 100 --nostream 2>&1 || true
echo "[$(date)] Environment check:"
if [ -f .env ]; then
  echo "[$(date)] .env file exists"
  echo "[$(date)] Checking for DATABASE_URL:"
  grep "DATABASE_URL" .env | head -1 | sed 's/=.*/=***/' || echo "DATABASE_URL not found"
else
  echo "[$(date)] ERROR: .env file not found!"
fi
exit 1

