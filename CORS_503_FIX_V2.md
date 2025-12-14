# CORS and 503 Error Fix for dev.chatappserver.space - Version 2

## Issues Reported
- 503 errors on sign in, sign up, and Google OAuth at `https://dev.chatappserver.space`
- CORS errors preventing these endpoints from working

## Root Causes

1. **CORS Headers Not Set on Auth Routes**: While global CORS middleware was in place, auth routes needed explicit CORS handling to ensure headers are set before any errors occur
2. **Missing OPTIONS Preflight Handlers**: Auth routes didn't have explicit OPTIONS handlers for preflight requests
3. **Database Connection Issues**: 503 errors may indicate database connectivity problems (separate from CORS)

## Fixes Applied

### 1. Added Explicit CORS Middleware to Auth Routes

**File: `src/features/auth/routes/authRoutes.ts`**

- Added `isOriginAllowed()` helper method (matches logic from `setupServer.ts`)
- Added `setCorsHeaders()` helper method to set CORS headers on responses
- Added `corsMiddleware()` that runs on ALL auth routes before route handlers
- This ensures CORS headers are set even if an error occurs in the route handler

### 2. Added Explicit OPTIONS Preflight Handlers

- Added OPTIONS handlers for specific routes:
  - `/signup`
  - `/signin`
  - `/:provider` (OAuth initiate)
  - `/:provider/callback` (OAuth callback)
- Added catch-all OPTIONS handler for other auth routes
- All OPTIONS handlers properly set CORS headers before responding

### 3. Enhanced OAuth Health Check

- OAuth health check endpoint now explicitly sets CORS headers before sending response

## Changes Made

```typescript
// Added CORS middleware that runs first on all auth routes
this.router.use(this.corsMiddleware.bind(this));

// Added explicit OPTIONS handlers for preflight requests
this.router.options('/signup', (req: Request, res: Response) => {
  this.setCorsHeaders(req, res);
  res.status(200).end();
});

// ... similar for other routes
```

## About 503 Errors

503 errors can occur for two reasons:

1. **Health Check Endpoint**: The `/health` endpoint returns 503 when the database is not connected. This is **expected behavior** during startup and is acceptable.

2. **Signup/Signin Endpoints**: If signup/signin endpoints are returning 503, this indicates:
   - Database connection is not established
   - Database connection string might be incorrect
   - Network connectivity issues to the database

**Important**: Even with 503 errors, CORS headers are now set, so the browser won't block the response due to CORS issues.

## Testing After Deployment

1. **Test Sign Up**:
   ```
   POST https://api.dev.chatappserver.space/api/v1/auth/signup
   Origin: https://dev.chatappserver.space
   ```
   - Check browser console - should see no CORS errors
   - Check Network tab - response should include `Access-Control-Allow-Origin: https://dev.chatappserver.space`
   - If 503 error: Check backend logs for database connection status

2. **Test Sign In**:
   ```
   POST https://api.dev.chatappserver.space/api/v1/auth/signin
   Origin: https://dev.chatappserver.space
   ```
   - Check browser console - should see no CORS errors
   - Check Network tab - should see CORS headers

3. **Test Google OAuth**:
   ```
   GET https://api.dev.chatappserver.space/api/v1/auth/google?redirect_uri=https://dev.chatappserver.space
   Origin: https://dev.chatappserver.space
   ```
   - Check for OPTIONS preflight request (should return 200 with CORS headers)
   - Check that redirect to Google works
   - Check callback redirect back to frontend

4. **Check Backend Logs**:
   - Look for: `CORS headers set for origin: https://dev.chatappserver.space`
   - Look for database connection status
   - Look for any error messages

## Database Connection Troubleshooting

If you're getting 503 errors on signup/signin (not just `/health`):

1. **Check Environment Variables**:
   ```bash
   # On the server, check if DATABASE_URL is set correctly
   echo $DATABASE_URL
   ```

2. **Check Database Connection**:
   ```bash
   # Test database connectivity from the server
   mongosh "$DATABASE_URL" --eval "db.adminCommand('ping')"
   ```

3. **Check Backend Logs**:
   - Look for database connection errors
   - Look for MongoDB connection status

4. **Verify Database Server**:
   - Ensure MongoDB/Atlas cluster is running
   - Check network security groups allow connections
   - Verify IP whitelist includes server IP

## Deployment Steps

1. **Build the application**:
   ```bash
   npm run build
   ```

2. **Test locally** (if possible):
   ```bash
   npm start
   ```

3. **Deploy to server** (follow your deployment process)

4. **Verify deployment**:
   - Check server logs for startup
   - Test health endpoint: `curl https://api.dev.chatappserver.space/health`
   - Test signup endpoint with CORS: Check browser network tab

## Expected Behavior After Fix

✅ All auth endpoints (signup, signin, OAuth) will have CORS headers set
✅ OPTIONS preflight requests will be handled correctly
✅ Even if 503 errors occur (database issues), CORS headers will be present
✅ Browser will not block responses due to CORS
✅ Errors will be visible in browser console (not blocked by CORS)

## Notes

- The CORS middleware in `setupServer.ts` still runs and provides a second layer of CORS protection
- The auth route CORS middleware runs first, ensuring headers are set early
- If database connection issues persist, they need to be resolved separately from CORS
- Health check endpoint can return 503 during startup - this is normal and expected


