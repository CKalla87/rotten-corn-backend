# Fix Connection Issues

## Problems Found

1. **Redis Connection Failed**: `EHOSTUNREACH 10.0.4.50:6379`
   - ElastiCache endpoint resolves correctly to `10.0.4.50`
   - But port 6379 is NOT accessible from the instance
   - **Root Cause**: Security group not allowing access

2. **MongoDB Connection Error**: `buffermaxentries is not supported`
   - Your current DATABASE_URL looks correct
   - This might be from an old cached connection or MongoDB driver version

## Solutions

### Fix 1: Redis Security Group

The ElastiCache security group needs to allow inbound traffic from your ASG security group.

**Check current security groups:**
```bash
# Get ASG security group ID
aws ec2 describe-security-groups --region us-east-1 \
  --filters "Name=group-name,Values=chatapp-server-asg-sg" \
  --query 'SecurityGroups[0].GroupId' --output text

# Get ElastiCache security group
aws elasticache describe-cache-clusters --region us-east-1 \
  --cache-cluster-id chatapp-server-default-redis \
  --show-cache-node-info \
  --query 'CacheClusters[0].SecurityGroups[0].SecurityGroupId' \
  --output text
```

**Add security group rule:**
```bash
# Replace <ELASTICACHE_SG_ID> and <ASG_SG_ID> with actual IDs
aws ec2 authorize-security-group-ingress \
  --region us-east-1 \
  --group-id <ELASTICACHE_SG_ID> \
  --protocol tcp \
  --port 6379 \
  --source-group <ASG_SG_ID>
```

### Fix 2: MongoDB Connection

The `buffermaxentries` error suggests an old MongoDB connection string format. Your current string looks correct, but:

1. **Check if there's a cached .env file:**
   ```bash
   # On the instance
   cd /home/ec2-user/chatty-backend
   cat .env | grep DATABASE_URL
   ```

2. **If the error persists, try updating the connection string:**
   - Remove any `buffermaxentries` parameter
   - Your current string: `mongodb+srv://Kalla1987:chipotle24@chatapp.vf4mpp7.mongodb.net/rotterncornapp-backend?retryWrites=true&w=majority&appName=ChatApp`
   - This looks correct - the error might be from MongoDB driver version

3. **Update MongoDB driver if needed:**
   ```bash
   # Check current mongoose version
   npm list mongoose
   
   # Update if needed
   npm install mongoose@latest
   ```

## Quick Test Commands

Once security groups are fixed, test from the instance:

```bash
# Test Redis connectivity
telnet 10.0.4.50 6379
# Or
nc -zv 10.0.4.50 6379

# Test MongoDB (from Node.js)
node -e "require('mongoose').connect('mongodb+srv://Kalla1987:chipotle24@chatapp.vf4mpp7.mongodb.net/rotterncornapp-backend?retryWrites=true&w=majority&appName=ChatApp').then(() => console.log('Connected')).catch(e => console.error(e))"
```

## After Fixing

1. Restart the application:
   ```bash
   cd /home/ec2-user/chatty-backend
   /usr/local/node-v16.20.2-linux-x64/bin/pm2 restart chatty-backend
   # Or if not using PM2:
   pkill -f "node.*app.js"
   # Then restart via deployment script
   ```

2. Check logs:
   ```bash
   /usr/local/node-v16.20.2-linux-x64/bin/pm2 logs chatty-backend --lines 50
   ```

3. Verify connections:
   ```bash
   curl http://localhost:5000/health
   ```

