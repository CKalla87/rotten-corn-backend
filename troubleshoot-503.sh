#!/bin/bash

# Troubleshooting script for 503 errors
# This script checks various aspects that could cause 503 errors

echo "=========================================="
echo "503 Error Troubleshooting Guide"
echo "=========================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "1. Testing Endpoint Availability"
echo "----------------------------------------"
echo -n "Testing https://api.dev.chatappserver.space/health ... "
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 https://api.dev.chatappserver.space/health 2>/dev/null || echo "000")
if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "503" ]; then
    echo -e "${GREEN}✓ Response received (HTTP $HTTP_CODE)${NC}"
    if [ "$HTTP_CODE" = "503" ]; then
        echo -e "  ${YELLOW}⚠ 503 status - this could be:${NC}"
        echo "    - Database not connected (expected during startup)"
        echo "    - Application not running (needs investigation)"
    fi
else
    echo -e "${RED}✗ No response or error (HTTP $HTTP_CODE)${NC}"
    echo "  This indicates the server is completely down"
fi
echo ""

echo "2. Checking if Response is from ELB or Application"
echo "----------------------------------------"
RESPONSE=$(curl -s -D - --max-time 10 https://api.dev.chatappserver.space/health 2>/dev/null | head -10)
if echo "$RESPONSE" | grep -q "awselb"; then
    echo -e "${RED}✗ Response is from AWS ELB only${NC}"
    echo "  This means the application server is not responding"
    echo "  The ELB cannot reach any healthy backend instances"
else
    echo -e "${GREEN}✓ Response appears to be from the application${NC}"
fi
echo ""

echo "3. Common Causes of 503 Errors"
echo "----------------------------------------"
echo "  • Application not started on EC2 instances"
echo "  • Application crashed after startup"
echo "  • Database connection failure preventing startup"
echo "  • Port 5000 not listening"
echo "  • All instances in target group are unhealthy"
echo "  • CodeDeploy deployment failed"
echo ""

echo "4. Next Steps to Diagnose"
echo "----------------------------------------"
echo ""
echo "A. Check Deployment Status (requires AWS CLI configured):"
echo "   cd deployment && ./check-deployment-status.sh"
echo ""
echo "B. Check Server Logs (requires SSH key):"
echo "   cd deployment && ./get-logs.sh app 100"
echo "   cd deployment && ./get-logs.sh pm2 100"
echo "   cd deployment && ./get-logs.sh errors 50"
echo ""
echo "C. Quick Debug (requires SSH key):"
echo "   cd deployment && ./quick-debug.sh"
echo ""
echo "D. Check AWS Console:"
echo "   • EC2 Auto Scaling Groups - check if instances are running"
echo "   • EC2 Target Groups - check instance health"
echo "   • CloudWatch Logs - check application logs"
echo "   • CodeDeploy - check latest deployment status"
echo ""

echo "5. Manual Checks (via AWS Console)"
echo "----------------------------------------"
echo ""
echo "Go to AWS Console → EC2 → Target Groups:"
echo "  • Find target group: <prefix>-tg"
echo "  • Check 'Targets' tab"
echo "  • Look for instances with status:"
echo "    - 'healthy' (green) = OK"
echo "    - 'unhealthy' (red) = Problem"
echo "    - 'draining' (yellow) = Being removed"
echo ""
echo "Go to AWS Console → EC2 → Auto Scaling Groups:"
echo "  • Find ASG: <prefix>-asg"
echo "  • Check 'Activity' tab for recent scaling events"
echo "  • Check 'Instances' tab - ensure instances are running"
echo ""

echo "6. If You Have SSH Access"
echo "----------------------------------------"
echo "SSH into an instance and run:"
echo ""
echo "  # Check if app is running"
echo "  ps aux | grep node"
echo "  pm2 list"
echo ""
echo "  # Check if port 5000 is listening"
echo "  netstat -tln | grep 5000"
echo "  curl http://localhost:5000/health"
echo ""
echo "  # Check application logs"
echo "  cd /home/ec2-user/chatty-backend"
echo "  pm2 logs chatty-backend --lines 50"
echo ""
echo "  # Check environment variables"
echo "  cat .env | grep -E 'DATABASE_URL|REDIS_HOST|NODE_ENV'"
echo ""

echo "7. Common Fixes"
echo "----------------------------------------"
echo ""
echo "If application is not running:"
echo "  • Check CodeDeploy deployment logs"
echo "  • Verify .env file exists and has correct values"
echo "  • Check database connectivity"
echo "  • Restart the application manually to see errors"
echo ""
echo "If database connection is failing:"
echo "  • Verify DATABASE_URL environment variable"
echo "  • Check MongoDB Atlas network access (IP whitelist)"
echo "  • Check security groups allow outbound connections"
echo ""
echo "If port 5000 is not listening:"
echo "  • Application may have crashed on startup"
echo "  • Check application logs for startup errors"
echo "  • Verify PM2 is managing the process correctly"
echo ""

echo "=========================================="
echo "For detailed logs, run:"
echo "  cd deployment && ./get-logs.sh app"
echo "=========================================="


