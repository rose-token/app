# Testing & CI/CD

**Parent**: [CLAUDE.md](../CLAUDE.md) | **Details**: See `details/testing/` for comprehensive test and env docs

## Test Suites

```bash
# Run all tests
npm test

# Run specific test
npx hardhat test test/RoseMarketplace.test.js
```

| File | Lines | Coverage |
|------|-------|----------|
| `test/RoseMarketplace.test.js` | 557 | Task lifecycle, payments, escrow |
| `test/RoseToken.test.js` | 130 | Minting, transfers, authorization |
| `test/TaskLifecycleEdgeCases.test.js` | 167 | Edge cases, error conditions |
| `test/DetailedDescription.test.js` | 100 | IPFS integration |

## Mock Contracts

Tests use mock contracts to simulate external dependencies:

| Mock | Purpose |
|------|---------|
| `MockV3Aggregator` | Chainlink price feeds (BTC/USD, ETH/USD, XAU/USD) |
| `MockUniswapV3Router` | Uniswap V3 swaps with configurable rates |
| `MockERC20` | Standard ERC20 with public mint for USDC, WBTC, rETH, PAXG |

## Token Acquisition in Tests

Tests obtain ROSE via Treasury deposit flow (not direct minting):

```javascript
// 1. Mint USDC to user
await usdc.mint(user.address, usdcAmount);

// 2. Approve Treasury
await usdc.connect(user).approve(treasury.address, usdcAmount);

// 3. Deposit (Treasury diversifies and mints ROSE)
await treasury.connect(user).deposit(usdcAmount);
```

## CI/CD Workflows

### pr-build.yml (Pull Requests)

Parallel jobs:
- **build-contracts**: npm ci → hardhat test → hardhat compile → update-abi
- **build-frontend**: npm install → update-abi → vite build

### combined-deploy.yml (Main Push)

- Deploys contracts to Arbitrum Sepolia
- Verifies on Arbiscan
- Deploys frontend to GitHub Pages

### deploy-signer.yml (Backend Changes)

Triggers when `backend/signer/` changes:
- Builds Docker image
- Pushes to GHCR
- Optionally deploys to Akash Network

## Environment Variables

### Root .env (Contracts)

```bash
ARBITRUM_SEPOLIA_RPC_URL=https://sepolia-rollup.arbitrum.io/rpc
ARBITRUM_RPC_URL=https://arb1.arbitrum.io/rpc
PRIVATE_KEY=your_wallet_private_key
DAO_TREASURY_ADDRESS=0x...
ARBISCAN_API_KEY=...
PASSPORT_SIGNER_ADDRESS=0x...
```

### frontend/.env

```bash
VITE_MARKETPLACE_ADDRESS=0x...
VITE_TOKEN_ADDRESS=0x...
VITE_TREASURY_ADDRESS=0x...
VITE_GOVERNANCE_ADDRESS=0x...
VITE_VROSE_ADDRESS=0x...
VITE_PINATA_API_KEY=...
VITE_PINATA_SECRET_API_KEY=...
VITE_PINATA_JWT=...
VITE_PASSPORT_SIGNER_URL=https://...
```

### backend/signer/.env

```bash
# Server
PORT=3001
ALLOWED_ORIGINS=http://localhost:5173,https://yourapp.com

# Signing
SIGNER_PRIVATE_KEY=0x...

# Gitcoin Passport
VITE_GITCOIN_API_KEY=...
VITE_GITCOIN_SCORER_ID=...

# Score Thresholds
THRESHOLD_CREATE_TASK=20
THRESHOLD_STAKE=20
THRESHOLD_CLAIM=20
THRESHOLD_VOTE=20
THRESHOLD_PROPOSE=25
SIGNATURE_TTL=3600

# Rate Limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=30

# Blockchain
GOVERNANCE_ADDRESS=0x...
TREASURY_ADDRESS=0x...
RPC_URL=...

# PostgreSQL
DATABASE_URL=postgresql://user:pass@host:port/database
DB_POOL_MAX=10
DB_POOL_MIN=2
DB_CONNECTION_TIMEOUT_MS=15000
DB_MAX_RETRIES=15
DB_RETRY_INITIAL_DELAY_MS=2000
DB_RETRY_MAX_DELAY_MS=60000

# Profile EIP-712
PROFILE_CHAIN_IDS=42161,421614
PROFILE_TIMESTAMP_TTL=300
```

## Token Decimals Reference

| Token | Decimals | Notes |
|-------|----------|-------|
| ROSE | 18 | Native token |
| vROSE | 18 | Governance receipt token |
| USDC | 6 | Standard stablecoin |
| WBTC | 8 | Wrapped Bitcoin |
| PAXG | 18 | Gold-backed token |
| Chainlink feeds | 8 | Price feed decimals |
| NAV prices | 6 | Normalized to USDC |

**Formatting helpers**:
- `formatUnits(value, 18)` for ROSE/vROSE
- `formatUnits(value, 6)` for USDC/prices
- Treasury normalizes all values to 6 decimals for USD calculations

## Frontend Tests

```bash
cd frontend
npm test  # Run Vitest tests
```

## Backend Tests

```bash
cd backend/signer
npm test  # Run tests (if configured)
```

## Local Development

### Contracts
```bash
npx hardhat node          # Start local node
npm run deploy:local      # Deploy locally (if script exists)
```

### Frontend
```bash
cd frontend
npm install
npm run dev               # Vite dev server (port 5173)
```

### Backend
```bash
cd backend/signer
npm install
cp .env.example .env      # Configure environment
npm run dev               # tsx watch mode (port 3001)
```

### Full Stack (Docker)
```bash
cd backend/signer
docker-compose up --build  # PostgreSQL + Signer on port 3000
```

## Deep Dive Documentation

For comprehensive details, see:

| Topic | Detail Document |
|-------|-----------------|
| Test Suites, Mocks, Fixtures, Patterns | [details/testing/test-suites.md](details/testing/test-suites.md) |
| All Environment Variables (root, frontend, backend) | [details/testing/environment.md](details/testing/environment.md) |
