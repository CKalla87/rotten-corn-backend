# Google OAuth Console - Quick Reference

## For Development Environment (dev.chatappserver.space)

### Authorized JavaScript origins
```
https://dev.chatappserver.space
https://api.dev.chatappserver.space
```

### Authorized redirect URIs
```
https://api.dev.chatappserver.space/api/v1/auth/google/callback
https://dev.chatappserver.space/auth/google/callback
```

---

## Explanation

### Authorized JavaScript origins
- **What it is:** The domains that can make OAuth requests to Google
- **Why needed:** Your frontend JavaScript at `dev.chatappserver.space` needs permission to initiate OAuth
- **No trailing slash:** Just the protocol and domain (e.g., `https://dev.chatappserver.space`)

### Authorized redirect URIs
- **What it is:** The exact URLs where Google redirects users after they authenticate
- **Why needed:** Google only redirects to URLs you've explicitly authorized (security)
- **Must match exactly:** The full path, including `/api/v1/auth/google/callback`
- **Both URLs needed:**
  - Primary: Backend API handles the callback and processes authentication
  - Fallback: Handles cases where Google redirects to the frontend domain

---

## Step-by-Step in Google Console

1. Go to https://console.cloud.google.com/apis/credentials
2. Click on your OAuth 2.0 Client ID
3. Scroll to "Authorized JavaScript origins"
4. Click "+ ADD URI" and add:
   - `https://dev.chatappserver.space`
   - `https://api.dev.chatappserver.space`
5. Scroll to "Authorized redirect URIs"
6. Click "+ ADD URI" and add:
   - `https://api.dev.chatappserver.space/api/v1/auth/google/callback`
   - `https://dev.chatappserver.space/auth/google/callback`
7. Click "SAVE" at the bottom

---

## For Other Environments

### Staging
**Authorized JavaScript origins:**
```
https://staging.chatappserver.space
https://api.staging.chatappserver.space
```

**Authorized redirect URIs:**
```
https://api.staging.chatappserver.space/api/v1/auth/google/callback
```

### Production
**Authorized JavaScript origins:**
```
https://chatappserver.space
https://api.chatappserver.space
```

**Authorized redirect URIs:**
```
https://api.chatappserver.space/api/v1/auth/google/callback
```
