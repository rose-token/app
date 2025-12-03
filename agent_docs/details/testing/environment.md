# Environment Variables - Detailed Documentation

**Parent**: [testing.md](../../testing.md)

---

## Root .env (Contracts)

Located at project root. Used by Hardhat for deployment and testing.

```bash
# Network RPC URLs
ARBITRUM_SEPOLIA_RPC_URL=https://sepolia-rollup.arbitrum.io/rpc
ARBITRUM_RPC_URL=https://arb1.arbitrum.io/rpc

# Deployment wallet (holds ETH for gas)
PRIVATE_KEY=0x...

# DAO Treasury address (receives minted tokens)
DAO_TREASURY_ADDRESS=0x...

# Arbiscan API key for contract verification
ARBISCAN_API_KEY=...

# Passport signer wallet address (used in contract constructor)
PASSPORT_SIGNER_ADDRESS=0x...
```

---

## frontend/.env

Used by Vite for frontend build.

### Contract Addresses

```bash
# Core contracts (deployed addresses)
VITE_MARKETPLACE_ADDRESS=0x...
VITE_TOKEN_ADDRESS=0x...
VITE_TREASURY_ADDRESS=0x...
VITE_GOVERNANCE_ADDRESS=0x...
VITE_VROSE_ADDRESS=0x...
VITE_USDC_ADDRESS=0x...
```

### Pinata (IPFS)

```bash
# Pinata API for IPFS uploads (task descriptions)
VITE_PINATA_API_KEY=...
VITE_PINATA_SECRET_API_KEY=...
VITE_PINATA_JWT=...
```

### Backend URL

```bash
# Passport signer backend URL
VITE_PASSPORT_SIGNER_URL=https://signer.rose-token.com
# Local development: http://localhost:3001
```

### Gitcoin Passport (optional direct API access)

```bash
VITE_GITCOIN_API_KEY=...
VITE_GITCOIN_SCORER_ID=...
```

---

## backend/signer/.env

Express backend configuration.

### Server

```bash
# Server port
PORT=3001

# CORS allowed origins (comma-separated)
ALLOWED_ORIGINS=http://localhost:5173,https://app.rose-token.com
```

### Signing

```bash
# Private key for signing approvals
# CRITICAL: Keep secure, used for all signatures
SIGNER_PRIVATE_KEY=0x...
```

### Gitcoin Passport

```bash
# Gitcoin Passport API credentials
VITE_GITCOIN_API_KEY=...
VITE_GITCOIN_SCORER_ID=...
```

### Score Thresholds

```bash
# Minimum passport score for each action
THRESHOLD_CREATE_TASK=20
THRESHOLD_STAKE=20
THRESHOLD_CLAIM=20
THRESHOLD_VOTE=20
THRESHOLD_PROPOSE=25

# Signature validity period (seconds)
SIGNATURE_TTL=3600
```

### Rate Limiting

```bash
# Rate limit window (milliseconds)
RATE_LIMIT_WINDOW_MS=60000

# Max requests per window per IP
RATE_LIMIT_MAX_REQUESTS=30
```

### Blockchain

```bash
# Contract addresses (must match frontend)
GOVERNANCE_ADDRESS=0x...
TREASURY_ADDRESS=0x...

# RPC endpoint for contract reads
RPC_URL=https://sepolia-rollup.arbitrum.io/rpc
```

### PostgreSQL Database

```bash
# Full connection URL
DATABASE_URL=postgresql://user:password@host:port/database

# Connection pool settings
DB_POOL_MAX=10
DB_POOL_MIN=2
DB_CONNECTION_TIMEOUT_MS=15000

# Retry settings (for startup)
DB_MAX_RETRIES=15
DB_RETRY_INITIAL_DELAY_MS=2000
DB_RETRY_MAX_DELAY_MS=60000
```

### Profile EIP-712

```bash
# Allowed chain IDs for signature verification (comma-separated)
PROFILE_CHAIN_IDS=42161,421614

# Profile signature TTL (seconds)
PROFILE_TIMESTAMP_TTL=300
```

---

## GitHub Secrets (CI/CD)

Used in GitHub Actions workflows.

### Deployment

```
PRIVATE_KEY          # Deployer wallet private key
ARBISCAN_API_KEY     # Contract verification
```

### Docker/GHCR

```
GITHUB_TOKEN         # Auto-provided by GitHub Actions
```

### Akash (optional)

```
AKASH_MNEMONIC       # Akash deployment key
```

---

## Docker Compose Environment

`backend/signer/docker-compose.yml` environment:

### PostgreSQL Service

```yaml
environment:
  POSTGRES_USER: rose
  POSTGRES_PASSWORD: ${DB_PASSWORD:-rosedev}
  POSTGRES_DB: rosetoken
```

### Signer Service

```yaml
environment:
  - DATABASE_URL=postgresql://rose:${DB_PASSWORD:-rosedev}@postgres:5432/rosetoken
  - SIGNER_PRIVATE_KEY=${SIGNER_PRIVATE_KEY}
  - VITE_GITCOIN_API_KEY=${VITE_GITCOIN_API_KEY}
  - VITE_GITCOIN_SCORER_ID=${VITE_GITCOIN_SCORER_ID}
  # ... other vars from .env
```

---

## Environment Variable Validation

Backend validates required vars on startup:

```typescript
// config.ts
const required = [
  'SIGNER_PRIVATE_KEY',
  'RPC_URL',
  'GOVERNANCE_ADDRESS',
];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}
```

---

## Development vs Production

### Local Development

```bash
# frontend/.env.local (not committed)
VITE_PASSPORT_SIGNER_URL=http://localhost:3001

# backend/signer/.env (not committed)
ALLOWED_ORIGINS=http://localhost:5173
RPC_URL=https://sepolia-rollup.arbitrum.io/rpc
```

### Production

```bash
# Set via hosting platform (Vercel, etc.)
VITE_PASSPORT_SIGNER_URL=https://signer.rose-token.com

# Set via container orchestration (Akash, etc.)
ALLOWED_ORIGINS=https://app.rose-token.com
RPC_URL=https://arb1.arbitrum.io/rpc
```

---

## Security Notes

1. **Never commit .env files** - Use .env.example templates
2. **Rotate SIGNER_PRIVATE_KEY** if compromised
3. **Use strong DB_PASSWORD** in production
4. **Restrict ALLOWED_ORIGINS** to production domains only
5. **API keys** should have minimal required permissions
