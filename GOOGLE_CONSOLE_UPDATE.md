# Update Google OAuth Console

## Add Missing Redirect URI

Add this to your **Authorized redirect URIs** in Google Console:

```
https://dev.chatappserver.space/auth/google/callback
```

## Complete List of Redirect URIs (After Update)

Your Authorized redirect URIs should include:

1. `http://localhost:5000/api/v1/auth/google/callback` ✅ (already have)
2. `https://api.chatappserver.space/api/v1/auth/google/callback` ✅ (already have)
3. `https://api.dev.chatappserver.space/api/v1/auth/google/callback` ✅ (already have)
4. `https://api.staging.chatappserver.space/api/v1/auth/google/callback` ✅ (already have)
5. `https://dev.chatappserver.space/auth/google/callback` ❌ **ADD THIS ONE**

## Why This Is Needed

Google is redirecting to `dev.chatappserver.space/auth/google/callback` (the frontend domain), but this URL wasn't in your authorized list, causing the 403 error.

We have a route handler at `/auth/:provider/callback` that handles this redirect, but Google needs authorization first.

## Steps

1. Go to https://console.cloud.google.com/apis/credentials
2. Click on your OAuth 2.0 Client ID
3. Scroll to "Authorized redirect URIs"
4. Click "+ ADD URI"
5. Add: `https://dev.chatappserver.space/auth/google/callback`
6. Click "SAVE"
7. Wait 1-2 minutes for changes to propagate
8. Try Google OAuth again
