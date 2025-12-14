# 🔴 CRITICAL: Google OAuth Redirect Issue

## The Problem

Google is redirecting to `https://dev.chatappserver.space/auth/google/callback` (frontend) instead of `https://api.dev.chatappserver.space/api/v1/auth/google/callback` (backend).

This causes:
1. ❌ 403 Forbidden - Frontend can't handle the callback
2. ❌ Backend callback handler never runs
3. ❌ No authorization code is generated
4. ❌ Frontend POST exchange fails with 400 Bad Request

## Root Cause

**Your Google OAuth Console has the frontend URL registered in "Authorized redirect URIs"**. Google is choosing to redirect there instead of the backend.

## The Fix (You MUST Do This)

### Go to Google Cloud Console

1. https://console.cloud.google.com/
2. Select your project
3. **APIs & Services** → **Credentials**
4. Find your **OAuth 2.0 Client ID**
5. Click **Edit**

### CRITICAL: Authorized redirect URIs

**REMOVE these URLs if they exist:**
- ❌ `https://dev.chatappserver.space/auth/google/callback`
- ❌ `https://staging.chatappserver.space/auth/google/callback`
- ❌ `https://chatappserver.space/auth/google/callback`

**KEEP ONLY these URLs:**
- ✅ `http://localhost:5000/api/v1/auth/google/callback` (local dev)
- ✅ `https://api.dev.chatappserver.space/api/v1/auth/google/callback` (dev - REQUIRED)
- ✅ `https://api.staging.chatappserver.space/api/v1/auth/google/callback` (staging)
- ✅ `https://api.chatappserver.space/api/v1/auth/google/callback` (production)

### Authorized JavaScript origins (These are OK)

You can keep frontend domains here:
- ✅ `https://dev.chatappserver.space`
- ✅ `https://staging.chatappserver.space`
- ✅ `https://chatappserver.space`
- ✅ `http://localhost:5000`

## Why This Matters

- **Authorized JavaScript origins** = Where the OAuth request originates (frontend is OK)
- **Authorized redirect URIs** = Where Google redirects back (MUST be backend only)

If you have frontend URLs in "Authorized redirect URIs", Google will redirect there and the backend never processes the callback.

## After Fixing

1. Wait 1-2 minutes for Google to propagate changes
2. Clear browser cache
3. Try OAuth again

The flow should now be:
1. Frontend → Backend (`api.dev.chatappserver.space/api/v1/auth/google`)
2. Backend → Google OAuth
3. Google → Backend (`api.dev.chatappserver.space/api/v1/auth/google/callback`)
4. Backend processes → Redirects to frontend (`dev.chatappserver.space/auth/google/callback?code=...`)
5. Frontend exchanges code → Success!
