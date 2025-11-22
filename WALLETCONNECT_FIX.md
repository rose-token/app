# WalletConnect Allowlist Configuration

## Issue
The console shows this error:
```
Origin https://demo.rose-token.com not found on Allowlist - update configuration on cloud.reown.com
```

This is because your WalletConnect Project ID (`95be0fbf27f06934c74d670d57f44939`) needs to have `demo.rose-token.com` added to its allowlist.

## Steps to Fix

1. **Go to Reown Cloud (formerly WalletConnect Cloud)**:
   - Visit: https://cloud.reown.com/

2. **Sign in** with your WalletConnect account

3. **Find your project**:
   - Look for the project with ID: `95be0fbf27f06934c74d670d57f44939`
   - Or find the project named "Rose Token" (or similar)

4. **Add domain to allowlist**:
   - Navigate to project settings
   - Find the "Allowed Domains" or "Domain Allowlist" section
   - Add: `demo.rose-token.com`
   - Also add: `localhost` (for local development)
   - Save changes

5. **Clear browser cache** and refresh the app

## Alternative: Create New Project ID (if you don't have access)

If you don't have access to the existing project, create a new one:

1. Go to https://cloud.reown.com/
2. Create a new project
3. Copy the new Project ID
4. Update `/frontend/src/wagmi.config.js`:
   ```javascript
   export const config = getDefaultConfig({
     appName: 'Rose Token',
     projectId: 'YOUR_NEW_PROJECT_ID_HERE', // Replace this
     chains: [sepolia],
     ssr: false,
   });
   ```
5. Add your domains to the allowlist in the project settings:
   - `demo.rose-token.com`
   - `localhost`

## Why This Happens

WalletConnect requires domain allowlisting for security. This prevents unauthorized websites from using your Project ID to connect wallets.

## After Fixing

Once the domain is allowlisted:
- The "Origin not found on Allowlist" error will disappear
- The 403 error for WalletConnect analytics will be resolved
- WalletConnect-based wallets will work correctly
