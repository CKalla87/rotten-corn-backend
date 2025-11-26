#!/bin/bash

# Quick script to check CodeDeploy logs on an instance
# Usage: ./check-logs.sh [instance-id]

INSTANCE_ID=${1:-"i-0db2989042efc59fe"}

echo "=== Checking logs for instance: $INSTANCE_ID ==="
echo ""
echo "To SSH into the instance and check logs, run:"
echo ""
echo "1. Connect via bastion:"
echo "   ssh -i chatappKeyPair.pem -J ec2-user@18.209.214.225 ec2-user@<instance-private-ip>"
echo ""
echo "2. Once connected, check these logs:"
echo ""
echo "   # CodeDeploy agent logs:"
echo "   sudo tail -100 /var/log/aws/codedeploy-agent/codedeploy-agent.log"
echo ""
echo "   # Latest deployment logs:"
echo "   sudo tail -100 /opt/codedeploy-agent/deployment-root/deployment-logs/codedeploy-agent-deployments.log"
echo ""
echo "   # PM2 logs (if app started):"
echo "   sudo pm2 logs"
echo ""
echo "   # Check if app is running:"
echo "   sudo pm2 list"
echo "   curl http://localhost:5000/health"
echo ""
echo "   # Check recent system logs:"
echo "   sudo journalctl -u codedeploy-agent -n 50 --no-pager"
echo ""
echo "=== Getting instance private IP ==="
aws ec2 describe-instances \
  --instance-ids $INSTANCE_ID \
  --region us-east-1 \
  --query 'Reservations[0].Instances[0].PrivateIpAddress' \
  --output text 2>/dev/null || echo "Could not get IP for instance"

