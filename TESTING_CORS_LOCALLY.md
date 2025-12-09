# Testing CORS Locally

Your backend already has CORS logging built in! Here's how to test CORS issues locally using your UI.

## Quick Setup

### 1. Check Your UI Origin
First, make sure your UI is running on one of these allowed origins:
- `http://localhost:3000` ✅ (already allowed)
- `http://localhost:3001` ✅ (already allowed)
- Your `CLIENT_URL` from `.env` ✅

### 2. Verify CLIENT_URL in .env
Make sure your `.env` file has `CLIENT_URL` set to match your UI's origin:
```bash
CLIENT_URL=http://localhost:3000
# or
CLIENT_URL=http://localhost:3001
```

### 3. Start Your Backend with Logging
The backend already logs CORS decisions. When you start the server, you'll see logs like:
- `CORS: Allowing exact match: http://localhost:3000`
- `CORS: Allowing subdomain match: ...`
- `CORS blocked origin: ...` (if blocked)

## Testing Steps

### Step 1: Check Server Logs
When you make a request from your UI, watch your backend terminal. You should see:
```
CORS: Allowing exact match: http://localhost:3000
```
or
```
CORS blocked origin: http://localhost:3001. Allowed origins: ...
```

### Step 2: Check Browser Console
Open your browser's Developer Tools (F12) and check:
- **Console tab**: Look for CORS errors like:
  ```
  Access to fetch at 'http://localhost:5000/api/v1/...' from origin 'http://localhost:3000' 
  has been blocked by CORS policy
  ```
- **Network tab**: 
  - Check the request headers (look for `Origin: http://localhost:3000`)
  - Check the response headers (look for `Access-Control-Allow-Origin`)
  - For OPTIONS preflight requests, check if they return 200

### Step 3: Test Different Scenarios

#### Test 1: Simple GET Request
Make a GET request from your UI. Check:
- Server logs show "CORS: Allowing exact match"
- Browser Network tab shows `Access-Control-Allow-Origin` header in response

#### Test 2: Request with Credentials
Make a request with `credentials: 'include'` in your fetch/axios call. Check:
- Server logs show the request was allowed
- Response includes `Access-Control-Allow-Credentials: true`
- Cookies are sent/received properly

#### Test 3: POST/PUT/DELETE Request
Make a POST/PUT/DELETE request. Check:
- OPTIONS preflight request succeeds (200 status)
- Actual request succeeds
- Server logs show CORS was allowed

## Common Issues & Solutions

### Issue: "CORS blocked origin" in logs
**Solution**: Add your UI's origin to the `allowedOrigins` array in `src/setupServer.ts` (lines 76-83)

### Issue: Preflight (OPTIONS) fails
**Solution**: Check that `methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']` includes your method

### Issue: Credentials not working
**Solution**: 
- Ensure `credentials: true` is set in CORS config (line 138) ✅
- Ensure your UI sends requests with `credentials: 'include'` or `withCredentials: true`

### Issue: Origin mismatch
**Solution**: 
- Check your UI is running on the exact origin (including port)
- `http://localhost:3000` ≠ `http://localhost:3001`
- Make sure there's no trailing slash: `http://localhost:3000/` should be `http://localhost:3000`

## Quick Debug Commands

### Check what origin your UI is using:
In your browser console on your UI page, run:
```javascript
console.log('Current origin:', window.location.origin);
```

### Test a request manually:
In your browser console on your UI page, run:
```javascript
fetch('http://localhost:5000/api/v1/health', {
  credentials: 'include',
  headers: {
    'Content-Type': 'application/json'
  }
})
.then(r => r.json())
.then(console.log)
.catch(console.error);
```

Watch both:
1. Browser console for errors
2. Backend terminal for CORS logs

## Current Allowed Origins

Based on `src/setupServer.ts`, these origins are currently allowed:
- `config.CLIENT_URL` (from your .env)
- `http://localhost:3000`
- `http://localhost:3001`
- `https://dev.chatappserver.space`
- `https://api.dev.chatappserver.space`
- `https://chatappserver.space`

If your UI runs on a different port or URL, add it to the `allowedOrigins` array!
