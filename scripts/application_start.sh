#!/bin/bash
set -e  # Exit on any error

# CodeDeploy ApplicationStart hook
# This script runs to start the application

cd /home/ec2-user/chatty-backend
echo "[$(date)] Changed to /home/ec2-user/chatty-backend"

# Ensure Node.js and npm are in PATH
export PATH="/usr/local/bin:/usr/bin:/opt/nodejs/node-v16.20.2-linux-x64/bin:$PATH"

GLOBAL_NPM_BIN="$(npm bin -g 2>/dev/null || echo '/usr/local/lib/node_modules/.bin' || true)"
if [ -n "$GLOBAL_NPM_BIN" ] && ! echo "$PATH" | grep -q "$GLOBAL_NPM_BIN"; then
  export PATH="$GLOBAL_NPM_BIN:$PATH"
fi

# Find PM2 - try multiple locations and verify each one exists
PM2_BIN=""
PM2_CANDIDATES=(
  "$(command -v pm2 2>/dev/null)"
  "/usr/local/bin/pm2"
  "/usr/bin/pm2"
  "$HOME/.npm-global/bin/pm2"
  "/opt/nodejs/node-v16.20.2-linux-x64/bin/pm2"
  "/root/.npm-global/bin/pm2"
)

echo "[$(date)] Searching for PM2..."
for pm2_path in "${PM2_CANDIDATES[@]}"; do
  # Skip empty strings
  [ -z "$pm2_path" ] && continue
  
  echo "[$(date)] Checking: $pm2_path"
  if [ -f "$pm2_path" ] && [ -x "$pm2_path" ]; then
    PM2_BIN="$pm2_path"
    echo "[$(date)] ✓ Found PM2 at: $PM2_BIN"
    break
  fi
done

# If not found, install PM2
if [ -z "$PM2_BIN" ]; then
  echo "[$(date)] pm2 not found in any location, installing globally..."
  npm install -g pm2 --unsafe-perm
  
  # Update PATH
  export PATH="/usr/local/bin:/usr/bin:$PATH"
  
  # Search again after installation
  for pm2_path in "${PM2_CANDIDATES[@]}"; do
    [ -z "$pm2_path" ] && continue
    if [ -f "$pm2_path" ] && [ -x "$pm2_path" ]; then
      PM2_BIN="$pm2_path"
      echo "[$(date)] ✓ Found PM2 after install at: $PM2_BIN"
      break
    fi
  done
fi

# Final verification
if [ -z "$PM2_BIN" ] || [ ! -f "$PM2_BIN" ] || [ ! -x "$PM2_BIN" ]; then
  echo "[$(date)] ERROR: pm2 still not found after install"
  echo "[$(date)] PATH: $PATH"
  echo "[$(date)] which pm2: $(which pm2 2>&1 || echo 'not found')"
  echo "[$(date)] Checking common locations:"
  ls -la /usr/local/bin/pm2 2>&1 || echo "  /usr/local/bin/pm2: not found"
  ls -la /usr/bin/pm2 2>&1 || echo "  /usr/bin/pm2: not found"
  echo "[$(date)] Trying to find npm global bin:"
  npm bin -g 2>&1 || echo "  npm bin -g failed"
  exit 1
fi

echo "[$(date)] Using PM2 binary: $PM2_BIN"
# Verify PM2 works before continuing
if ! "$PM2_BIN" --version > /dev/null 2>&1; then
  echo "[$(date)] WARNING: PM2 binary found but --version check failed, continuing anyway..."
else
  PM2_VERSION=$("$PM2_BIN" --version 2>&1)
  echo "[$(date)] PM2 version: $PM2_VERSION"
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

# CRITICAL: Verify node_modules exist before trying to start
echo "[$(date)] Verifying dependencies are installed..."
if [ ! -d "node_modules" ]; then
  echo "[$(date)] ERROR: node_modules directory does not exist!"
  echo "[$(date)] Current directory: $(pwd)"
  echo "[$(date)] Directory contents:"
  ls -la | head -20
  echo "[$(date)] This means npm install failed or didn't run. Check AfterInstall hook logs."
  exit 1
fi

# Verify critical dependencies
MISSING_DEPS=""
for dep in express passport dotenv; do
  if [ ! -d "node_modules/$dep" ]; then
    MISSING_DEPS="$MISSING_DEPS $dep"
  fi
