#!/bin/bash

# Check database and Redis connections from the instance

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
echo "Checking Database and Redis Connections"
echo "=========================================="
echo ""

echo "1. Checking .env file for connection strings:"
echo "----------------------------------------"
run_on_backend "cd /home/ec2-user/rotten-corn-backend && grep -E 'DATABASE_URL|REDIS_HOST' .env | sed 's/=.*/=***/' || echo '.env not found or variables not set'"
echo ""

echo "2. Testing Redis connection (10.0.4.50:6379):"
echo "----------------------------------------"
run_on_backend "timeout 3 bash -c 'echo > /dev/tcp/10.0.4.50/6379' 2>&1 && echo '✓ Redis port is reachable' || echo '✗ Redis port is NOT reachable (EHOSTUNREACH)'"
echo ""

echo "3. Checking if Redis/ElastiCache exists:"
echo "----------------------------------------"
run_on_backend "ping -c 2 10.0.4.50 2>&1 | head -3 || echo 'Cannot ping Redis host'"
echo ""

echo "4. Checking MongoDB connection string format:"
echo "----------------------------------------"
run_on_backend "cd /home/ec2-user/rotten-corn-backend && grep 'DATABASE_URL' .env | grep -o 'buffermaxentries' && echo '✗ Found invalid option: buffermaxentries' || echo '✓ No buffermaxentries found in connection string'"
echo ""

echo "5. Network connectivity test:"
echo "----------------------------------------"
run_on_backend "echo 'Testing network routes:'; ip route | grep -E '10.0.4|default' || route -n | grep -E '10.0.4|0.0.0.0'"
echo ""

echo "=========================================="
echo "Issues Found:"
echo "=========================================="
echo "1. MongoDB: Invalid option 'buffermaxentries' in connection string"
echo "   Fix: Remove 'buffermaxentries' from DATABASE_URL in .env"
echo ""
echo "2. Redis: Cannot reach 10.0.4.50:6379"
echo "   Possible causes:"
echo "   - ElastiCache not running or wrong IP"
echo "   - Security group not allowing access"
echo "   - Network routing issue"
echo "   Fix: Check ElastiCache endpoint and security groups"
echo "=========================================="

