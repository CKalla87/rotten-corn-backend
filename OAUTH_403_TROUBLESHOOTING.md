# OAuth 403 Error - Troubleshooting Guide

## The Problem
Getting `403 Forbidden` on `https://dev.chatappserver.space/auth/google/callback`

## Root Cause
Google OAuth is redirecting to the **frontend domain** (`dev.chatappserver.space`) instead of the **backend API domain** (`api.dev.chatappserver.space`).

## Why This Happens
1. **Google OAuth Console** has the wrong redirect URI configured
2. OR the **passport.js configuration** is telling Google to use the wrong callback URL
3. OR your frontend is initiating OAuth with the wrong redirect URI

## The Fix

### Step 1: Check What Passport.js is Using
The backend code determines the callback URL in `src/shared/config/passport.config.ts`.

**Check your `.env` file on the server:**
```bash
NODE_ENV=develop
EC2_URL=https://api.dev.chatappserver.space  # THIS MUST BE SET CORRECTLY
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
```

### Step 2: Verify Google OAuth Console Configuration

**Go to:** https://console.cloud.google.com/apis/credentials

**Authorized redirect URIs must include:**
```
https://api.dev.chatappserver.space/api/v1/auth/google/callback
```

**DO NOT include:**
```
https://dev.chatappserver.space/auth/google/callback  ❌ WRONG - This is the frontend!
```

### Step 3: Check Application Logs

After restarting your application, check the logs. You should see:
```
Google OAuth callback URL (EC2_URL): https://api.dev.chatappserver.space/api/v1/auth/google/callback
```

**If you see a different URL, fix your `.env` file and restart.**

### Step 4: Verify Frontend is Calling Correct Backend URL

Your frontend should be calling:
```
https://api.dev.chatappserver.space/api/v1/auth/google/initiate?redirect_uri=https://dev.chatappserver.space
```

NOT:
```
https://dev.chatappserver.space/auth/google  ❌ WRONG
```

### Step 5: Infrastructure Check

If the above is all correct, the 403 might be from:

1. **ALB (Application Load Balancer)** - Check security groups allow port 443
2. **CloudFront** (if used) - Check origin settings
3. **DNS** - Verify `api.dev.chatappserver.space` points to your backend server

## Quick Test

Try accessing directly in your browser:
```
https://api.dev.chatappserver.space/api/v1/auth/google/callback?code=test123
```

- If you get an error about invalid code → Route is working! ✅
- If you get 403 → Infrastructure/infrastructure is blocking it ❌
- If you get 404 → Route not registered ❌

## Summary Checklist

- [ ] `.env` has `EC2_URL=https://api.dev.chatappserver.space`
- [ ] `.env` has `NODE_ENV=develop` (or your environment)
- [ ] Google OAuth Console has `https://api.dev.chatappserver.space/api/v1/auth/google/callback`
- [ ] Application logs show the correct callback URL
- [ ] Frontend calls `api.dev.chatappserver.space/api/v1/auth/google/initiate`
- [ ] ALB/CloudFront allows HTTPS traffic
- [ ] DNS points `api.dev.chatappserver.space` to backend
