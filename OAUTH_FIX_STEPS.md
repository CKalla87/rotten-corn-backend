# CRITICAL: OAuth 403 Error - Required Steps

## The Problem
Google redirects to `dev.chatappserver.space/auth/google/callback` (frontend), but your backend is at `api.dev.chatappserver.space`.

## REQUIRED FIXES (Do ALL of these):

### 1. Google OAuth Console
**Go to:** https://console.cloud.google.com/apis/credentials

**In Authorized redirect URIs, you MUST have:**
```
https://api.dev.chatappserver.space/api/v1/auth/google/callback
```

**REMOVE (if present):**
```
https://dev.chatappserver.space/auth/google/callback  ❌ DELETE THIS
```

### 2. Server .env File
**SSH to your EC2 instance and edit `.env`:**

```bash
# MUST be set to backend API URL
EC2_URL=https://api.dev.chatappserver.space

# MUST match your environment
NODE_ENV=develop

# Your Google credentials
GOOGLE_CLIENT_ID=your-client-id-here
GOOGLE_CLIENT_SECRET=your-client-secret-here
```

### 3. Restart Application
After changing `.env`:
```bash
# If using PM2:
pm2 restart all

# Or restart your Node.js process
```

### 4. Check Application Logs
After restart, you should see:
```
Google OAuth callback URL (EC2_URL): https://api.dev.chatappserver.space/api/v1/auth/google/callback
```

**If you see a different URL, your EC2_URL is wrong!**

### 5. Verify the Issue
The 403 error happens because:
- Google redirects to: `dev.chatappserver.space/auth/google/callback` ❌
- Backend expects: `api.dev.chatappserver.space/api/v1/auth/google/callback` ✅

**These are DIFFERENT SERVERS!** The frontend (`dev.chatappserver.space`) doesn't have the OAuth route, so you get 403.

## Quick Test
Try this URL directly (will fail with "invalid code" but proves route works):
```
https://api.dev.chatappserver.space/api/v1/auth/google/callback?code=test123
```

- ✅ Error about invalid code = Route works!
- ❌ 403 Forbidden = Still wrong URL or infrastructure blocking
- ❌ 404 Not Found = Route not registered

## Why This Matters
- `dev.chatappserver.space` = Frontend server (React/Vue/etc)
- `api.dev.chatappserver.space` = Backend API server (Node.js)

Google MUST redirect to the BACKEND (`api.dev...`), not the frontend (`dev...`).
