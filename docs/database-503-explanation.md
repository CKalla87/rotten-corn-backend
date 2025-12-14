# Why is the Database Returning 503?

## Overview

The health endpoint (`/health`) returns HTTP 503 when the database is not connected. This is **expected behavior** during application startup, but can also indicate connection issues.

## Database Connection States

Mongoose connection `readyState` values:
- **0** = `disconnected` - Not connected to database
- **1** = `connected` - Successfully connected ✅
- **2** = `connecting` - Connection in progress
- **3** = `disconnecting` - Disconnection in progress

The health endpoint returns:
- **200** when `readyState === 1` (connected)
- **503** when `readyState !== 1` (not connected)

## Why 503 During Startup is Normal

1. **Asynchronous Connection**: The database connection is started asynchronously in `setupDatabase.ts` but not awaited
2. **Server Starts Immediately**: The Express server starts listening before the database connection completes
3. **Connection Takes Time**: Database connections can take 5-15 seconds depending on:
   - Network latency
   - Database server response time
   - Authentication/authorization
   - SSL/TLS handshake (if enabled)

## Common Causes of Persistent 503

If the database continues to return 503 after 30+ seconds, check:

### 1. **Database URL Configuration**
- Check if `DATABASE_URL` environment variable is set correctly
- Verify the connection string format: `mongodb://[username]:[password]@[host]:[port]/[database]`
- For MongoDB Atlas: Ensure the connection string includes the cluster name

### 2. **Network Connectivity**
- **Security Groups**: Ensure EC2 security group allows outbound traffic to MongoDB port (usually 27017)
- **VPC Configuration**: If MongoDB is in a VPC, ensure proper routing and security group rules
- **MongoDB Atlas**: Ensure your IP/security group is whitelisted in MongoDB Atlas network access settings

### 3. **Authentication Issues**
- Verify username and password are correct
- Check if the database user has proper permissions
- For MongoDB Atlas: Ensure the database user exists and has read/write permissions

### 4. **Database Server Issues**
- Check if MongoDB server is running and accessible
- Verify database server is not overloaded
- Check MongoDB server logs for errors

### 5. **Connection Timeout**
- Default connection timeout is 10 seconds (`serverSelectionTimeoutMS`)
- If database is slow to respond, connection may timeout
- Check network latency between EC2 and MongoDB

## How to Debug

### 1. Check Application Logs
Look for database connection logs:
```bash
# On EC2 instance
pm2 logs chatty-backend --lines 100 | grep -i "database\|mongoose\|connection"
```

### 2. Check Health Endpoint Details
The improved health endpoint now returns detailed database state:
```bash
curl http://localhost:5000/health
```

Response includes:
```json
{
  "services": {
    "database": {
      "status": "connecting" | "connected" | "disconnected",
      "readyState": 0-3,
      "host": "database-host",
      "port": 27017,
      "name": "database-name"
    }
  }
}
```

### 3. Test Database Connection Manually
```bash
# On EC2 instance, test MongoDB connection
mongo "your-connection-string" --eval "db.adminCommand('ping')"
```

### 4. Check Environment Variables
```bash
# On EC2 instance
cat /home/ec2-user/chatty-backend/.env | grep DATABASE_URL
```

## Deployment Script Behavior

The `application_start.sh` script:
- ✅ Accepts HTTP 503 as a valid response (database may still be connecting)
- ✅ Exits successfully if port 5000 is listening (even if health check returns 503)
- ✅ Allows deployment to continue - target group health checks will validate readiness

This means:
- **503 during startup is OK** - the script won't fail
- **503 after 30+ seconds** - may indicate a real connection issue
- **Port listening** - means the app is running, even if database isn't connected yet

## Solutions

### If Database Never Connects

1. **Verify DATABASE_URL** in `.env` file on EC2
2. **Check Security Groups** - ensure outbound access to MongoDB
3. **Check MongoDB Atlas Whitelist** - ensure EC2 IP/security group is allowed
4. **Review Connection Logs** - look for specific error messages
5. **Test Connection Manually** - verify connectivity from EC2 instance

### If Connection is Slow

1. **Increase Timeout** - modify `serverSelectionTimeoutMS` in `setupDatabase.ts`
2. **Check Network** - verify low latency between EC2 and MongoDB
3. **Optimize Connection String** - use connection pooling options

## Connection Retry Logic

The application automatically retries database connection:
- Retries every 5 seconds on connection failure
- Logs errors for each retry attempt
- Continues retrying until successful

This means even if the initial connection fails, the app will keep trying to connect.