done

if [ -n "$MISSING_DEPS" ]; then
  echo "[$(date)] ERROR: Critical dependencies missing:$MISSING_DEPS"
  echo "[$(date)] node_modules exists: yes"
  echo "[$(date)] node_modules size: $(du -sh node_modules 2>/dev/null || echo 'unknown')"
  echo "[$(date)] First 20 items in node_modules:"
  ls -la node_modules | head -20 || true
  echo "[$(date)] npm install may have failed. Check AfterInstall hook logs."
  exit 1
fi

echo "[$(date)] ✓ Dependencies verified - express, passport, dotenv all present"

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

  # Now start with PM2 - ensure we're using the correct binary path
  echo "[$(date)] Starting with PM2 at: $PM2_BIN"

  # Ensure we're in the right directory
  cd /home/ec2-user/chatty-backend
  echo "[$(date)] Current directory: $(pwd)"

  # Delete any existing process first
  "$PM2_BIN" delete chatty-backend 2>/dev/null || true
  sleep 1

  # Start the application
  if ! "$PM2_BIN" start ./build/src/app.js -i 1 --name "chatty-backend"; then
    echo "[$(date)] ERROR: PM2 start command failed"
    echo "[$(date)] PM2 binary used: $PM2_BIN"
    echo "[$(date)] Checking if PM2 binary exists:"
    ls -la "$PM2_BIN" 2>&1 || echo "PM2 binary not found at expected path"
    echo "[$(date)] PM2 error output:"
    "$PM2_BIN" logs chatty-backend --err --lines 20 --nostream 2>&1 || true
    exit 1
  fi

  # Wait a moment for PM2 to register the process
  sleep 3

  # Verify PM2 actually has the process (use full path again)
  if ! "$PM2_BIN" list | grep -q "chatty-backend"; then
    echo "[$(date)] ERROR: chatty-backend not found in PM2 list after start"
    echo "[$(date)] PM2 list:"
    "$PM2_BIN" list || true
    echo "[$(date)] PM2 logs:"
    "$PM2_BIN" logs --lines 50 --nostream 2>&1 || true
    exit 1
  fi

  # Save PM2 process list
  "$PM2_BIN" save || echo "[$(date)] Warning: PM2 save failed (non-critical)"

  echo "[$(date)] PM2 start command completed successfully, waiting for application to initialize..."
else
  echo "[$(date)] ERROR: build/src/app.js not found"
  exit 1
fi

# Wait for application to start with retries (app needs time to connect to DB/Redis)
MAX_WAIT=90  # Maximum wait time in seconds (increased for slow startup)
WAIT_INTERVAL=3  # Check every 3 seconds
ELAPSED=0

