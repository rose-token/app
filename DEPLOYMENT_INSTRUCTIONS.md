# Deployment Instructions - Wallet Connection Fixes

## Issues Fixed in This Branch

### 1. ✅ Content Security Policy (CSP) Blocking WebSocket Connections
**Problem**: The CSP in `frontend/public/index.html` only allowed `https:` connections, blocking the `wss:` (WebSocket Secure) connections required by wallets.

**Fix**: Updated CSP to include `wss:` and `data:` protocols:
```html
connect-src 'self' https: wss: data:
```

### 2. ✅ MetaMask SDK Conflict (Already Fixed in Previous Branch)
**Problem**: Old `@metamask/sdk-react` package conflicted with RainbowKit's built-in MetaMask support.

**Fix**:
- Removed `@metamask/sdk-react` from `package.json`
- Deleted `frontend/src/hooks/useEthereum.js`
- Migrated `NetworkSelector.jsx` to use wagmi hooks

## How to Deploy These Fixes

### Step 1: Merge Both Fix Branches

You need to merge **both** of these branches:
1. `claude/fix-bug-01Vve2gkTPG6VU5N5bADqBcC` (MetaMask SDK removal)
2. `claude/fix-wallet-csp-01Vve2gkTPG6VU5N5bADqBcC` (CSP fixes) ← **Current branch**

### Step 2: Rebuild the Frontend

After merging, rebuild the frontend:

```bash
cd frontend
npm install  # Install updated dependencies
npm run build  # Build production version
```

### Step 3: Deploy the New Build

Deploy the contents of `frontend/build/` to your hosting service:

**For GitHub Pages:**
```bash
# The CI/CD workflow should handle this automatically
# Or manually copy build/ contents to gh-pages branch
```

**For other hosting (Netlify, Vercel, etc.):**
- Upload the `frontend/build/` directory
- Or trigger a redeploy from your hosting dashboard

### Step 4: Verify Deployment

After deployment, check:

1. **No MetaMask SDK Error**:
   - Open browser console
   - Should NOT see: `TypeError: (0 , m.default) is not a function`

2. **No CSP Violations**:
   - Open browser console
   - Should NOT see: `violates the following Content Security Policy directive`

3. **Wallets Connect**:
   - Try connecting with MetaMask ✓
   - Try connecting with WalletConnect ✓
   - Try connecting with Rainbow ✓
   - Try connecting with Base wallet ✓

## WalletConnect Allowlist (Still Required)

Even after deploying these fixes, you MUST configure WalletConnect allowlist:

1. Go to https://cloud.reown.com/
2. Find project ID: `95be0fbf27f06934c74d670d57f44939`
3. Add `demo.rose-token.com` to allowed domains
4. Add `localhost` for local development
5. Save changes

See `WALLETCONNECT_FIX.md` for detailed instructions.

## Summary of Changes

| File | Change |
|------|--------|
| `frontend/public/index.html` | Added `wss:` and `data:` to CSP `connect-src` directive |
| `frontend/package.json` | Removed `@metamask/sdk-react` dependency |
| `frontend/src/hooks/useEthereum.js` | **DELETED** (561 lines) |
| `frontend/src/components/wallet/NetworkSelector.jsx` | Migrated to wagmi hooks |

## Expected Behavior After Deployment

- ✅ All wallets (MetaMask, WalletConnect, Rainbow, Base) should connect
- ✅ No console errors about MetaMask SDK
- ✅ No CSP violations for WebSocket connections
- ⚠️ WalletConnect still needs allowlist configuration (manual step)

## Troubleshooting

**If wallets still don't work after deployment:**

1. **Hard refresh the browser**: `Ctrl+Shift+R` (Windows/Linux) or `Cmd+Shift+R` (Mac)
2. **Clear browser cache**: Ensure you're loading the new build
3. **Check browser console**: Look for any remaining errors
4. **Verify CSP**: View page source and confirm `wss:` is in the CSP
5. **Check WalletConnect allowlist**: Ensure domain is added at cloud.reown.com

**If you see old build hash (e.g., `6336.cf1ab31b.fca4c60c.chunk.js`):**
- The new build hash should be different (e.g., `6336.7ab592f0.cbc5edc7.chunk.js`)
- Clear cache and hard refresh
- Verify deployment actually updated the files
