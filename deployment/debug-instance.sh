#!/bin/bash

# Debug script for backend instance
# Connects via bastion and retrieves error logs

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KEY_FILE="$SCRIPT_DIR/chatappKeyPair.pem"
BASTION="ec2-user@98.92.178.139"
BACKEND="ec2-user@10.0.4.55"
BACKEND_INSTANCE_ID="i-07b8b7267334ba92d"

echo "=========================================="
echo "Debugging Instance: $BACKEND_INSTANCE_ID"
echo "=========================================="
echo ""

# Function to run command on backend
run_on_backend() {
  ssh -i "$KEY_FILE" \
      -o StrictHostKeyChecking=no \
      -o UserKnownHostsFile=/dev/null \
      -o ProxyCommand="ssh -i $KEY_FILE -W %h:%p $BASTION" \
      "$BACKEND" \
      "$@"
}

echo "1. System Logs (last 50 lines)"
echo "----------------------------------------"
run_on_backend "sudo tail -50 /var/log/messages" 2>/dev/null || run_on_backend "sudo journalctl -n 50 --no-pager" 2>/dev/null
echo ""

echo "2. Application Logs (if exists)"
echo "----------------------------------------"
run_on_backend "ls -la /opt/codedeploy-agent/deployment-root/*/d-*/logs/scripts.log 2>/dev/null | head -1 | xargs -I {} sudo tail -100 {} 2>/dev/null || echo 'No CodeDeploy logs found'"
echo ""

echo "3. CodeDeploy Agent Logs"
echo "----------------------------------------"
run_on_backend "sudo tail -100 /var/log/amazon/codedeploy-agent/codedeploy-agent.log 2>/dev/null || echo 'CodeDeploy agent log not found'"
echo ""

echo "4. User Data Logs"
echo "----------------------------------------"
run_on_backend "sudo tail -100 /var/log/user-data.log 2>/dev/null || echo 'User data log not found'"
echo ""

echo "5. Application Process Status"
echo "----------------------------------------"
run_on_backend "ps aux | grep -E 'node|npm|pm2|app' | grep -v grep || echo 'No application processes found'"
echo ""

echo "6. Service Status (if using systemd)"
echo "----------------------------------------"
run_on_backend "systemctl list-units --type=service --state=running | grep -E 'app|node|chatapp' || echo 'No matching services found'"
echo ""

echo "7. Recent System Errors"
echo "----------------------------------------"
run_on_backend "sudo dmesg | tail -20 2>/dev/null || echo 'dmesg not available'"
echo ""

echo "8. Disk Space"
echo "----------------------------------------"
run_on_backend "df -h"
echo ""

echo "9. Memory Usage"
echo "----------------------------------------"
run_on_backend "free -h"
echo ""

echo "10. Network Connections"
echo "----------------------------------------"
run_on_backend "netstat -tuln | head -20 || ss -tuln | head -20"
echo ""

echo "=========================================="
echo "To get specific logs, run:"
echo "  ./debug-instance.sh <log-type>"
echo ""
echo "Available log types:"
echo "  - system: System logs"
echo "  - app: Application logs"
echo "  - codedeploy: CodeDeploy agent logs"
echo "  - userdata: User data script logs"
echo "  - all: All logs (default)"
echo "=========================================="

