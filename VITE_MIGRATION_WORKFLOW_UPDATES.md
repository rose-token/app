# CI/CD Workflow Updates Required for Vite Migration

The Vite migration is complete, but the GitHub workflow files need manual updates due to GitHub App permission restrictions.

## Files That Need Manual Updates

### 1. `.github/workflows/pr-build.yml`

**Location:** Lines 55-64

**Change required:**
```yaml
# BEFORE (lines 55-64):
      - name: Build
        run: cd frontend && npm run build
        env:
          # Using placeholder values for build-only environment
          REACT_APP_MARKETPLACE_ADDRESS: "0x0000000000000000000000000000000000000000"
          REACT_APP_TOKEN_ADDRESS: "0x0000000000000000000000000000000000000000"
          # Using real Pinata API keys from GitHub secrets
          REACT_APP_PINATA_API_KEY: ${{ secrets.REACT_APP_PINATA_API_KEY }}
          REACT_APP_PINATA_SECRET_API_KEY: ${{ secrets.REACT_APP_PINATA_SECRET_API_KEY }}
          REACT_APP_PINATA_JWT: ${{ secrets.REACT_APP_PINATA_JWT }}

# AFTER:
      - name: Build
        run: cd frontend && npm run build
        env:
          # Using placeholder values for build-only environment
          VITE_MARKETPLACE_ADDRESS: "0x0000000000000000000000000000000000000000"
          VITE_TOKEN_ADDRESS: "0x0000000000000000000000000000000000000000"
          # Using real Pinata API keys from GitHub secrets
          VITE_PINATA_API_KEY: ${{ secrets.REACT_APP_PINATA_API_KEY }}
          VITE_PINATA_SECRET_API_KEY: ${{ secrets.REACT_APP_PINATA_SECRET_API_KEY }}
          VITE_PINATA_JWT: ${{ secrets.REACT_APP_PINATA_JWT }}
```

**Summary:** Replace all `REACT_APP_*` with `VITE_*` prefix.

---

### 2. `.github/workflows/combined-deploy.yml`

**Location 1:** Line 158

**Change required:**
```yaml
# BEFORE (line 158):
      - name: Install dependencies
        run: cd frontend && npm install --legacy-peer-deps --force

# AFTER:
      - name: Install dependencies
        run: cd frontend && npm install
```

**Summary:** Remove `--legacy-peer-deps --force` flags (no longer needed with Vite).

---

**Location 2:** Lines 208-222

**Change required:**
```yaml
# BEFORE (lines 208-222):
      - name: Build
        run: cd frontend && npm run build
        env:
          REACT_APP_MARKETPLACE_ADDRESS: ${{ env.MARKETPLACE_ADDRESS }}
          REACT_APP_TOKEN_ADDRESS: ${{ env.TOKEN_ADDRESS }}
          REACT_APP_REPUTATION_ADDRESS: ${{ env.REPUTATION_ADDRESS }}
          REACT_APP_GOVERNANCE_ADDRESS: ${{ env.GOVERNANCE_ADDRESS }}
          REACT_APP_DAO_TREASURY_ADDRESS: ${{ env.DAO_TREASURY_ADDRESS }}
          REACT_APP_TOKEN_STAKING_ADDRESS: ${{ env.TOKEN_STAKING_ADDRESS }}
          REACT_APP_STAKEHOLDER_REGISTRY_ADDRESS: ${{ env.STAKEHOLDER_REGISTRY_ADDRESS }}
          REACT_APP_BID_EVALUATION_MANAGER_ADDRESS: ${{ env.BID_EVALUATION_MANAGER_ADDRESS }}
          REACT_APP_BUILD_VERSION: ${{ env.BUILD_VERSION }}
          REACT_APP_PINATA_API_KEY: ${{ secrets.REACT_APP_PINATA_API_KEY }}
          REACT_APP_PINATA_SECRET_API_KEY: ${{ secrets.REACT_APP_PINATA_SECRET_API_KEY }}
          REACT_APP_PINATA_JWT: ${{ secrets.REACT_APP_PINATA_JWT }}

# AFTER:
      - name: Build
        run: cd frontend && npm run build
        env:
          VITE_MARKETPLACE_ADDRESS: ${{ env.MARKETPLACE_ADDRESS }}
          VITE_TOKEN_ADDRESS: ${{ env.TOKEN_ADDRESS }}
          VITE_REPUTATION_ADDRESS: ${{ env.REPUTATION_ADDRESS }}
          VITE_GOVERNANCE_ADDRESS: ${{ env.GOVERNANCE_ADDRESS }}
          VITE_DAO_TREASURY_ADDRESS: ${{ env.DAO_TREASURY_ADDRESS }}
          VITE_TOKEN_STAKING_ADDRESS: ${{ env.TOKEN_STAKING_ADDRESS }}
          VITE_STAKEHOLDER_REGISTRY_ADDRESS: ${{ env.STAKEHOLDER_REGISTRY_ADDRESS }}
          VITE_BID_EVALUATION_MANAGER_ADDRESS: ${{ env.BID_EVALUATION_MANAGER_ADDRESS }}
          VITE_BUILD_VERSION: ${{ env.BUILD_VERSION }}
          VITE_PINATA_API_KEY: ${{ secrets.REACT_APP_PINATA_API_KEY }}
          VITE_PINATA_SECRET_API_KEY: ${{ secrets.REACT_APP_PINATA_SECRET_API_KEY }}
          VITE_PINATA_JWT: ${{ secrets.REACT_APP_PINATA_JWT }}
```

**Summary:** Replace all `REACT_APP_*` with `VITE_*` prefix.

---

## How to Apply These Changes

You have two options:

### Option 1: Manual Edit via GitHub UI
1. Go to https://github.com/emmadorably/rose-token
2. Navigate to `.github/workflows/pr-build.yml`
3. Click "Edit this file" (pencil icon)
4. Make the changes listed above
5. Commit directly to the branch
6. Repeat for `.github/workflows/combined-deploy.yml`

### Option 2: Grant Workflows Permission to GitHub App
1. Go to GitHub repository settings
2. Navigate to "Actions" → "General"
3. Under "Workflow permissions", ensure the GitHub App has workflow write permissions
4. Apply the changes via a new commit

---

## Why These Changes Are Needed

Vite uses `import.meta.env.VITE_*` instead of `process.env.REACT_APP_*` for environment variables. This is a breaking change from Create React App's convention.

All environment variables in the codebase have already been updated. Only the CI/CD workflow files remain.

---

## Verification After Updates

After applying these changes, the CI/CD pipeline should:
- ✅ Build successfully with Vite
- ✅ Recognize all environment variables properly
- ✅ Deploy to GitHub Pages without errors
- ✅ Have faster build times (~40s vs ~60s with CRA)

---

**Migration Status:** 95% Complete
**Remaining:** Workflow file updates (blocked by GitHub App permissions)
**Workaround:** Manual edit via GitHub UI
