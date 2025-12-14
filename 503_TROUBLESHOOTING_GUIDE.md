# 503 Error Troubleshooting Guide

## Current Status

**Issue**: All requests to `https://api.dev.chatappserver.space` are returning **503 Service Temporarily Unavailable** from the AWS Elastic Load Balancer (ELB).

**Diagnosis**: The response is coming directly from the ELB, not the application server. This means:
- No backend instances are responding to health checks
- The application is likely not running on EC2 instances
- OR the application is running but failing health checks

## Root Cause Analysis

The 503 error from ELB indicates one of these scenarios:

1. **No Healthy Instances**: All instances in the target group are marked as unhealthy
2. **Application Not Running**: The Node.js application is not started on the EC2 instances
3. **Port Not Listening**: Port 5000 is not listening on the instances
4. **Database Connection Issues**: Application starts but crashes due to database connection failures
5. **CodeDeploy Failure**: Latest deployment failed to start the application
6. **Environment Configuration**: Missing or incorrect environment variables (DATABASE_URL, etc.)

## Step-by-Step Diagnosis

### Step 1: Check AWS Target Group Health

1. Go to AWS Console → EC2 → Target Groups
2. Find the target group (likely named `<prefix>-tg`)
3. Click on the "Targets" tab
4. Check the health status:
   - **healthy** (green) = Instance is passing health checks
   - **unhealthy** (red) = Instance is failing health checks
   - **draining** (yellow) = Instance is being removed
   - **initial** (gray) = Health checks haven't completed yet

**What to look for**:
- Are there any instances registered?
- Are all instances marked as "unhealthy"?
- What's the last health check failure reason?

### Step 2: Check Auto Scaling Group

1. Go to AWS Console → EC2 → Auto Scaling Groups
2. Find the ASG (likely named `<prefix>-asg`)
3. Check the "Instances" tab:
   - Are instances running?
   - How many instances are in service?
   - Are instances in "InService" state?

### Step 3: Check CodeDeploy Deployment Status

Run (requires AWS CLI configured):
```bash
cd deployment
./check-deployment-status.sh
```

Or manually:
```bash
aws deploy get-deployment \
  --deployment-id <latest-deployment-id> \
  --region us-east-1 \
  --query '{Status:deploymentInfo.status,StatusMessage:deploymentInfo.statusMessage,ErrorInformation:deploymentInfo.errorInformation}' \
  --output json
```

### Step 4: Check Server Logs (SSH Access Required)

If you have SSH access to the instances:

```bash
# Get application logs
cd deployment
./get-logs.sh app 100

# Get PM2 logs
./get-logs.sh pm2 100

# Get error logs
./get-logs.sh errors 50

# Quick debug
./quick-debug.sh
```

### Step 5: Manual Instance Checks

SSH into an instance and verify:

```bash
# Check if application process is running
ps aux | grep node
pm2 list

# Check if port 5000 is listening
netstat -tln | grep 5000
# or
ss -tln | grep 5000

# Test local health endpoint
curl http://localhost:5000/health

# Check application directory
cd /home/ec2-user/chatty-backend
ls -la
cat .env | grep -E 'DATABASE_URL|REDIS_HOST|NODE_ENV'

# Check PM2 logs
pm2 logs chatty-backend --lines 100
pm2 logs chatty-backend --err --lines 100

# Check CodeDeploy logs
sudo ls -lt /opt/codedeploy-agent/deployment-root/*/d-*/logs/scripts.log | head -1
sudo tail -200 <latest-deployment-log>
```

## Common Issues and Solutions

### Issue 1: Application Not Running

**Symptoms**:
- No node process found
- PM2 shows app as "stopped" or not listed
- Port 5000 not listening

**Possible Causes**:
- CodeDeploy deployment failed
- Application crashed on startup
- PM2 not starting the app correctly

**Solutions**:
1. Check CodeDeploy deployment logs
2. Manually start the app to see errors:
   ```bash
   cd /home/ec2-user/chatty-backend
   npm start
   # or
   pm2 start build/src/app.js --name chatty-backend
   ```
3. Check `.env` file exists and has correct values
4. Review `application_start.sh` script for issues

### Issue 2: Database Connection Failure

