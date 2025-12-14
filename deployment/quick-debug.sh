#!/bin/bash

# Quick debugging script for backend instance
# Shows key information about the application status

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KEY_FILE="$SCRIPT_DIR/chatappKeyPair.pem"
BASTION="ec2-user@98.92.178.139"
BACKEND="ec2-user@10.0.4.55"

run_on_backend() {
  ssh -i "$KEY_FILE" \
      -o StrictHostKeyChecking=no \
      -o UserKnownHostsFile=/dev/null \
      -o ProxyCommand="ssh -i $KEY_FILE -W %h:%p $BASTION" \
      "$BACKEND" \
      "$@"
}

echo "=========================================="
echo "Quick Debug - Instance i-07b8b7267334ba92d"
echo "=========================================="
echo ""

echo "1. Application Process:"
echo "----------------------------------------"
run_on_backend "ps aux | grep -E 'node.*app.js|pm2' | grep -v grep || echo 'No process found'"
echo ""

echo "2. Port 5000 Status:"
echo "----------------------------------------"
run_on_backend "netstat -tln | grep 5000 || ss -tln | grep 5000 || echo 'Port 5000 not listening'"
echo ""

echo "3. Health Check:"
echo "----------------------------------------"
run_on_backend "curl -s --max-time 5 http://localhost:5000/health 2>&1 || echo 'Health check failed or timed out'"
echo ""

echo "4. PM2 Status:"
echo "----------------------------------------"
run_on_backend "cd /home/ec2-user/rotten-corn-backend && pm2 list 2>/dev/null || echo 'PM2 not managing any processes'"
echo ""

echo "5. Application Directory:"
echo "----------------------------------------"
run_on_backend "cd /home/ec2-user/rotten-corn-backend && ls -la | head -10 && echo '...' && echo '.env exists:' && [ -f .env ] && echo 'yes' || echo 'no'"
echo ""

echo "6. Recent System Errors:"
echo "----------------------------------------"
run_on_backend "sudo dmesg | tail -5 2>/dev/null || echo 'dmesg not available'"
echo ""

echo "=========================================="
echo "For more detailed logs, run:"
echo "  ./get-logs.sh <log-type>"
echo "  ./debug-instance.sh"
echo "=========================================="