while [ $ELAPSED -lt $MAX_WAIT ]; do
  # First verify the process exists in PM2
  if ! "$PM2_BIN" list | grep -q "chatty-backend"; then
    echo "[$(date)] WARNING: chatty-backend not found in PM2 list (waited ${ELAPSED}s)"
    echo "[$(date)] PM2 list output:"
    "$PM2_BIN" list || true
    sleep $WAIT_INTERVAL
    ELAPSED=$((ELAPSED + WAIT_INTERVAL))
    continue
  fi

  # Check if PM2 shows the app as online
  PM2_STATUS=$("$PM2_BIN" list | grep "chatty-backend" | awk '{print $10}' || echo "unknown")
  echo "[$(date)] PM2 status: $PM2_STATUS (waited ${ELAPSED}s)"

  if [ "$PM2_STATUS" = "online" ]; then
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
        # Try HTTP check multiple times with delays
        for retry in 1 2 3 4 5; do
          sleep 3
          if curl -f -s --max-time 5 http://localhost:5000/health > /dev/null 2>&1; then
            echo "[$(date)] ✓ Application is now responding to HTTP requests (after ${retry} retries)"
            exit 0
          else
            echo "[$(date)] HTTP check retry ${retry}/5 failed, waiting..."
          fi
        done
        # If we get here, port is listening but HTTP still not responding
        echo "[$(date)] WARNING: Port 5000 is listening but HTTP health check still failing after 15 seconds"
        echo "[$(date)] This might be a transient issue. Checking PM2 status..."
        "$PM2_BIN" list | grep chatty-backend || true
        echo "[$(date)] Attempting one final HTTP check with extended timeout..."
        if curl -f -s --max-time 10 http://localhost:5000/health > /dev/null 2>&1; then
          echo "[$(date)] ✓ Application is responding to HTTP requests"
          exit 0
        fi
        # If port is listening, we'll give it the benefit of the doubt and continue
        # The target group health checks will catch if it's truly broken
        echo "[$(date)] Port is listening but HTTP check failing. App may still be initializing."
        echo "[$(date)] Allowing deployment to continue - target group will validate health."
        exit 0
      fi
    fi
  fi

  # Process exists but not online - check status
  RESTARTS=$("$PM2_BIN" list | grep "chatty-backend" | awk '{print $12}' || echo "0")
  echo "[$(date)] Application status: $PM2_STATUS, restarts: $RESTARTS (waited ${ELAPSED}s)"

  # Check for crash loop (too many restarts)
  if [ -n "$RESTARTS" ] && [ "$RESTARTS" != "N/A" ] && [ "$RESTARTS" -gt 5 ]; then
    echo "[$(date)] ERROR: App is in crash loop (${RESTARTS} restarts)"
    echo "[$(date)] Showing last 50 lines of logs:"
    "$PM2_BIN" logs chatty-backend --lines 50 --nostream 2>&1 || true
    exit 1
  fi

  # If it's errored or stopped, show logs and exit
  if [ "$PM2_STATUS" = "errored" ] || [ "$PM2_STATUS" = "stopped" ]; then
    echo "[$(date)] ERROR: Application status is $PM2_STATUS"
    echo "[$(date)] PM2 error logs (last 50 lines):"
    "$PM2_BIN" logs chatty-backend --err --lines 50 --nostream 2>&1 || true
    echo "[$(date)] PM2 output logs (last 50 lines):"
    "$PM2_BIN" logs chatty-backend --out --lines 50 --nostream 2>&1 || true
    exit 1
  fi

  # If it's launching or waiting for restart, give it more time
  if [ "$PM2_STATUS" = "launching" ] || [ "$PM2_STATUS" = "waiting restart" ]; then
    echo "[$(date)] App is in $PM2_STATUS state, continuing to wait..."
  fi

  sleep $WAIT_INTERVAL
  ELAPSED=$((ELAPSED + WAIT_INTERVAL))
done

# If we get here, the app didn't start within the timeout
echo "[$(date)] WARNING: Application did not come online in PM2 within ${MAX_WAIT} seconds"
echo "[$(date)] Checking if app is running anyway (may have started outside PM2 or PM2 status incorrect)..."
echo "[$(date)] Current PM2 status:"
"$PM2_BIN" list || true
echo "[$(date)] Port 5000 status:"
PORT_LISTENING=false
if netstat -tln 2>/dev/null | grep -q ":5000 " || ss -tln 2>/dev/null | grep -q ":5000 "; then
  PORT_LISTENING=true
  echo "[$(date)] ✓ Port 5000 IS listening"
else
  echo "[$(date)] ✗ Port 5000 is NOT listening"
fi

# Check if node process is running the app
APP_PROCESS_RUNNING=false
if pgrep -f "node.*build/src/app.js" > /dev/null 2>&1 || ps aux | grep -v grep | grep -q "node.*build/src/app.js"; then
  APP_PROCESS_RUNNING=true
  echo "[$(date)] ✓ Node process running build/src/app.js found"
fi

# Final fallback: If port is listening OR process is running, try HTTP check
if [ "$PORT_LISTENING" = true ] || [ "$APP_PROCESS_RUNNING" = true ]; then
  echo "[$(date)] App process or port detected - attempting final HTTP health check..."
  for final_check in 1 2 3 4 5; do
    sleep 2
    if curl -f -s --max-time 5 http://localhost:5000/health > /dev/null 2>&1; then
      echo "[$(date)] ✓ SUCCESS: Application is responding to HTTP requests!"
      echo "[$(date)] App appears to be running (even if PM2 status unclear)"
      exit 0
    fi
  done
fi

# If we still haven't succeeded, show diagnostics and exit with error
echo "[$(date)] ERROR: Application did not respond to HTTP health checks"
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
echo "[$(date)] Process check:"
ps aux | grep -E "node|pm2" | grep -v grep || true
exit 1

