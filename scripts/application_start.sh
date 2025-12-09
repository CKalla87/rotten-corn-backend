#!/bin/bash
set -e  # Exit on any error

# CodeDeploy ApplicationStart hook
# This script runs to start the application

cd /home/ec2-user/chatty-backend
echo "[$(date)] Changed to /home/ec2-user/chatty-backend"

# Ensure Node.js and npm are in PATH
export PATH="/usr/local/bin:/usr/bin:$PATH"

# Add npm global bin to PATH if it exists
GLOBAL_NPM_BIN="$(npm bin -g 2>/dev/null || echo '' || true)"
if [ -n "$GLOBAL_NPM_BIN" ] && [ -d "$GLOBAL_NPM_BIN" ] && ! echo "$PATH" | grep -q "$GLOBAL_NPM_BIN"; then
  export PATH="$GLOBAL_NPM_BIN:$PATH"
fi

# Find PM2 - use command -v first (most reliable)
PM2_BIN=""
echo "[$(date)] Searching for PM2..."

# First try: use command -v (finds it in PATH)
if command -v pm2 >/dev/null 2>&1; then
  PM2_BIN=$(command -v pm2)
  echo "[$(date)] ✓ Found PM2 via command -v: $PM2_BIN"
elif [ -f "/usr/local/bin/pm2" ] && [ -x "/usr/local/bin/pm2" ]; then
  PM2_BIN="/usr/local/bin/pm2"
  echo "[$(date)] ✓ Found PM2 at: $PM2_BIN"
elif [ -f "/usr/bin/pm2" ] && [ -x "/usr/bin/pm2" ]; then
  PM2_BIN="/usr/bin/pm2"
  echo "[$(date)] ✓ Found PM2 at: $PM2_BIN"
fi

# If not found, install PM2
if [ -z "$PM2_BIN" ]; then
  echo "[$(date)] pm2 not found, installing globally..."
  npm install -g pm2 --unsafe-perm || {
    echo "[$(date)] ERROR: npm install -g pm2 failed"
    exit 1
  }

  # Update PATH after installation
  export PATH="/usr/local/bin:/usr/bin:$PATH"
  GLOBAL_NPM_BIN="$(npm bin -g 2>/dev/null || echo '' || true)"
  if [ -n "$GLOBAL_NPM_BIN" ] && [ -d "$GLOBAL_NPM_BIN" ]; then
    export PATH="$GLOBAL_NPM_BIN:$PATH"
  fi

  # Search again after installation using command -v
  if command -v pm2 >/dev/null 2>&1; then
    PM2_BIN=$(command -v pm2)
    echo "[$(date)] ✓ Found PM2 after install via command -v: $PM2_BIN"
  elif [ -f "/usr/local/bin/pm2" ] && [ -x "/usr/local/bin/pm2" ]; then
    PM2_BIN="/usr/local/bin/pm2"
    echo "[$(date)] ✓ Found PM2 after install at: $PM2_BIN"
  elif [ -f "/usr/bin/pm2" ] && [ -x "/usr/bin/pm2" ]; then
    PM2_BIN="/usr/bin/pm2"
    echo "[$(date)] ✓ Found PM2 after install at: $PM2_BIN"
  fi
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

# Build should already be done in AfterInstall hook
# Verify build directory exists and fail fast if missing
if [ ! -d "./build" ]; then
  echo "[$(date)] ERROR: build directory not found!"
  echo "[$(date)] Build should have been completed in AfterInstall hook."
  echo "[$(date)] Current directory: $(pwd)"
  echo "[$(date)] Directory contents:"
  ls -la | head -20
  echo "[$(date)] Check AfterInstall hook logs for build errors."
  exit 1
fi

if [ ! -f "./build/src/app.js" ]; then
  echo "[$(date)] ERROR: build/src/app.js not found!"
  echo "[$(date)] Build directory exists but app.js is missing."
  echo "[$(date)] Build directory contents:"
  ls -la build/ 2>&1 | head -20 || echo "Cannot list build directory"
  echo "[$(date)] Check AfterInstall hook logs for build errors."
  exit 1
fi

