#!/bin/bash
# Fix port 5000 conflict and restart app properly

cd /home/ec2-user/rotten-corn-backend || exit 1

echo "=== Step 1: Stopping PM2 ==="
pm2 delete all 2>/dev/null || true
pm2 kill 2>/dev/null || true
sleep 2

echo "=== Step 2: Killing all node processes ==="
sudo pkill -9 node || true
sleep 2

echo "=== Step 3: Freeing port 5000 ==="
sudo fuser -k 5000/tcp 2>/dev/null || true
sudo lsof -ti:5000 | xargs sudo kill -9 2>/dev/null || true
sleep 2

echo "=== Step 4: Verifying port 5000 is free ==="
if netstat -tln 2>/dev/null | grep -q ":5000 " || ss -tln 2>/dev/null | grep -q ":5000 "; then
  echo "WARNING: Port 5000 still in use"
  sudo netstat -tlnp 2>/dev/null | grep 5000 || sudo ss -tlnp 2>/dev/null | grep 5000
else
  echo "✓ Port 5000 is free"
fi

echo "=== Step 5: Starting app in fork mode (not cluster) ==="
pm2 start ./build/src/app.js --name rotten-corn-backend
pm2 save

echo "=== Step 6: Waiting for app to start ==="
sleep 5

echo "=== Step 7: Checking status ==="
pm2 list
echo ""
echo "=== Step 8: Testing health endpoint ==="
curl -s http://localhost:5000/health | head -3
echo ""

