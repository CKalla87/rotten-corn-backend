#!/bin/bash

# Fix CodeDeploy Agent Issues
# This script diagnoses and fixes common CodeDeploy agent problems

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KEY_FILE="$SCRIPT_DIR/chatappKeyPair.pem"
BASTION="ec2-user@98.92.178.139"
REGION="us-east-1"

# Get instance ID from command line or use default
INSTANCE_ID="${1:-i-07b8b7267334ba92d}"
BACKEND_IP="${2:-10.0.4.55}"

echo "=========================================="
echo "CodeDeploy Agent Diagnostic & Fix Script"
echo "=========================================="
echo "Instance ID: $INSTANCE_ID"
echo "Backend IP: $BACKEND_IP"
echo ""

# Function to run command on instance
run_on_instance() {
  ssh -i "$KEY_FILE" \
      -o StrictHostKeyChecking=no \
      -o UserKnownHostsFile=/dev/null \
      -o ProxyCommand="ssh -i $KEY_FILE -W %h:%p $BASTION" \
      "ec2-user@$BACKEND_IP" \
      "$@"
}

echo "1. Checking CodeDeploy agent status..."
run_on_instance "sudo service codedeploy-agent status" || echo "⚠ Agent service check failed"

echo ""
echo "2. Checking if agent process is running..."
run_on_instance "ps aux | grep codedeploy-agent | grep -v grep || echo 'Agent process not found'"

echo ""
echo "3. Checking agent logs for errors..."
run_on_instance "sudo tail -50 /var/log/amazon/codedeploy-agent/codedeploy-agent.log | grep -i error || echo 'No recent errors in logs'"

echo ""
echo "4. Checking agent configuration..."
run_on_instance "cat /etc/codedeploy-agent/conf/codedeploy.conf 2>/dev/null || echo 'Config file not found'"

echo ""
echo "5. Checking IAM instance profile..."
run_on_instance "curl -s http://169.254.169.254/latest/meta-data/iam/security-credentials/ 2>/dev/null || echo 'No IAM role attached'"

echo ""
echo "6. Testing AWS connectivity from instance..."
run_on_instance "aws sts get-caller-identity --region $REGION 2>&1 || echo 'AWS CLI not available or no permissions'"

echo ""
echo "7. Checking if agent can reach CodeDeploy service..."
run_on_instance "curl -I https://codedeploy.${REGION}.amazonaws.com 2>&1 | head -5 || echo 'Cannot reach CodeDeploy service'"

echo ""
echo "=========================================="
echo "Attempting Fixes..."
echo "=========================================="

echo ""
echo "8. Stopping agent..."
run_on_instance "sudo service codedeploy-agent stop 2>&1 || echo 'Stop failed (may not be running)'"

echo ""
echo "9. Checking agent installation..."
run_on_instance "which codedeploy-agent || echo 'Agent not in PATH'"
run_on_instance "ls -la /opt/codedeploy-agent/bin/codedeploy-agent 2>/dev/null || echo 'Agent binary not found'"

echo ""
echo "10. Reinstalling CodeDeploy agent..."
run_on_instance "cd /home/ec2-user && \
  wget https://aws-codedeploy-${REGION}.s3.${REGION}.amazonaws.com/latest/install -O install 2>&1 && \
  sudo chmod +x ./install && \
  sudo ./install auto 2>&1 | tail -20"

echo ""
echo "11. Starting agent..."
run_on_instance "sudo service codedeploy-agent start 2>&1"

echo ""
echo "12. Waiting 5 seconds for agent to initialize..."
sleep 5

echo ""
echo "13. Checking agent status again..."
run_on_instance "sudo service codedeploy-agent status"

echo ""
echo "14. Checking agent logs after restart..."
run_on_instance "sudo tail -30 /var/log/amazon/codedeploy-agent/codedeploy-agent.log"

echo ""
echo "=========================================="
echo "Diagnostic Complete"
echo "=========================================="
echo ""
echo "If agent is still not working, check:"
echo "  1. IAM role has CodeDeploy permissions"
echo "  2. Security groups allow outbound HTTPS (443)"
echo "  3. Instance can reach codedeploy.${REGION}.amazonaws.com"
echo "  4. Agent logs: /var/log/amazon/codedeploy-agent/codedeploy-agent.log"
echo ""

