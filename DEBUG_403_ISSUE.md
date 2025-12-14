# Debugging 403 Error on Google OAuth

## The Problem
Getting 403 on `https://dev.chatappserver.space/auth/google/callback`

## Key Insight
The 403 is happening because:
- `dev.chatappserver.space` = **Frontend server** (React/Vue app)
- `api.dev.chatappserver.space` = **Backend API server** (Node.js)

Google is redirecting to the **frontend** domain, but the OAuth callback handler is on the **backend**.

## The Real Issue

The frontend is probably calling:
```
https://api.dev.chatappserver.space/api/v1/auth/google/initiate?redirect_uri=https://dev.chatappserver.space
```

But when passport.js tells Google where to redirect, it uses the callback URL from the passport configuration, which should be:
```
https://api.dev.chatappserver.space/api/v1/auth/google/callback
```

However, Google might be redirecting to the frontend domain instead.

## Solution

The frontend should NOT initiate OAuth directly. Instead:

1. **Frontend calls backend**: `GET https://api.dev.chatappserver.space/api/v1/auth/google/initiate?redirect_uri=https://dev.chatappserver.space`

2. **Backend redirects to Google** with callback URL: `https://api.dev.chatappserver.space/api/v1/auth/google/callback`

3. **Google redirects back to backend**: `https://api.dev.chatappserver.space/api/v1/auth/google/callback?code=...`

4. **Backend processes callback** and redirects to frontend: `https://dev.chatappserver.space?token=...`

The issue is that step 3 isn't happening - Google is redirecting to `dev.chatappserver.space` instead.

## Check Server Logs

SSH to your server and check what callback URL passport.js is using:

```bash
ssh -i your-key.pem ec2-user@your-server
cd /home/ec2-user/rotten-corn-backend
pm2 logs --lines 200 | grep -i "oauth\|callback"
```

Look for:
```
Google OAuth callback URL (EC2_URL): https://api.dev.chatappserver.space/api/v1/auth/google/callback
```

If you see a different URL, that's the problem.
