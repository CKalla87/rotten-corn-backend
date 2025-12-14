# Merge Requirements to Prevent App Crashes

## Critical Fix Required

### ✅ **MUST MERGE: `src/setupDatabase.ts`**

This is the **ONLY code change** that needs to be committed and merged to prevent the app from crashing.

**What it fixes:**
- Prevents `MongoParseError: option buffermaxentries is not supported` error
- This error was causing the app to crash on startup
- Disables Mongoose command buffering for immediate error handling
- Strips deprecated `buffermaxentries` options from connection URL

**Git Status:**
```bash
M src/setupDatabase.ts  # Modified, needs to be committed
```

**To commit and merge:**
```bash
git add src/setupDatabase.ts
git commit -m "fix: resolve MongoDB buffermaxentries error causing app crashes

- Disable Mongoose command buffering for immediate error handling
- Strip deprecated buffermaxentries options from connection URL
- Prevents MongoParseError on application startup"
git push origin <your-branch>
```

---

## Environment Variables (Already Fixed)

### `.env.develop` - **NOT in Git** (gitignored)

The `.env.develop` file is gitignored and **does not need to be committed**. However:

✅ **Already updated in S3:** `s3://chattapplication1-env-files/develop/.env.develop`
- Contains correct `REDIS_HOST` endpoint
- All 18 environment variables are present
- Deployment process downloads from S3 automatically

**No action needed** - S3 already has the correct values, and the deployment scripts will use them.

---

## Summary

### What to Merge:
1. ✅ **`src/setupDatabase.ts`** - Critical MongoDB fix

### What NOT to Merge:
- ❌ `.env.develop` - Gitignored, already in S3
- ❌ Deployment helper scripts - Optional, not critical for app stability
- ❌ Test scripts - Optional, not needed in production

---

## After Merging

Once `src/setupDatabase.ts` is merged:

1. **Future deployments** will automatically include the fix
2. **App will not crash** on MongoDB connection
3. **No manual intervention** needed on instances

The fix is **permanent** once merged into your main branch.

---

## Verification

After merging, verify the fix is in place:
```bash
git log --oneline -1
git show HEAD:src/setupDatabase.ts | grep -A 5 "bufferCommands"
```

You should see:
- `mongoose.set('bufferCommands', false);`
- Connection URL cleaning logic

