#!/bin/bash
# Script to check auth middleware logs for 403 errors

echo "=== Checking PM2 Logs for Auth Middleware Debug Output ==="
echo ""
echo "1. Recent PM2 logs (last 100 lines):"
cd /home/ec2-user/rotten-corn-backend && pm2 logs rotten-corn-backend --lines 100 --nostream 2>/dev/null | grep -i "auth\|session\|cookie\|jwt\|token\|403\|401" | tail -50

echo ""
echo "2. PM2 Error logs (last 50 lines):"
cd /home/ec2-user/rotten-corn-backend && pm2 logs rotten-corn-backend --err --lines 50 --nostream 2>/dev/null | tail -30

echo ""
echo "3. PM2 Output logs (last 50 lines):"
cd /home/ec2-user/rotten-corn-backend && pm2 logs rotten-corn-backend --out --lines 50 --nostream 2>/dev/null | tail -30

echo ""
echo "4. PM2 Process Status:"
cd /home/ec2-user/rotten-corn-backend && pm2 list

echo ""
echo "=== To see real-time logs, run: ==="
echo "  cd /home/ec2-user/rotten-corn-backend && pm2 logs rotten-corn-backend"
echo ""
echo "=== To filter for auth-related logs: ==="
echo "  cd /home/ec2-user/rotten-corn-backend && pm2 logs rotten-corn-backend | grep -i 'auth\|session\|cookie'"