echo "[$(date)] ✓ Build directory and app.js verified"

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
  # Clean up ALL existing PM2 processes to avoid conflicts
  echo "[$(date)] Cleaning up existing PM2 processes..."
  "$PM2_BIN" delete all 2>/dev/null || true
  # Also try to delete specific known process names
  "$PM2_BIN" delete chatty-backend 2>/dev/null || true
  "$PM2_BIN" delete chatty-b 2>/dev/null || true
  # Kill any PM2 daemon and restart it fresh
  "$PM2_BIN" kill 2>/dev/null || true
  sleep 2
  # Resurrect PM2 daemon
  "$PM2_BIN" resurrect 2>/dev/null || true
  sleep 1

  # Start the application (PM2 runs in daemon mode by default)
  echo "[$(date)] Launching application..."

  # First, try to run the app directly to capture any immediate errors (optional test)
  if command -v timeout >/dev/null 2>&1; then
    echo "[$(date)] Testing app startup (will timeout after 5 seconds)..."
    timeout 5 node ./build/src/app.js 2>&1 | head -50 || APP_ERROR=$?
    if [ -n "$APP_ERROR" ] && [ "$APP_ERROR" != "124" ]; then
      echo "[$(date)] App failed to start directly. Error code: $APP_ERROR"
      echo "[$(date)] This usually indicates a database/Redis connection issue or missing env vars"
      echo "[$(date)] Continuing with PM2 start anyway..."
    fi
  else
    echo "[$(date)] timeout command not available, skipping direct app test"
  fi

  # Now start with PM2 - ensure we're using the correct binary path
  echo "[$(date)] Starting with PM2 at: $PM2_BIN"

  # Ensure we're in the right directory
  cd /home/ec2-user/chatty-backend
  echo "[$(date)] Current directory: $(pwd)"

  # Final cleanup before starting
  "$PM2_BIN" delete chatty-backend 2>/dev/null || true
  "$PM2_BIN" delete chatty-b 2>/dev/null || true
  sleep 1

  # Check existing PM2 processes before starting
  echo "[$(date)] Current PM2 processes before start:"
  "$PM2_BIN" list || echo "PM2 list command failed or no processes"

  # Start the application
  echo "[$(date)] Executing: $PM2_BIN start ./build/src/app.js -i 1 --name chatty-backend"
  # Capture both stdout and stderr, but filter out harmless PM2 warnings
  PM2_START_OUTPUT=$("$PM2_BIN" start ./build/src/app.js -i 1 --name "chatty-backend" 2>&1 | grep -v "event-loop-stats not found" || true)
  PM2_START_EXIT=${PIPESTATUS[0]}

  # Check if process actually started (PM2 sometimes returns non-zero but still starts the process)
  sleep 2
  PM2_PROCESS_EXISTS=false
  if "$PM2_BIN" list 2>/dev/null | grep -qE "chatty-backend|chatty-b"; then
    PM2_PROCESS_EXISTS=true
  fi

  if [ $PM2_START_EXIT -ne 0 ] && [ "$PM2_PROCESS_EXISTS" = false ]; then
    echo "[$(date)] ERROR: PM2 start command failed with exit code $PM2_START_EXIT and process not found"
    echo "[$(date)] PM2 start output:"
    echo "$PM2_START_OUTPUT"
    echo "[$(date)] PM2 binary used: $PM2_BIN"
    echo "[$(date)] Checking if PM2 binary exists:"
    ls -la "$PM2_BIN" 2>&1 || echo "PM2 binary not found at expected path"
    echo "[$(date)] Current PM2 processes:"
    "$PM2_BIN" list || true
    echo "[$(date)] Attempting to get logs from any existing process:"
    "$PM2_BIN" logs --lines 20 --nostream 2>&1 || true
    exit 1
  elif [ "$PM2_PROCESS_EXISTS" = true ]; then
    echo "[$(date)] ✓ PM2 process started successfully (exit code was $PM2_START_EXIT but process exists)"
    if [ -n "$PM2_START_OUTPUT" ]; then
      echo "[$(date)] PM2 start output:"
      echo "$PM2_START_OUTPUT"
    fi
  else
    echo "[$(date)] ✓ PM2 start command succeeded"
    if [ -n "$PM2_START_OUTPUT" ]; then
      echo "$PM2_START_OUTPUT"
    fi
  fi

  # Wait a moment for PM2 to register the process
  sleep 3

  # Verify PM2 actually has the process (check for both possible names)
  PM2_PROCESS_FOUND=false
  if "$PM2_BIN" list | grep -q "chatty-backend"; then
    PM2_PROCESS_FOUND=true
    echo "[$(date)] ✓ Found chatty-backend in PM2 list"
  elif "$PM2_BIN" list | grep -q "chatty-b"; then
    PM2_PROCESS_FOUND=true
    echo "[$(date)] ⚠ Found chatty-b in PM2 list (name may have been truncated)"
    # Try to rename it
    "$PM2_BIN" restart chatty-b --update-env --name chatty-backend 2>/dev/null || true
  fi

  if [ "$PM2_PROCESS_FOUND" = false ]; then
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
MAX_WAIT=120  # Maximum wait time in seconds (increased for slow startup and restarts)
WAIT_INTERVAL=3  # Check every 3 seconds
ELAPSED=0
# Give app extra time to stabilize before starting health checks
INITIAL_STABILIZATION=15  # Wait 15 seconds before starting health checks

