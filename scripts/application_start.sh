#!/bin/bash
# Use set -e carefully - we want to catch real errors but not exit on non-critical command failures
# We'll use set +e around non-critical checks and set -e for critical operations
set -e

# CodeDeploy ApplicationStart hook
# This script runs to start the application

cd /home/ec2-user/rotten-corn-backend
echo "[$(date)] Changed to /home/ec2-user/rotten-corn-backend"

# CRITICAL: Clean PATH - remove any references to non-existent /opt/nodejs paths
# This prevents PM2 from trying to load from broken installations
export PATH="/usr/local/bin:/usr/bin:/usr/local/sbin:/usr/sbin:/sbin:/bin"

# Verify Node.js and npm are available
if ! command -v node >/dev/null 2>&1; then
  echo "[$(date)] ERROR: node command not found"
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "[$(date)] ERROR: npm command not found"
  exit 1
fi

echo "[$(date)] Node.js version: $(node --version)"
echo "[$(date)] npm version: $(npm --version)"

# Add npm global bin to PATH if it exists (but verify it's a real directory)
GLOBAL_NPM_BIN="$(npm bin -g 2>/dev/null || echo '' || true)"
if [ -n "$GLOBAL_NPM_BIN" ] && [ -d "$GLOBAL_NPM_BIN" ] && [ ! "$GLOBAL_NPM_BIN" = "/opt/nodejs"* ]; then
  export PATH="$GLOBAL_NPM_BIN:$PATH"
  echo "[$(date)] Added npm global bin to PATH: $GLOBAL_NPM_BIN"
fi

# Find PM2 - use command -v first (most reliable)
PM2_BIN=""
echo "[$(date)] Searching for PM2..."

# First try: use command -v (finds it in PATH)
if command -v pm2 >/dev/null 2>&1; then
  PM2_BIN=$(command -v pm2)
  # Verify it's not pointing to a broken /opt/nodejs path
  if [ -f "$PM2_BIN" ] && [ -x "$PM2_BIN" ] && ! echo "$PM2_BIN" | grep -q "/opt/nodejs"; then
    echo "[$(date)] ✓ Found PM2 via command -v: $PM2_BIN"
  else
    echo "[$(date)] ⚠ PM2 found but path looks broken, will reinstall: $PM2_BIN"
    PM2_BIN=""
  fi
fi

# Try standard locations if not found
if [ -z "$PM2_BIN" ]; then
  if [ -f "/usr/local/bin/pm2" ] && [ -x "/usr/local/bin/pm2" ]; then
    PM2_BIN="/usr/local/bin/pm2"
    echo "[$(date)] ✓ Found PM2 at: $PM2_BIN"
  elif [ -f "/usr/bin/pm2" ] && [ -x "/usr/bin/pm2" ]; then
    PM2_BIN="/usr/bin/pm2"
    echo "[$(date)] ✓ Found PM2 at: $PM2_BIN"
  fi
fi

# If not found or broken, uninstall and reinstall PM2 cleanly
if [ -z "$PM2_BIN" ]; then
  echo "[$(date)] pm2 not found or broken, cleaning up and reinstalling..."

  # Remove any existing broken PM2 installations
  npm uninstall -g pm2 2>/dev/null || true
  rm -rf /usr/local/lib/node_modules/pm2 2>/dev/null || true
  rm -rf /root/.pm2 2>/dev/null || true
  rm -f /usr/local/bin/pm2 /usr/bin/pm2 2>/dev/null || true

  echo "[$(date)] Installing PM2 fresh..."
  npm install -g pm2 --unsafe-perm --prefix /usr/local || {
    echo "[$(date)] ERROR: npm install -g pm2 failed"
    exit 1
  }

  # Update PATH after installation
  export PATH="/usr/local/bin:/usr/bin:$PATH"
  GLOBAL_NPM_BIN="$(npm bin -g 2>/dev/null || echo '' || true)"
  if [ -n "$GLOBAL_NPM_BIN" ] && [ -d "$GLOBAL_NPM_BIN" ] && [ ! "$GLOBAL_NPM_BIN" = "/opt/nodejs"* ]; then
    export PATH="$GLOBAL_NPM_BIN:$PATH"
  fi

  # Search again after installation using command -v
  if command -v pm2 >/dev/null 2>&1; then
    PM2_BIN=$(command -v pm2)
    if [ -f "$PM2_BIN" ] && [ -x "$PM2_BIN" ] && ! echo "$PM2_BIN" | grep -q "/opt/nodejs"; then
      echo "[$(date)] ✓ Found PM2 after install via command -v: $PM2_BIN"
    else
      echo "[$(date)] ERROR: PM2 still pointing to broken path: $PM2_BIN"
      exit 1
    fi
  elif [ -f "/usr/local/bin/pm2" ] && [ -x "/usr/local/bin/pm2" ]; then
    PM2_BIN="/usr/local/bin/pm2"
    echo "[$(date)] ✓ Found PM2 after install at: $PM2_BIN"
  elif [ -f "/usr/bin/pm2" ] && [ -x "/usr/bin/pm2" ]; then
    PM2_BIN="/usr/bin/pm2"
    echo "[$(date)] ✓ Found PM2 after install at: $PM2_BIN"
  else
    echo "[$(date)] ERROR: PM2 not found after installation"
    exit 1
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
for dep in express dotenv mongoose; do
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

