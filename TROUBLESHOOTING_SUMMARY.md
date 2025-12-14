# 503 Error Troubleshooting Summary

## Current Diagnosis

✅ **Confirmed**: The 503 error is coming from AWS ELB, not the application
- This means **no backend instances are responding** to health checks
- The application is likely **not running** on EC2 instances

## Immediate Action Items

### 1. Check AWS Console (Most Important)

**EC2 Target Groups**:
- Go to: AWS Console → EC2 → Target Groups
- Find target group: `<prefix>-tg`
- Check "Targets" tab:
  - Are instances registered?
  - What's their health status?
  - What's the failure reason?

**EC2 Auto Scaling Groups**:
- Go to: AWS Console → EC2 → Auto Scaling Groups  
- Find ASG: `<prefix>-asg`
- Check "Instances" tab - are instances running?

**CodeDeploy**:
- Go to: AWS Console → CodeDeploy → Deployments
- Check latest deployment status
- Look for failed deployments

### 2. Check Server Logs (If You Have SSH Access)

```bash
cd deployment

# Quick debug
./quick-debug.sh

# Application logs
./get-logs.sh app 100

# PM2 logs
./get-logs.sh pm2 100

# Errors
./get-logs.sh errors 50
```

### 3. Common Issues to Check

**Most Likely Causes** (in order of probability):

1. **Application Not Started**
   - CodeDeploy failed to start app
   - PM2 not managing the process
   - Application crashed on startup

2. **Database Connection Failure**
   - DATABASE_URL missing or incorrect
   - MongoDB Atlas IP whitelist issue
   - Network connectivity problem

3. **Environment Variables Missing**
   - .env file not present
   - Required variables undefined
   - Config validation failing

4. **Port Not Listening**
   - Application crashed before binding to port 5000
   - Firewall/security group blocking

5. **Health Check Misconfiguration**
   - Health check path wrong
   - Security group blocks ALB access

## Quick Diagnostic Commands

### If You Can SSH Into Instance:

```bash
# 1. Check if app is running
ps aux | grep node
pm2 list

# 2. Check port status
netstat -tln | grep 5000
curl http://localhost:5000/health

# 3. Check application directory
cd /home/ec2-user/chatty-backend
ls -la
cat .env

# 4. Check logs
pm2 logs chatty-backend --lines 50
```

### If You Can't SSH:

Use AWS Console to check:
- CloudWatch Logs (if configured)
- EC2 Instance status
- Target Group health
- CodeDeploy deployment logs

## Expected Behavior After Fix

Once fixed, you should see:
- ✅ Health endpoint returns 200 or 503 (with database connecting)
- ✅ Target group shows instances as "healthy"
- ✅ Auth endpoints return responses with CORS headers
- ✅ Application logs show successful startup

## Files Created for Troubleshooting

1. **troubleshoot-503.sh** - Automated diagnostic script
2. **503_TROUBLESHOOTING_GUIDE.md** - Comprehensive troubleshooting guide
3. **test-cors-endpoints.sh** - Test CORS headers (once server is up)

## Next Steps

1. **Check AWS Console** for target group and ASG status
2. **If you have SSH access**: Run diagnostic scripts
3. **If you don't have SSH access**: Check CloudWatch Logs or request access
4. **After fixing**: Run `./test-cors-endpoints.sh` to verify CORS fixes work

## Remember

- The **CORS fixes we made are correct** and will work once the server is running
- The 503 error is a **separate infrastructure/deployment issue**
- Focus on getting the application running first, then verify CORS


