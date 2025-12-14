# Debugging Instance i-07b8b7267334ba92d

## Quick Debug Commands

### 1. Check Application Status
```bash
cd deployment
./get-logs.sh process
```

### 2. Get Application Logs
```bash
# PM2 logs (if app is managed by PM2)
./get-logs.sh pm2 100

# Application logs (PM2 + CodeDeploy)
./get-logs.sh app 100

# CodeDeploy deployment logs
./get-logs.sh codedeploy 200
```

### 3. Check for Errors
```bash
./get-logs.sh errors 50
```

### 4. System Information
```bash
./debug-instance.sh
```

## Current Status

Based on recent checks:
- ✅ **Application is running** - Node process found: `node /home/ec2-user/chatty-backend/build/src/app.js`
- ⚠️ **High CPU usage** - 89.7% (might indicate an issue)
- ⚠️ **PM2 daemon running** but app not managed by PM2 (running directly)
- ⚠️ **SSM permissions** - Some SSM errors (not critical for app debugging)

## Common Log Locations

### Application Logs
- **PM2 Logs**: `~/.pm2/logs/` (if using PM2)
- **Application Directory**: `/home/ec2-user/chatty-backend/`
- **CodeDeploy Scripts Log**: `/opt/codedeploy-agent/deployment-root/*/d-*/logs/scripts.log`

### System Logs
- **System Messages**: `/var/log/messages` or `journalctl`
- **User Data Script**: `/var/log/user-data.log`
- **Cloud Init**: `/var/log/cloud-init.log`

### CodeDeploy Logs
- **Agent Log**: `/var/log/amazon/codedeploy-agent/codedeploy-agent.log`
- **Deployment Logs**: `/opt/codedeploy-agent/deployment-root/*/d-*/logs/scripts.log`

## Manual SSH Debugging

### Connect to Instance
```bash
cd deployment
./ssh-backend.sh
```

### Once Connected, Check:

1. **Application Process**
   ```bash
   ps aux | grep node
   pm2 list
   pm2 logs
   ```

2. **Application Directory**
   ```bash
   cd /home/ec2-user/chatty-backend
   ls -la
   cat .env | grep -E "DATABASE_URL|REDIS_HOST|NODE_ENV"
   ```

3. **Check if App is Listening**
   ```bash
   netstat -tln | grep 5000
   # or
   ss -tln | grep 5000
   curl http://localhost:5000/health
   ```

4. **PM2 Status (if using PM2)**
   ```bash
   cd /home/ec2-user/chatty-backend
   pm2 list
   pm2 logs chatty-backend --lines 100
   pm2 logs chatty-backend --err --lines 100
   ```

5. **Recent CodeDeploy Deployment**
   ```bash
   sudo ls -lt /opt/codedeploy-agent/deployment-root/*/d-*/logs/scripts.log | head -1
   sudo tail -200 <latest-deployment-log>
   ```

6. **Check Application Output**
   ```bash
   # If running directly (not PM2)
   sudo journalctl -u chatty-backend -n 100 --no-pager
   
   # Or check process output
   ps aux | grep "node.*app.js"
   ```

## Troubleshooting High CPU Usage

If CPU is high (like 89.7% seen):
1. Check if app is in a loop
2. Check database/Redis connections
3. Check for memory leaks
4. Review application logs for errors

```bash
# Check what the process is doing
top -p $(pgrep -f "node.*app.js")
strace -p $(pgrep -f "node.*app.js") -c
```

## Quick Health Check Script

Run this to get a complete status:
```bash
cd deployment
./ssh-backend.sh << 'EOF'
echo "=== Application Status ==="
ps aux | grep -E "node|pm2" | grep -v grep
echo ""
echo "=== Port Status ==="
netstat -tln | grep 5000 || ss -tln | grep 5000
echo ""
echo "=== Health Check ==="
curl -s http://localhost:5000/health || echo "Health check failed"
echo ""
echo "=== PM2 Status ==="
cd /home/ec2-user/chatty-backend && pm2 list 2>/dev/null || echo "PM2 not managing app"
echo ""
echo "=== Recent Logs ==="
cd /home/ec2-user/chatty-backend && pm2 logs chatty-backend --lines 20 --nostream 2>/dev/null || echo "No PM2 logs"
EOF
```

