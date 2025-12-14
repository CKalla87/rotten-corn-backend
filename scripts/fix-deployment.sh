#!/bin/bash
# Quick fix script to clean up and restart the app properly

cd /home/ec2-user/rotten-corn-backend || exit 1

echo "=== Stopping all node processes ==="
pkill -9 node || true
pm2 delete all || true
pm2 kill || true
sleep 2

echo "=== Starting app with PM2 ==="
pm2 start ./build/src/app.js -i 1 --name rotten-corn-backend
pm2 save

echo "=== Waiting for app to start ==="
sleep 5

echo "=== Checking status ==="
pm2 list
echo ""
echo "=== Testing health endpoint ==="
curl -s http://localhost:5000/health | head -5

