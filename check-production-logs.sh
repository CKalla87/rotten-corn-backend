#!/bin/bash
# Script to check production logs on EC2 instance
# This assumes you have SSH access via bastion host

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KEY_FILE="$SCRIPT_DIR/deployment/chatappKeyPair.pem"
BASTION="ec2-user@98.92.178.139"
BACKEND="ec2-user@10.0.4.64"

if [ ! -f "$KEY_FILE" ]; then
  echo "Error: SSH key file not found at $KEY_FILE"
  echo "Please update the KEY_FILE path in this script"
  exit 1
fi

run_on_backend() {
  ssh -i "$KEY_FILE" \
      -o StrictHostKeyChecking=no \
      -o UserKnownHostsFile=/dev/null \
      -o ProxyCommand="ssh -i $KEY_FILE -W %h:%p $BASTION" \
      "$BACKEND" \
      "$@"
}

echo "=== Checking PM2 Processes on EC2 ==="
run_on_backend "pm2 list"

echo ""
echo "=== Finding Application Directory ==="
run_on_backend "find /home /opt /var -name 'rotten-corn-backend' -type d 2>/dev/null | head -5"

echo ""
echo "=== Checking PM2 Logs for Auth Issues ==="
run_on_backend "pm2 logs rotten-corn-backend --lines 100 --nostream 2>/dev/null | grep -iE 'auth|session|cookie|jwt|token|403|401|post/all' | tail -50 || echo 'Process not found or no matching logs'"

echo ""
echo "=== Recent Error Logs ==="
run_on_backend "pm2 logs rotten-corn-backend --err --lines 50 --nostream 2>/dev/null | tail -30 || echo 'No error logs found'"

echo ""
echo "=== Recent Output Logs ==="
run_on_backend "pm2 logs rotten-corn-backend --out --lines 50 --nostream 2>/dev/null | tail -30 || echo 'No output logs found'"

echo ""
echo "=== If rotten-corn-backend doesn't exist, check other processes ==="
run_on_backend "pm2 list && pm2 describe chatty-backend 2>/dev/null | head -15 || echo 'chatty-backend not found'"