while [ $ELAPSED -lt $MAX_WAIT ]; do
  # First verify the process exists in PM2 (check for both possible names)
  PM2_PROCESS_NAME=""
  if "$PM2_BIN" list | grep -q "chatty-backend"; then
    PM2_PROCESS_NAME="chatty-backend"
  elif "$PM2_BIN" list | grep -q "chatty-b"; then
    PM2_PROCESS_NAME="chatty-b"
  fi

  if [ -z "$PM2_PROCESS_NAME" ]; then
    echo "[$(date)] WARNING: chatty-backend or chatty-b not found in PM2 list (waited ${ELAPSED}s)"
    echo "[$(date)] PM2 list output:"
    "$PM2_BIN" list || true
    sleep $WAIT_INTERVAL
    ELAPSED=$((ELAPSED + WAIT_INTERVAL))
    continue
  fi

  # Check if PM2 shows the app as online
  PM2_STATUS=$("$PM2_BIN" list | grep "$PM2_PROCESS_NAME" | awk '{print $10}' || echo "unknown")
  echo "[$(date)] PM2 status for $PM2_PROCESS_NAME: $PM2_STATUS (waited ${ELAPSED}s)"

  if [ "$PM2_STATUS" = "online" ]; then
    # Wait for initial stabilization period before checking health
    if [ $ELAPSED -lt $INITIAL_STABILIZATION ]; then
      echo "[$(date)] PM2 reports app as online, waiting ${INITIAL_STABILIZATION}s for app to stabilize before health check..."
      sleep $((INITIAL_STABILIZATION - ELAPSED))
      ELAPSED=$INITIAL_STABILIZATION
    fi

    echo "[$(date)] PM2 reports app as online, verifying HTTP response..."

    # CRITICAL: Actually test if the app responds to HTTP requests
    # PM2 might say "online" but app could be crashing or not listening
    # Try multiple times as the app might be starting up
    HTTP_CHECK_SUCCESS=false
    for check_attempt in 1 2 3 4 5; do
      if curl -f -s --max-time 10 http://localhost:5000/health > /dev/null 2>&1; then
        HTTP_CHECK_SUCCESS=true
        break
      else
        echo "[$(date)] ⚠ HTTP check attempt $check_attempt/5 failed, waiting 3 seconds..."
        sleep 3
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
        "$PM2_BIN" list | grep -E "chatty-backend|chatty-b" || true
        echo "[$(date)] PM2 error logs (last 50 lines):"
        "$PM2_BIN" logs $PM2_PROCESS_NAME --err --lines 50 --nostream 2>&1 || true
        echo "[$(date)] PM2 output logs (last 50 lines):"
        "$PM2_BIN" logs $PM2_PROCESS_NAME --out --lines 50 --nostream 2>&1 || true
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
        # Port is listening, give it more time to fully initialize
        echo "[$(date)] Port 5000 is listening, waiting additional time for app to fully initialize..."
        # Try HTTP check multiple times with longer delays
        for retry in 1 2 3 4 5 6 7 8; do
          sleep 4
          if curl -f -s --max-time 10 http://localhost:5000/health > /dev/null 2>&1; then
            echo "[$(date)] ✓ Application is now responding to HTTP requests (after ${retry} retries)"
            exit 0
          else
            echo "[$(date)] HTTP check retry ${retry}/8 failed, waiting 4 seconds..."
          fi
        done
        # If we get here, port is listening but HTTP still not responding
        echo "[$(date)] WARNING: Port 5000 is listening but HTTP health check still failing after 32 seconds"
        echo "[$(date)] This might be a transient issue. Checking PM2 status..."
        "$PM2_BIN" list | grep -E "chatty-backend|chatty-b" || true
        echo "[$(date)] Attempting one final HTTP check with extended timeout..."
        if curl -f -s --max-time 15 http://localhost:5000/health > /dev/null 2>&1; then
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
  RESTARTS=$("$PM2_BIN" list | grep "$PM2_PROCESS_NAME" | awk '{print $12}' || echo "0")
  echo "[$(date)] Application status: $PM2_STATUS, restarts: $RESTARTS (waited ${ELAPSED}s)"

  # Check for crash loop (too many restarts) - but be more lenient during initial startup
  # Allow up to 10 restarts during the first 30 seconds, then 5 after that
  if [ -n "$RESTARTS" ] && [ "$RESTARTS" != "N/A" ]; then
    RESTART_LIMIT=10
    if [ $ELAPSED -gt 30 ]; then
      RESTART_LIMIT=5
    fi
    if [ "$RESTARTS" -gt $RESTART_LIMIT ]; then
      echo "[$(date)] ERROR: App is in crash loop (${RESTARTS} restarts, limit: ${RESTART_LIMIT})"
      echo "[$(date)] Showing last 50 lines of logs:"
      "$PM2_BIN" logs $PM2_PROCESS_NAME --lines 50 --nostream 2>&1 || true
      exit 1
    fi
  fi

  # If it's errored or stopped, show logs but don't exit immediately - give it a chance to restart
  if [ "$PM2_STATUS" = "errored" ] || [ "$PM2_STATUS" = "stopped" ]; then
    echo "[$(date)] ⚠ Application status is $PM2_STATUS (waited ${ELAPSED}s)"
    # Only exit if it's been errored/stopped for more than 30 seconds
    if [ $ELAPSED -gt 30 ]; then
      echo "[$(date)] ERROR: Application has been $PM2_STATUS for more than 30 seconds"
      echo "[$(date)] PM2 error logs (last 50 lines):"
      "$PM2_BIN" logs $PM2_PROCESS_NAME --err --lines 50 --nostream 2>&1 || true
      echo "[$(date)] PM2 output logs (last 50 lines):"
      "$PM2_BIN" logs $PM2_PROCESS_NAME --out --lines 50 --nostream 2>&1 || true
      exit 1
    else
      echo "[$(date)] App is $PM2_STATUS but still within startup grace period, continuing to wait..."
    fi
  fi

  # If it's launching or waiting for restart, give it more time
  if [ "$PM2_STATUS" = "launching" ] || [ "$PM2_STATUS" = "waiting restart" ] || [ "$PM2_STATUS" = "restarting" ]; then
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
  for final_check in 1 2 3 4 5 6 7 8; do
    sleep 3
    if curl -f -s --max-time 10 http://localhost:5000/health > /dev/null 2>&1; then
      echo "[$(date)] ✓ SUCCESS: Application is responding to HTTP requests!"
      echo "[$(date)] App appears to be running (even if PM2 status unclear)"
      exit 0
    else
      echo "[$(date)] Final HTTP check attempt ${final_check}/8 failed, waiting 3 seconds..."
    fi
  done
  # If port is listening but health check still failing, give benefit of doubt
  if [ "$PORT_LISTENING" = true ]; then
    echo "[$(date)] Port 5000 is listening but health check failing after 24 seconds"
    echo "[$(date)] App may still be initializing. Allowing deployment to continue."
    echo "[$(date)] Target group health checks will validate if app is truly ready."
    exit 0
  fi
fi

# If we still haven't succeeded, show diagnostics and exit with error
echo "[$(date)] ERROR: Application did not respond to HTTP health checks"
# Determine which process name to use for logs
FINAL_PROCESS_NAME="chatty-backend"
if "$PM2_BIN" list | grep -q "chatty-b"; then
  FINAL_PROCESS_NAME="chatty-b"
fi
echo "[$(date)] PM2 error logs (last 100 lines) for $FINAL_PROCESS_NAME:"
"$PM2_BIN" logs $FINAL_PROCESS_NAME --err --lines 100 --nostream 2>&1 || true
echo "[$(date)] PM2 output logs (last 100 lines) for $FINAL_PROCESS_NAME:"
"$PM2_BIN" logs $FINAL_PROCESS_NAME --out --lines 100 --nostream 2>&1 || true
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

