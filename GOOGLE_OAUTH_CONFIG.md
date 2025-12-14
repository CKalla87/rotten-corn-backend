# Google OAuth Configuration Guide

## Problem
You're getting `403 Forbidden` on `dev.chatappserver.space/auth/google/callback` because Google OAuth is redirecting to the wrong URL.

## Solution

### 1. Google OAuth Console Configuration

**Go to:** https://console.cloud.google.com/apis/credentials

Click on your OAuth 2.0 Client ID to edit it.

#### Authorized JavaScript origins

Add these (where your frontend runs):
```
https://dev.chatappserver.space
https://api.dev.chatappserver.space
```

**What this is:** The domains that can initiate OAuth requests. Your frontend at `dev.chatappserver.space` needs to be here.

#### Authorized redirect URIs

Add these (where Google redirects after authentication):
```
https://api.dev.chatappserver.space/api/v1/auth/google/callback
https://dev.chatappserver.space/auth/google/callback
```

**Why both?**
- `https://api.dev.chatappserver.space/api/v1/auth/google/callback` - The primary backend callback (what the code expects)
- `https://dev.chatappserver.space/auth/google/callback` - A fallback route we've set up to handle cases where Google redirects here

For **staging environment** (if applicable):
```
https://api.staging.chatappserver.space/api/v1/auth/google/callback
```

For **production environment** (if applicable):
```
https://api.chatappserver.space/api/v1/auth/google/callback
```

### 2. Environment Variables (.env file)

Add these variables to your `.env` file on the server:

```bash
# Google OAuth Credentials (REQUIRED)
GOOGLE_CLIENT_ID=your-google-client-id-here
GOOGLE_CLIENT_SECRET=your-google-client-secret-here

# Environment (should be 'develop' for dev environment)
NODE_ENV=develop

# Backend Server URL (OPTIONAL but recommended)
# This should be the public URL of your backend API server
EC2_URL=https://api.dev.chatappserver.space

# Frontend Client URL (OPTIONAL)
# This should be your frontend URL
CLIENT_URL=https://dev.chatappserver.space
```

### 3. How the Code Determines Callback URL

The code determines the callback URL in this order (from `src/shared/config/passport.config.ts`):

1. **If local development** (NODE_ENV='development' AND no EC2_URL AND CLIENT_URL doesn't include 'chatappserver.space'):
   ```
   http://localhost:5000/api/v1/auth/google/callback
   ```

2. **If EC2_URL is set** (recommended for deployed environments):
   ```
   ${EC2_URL}/api/v1/auth/google/callback
   ```
   Example: `https://api.dev.chatappserver.space/api/v1/auth/google/callback`

3. **If NODE_ENV='staging'**:
   ```
   https://api.staging.chatappserver.space/api/v1/auth/google/callback
   ```

4. **If NODE_ENV='production'**:
   ```
   https://api.chatappserver.space/api/v1/auth/google/callback
   ```

5. **Fallback (if NODE_ENV='develop')**:
   ```
   https://api.dev.chatappserver.space/api/v1/auth/google/callback
   ```

### 4. Quick Fix Checklist

✅ **In Google OAuth Console:**
- [ ] Add `https://api.dev.chatappserver.space/api/v1/auth/google/callback` to Authorized redirect URIs
- [ ] Add `https://dev.chatappserver.space/auth/google/callback` to Authorized redirect URIs (fallback)
- [ ] Make sure your Client ID and Client Secret match what's in your .env file

✅ **In your .env file on the server:**
- [ ] Set `GOOGLE_CLIENT_ID=your-client-id`
- [ ] Set `GOOGLE_CLIENT_SECRET=your-client-secret`
- [ ] Set `NODE_ENV=develop` (for dev environment)
- [ ] Set `EC2_URL=https://api.dev.chatappserver.space` (recommended)

✅ **After updating .env:**
- [ ] Restart your Node.js application
- [ ] Check application logs to see what callback URL it's using (should log: `Google OAuth callback URL (EC2_URL): ...`)

### 5. Verify Configuration

After restarting your app, check the logs. You should see:
```
Google OAuth callback URL (EC2_URL): https://api.dev.chatappserver.space/api/v1/auth/google/callback
```

This confirms the callback URL the backend expects. **Make sure this exact URL is in your Google OAuth Console.**

### 6. Common Issues

**Issue:** Still getting 403
- **Solution:** Make sure the URL in Google OAuth Console matches EXACTLY (including https://, no trailing slash, etc.)

**Issue:** Getting "redirect_uri_mismatch" error
- **Solution:** Double-check that the Authorized redirect URI in Google Console matches what the code expects (check logs)

**Issue:** OAuth works locally but not on server
- **Solution:** Make sure NODE_ENV is set correctly ('develop' for dev, not 'development')
