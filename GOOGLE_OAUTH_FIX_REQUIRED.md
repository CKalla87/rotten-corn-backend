# 🔴 CRITICAL: Google OAuth Configuration Issue

## The Problem

You're getting **403 Forbidden** on `https://dev.chatappserver.space/auth/google/callback` because Google is redirecting to the **frontend domain** instead of the **backend API domain**.

This causes:
1. ❌ Google redirects to `dev.chatappserver.space/auth/google/callback` (frontend) → **403 Forbidden**
2. ❌ The backend callback handler never runs, so **no authorization code is generated**
3. ❌ Frontend tries to exchange a code that doesn't exist → **400 Bad Request**

## The Root Cause

Your **Google OAuth Console** has the wrong redirect URI registered. Google is redirecting to:
- ❌ `https://dev.chatappserver.space/auth/google/callback` (frontend domain - WRONG)

But it should redirect to:
- ✅ `https://api.dev.chatappserver.space/api/v1/auth/google/callback` (backend API domain - CORRECT)

## The Fix (You Must Do This in Google Console)

### Step 1: Go to Google Cloud Console
1. Go to https://console.cloud.google.com/
2. Select your project
3. Navigate to **APIs & Services** → **Credentials**
4. Find your **OAuth 2.0 Client ID**
5. Click **Edit**

### Step 2: Update Authorized redirect URIs

**REMOVE this URL (if it exists):**
- ❌ `https://dev.chatappserver.space/auth/google/callback`

**KEEP ONLY these URLs:**
- ✅ `http://localhost:5000/api/v1/auth/google/callback` (for local development)
- ✅ `https://api.dev.chatappserver.space/api/v1/auth/google/callback` (for dev environment)
- ✅ `https://api.staging.chatappserver.space/api/v1/auth/google/callback` (for staging, if needed)
- ✅ `https://api.chatappserver.space/api/v1/auth/google/callback` (for production, if needed)

### Step 3: Save Changes

After updating, **wait 1-2 minutes** for Google to propagate the changes, then try OAuth again.

## Why This Happens

The backend code correctly sets the callback URL to `https://api.dev.chatappserver.space/api/v1/auth/google/callback`, but Google OAuth Console allows you to register multiple redirect URIs. If you have both the frontend and backend URLs registered, Google may choose to redirect to the frontend one, causing the 403 error.

## Important Notes

- **Authorized JavaScript origins** can include both frontend and backend domains (this is fine)
- **Authorized redirect URIs** should ONLY include backend API callback URLs
- The callback MUST go to the backend API (`api.dev.chatappserver.space`), not the frontend (`dev.chatappserver.space`)

## Verify After Fixing

After updating Google Console:
1. Try the OAuth flow again
2. Google should redirect to `https://api.dev.chatappserver.space/api/v1/auth/google/callback?code=...`
3. The backend will generate an authorization code
4. The frontend will successfully exchange the code for a token