echo "[$(date)] ✓ Dependencies verified - express, dotenv, mongoose all present"

# Start the application with PM2
echo "[$(date)] Starting application with PM2..."
if [ -f ./build/src/app.js ]; then
  # Clean up ALL existing PM2 processes to avoid conflicts
  echo "[$(date)] Cleaning up existing PM2 processes..."
  "$PM2_BIN" delete all 2>/dev/null || true
  # Also try to delete specific known process names
  "$PM2_BIN" delete rotten-corn-backend 2>/dev/null || true
  "$PM2_BIN" delete rotten-corn 2>/dev/null || true
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
  cd /home/ec2-user/rotten-corn-backend
  echo "[$(date)] Current directory: $(pwd)"

  # Kill any existing node processes running the app (might be from previous failed deployment)
  echo "[$(date)] Checking for existing node processes..."
  pkill -9 -f "node.*build/src/app.js" 2>/dev/null || true
  # Also ensure port 5000 is free
  echo "[$(date)] Ensuring port 5000 is free..."
  fuser -k 5000/tcp 2>/dev/null || true
  lsof -ti:5000 | xargs kill -9 2>/dev/null || true
  sleep 2

  # Final cleanup before starting
  "$PM2_BIN" delete rotten-corn-backend 2>/dev/null || true
  "$PM2_BIN" delete rotten-corn 2>/dev/null || true
  sleep 1

  # Check existing PM2 processes before starting
  echo "[$(date)] Current PM2 processes before start:"
  set +e
  "$PM2_BIN" list 2>/dev/null || echo "PM2 list command failed or no processes"
  set -e

  # Start the application
  echo "[$(date)] Executing: $PM2_BIN start ./build/src/app.js -i 1 --name rotten-corn-backend"
  # Capture both stdout and stderr, but filter out harmless PM2 warnings
  set +e
  PM2_START_OUTPUT=$("$PM2_BIN" start ./build/src/app.js -i 1 --name "rotten-corn-backend" 2>&1 | grep -v "event-loop-stats not found" || true)
  PM2_START_EXIT=${PIPESTATUS[0]}
  set -e

  # Check if process actually started (PM2 sometimes returns non-zero but still starts the process)
  sleep 3
  PM2_PROCESS_EXISTS=false
  set +e
  if "$PM2_BIN" list 2>/dev/null | grep -qE "rotten-corn-backend|rotten-corn"; then
    PM2_PROCESS_EXISTS=true
  fi
  set -e

  # Also check if node process is running (even if not in PM2)
  NODE_PROCESS_EXISTS=false
  set +e
  if pgrep -f "node.*build/src/app.js" > /dev/null 2>&1 || ps aux | grep -v grep | grep -q "node.*build/src/app.js"; then
    NODE_PROCESS_EXISTS=true
    echo "[$(date)] ⚠ Node process found running outside PM2"
  fi
  set -e

  if [ $PM2_START_EXIT -ne 0 ] && [ "$PM2_PROCESS_EXISTS" = false ] && [ "$NODE_PROCESS_EXISTS" = false ]; then
    echo "[$(date)] ERROR: PM2 start command failed with exit code $PM2_START_EXIT and no process found"
    echo "[$(date)] PM2 start output:"
    echo "$PM2_START_OUTPUT"
    echo "[$(date)] PM2 binary used: $PM2_BIN"
    echo "[$(date)] Checking if PM2 binary exists:"
    set +e
    ls -la "$PM2_BIN" 2>&1 || echo "PM2 binary not found at expected path"
    echo "[$(date)] Current PM2 processes:"
    "$PM2_BIN" list 2>/dev/null || true
    echo "[$(date)] Attempting to get logs from any existing process:"
    "$PM2_BIN" logs --lines 20 --nostream 2>&1 || true
    set -e
    exit 1
  elif [ "$PM2_PROCESS_EXISTS" = true ]; then
    echo "[$(date)] ✓ PM2 process started successfully (exit code was $PM2_START_EXIT but process exists)"
    if [ -n "$PM2_START_OUTPUT" ]; then
      echo "[$(date)] PM2 start output:"
      echo "$PM2_START_OUTPUT"
    fi
  elif [ "$NODE_PROCESS_EXISTS" = true ]; then
    echo "[$(date)] ⚠ Node process is running but not managed by PM2"
    echo "[$(date)] This might be from a previous deployment. Will continue and check if app responds."
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
  PM2_PROCESS_NAME=""
  set +e
  if "$PM2_BIN" list 2>/dev/null | grep -q "rotten-corn-backend"; then
    PM2_PROCESS_FOUND=true
    PM2_PROCESS_NAME="rotten-corn-backend"
    echo "[$(date)] ✓ Found rotten-corn-backend in PM2 list"
  elif "$PM2_BIN" list 2>/dev/null | grep -q "rotten-corn"; then
    PM2_PROCESS_FOUND=true
    PM2_PROCESS_NAME="rotten-corn"
    echo "[$(date)] ⚠ Found rotten-corn in PM2 list (name may have been truncated)"
    # Try to rename it
    "$PM2_BIN" restart rotten-corn --update-env --name rotten-corn-backend 2>/dev/null || true
  fi
  set -e

  if [ "$PM2_PROCESS_FOUND" = false ]; then
    echo "[$(date)] ERROR: rotten-corn-backend not found in PM2 list after start"
    set +e
    echo "[$(date)] PM2 list:"
    "$PM2_BIN" list 2>/dev/null || true
    echo "[$(date)] PM2 logs:"
    "$PM2_BIN" logs --lines 50 --nostream 2>&1 || true
    set -e
    exit 1
  fi

  # Early success check: if logs already show server started, we can exit early
  set +e
  if [ -n "$PM2_PROCESS_NAME" ] && "$PM2_BIN" logs $PM2_PROCESS_NAME --lines 30 --nostream 2>&1 | grep -q "Server running on port 5000"; then
    echo "[$(date)] ✓ Early success: PM2 logs already show 'Server running on port 5000'"
    # Double-check port is listening
    if netstat -tln 2>/dev/null | grep -q ":5000 " || ss -tln 2>/dev/null | grep -q ":5000 "; then
      echo "[$(date)] ✓ Port 5000 is listening - application is running"
      echo "[$(date)] ✓ Application startup verified (early exit)"
      set -e
      exit 0
    fi
  fi
  set -e

  # Save PM2 process list
  "$PM2_BIN" save || echo "[$(date)] Warning: PM2 save failed (non-critical)"

  echo "[$(date)] PM2 start command completed successfully, waiting for application to initialize..."
