# CORS and 503 Error Fix for dev.chatappserver.space

## Issues Identified

1. **CORS Errors**: Frontend at `https://dev.chatappserver.space` was experiencing CORS errors when making requests to the backend API
2. **503 Errors**: Health check endpoint and potentially other endpoints were returning 503 errors, which might be blocking requests

## Root Causes

1. **CORS Origin Matching**: The origin matching logic had some edge cases that could fail for certain origin formats
2. **Missing CORS Headers on Errors**: Error responses (including 503) were not explicitly setting CORS headers, causing browsers to block the responses
3. **OPTIONS Preflight Handling**: While CORS middleware handled OPTIONS requests, explicit handling was added for better reliability

## Fixes Applied

### 1. Improved CORS Origin Matching

**Changes in `src/setupServer.ts`**:
- Made origin matching case-insensitive for better reliability
- Improved subdomain matching logic to handle all `chatappserver.space` subdomains
- Added explicit host matching in addition to full URL matching
- Better normalization of origins (removing trailing slashes, case-insensitive comparison)

**Key improvements**:
```typescript
// Before: Case-sensitive, less robust matching
if (normalizedOrigin === normalizedAllowed) { ... }

// After: Case-insensitive, multiple matching strategies
const normalizedOrigin = origin.replace(/\/$/, '').toLowerCase();
// Checks: exact match, host match, subdomain match
```

### 2. Explicit CORS Headers on All Responses

**Added middleware** to set CORS headers on all responses:
- Ensures CORS headers are present even if the CORS middleware fails
- Applied to all routes, including error responses
- Includes all necessary headers: `Access-Control-Allow-Origin`, `Access-Control-Allow-Credentials`, etc.

### 3. Explicit OPTIONS Preflight Handling

**Added explicit OPTIONS handler**:
- Handles preflight requests before they reach route handlers
- Ensures proper CORS headers are set for OPTIONS requests
- Logs preflight requests for debugging

### 4. CORS Headers in Error Handlers

**Updated error handlers** to set CORS headers:
- Global error handler now sets CORS headers before sending error responses
- 404 handler also sets CORS headers
- This ensures that even 503 errors from health checks include CORS headers

### 5. Enhanced CORS Configuration

**Updated CORS allowed headers**:
- Added `Cookie` to `allowedHeaders` (for cookie-based auth)
- Added `Set-Cookie` to `exposedHeaders` (for session cookies)
- This ensures cookies work properly with CORS

## Testing

After deploying these changes, test the following:

1. **Sign Up**:
   - Go to `https://dev.chatappserver.space/`
   - Try to sign up
   - Check browser console - should see no CORS errors
   - Check Network tab - should see proper CORS headers in response

2. **Sign In**:
   - Try to sign in with credentials
   - Verify cookies are being set (check DevTools → Application → Cookies)
   - Verify no CORS errors in console

3. **Google OAuth**:
   - Click Google OAuth button
   - Complete OAuth flow
   - Verify redirect back to frontend works
   - Check for CORS errors during OAuth callback

4. **Check Backend Logs**:
   - Look for CORS decision logs:
     - Success: `CORS: Allowing exact match: https://dev.chatappserver.space`
     - Preflight: `CORS: Handled OPTIONS preflight for https://dev.chatappserver.space`
   - Failure: `CORS blocked origin: ...`

## About 503 Errors

The 503 error from the health check endpoint (`/health`) is **expected behavior** when the database is not connected. This is normal during:
- Application startup (database is connecting)
- Database reconnection attempts

However, the health check endpoint now includes proper CORS headers, so even if it returns 503, the browser won't block it due to CORS.

**Note**: If you're getting 503 errors on signup/signin endpoints (not just `/health`), this indicates the database is not connected. Check:
- Database connection string in environment variables
- Database server availability
- Network connectivity to database

## Allowed Origins

The backend now allows requests from:
- `https://dev.chatappserver.space` (dev frontend)
- `https://api.dev.chatappserver.space` (dev API)
- `https://staging.chatappserver.space` (staging frontend)
- `https://api.staging.chatappserver.space` (staging API)
- `https://chatappserver.space` (production frontend)
- `http://localhost:3000`, `http://localhost:3001`, `http://localhost:8080` (local dev)
- `config.CLIENT_URL` (from environment)

All subdomains of `chatappserver.space` are automatically allowed.

## Deployment

After deploying these changes:
1. Rebuild the application: `npm run build`
2. Restart the server
3. Check logs for CORS decisions
4. Test from the frontend

## Additional Notes

- CORS headers are now set on **all** responses, including errors
- The origin matching is case-insensitive and handles trailing slashes
- OPTIONS preflight requests are explicitly handled
- Cookie-based authentication should work properly with CORS