**Symptoms**:
- Application starts but crashes
- Logs show MongoDB connection errors
- Health endpoint returns 503 (database not connected)

**Possible Causes**:
- `DATABASE_URL` environment variable missing or incorrect
- MongoDB Atlas IP whitelist doesn't include instance IPs
- Security group blocks outbound connections
- Database server is down

**Solutions**:
1. Verify `DATABASE_URL` in `.env` file
2. Check MongoDB Atlas → Network Access → IP Access List
3. Add EC2 instance IPs or `0.0.0.0/0` (for testing)
4. Check security groups allow outbound HTTPS (port 443)

### Issue 3: Health Check Failing

**Symptoms**:
- Application is running locally
- Port 5000 is listening
- But target group marks instance as unhealthy

**Possible Causes**:
- Health check path `/health` not responding correctly
- Health check timeout too short
- Security group blocks ALB from reaching instances

**Solutions**:
1. Verify health endpoint responds:
   ```bash
   curl http://localhost:5000/health
   ```
2. Check security group inbound rules:
   - Allow HTTP (port 80) from ALB security group
   - Allow HTTP (port 5000) from ALB security group
3. Check target group health check settings:
   - Path: `/health`
   - Port: `traffic-port` or `5000`
   - Protocol: `HTTP`
   - Success codes: `200,503` (503 is OK during startup)

### Issue 4: Environment Variables Missing

**Symptoms**:
- Application fails to start
- Logs show "Configuration X is undefined"
- Config validation errors

**Solutions**:
1. Verify `.env` file exists in `/home/ec2-user/chatty-backend/`
2. Check required variables are set:
   - `DATABASE_URL`
   - `JWT_TOKEN`
   - `SECRET_KEY_ONE`
   - `SECRET_KEY_TWO`
   - `CLIENT_URL`
   - `REDIS_HOST`
   - `NODE_ENV`
3. Verify variables are set correctly (no extra quotes, proper format)

### Issue 5: PM2 Issues

**Symptoms**:
- PM2 not found or broken
- PM2 can't start the application
- PM2 logs show errors

**Solutions**:
1. Reinstall PM2:
   ```bash
   npm uninstall -g pm2
   npm install -g pm2
   ```
2. Check PM2 is in PATH:
   ```bash
   which pm2
   pm2 --version
   ```
3. Manually start with PM2:
   ```bash
   cd /home/ec2-user/chatty-backend
   pm2 start build/src/app.js --name chatty-backend
   pm2 save
   ```

## Quick Fixes

### Restart Application Manually

```bash
# SSH into instance
cd /home/ec2-user/chatty-backend

# Stop existing process
pm2 stop chatty-backend || pkill -f "node.*app.js"

# Start fresh
pm2 start build/src/app.js --name chatty-backend
pm2 save
pm2 logs chatty-backend
```

### Check Application Startup

```bash
# Run directly to see errors
cd /home/ec2-user/chatty-backend
node build/src/app.js
```

### Re-run CodeDeploy Script

```bash
cd /home/ec2-user/chatty-backend
sudo /opt/codedeploy-agent/deployment-root/deployment-instructions/<deployment-id>/scripts/application_start.sh
```

## Prevention

To prevent 503 errors:

1. **Monitor Health Checks**: Set up CloudWatch alarms for unhealthy target counts
2. **Database Connection Pooling**: Ensure proper connection handling
3. **Graceful Startup**: Health check accepts 503 during startup (already configured)
4. **Logging**: Ensure application logs are available in CloudWatch
5. **Automatic Recovery**: Ensure ASG can replace unhealthy instances

## Testing After Fix

Once you've fixed the issue:

1. **Test Health Endpoint**:
   ```bash
   curl https://api.dev.chatappserver.space/health
   ```

2. **Test Auth Endpoints**:
   ```bash
   ./test-cors-endpoints.sh https://api.dev.chatappserver.space
   ```

3. **Verify Target Group**: Wait 2-3 minutes, then check AWS Console to see if instances are healthy

4. **Check CORS Headers**: Verify responses include CORS headers

## Getting Help

If issues persist:

1. Collect logs: `./deployment/get-logs.sh all`
2. Take screenshots of AWS Console (Target Groups, ASG, CodeDeploy)
3. Check CloudWatch Logs for application errors
4. Review recent deployment history


