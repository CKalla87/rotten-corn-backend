#!/bin/bash
# Test script to verify health check logic locally
# This simulates the key parts of application_start.sh health checking

set -e

echo "Testing health check logic..."
echo "================================"

# Test 1: Check if port is listening
echo ""
echo "[1] Checking if port 5000 is listening..."
PORT_LISTENING=false
if netstat -tln 2>/dev/null | grep -q ":5000 " || ss -tln 2>/dev/null | grep -q ":5000 "; then
  PORT_LISTENING=true
  echo "✓ Port 5000 IS listening"
else
  echo "✗ Port 5000 is NOT listening"
fi

# Test 2: HTTP health check
echo ""
echo "[2] Testing HTTP health endpoint..."
HTTP_CHECK_SUCCESS=false
HTTP_STATUS="000"

for check_attempt in 1 2 3; do
  HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:5000/health 2>&1 || printf "000")

  if [ "$HTTP_STATUS" = "200" ] || [ "$HTTP_STATUS" = "503" ]; then
    HTTP_CHECK_SUCCESS=true
    echo "✓ HTTP check succeeded with status $HTTP_STATUS (attempt $check_attempt/3)"
    if [ "$HTTP_STATUS" = "503" ]; then
      echo "  ⚠ Health endpoint returned 503 - database may still be connecting (this is OK)"
    fi
    break
  elif [ "$HTTP_STATUS" != "000" ] && [ -n "$HTTP_STATUS" ] && [ ${#HTTP_STATUS} -eq 3 ]; then
    HTTP_CHECK_SUCCESS=true
    echo "✓ Server is responding with status $HTTP_STATUS (attempt $check_attempt/3)"
    break
  else
    echo "✗ HTTP check attempt $check_attempt/3 failed (status: $HTTP_STATUS)"
    if [ $check_attempt -lt 3 ]; then
      echo "  Waiting 2 seconds before retry..."
      sleep 2
    fi
  fi
done

# Test 3: Summary
echo ""
echo "[3] Summary:"
echo "================================"
if [ "$PORT_LISTENING" = true ]; then
  echo "✓ Port 5000: LISTENING"
else
  echo "✗ Port 5000: NOT LISTENING"
fi

if [ "$HTTP_CHECK_SUCCESS" = true ]; then
  echo "✓ HTTP Health Check: SUCCESS (status: $HTTP_STATUS)"
else
  echo "✗ HTTP Health Check: FAILED (status: $HTTP_STATUS)"
fi

echo ""
if [ "$PORT_LISTENING" = true ] || [ "$HTTP_CHECK_SUCCESS" = true ]; then
  echo "✓ Application appears to be running!"
  exit 0
else
  echo "✗ Application does not appear to be running"
  echo ""
  echo "To start the app locally:"
  echo "  1. Build: npm run build"
  echo "  2. Start: pm2 start build/src/app.js --name rotten-corn-backend"
  echo "  3. Or: node build/src/app.js"
  exit 1
fi

