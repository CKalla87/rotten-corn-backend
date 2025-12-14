# CORS Fix for dev.chatappserver.space

## Issue
CORS errors occurring for signin, signup, and Google OAuth on `https://dev.chatappserver.space/`

## Root Causes Identified

1. **Cookie Domain Configuration**: The cookie domain logic didn't explicitly handle the dev environment, which could cause cookies to not be set/sent properly across subdomains (dev.chatappserver.space ↔ api.dev.chatappserver.space)

2. **Missing CORS Headers**: The CORS configuration was missing some explicit headers that browsers need for credentialed requests (cookies)

## Fixes Applied

### 1. Enhanced Cookie Domain Logic
Updated `getSessionDomain()` in `src/setupServer.ts` to:
- Better detect dev environment by checking `EC2_URL` or `CLIENT_URL` for dev subdomain
- Explicitly handle dev environment to use `.chatappserver.space` domain
- This allows cookies to work across `dev.chatappserver.space` and `api.dev.chatappserver.space`

### 2. Enhanced CORS Configuration
Added explicit CORS headers:
- `allowedHeaders`: Explicitly allows Content-Type, Authorization, Accept, Origin, X-Requested-With
- `exposedHeaders`: Exposes Content-Length and Content-Type to the client
- `methods`: Added PATCH to allowed methods
- `maxAge`: Set to 86400 (24 hours) to cache preflight requests
- `preflightContinue`: Set to false for proper preflight handling

### Changes Made

```typescript
// Before
credentials: true,
optionsSuccessStatus: 200,
methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']

// After  
credentials: true,
optionsSuccessStatus: 200,
methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'X-Requested-With'],
exposedHeaders: ['Content-Length', 'Content-Type'],
preflightContinue: false,
maxAge: 86400 // 24 hours
```

## Testing

After deploying these changes:

1. **Test Signup**:
   - Go to `https://dev.chatappserver.space/`
   - Try to sign up
   - Check browser console for CORS errors
   - Check backend logs for: `CORS: Allowing exact match: https://dev.chatappserver.space`

2. **Test Signin**:
   - Try to sign in with credentials
   - Verify cookies are being set (check DevTools → Application → Cookies)
   - Verify no CORS errors in console

3. **Test Google OAuth**:
   - Click Google OAuth button
   - Complete OAuth flow
   - Verify redirect back to frontend works
   - Check for CORS errors during OAuth callback

4. **Check Backend Logs**:
   - Look for CORS decision logs
   - Success: `CORS: Allowing exact match: https://dev.chatappserver.space`
   - Failure: `CORS blocked origin: ...`

## Cookie Domain Notes

- Cookies use domain `.chatappserver.space` which works for all subdomains
- `sameSite: 'none'` and `secure: true` are set for cross-origin requests (HTTPS)
- This allows cookies to work between `dev.chatappserver.space` (frontend) and `api.dev.chatappserver.space` (backend)

## Additional Notes

- The CORS configuration already includes `https://dev.chatappserver.space` in allowed origins ✅
- Credentials are enabled (`credentials: true`) ✅
- The fix ensures cookies can be properly set and sent across subdomains ✅


