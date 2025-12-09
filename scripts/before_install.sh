#!/bin/bash
# Don't use set -e here - we want to continue even if some cleanup steps fail
# (e.g., if processes don't exist, that's fine, we just want to clean up what we can)

# CodeDeploy BeforeInstall hook
# This script runs before the application files are copied
# This is the best place to do aggressive cleanup to ensure a clean state

echo "[$(date)] Starting BeforeInstall hook - aggressive cleanup phase"

# Ensure Node.js and npm are in PATH for PM2 commands
export PATH="/usr/local/bin:/usr/bin:/opt/nodejs/node-v16.20.2-linux-x64/bin:$PATH"

# Step 1: Kill all PM2 processes and daemon
echo "[$(date)] Step 1: Cleaning up PM2 processes..."
# Find PM2 binary
PM2_BIN=""
if command -v pm2 >/dev/null 2>&1; then
  PM2_BIN=$(command -v pm2)
elif [ -f "/usr/local/bin/pm2" ]; then
  PM2_BIN="/usr/local/bin/pm2"
elif [ -f "/opt/nodejs/node-v16.20.2-linux-x64/bin/pm2" ]; then
  PM2_BIN="/opt/nodejs/node-v16.20.2-linux-x64/bin/pm2"
fi

if [ -n "$PM2_BIN" ] && [ -x "$PM2_BIN" ]; then
  echo "[$(date)] Found PM2 at: $PM2_BIN"
  # Delete all PM2 processes
  "$PM2_BIN" delete all 2>/dev/null || true
  "$PM2_BIN" delete chatty-backend 2>/dev/null || true
  "$PM2_BIN" delete chatty-b 2>/dev/null || true
  # Kill PM2 daemon completely
  "$PM2_BIN" kill 2>/dev/null || true
  # Stop PM2 daemon
  "$PM2_BIN" stop all 2>/dev/null || true
  echo "[$(date)] PM2 processes cleaned up"
else
  echo "[$(date)] PM2 not found, skipping PM2 cleanup"
fi

# Step 2: Kill any node processes running on port 5000
echo "[$(date)] Step 2: Freeing up port 5000..."
# Find processes using port 5000 and kill them
if command -v lsof >/dev/null 2>&1; then
  lsof -ti:5000 | xargs kill -9 2>/dev/null || true
elif command -v fuser >/dev/null 2>&1; then
  fuser -k 5000/tcp 2>/dev/null || true
fi
# Also try to kill any node processes that might be running the app
pkill -f "node.*build/src/app.js" 2>/dev/null || true
pkill -f "node.*chatty" 2>/dev/null || true
echo "[$(date)] Port 5000 cleanup attempted"

# Step 3: Kill any remaining PM2 or node processes (nuclear option)
echo "[$(date)] Step 3: Cleaning up any remaining node/PM2 processes..."
# Kill PM2 processes by name
pkill -f pm2 2>/dev/null || true
# Give it a moment
sleep 2
# Kill any node processes that look like our app (but be careful not to kill everything)
ps aux | grep -E "node.*build/src/app.js|node.*chatty-backend" | grep -v grep | awk '{print $2}' | xargs kill -9 2>/dev/null || true
echo "[$(date)] Remaining processes cleaned up"

# Step 4: Remove the deployment directory
echo "[$(date)] Step 4: Removing deployment directory..."
DIR="/home/ec2-user/chatty-backend"
if [ -d "$DIR" ]; then
  cd /home/ec2-user
  # Remove directory (this will fail if processes are still using files, which is why we cleaned up first)
  sudo rm -rf chatty-backend
  echo "[$(date)] Removed existing chatty-backend directory"
else
  echo "[$(date)] Directory does not exist, creating it"
  mkdir -p /home/ec2-user/chatty-backend
fi

# Step 5: Clean up PM2 dump file and logs (optional, but helps ensure clean state)
echo "[$(date)] Step 5: Cleaning up PM2 state files..."
rm -f /home/ec2-user/.pm2/dump.pm2 2>/dev/null || true
rm -f /root/.pm2/dump.pm2 2>/dev/null || true
echo "[$(date)] PM2 state files cleaned up"

# Step 6: Verify port 5000 is free
echo "[$(date)] Step 6: Verifying port 5000 is free..."
if command -v lsof >/dev/null 2>&1; then
  PORT_IN_USE=$(lsof -ti:5000 2>/dev/null || echo "")
  if [ -n "$PORT_IN_USE" ]; then
    echo "[$(date)] WARNING: Port 5000 still in use by PID: $PORT_IN_USE"
    kill -9 $PORT_IN_USE 2>/dev/null || true
    sleep 1
  else
    echo "[$(date)] ✓ Port 5000 is free"
  fi
elif command -v netstat >/dev/null 2>&1; then
  if netstat -tln 2>/dev/null | grep -q ":5000 "; then
    echo "[$(date)] WARNING: Port 5000 appears to be in use"
  else
    echo "[$(date)] ✓ Port 5000 appears to be free"
  fi
fi

echo "[$(date)] BeforeInstall hook completed - system should be in clean state"

