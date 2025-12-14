# Deployment Steps for CORS/503 Fix

Follow these steps to deploy the CORS and 503 fixes to `https://dev.chatappserver.space`:

## Step 1: Build the TypeScript Code

First, compile the TypeScript changes to JavaScript:

```bash
npm run build
```

This will compile `src/setupServer.ts` and other TypeScript files into the `build/` directory.

**Verify the build succeeded:**
```bash
ls -la build/src/setupServer.js
```

You should see the compiled JavaScript file.

## Step 2: Test Locally (Optional but Recommended)

If you want to test locally first:

```bash
npm run dev
```

Then test from your frontend to ensure CORS is working. Check the console logs for CORS messages like:
- `CORS: Allowing exact match: https://dev.chatappserver.space`
- `CORS: Handled OPTIONS preflight for https://dev.chatappserver.space`

## Step 3: Commit and Push Changes (if using Git)

If you're using version control:

```bash
git add src/setupServer.ts CORS_503_FIX.md DEPLOYMENT_STEPS.md
git commit -m "Fix CORS and 503 errors for dev.chatappserver.space"
git push
```

## Step 4: Create Deployment Package

Create the deployment package that includes the built code:

```bash
./create-deployment-package.sh
```

This will create `chatapp.zip` with all necessary files (excluding `node_modules`, `.git`, etc.).

**Verify the package:**
```bash
ls -lh chatapp.zip
```

## Step 5: Upload to S3

Upload the deployment package to your S3 bucket:

```bash
aws --region us-east-1 s3 cp chatapp.zip s3://chatapp-server-app-602951639614/chatapp.zip
```

**Note:** If your bucket name is different, check your deployment configuration or use:
```bash
aws s3 cp chatapp.zip s3://chatapp-server-default-app-602951639614/chatapp.zip --region us-east-1
```

## Step 6: Create CodeDeploy Deployment

Navigate to the deployment directory and create a new deployment:

```bash
cd deployment
./create-deployment.sh
```

Or if you prefer to use AWS CLI directly:

```bash
aws deploy create-deployment \
  --application-name chatapp-server-app \
  --deployment-group-name dev \
  --s3-location bucket=chatapp-server-app-602951639614,key=chatapp.zip,bundleType=zip \
  --region us-east-1
```

## Step 7: Monitor Deployment

Watch the deployment progress:

```bash
# From the deployment directory
./check-deployment-status.sh
```

Or check logs on the EC2 instance:

```bash
./check-logs.sh
```

## Step 8: Verify the Fix

Once deployment completes, test the following:

### Test Sign Up:
1. Go to `https://dev.chatappserver.space/`
2. Try to sign up
3. **Check browser console** - should see NO CORS errors
4. **Check Network tab** - response should include:
   - `Access-Control-Allow-Origin: https://dev.chatappserver.space`
   - `Access-Control-Allow-Credentials: true`

### Test Sign In:
1. Try to sign in with credentials
2. Verify cookies are being set (DevTools → Application → Cookies)
3. No CORS errors in console

### Test Google OAuth:
1. Click Google OAuth button
2. Complete OAuth flow
3. Verify redirect works
4. Check for CORS errors

### Check Backend Logs:
SSH into your EC2 instance and check logs:

```bash
# From deployment directory
./ssh-backend.sh

# Then on the server:
pm2 logs
# or
tail -f /var/log/cloud-init-output.log
```

Look for CORS logs:
- ✅ `CORS: Allowing exact match: https://dev.chatappserver.space`
- ✅ `CORS: Handled OPTIONS preflight for https://dev.chatappserver.space`
- ❌ `CORS blocked origin: ...` (should NOT see this)

## Troubleshooting

### If deployment fails:
1. Check CodeDeploy logs: `./deployment/check-logs.sh`
2. Verify build succeeded: `ls -la build/src/setupServer.js`
3. Check S3 upload: `aws s3 ls s3://chatapp-server-app-602951639614/`

### If CORS errors persist:
1. Check backend logs for CORS decisions
2. Verify the origin in browser Network tab matches exactly
3. Clear browser cache and try again
4. Check that the build includes the updated `setupServer.js`

### If 503 errors persist:
1. Check database connection: `./deployment/check-logs.sh | grep -i database`
2. Verify health endpoint: `curl https://api.dev.chatappserver.space/health`
3. Check MongoDB connection string in environment variables

## Quick Deployment (All-in-One)

If you want to do everything in one go:

```bash
# Build
npm run build

# Create package
./create-deployment-package.sh

# Upload
aws --region us-east-1 s3 cp chatapp.zip s3://chatapp-server-app-602951639614/chatapp.zip

# Deploy
cd deployment && ./create-deployment.sh
```

## What Changed

The fixes include:
- ✅ Improved CORS origin matching (case-insensitive, better subdomain handling)
- ✅ Explicit CORS headers on all responses (including errors)
- ✅ OPTIONS preflight request handling
- ✅ CORS headers in error handlers (so 503 errors include CORS headers)

All changes are in `src/setupServer.ts` and are compiled to `build/src/setupServer.js` during the build step.