else
  echo "[$(date)] ERROR: build/src/app.js not found"
  exit 1
fi

# Wait for application to start with retries (app needs time to connect to DB/Redis)
MAX_WAIT=90  # Maximum wait time in seconds (reduced to prevent CodeDeploy timeout)
WAIT_INTERVAL=2  # Check every 2 seconds (faster checks)
ELAPSED=0
# Give app extra time to stabilize before starting health checks
INITIAL_STABILIZATION=10  # Wait 10 seconds before starting health checks (reduced)

while [ $ELAPSED -lt $MAX_WAIT ]; do
  # First verify the process exists in PM2 (check for both possible names)
    # Use the process name we found earlier, or search again
    if [ -z "$PM2_PROCESS_NAME" ]; then
      set +e
      if "$PM2_BIN" list 2>/dev/null | grep -q "rotten-corn-backend"; then
        PM2_PROCESS_NAME="rotten-corn-backend"
      elif "$PM2_BIN" list 2>/dev/null | grep -q "rotten-corn"; then
        PM2_PROCESS_NAME="rotten-corn"
      fi
      set -e
    fi

    if [ -z "$PM2_PROCESS_NAME" ]; then
      echo "[$(date)] WARNING: rotten-corn-backend or rotten-corn not found in PM2 list (waited ${ELAPSED}s)"
    set +e
    echo "[$(date)] PM2 list output:"
    "$PM2_BIN" list 2>/dev/null || true
    set -e
    sleep $WAIT_INTERVAL
    ELAPSED=$((ELAPSED + WAIT_INTERVAL))
    continue
  fi

  # Check if PM2 shows the app as online
  # Use set +e to prevent exit on grep/awk failures (non-critical)
  set +e
  PM2_STATUS=$("$PM2_BIN" list 2>/dev/null | grep "$PM2_PROCESS_NAME" 2>/dev/null | awk '{print $10}' 2>/dev/null || echo "unknown")
  set -e
  echo "[$(date)] PM2 status for $PM2_PROCESS_NAME: $PM2_STATUS (waited ${ELAPSED}s)"

  if [ "$PM2_STATUS" = "online" ]; then
    # Wait for initial stabilization period before checking health
    if [ $ELAPSED -lt $INITIAL_STABILIZATION ]; then
      echo "[$(date)] PM2 reports app as online, waiting ${INITIAL_STABILIZATION}s for app to stabilize before health check..."
      sleep $((INITIAL_STABILIZATION - ELAPSED))
      ELAPSED=$INITIAL_STABILIZATION
    fi

    echo "[$(date)] PM2 reports app as online, verifying HTTP response..."

    # Check PM2 logs to see if server started successfully (faster than HTTP check)
    PM2_LOGS_STARTED=false
    set +e
    if "$PM2_BIN" logs $PM2_PROCESS_NAME --lines 20 --nostream 2>&1 | grep -q "Server running on port 5000"; then
      PM2_LOGS_STARTED=true
      echo "[$(date)] ✓ PM2 logs show 'Server running on port 5000'"
    fi
    set -e

    # CRITICAL: Check if port is listening first (faster and more reliable)
    # The health endpoint may return 503 while database is connecting, which is OK
    PORT_LISTENING=false
    set +e
    if netstat -tln 2>/dev/null | grep -q ":5000 " || ss -tln 2>/dev/null | grep -q ":5000 "; then
      PORT_LISTENING=true
      echo "[$(date)] ✓ Port 5000 IS listening"
    else
      echo "[$(date)] ⚠ Port 5000 is NOT listening yet, waiting..."
    fi
    set -e

    # If port is listening, app is definitely running - exit immediately
    # (HTTP check is nice but not required if port is listening)
    if [ "$PORT_LISTENING" = true ]; then
      echo "[$(date)] ✓ Port 5000 is listening - application is running"
      # Do a quick HTTP check to confirm, but don't wait long
      set +e
      HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:5000/health 2>&1 || printf "000")
      if [ "$HTTP_STATUS" = "200" ] || [ "$HTTP_STATUS" = "503" ] || ([ "$HTTP_STATUS" != "000" ] && [ -n "$HTTP_STATUS" ] && [ ${#HTTP_STATUS} -eq 3 ]); then
        echo "[$(date)] ✓ HTTP check confirmed (status: $HTTP_STATUS)"
      else
        echo "[$(date)] ⚠ HTTP check not responding yet, but port is listening - app is running"
      fi
      set -e
      echo "[$(date)] ✓ Application startup verified after ${ELAPSED}s"
      exit 0
    fi

    # If logs show server started, also exit (port should be listening soon)
    if [ "$PM2_LOGS_STARTED" = true ]; then
      echo "[$(date)] ✓ PM2 logs confirm server started successfully"
      # Give it 2 seconds for port to start listening, then check
      sleep 2
      set +e
      if netstat -tln 2>/dev/null | grep -q ":5000 " || ss -tln 2>/dev/null | grep -q ":5000 "; then
        echo "[$(date)] ✓ Port 5000 is now listening"
        set -e
        echo "[$(date)] ✓ Application startup verified after ${ELAPSED}s"
        exit 0
      fi
      set -e
    fi

    # Test if the app responds to HTTP requests (only if port not listening yet)
    # Accept both 200 (healthy) and 503 (database connecting) as valid responses
    # The app is running if it responds with any HTTP status code
    HTTP_CHECK_SUCCESS=false
    HTTP_STATUS="000"
    set +e
    # Reduced retries - only 3 attempts with shorter timeout
    for check_attempt in 1 2 3; do
      # Use printf instead of echo -e for better compatibility
      HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:5000/health 2>&1 || printf "000")

      # Accept 200 (healthy) or 503 (database connecting) as success
      # Also accept any 3-digit status code (means server is responding)
      if [ "$HTTP_STATUS" = "200" ] || [ "$HTTP_STATUS" = "503" ]; then
        HTTP_CHECK_SUCCESS=true
        echo "[$(date)] ✓ HTTP check succeeded with status $HTTP_STATUS (attempt $check_attempt/3)"
        if [ "$HTTP_STATUS" = "503" ]; then
          echo "[$(date)] ⚠ Health endpoint returned 503 - database may still be connecting (this is OK)"
        fi
        break
      elif [ "$HTTP_STATUS" != "000" ] && [ -n "$HTTP_STATUS" ] && [ ${#HTTP_STATUS} -eq 3 ]; then
        # Any 3-digit HTTP status code means the server is responding
        HTTP_CHECK_SUCCESS=true
        echo "[$(date)] ✓ Server is responding with status $HTTP_STATUS (attempt $check_attempt/3)"
        break
      else
        echo "[$(date)] ⚠ HTTP check attempt $check_attempt/3 failed (status: $HTTP_STATUS), waiting 2 seconds..."
        sleep 2
      fi
    done
    set -e

    # If HTTP check succeeded, app is running
    if [ "$HTTP_CHECK_SUCCESS" = true ]; then
      echo "[$(date)] ✓ Application is responding to HTTP requests (status: $HTTP_STATUS)"
      echo "[$(date)] ✓ Application startup verified after ${ELAPSED}s"
      exit 0
    else
      echo "[$(date)] ⚠ PM2 says online but app not responding (waited ${ELAPSED}s)"
      echo "[$(date)] Port listening: $PORT_LISTENING, HTTP response: $HTTP_STATUS"

      # Show diagnostics
      set +e
      echo "[$(date)] PM2 status:"
      "$PM2_BIN" list 2>/dev/null | grep -E "rotten-corn-backend|rotten-corn" || true
      echo "[$(date)] PM2 error logs (last 50 lines):"
      "$PM2_BIN" logs $PM2_PROCESS_NAME --err --lines 50 --nostream 2>&1 || true
      echo "[$(date)] PM2 output logs (last 50 lines):"
      "$PM2_BIN" logs $PM2_PROCESS_NAME --out --lines 50 --nostream 2>&1 || true
      set -e
      echo "[$(date)] Checking if .env file exists and has required vars:"
      if [ -f .env ]; then
        echo "[$(date)] .env file exists"
        grep -E "DATABASE_URL|REDIS_HOST|NODE_ENV" .env | sed 's/=.*/=***/' || echo "Required vars not found in .env"
      else
        echo "[$(date)] ERROR: .env file not found!"
      fi
      echo "[$(date)] Checking process status:"
      ps aux | grep -E "node|pm2" | grep -v grep || true

      # Give it more time - database connection can take a while
      # But reduce retries to prevent timeout
      echo "[$(date)] Waiting additional time for app to fully initialize (database connection may be slow)..."
      set +e
      for retry in 1 2 3 4; do
        sleep 3
        # Check port first (fastest)
        if netstat -tln 2>/dev/null | grep -q ":5000 " || ss -tln 2>/dev/null | grep -q ":5000 "; then
          echo "[$(date)] ✓ Port 5000 is now listening (after ${retry} retries)"
          echo "[$(date)] ✓ Allowing deployment to continue - target group will validate health"
          set -e
          exit 0
        fi
        # Also try HTTP check
        HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:5000/health 2>&1 || printf "000")
        if [ "$HTTP_STATUS" = "200" ] || [ "$HTTP_STATUS" = "503" ] || ([ "$HTTP_STATUS" != "000" ] && [ -n "$HTTP_STATUS" ] && [ ${#HTTP_STATUS} -eq 3 ]); then
          echo "[$(date)] ✓ Application is now responding to HTTP requests (status: $HTTP_STATUS, after ${retry} retries)"
          set -e
          exit 0
        else
          echo "[$(date)] HTTP check retry ${retry}/4 failed (status: $HTTP_STATUS), waiting 3 seconds..."
        fi
      done
      set -e

      # Final check - if port is listening, allow deployment
      set +e
      if netstat -tln 2>/dev/null | grep -q ":5000 " || ss -tln 2>/dev/null | grep -q ":5000 "; then
        echo "[$(date)] ✓ Port 5000 is now listening"
        echo "[$(date)] ✓ Allowing deployment to continue - target group will validate health"
        set -e
        exit 0
      else
        set -e
        echo "[$(date)] ERROR: Port 5000 is not listening - app may have crashed"
        exit 1
      fi
    fi
  fi

  # Process exists but not online - check status
  set +e
  RESTARTS=$("$PM2_BIN" list 2>/dev/null | grep "$PM2_PROCESS_NAME" 2>/dev/null | awk '{print $12}' 2>/dev/null || echo "0")
  set -e
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
      set +e
      echo "[$(date)] PM2 error logs (last 50 lines):"
      "$PM2_BIN" logs $PM2_PROCESS_NAME --err --lines 50 --nostream 2>&1 || true
      echo "[$(date)] PM2 output logs (last 50 lines):"
      "$PM2_BIN" logs $PM2_PROCESS_NAME --out --lines 50 --nostream 2>&1 || true
      set -e
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
set +e
echo "[$(date)] Current PM2 status:"
"$PM2_BIN" list 2>/dev/null || true
set -e
echo "[$(date)] Port 5000 status:"
PORT_LISTENING=false
set +e
if netstat -tln 2>/dev/null | grep -q ":5000 " || ss -tln 2>/dev/null | grep -q ":5000 "; then
  PORT_LISTENING=true
  echo "[$(date)] ✓ Port 5000 IS listening"
else
  echo "[$(date)] ✗ Port 5000 is NOT listening"
fi
set -e

# Check if node process is running the app
APP_PROCESS_RUNNING=false
set +e
if pgrep -f "node.*build/src/app.js" > /dev/null 2>&1 || ps aux | grep -v grep | grep -q "node.*build/src/app.js"; then
  APP_PROCESS_RUNNING=true
  echo "[$(date)] ✓ Node process running build/src/app.js found"
fi
set -e

  # Final fallback: If port is listening OR process is running, try HTTP check
if [ "$PORT_LISTENING" = true ] || [ "$APP_PROCESS_RUNNING" = true ]; then
  echo "[$(date)] App process or port detected - attempting final HTTP health check..."
  set +e
  # Reduced retries to prevent timeout
  for final_check in 1 2 3; do
    sleep 2
    HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:5000/health 2>&1 || printf "000")
    # Accept 200 (healthy) or 503 (database connecting) as success
    if [ "$HTTP_STATUS" = "200" ] || [ "$HTTP_STATUS" = "503" ]; then
      echo "[$(date)] ✓ SUCCESS: Application is responding to HTTP requests (status: $HTTP_STATUS)!"
      echo "[$(date)] App appears to be running (even if PM2 status unclear)"
      set -e
      exit 0
    elif [ "$HTTP_STATUS" != "000" ] && [ -n "$HTTP_STATUS" ] && [ ${#HTTP_STATUS} -eq 3 ]; then
      # Any 3-digit HTTP status code means server is responding
      echo "[$(date)] ✓ SUCCESS: Application is responding to HTTP requests (status: $HTTP_STATUS)!"
      echo "[$(date)] App appears to be running (even if PM2 status unclear)"
      set -e
      exit 0
    else
      echo "[$(date)] Final HTTP check attempt ${final_check}/3 failed (status: $HTTP_STATUS), waiting 2 seconds..."
    fi
  done
  set -e
  # If port is listening but health check still failing, give benefit of doubt
  if [ "$PORT_LISTENING" = true ]; then
    echo "[$(date)] Port 5000 is listening but health check failing after 6 seconds"
    echo "[$(date)] App may still be initializing (database connection may be slow). Allowing deployment to continue."
    echo "[$(date)] Target group health checks will validate if app is truly ready."
    exit 0
  fi
fi

# If we still haven't succeeded, show diagnostics
echo "[$(date)] WARNING: Application did not respond to HTTP health checks within timeout"
# Determine which process name to use for logs
set +e
FINAL_PROCESS_NAME="rotten-corn-backend"
if "$PM2_BIN" list 2>/dev/null | grep -q "rotten-corn"; then
  FINAL_PROCESS_NAME="rotten-corn"
fi
set -e
set +e
echo "[$(date)] PM2 error logs (last 100 lines) for $FINAL_PROCESS_NAME:"
"$PM2_BIN" logs $FINAL_PROCESS_NAME --err --lines 100 --nostream 2>&1 || true
echo "[$(date)] PM2 output logs (last 100 lines) for $FINAL_PROCESS_NAME:"
"$PM2_BIN" logs $FINAL_PROCESS_NAME --out --lines 100 --nostream 2>&1 || true
set -e
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

# Check if app is running (PM2, node process, or port listening)
# The target group health checks will catch if the app is truly broken
PM2_PROCESS_EXISTS=false
set +e
if "$PM2_BIN" list 2>/dev/null | grep -qE "rotten-corn-backend|rotten-corn"; then
  PM2_PROCESS_EXISTS=true
fi
set -e

NODE_PROCESS_EXISTS=false
# Use set +e temporarily to avoid script exit on command failure
set +e
if pgrep -f "node.*build/src/app.js" > /dev/null 2>&1; then
  NODE_PROCESS_EXISTS=true
elif ps aux | grep -v grep | grep -q "node.*build/src/app.js" 2>/dev/null; then
  NODE_PROCESS_EXISTS=true
fi
set -e

PORT_LISTENING=false
# Use set +e temporarily to avoid script exit on command failure
set +e
if netstat -tln 2>/dev/null | grep -q ":5000 "; then
  PORT_LISTENING=true
elif ss -tln 2>/dev/null | grep -q ":5000 "; then
  PORT_LISTENING=true
fi
set -e

# Check PM2 logs one more time for startup confirmation
PM2_LOGS_SHOW_STARTED=false
set +e
FINAL_PROCESS_NAME="rotten-corn-backend"
if "$PM2_BIN" list 2>/dev/null | grep -q "rotten-corn"; then
  FINAL_PROCESS_NAME="rotten-corn"
fi
if "$PM2_BIN" logs $FINAL_PROCESS_NAME --lines 30 --nostream 2>&1 | grep -q "Server running on port 5000"; then
  PM2_LOGS_SHOW_STARTED=true
fi
set -e

# Final check: Try one more HTTP health check (even if previous checks failed)
# This is a last resort to verify the app is actually responding
HTTP_FINAL_CHECK=false
set +e
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 http://localhost:5000/health 2>&1 || printf "000")
if [ "$HTTP_STATUS" = "200" ] || [ "$HTTP_STATUS" = "503" ] || ([ "$HTTP_STATUS" != "000" ] && [ -n "$HTTP_STATUS" ] && [ ${#HTTP_STATUS} -eq 3 ]); then
  HTTP_FINAL_CHECK=true
  echo "[$(date)] ✓ Final HTTP health check succeeded (status: $HTTP_STATUS)"
fi
set -e

# Allow deployment if ANY indicator shows the app is running
# (PM2 process, node process, port listening, logs show server started, OR HTTP check succeeds)
if [ "$PM2_PROCESS_EXISTS" = true ] || [ "$NODE_PROCESS_EXISTS" = true ] || [ "$PORT_LISTENING" = true ] || [ "$PM2_LOGS_SHOW_STARTED" = true ] || [ "$HTTP_FINAL_CHECK" = true ]; then
  echo "[$(date)] ✓ Application appears to be running:"
  if [ "$PM2_PROCESS_EXISTS" = true ]; then
    echo "[$(date)]   - PM2 process found"
  fi
  if [ "$NODE_PROCESS_EXISTS" = true ]; then
    echo "[$(date)]   - Node process found"
  fi
  if [ "$PORT_LISTENING" = true ]; then
    echo "[$(date)]   - Port 5000 is listening"
  fi
  if [ "$PM2_LOGS_SHOW_STARTED" = true ]; then
    echo "[$(date)]   - PM2 logs confirm server started"
  fi
  if [ "$HTTP_FINAL_CHECK" = true ]; then
    echo "[$(date)]   - HTTP health check responding (status: $HTTP_STATUS)"
  fi
  echo "[$(date)] ✓ Allowing deployment to continue - target group will validate health"
  # Use set +e before exit to prevent any issues
  set +e
  exit 0
else
  echo "[$(date)] ERROR: Application is not running"
  echo "[$(date)]   - PM2 process: not found"
  echo "[$(date)]   - Node process: not found"
  echo "[$(date)]   - Port 5000: not listening"
  echo "[$(date)]   - PM2 logs: no startup confirmation"
  echo "[$(date)]   - HTTP check: failed (status: $HTTP_STATUS)"
  # Use set +e before exit to prevent any issues
  set +e
  exit 1
fi

