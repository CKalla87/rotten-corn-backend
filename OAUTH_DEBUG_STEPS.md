# OAuth Debugging Steps

## Current Issue
Google is redirecting to `dev.chatappserver.space/auth/google/callback` instead of `api.dev.chatappserver.space/api/v1/auth/google/callback`, causing:
- 403 Forbidden on frontend callback route
- 400 Bad Request on code exchange

## Debugging Checklist

### 1. Check Backend Logs
When you click the OAuth button, check the backend logs for:
- `Expected OAuth callback URL for google: ...`
- `OAuth request details:` (should show the callback URL being used)
- Any error messages about redirect_uri

### 2. Verify Google OAuth Request URL
When you click the OAuth button, open browser DevTools → Network tab and find the request to `accounts.google.com/o/oauth2/v2/auth`. Check:
- **redirect_uri parameter** - Should be `https://api.dev.chatappserver.space/api/v1/auth/google/callback`
- If it's different, that's the problem source

### 3. Check Backend Configuration
The backend determines the callback URL based on:
- `NODE_ENV` environment variable
- `EC2_URL` environment variable  
- Falls back to `https://api.dev.chatappserver.space/api/v1/auth/google/callback` if neither match

### 4. Verify Passport Strategy Configuration
The backend logs should show:
- `Google OAuth Strategy configured with callback URL: ...` (at startup)

This should be `https://api.dev.chatappserver.space/api/v1/auth/google/callback` for dev environment.

### 5. Check Health Endpoint
Visit: `https://api.dev.chatappserver.space/api/v1/auth/health/oauth`

This shows:
- Configured callback URL
- Whether Google OAuth is configured
- Redis availability

## If redirect_uri in Google Request is Wrong

If the `redirect_uri` parameter in the Google OAuth request is incorrect, the issue is in the backend's Passport strategy configuration. The callback URL is set in `src/shared/config/passport.config.ts` at startup.

## If redirect_uri is Correct but Google Redirects Elsewhere

If the request has the correct `redirect_uri` but Google still redirects to the frontend, this suggests:
1. Google OAuth Console has the frontend URL registered (you've confirmed this is NOT the case)
2. There's a redirect happening AFTER Google's callback
3. Browser or proxy is rewriting the redirect

## Next Steps

1. Check the actual `redirect_uri` value in the Google OAuth request
2. Check backend startup logs for the configured callback URL
3. Check backend logs when OAuth button is clicked
4. Share these findings for further debugging
