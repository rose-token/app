# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Rose Token is a decentralized Web3 marketplace with a task-value-based token distribution model. Workers complete tasks, stakeholders validate work, and customers fund tasks with ROSE tokens.

**Tokenomics (95/5 split + 2% DAO minting):**
- Customer deposits ROSE tokens (escrowed)
- Stakeholder stakes 10% of task value (returned on completion)
- On completion: Worker gets 95%, Stakeholder gets 5% fee + stake back, Platform mints 2% to DAO treasury

## Development Commands

```bash
# Smart Contracts
npm run compile           # Compile contracts
npm test                  # Run all tests (4 test files, ~954 lines)
npx hardhat test test/RoseMarketplace.test.js  # Run specific test
npx hardhat node          # Start local node
npm run deploy:arbitrumSepolia  # Deploy to Arbitrum Sepolia testnet
npm run deploy:arbitrum   # Deploy to Arbitrum One mainnet
npm run update-abi        # Copy ABIs to frontend after contract changes

# Frontend (from frontend/ directory)
npm install               # Install dependencies
npm run dev               # Start Vite dev server
npm run build             # Production build
npm test                  # Run Vitest tests
```

## Contract Architecture

**3 core contracts + 3 mocks (in contracts/):**

| Contract | Lines | Purpose |
|----------|-------|---------|
| RoseToken.sol | 167 | ERC20 with authorized mint/burn (multiple authorized addresses) |
| RoseMarketplace.sol | 362 | Task lifecycle, escrow, payment distribution |
| RoseTreasury.sol | 589 | RWA-backed treasury (BTC/rETH/Gold/USDC via Chainlink + Uniswap) |
| mocks/MockERC20.sol | 38 | ERC20 test utility with public mint |
| mocks/MockV3Aggregator.sol | 50 | Chainlink price feed mock for testing |
| mocks/MockUniswapV3Router.sol | 70 | Uniswap V3 swap router mock for testing |

**Key architectural decisions:**
- RoseMarketplace accepts existing RoseToken address (not self-deployed)
- RoseToken uses authorization mapping (multiple contracts can mint/burn)
- RoseTreasury integrates Chainlink price feeds and Uniswap V3 for RWA diversification

**Deployment order:**
1. Deploy RoseToken with initial authorized address
2. Deploy RoseTreasury with RoseToken address
3. Deploy RoseMarketplace with RoseToken, Treasury, and passportSigner addresses
4. Authorize Treasury on RoseToken via `setAuthorized()`
5. Authorize Marketplace on RoseToken via `setAuthorized()`

**Passport Signature Verification:**
- Contract verifies ECDSA signatures from trusted passportSigner address
- Protected functions: `createTask("createTask")`, `stakeholderStake("stake")`, `claimTask("claim")`
- Replay protection: `usedSignatures` mapping marks each signature as consumed
- Custom errors: `InvalidSignature`, `SignatureExpired`, `SignatureAlreadyUsed`, `ZeroAddressSigner`
- Admin: `setPassportSigner(address)` - owner-only signer update

## Task Status Flow

```
StakeholderRequired → Open → InProgress → Completed → ApprovedPendingPayment → Closed
         ↓            ↓
         └────────────┴─→ cancelTask() → Closed (refunds)
```

**Role separation enforced:** Customer ≠ Stakeholder ≠ Worker on same task.

## Frontend Architecture

**Stack:** React 18 + Vite + Wagmi/RainbowKit + TailwindCSS

**Key directories:**
- `frontend/src/pages/` - 4 pages (TasksPage, VaultPage, ProfilePage, HelpPage)
- `frontend/src/components/marketplace/` - TaskCard, TaskList, TaskFilters, CreateTaskForm
- `frontend/src/components/vault/` - VaultStats, VaultAllocation, DepositCard, RedeemCard, TransactionHistory
- `frontend/src/components/wallet/` - TokenBalance, NetworkSelector
- `frontend/src/hooks/` - useNotifications, useProfile, useVaultData, usePassport, usePassportVerify
- `frontend/src/utils/ipfs/` - pinataService.js for IPFS integration
- `frontend/src/contracts/` - Auto-generated ABIs (via update-abi script)

**Styling:** Uses CSS variables in `index.css` with semantic Tailwind classes (`bg-primary`, `text-accent`, etc.). Never use hardcoded colors.

## Frontend Passport System

**Hooks:**
- `usePassport` - Direct Gitcoin API integration with 1-hour localStorage caching; provides `{ score, loading, error, refetch, meetsThreshold }`
- `usePassportVerify` - Backend signer communication; provides `{ getSignature, getScore, getSignerAddress }`

**Components:**
- `PassportGate` - Conditional rendering based on score threshold; wraps protected actions
- `PassportStatus` - Score display (compact header badge or full profile card); color-coded levels

**Integration Points:**
- Header: Compact PassportStatus badge
- CreateTaskForm: Wrapped in PassportGate (threshold: 20)
- ProfilePage: Full PassportStatus in "Sybil Resistance" section

**Thresholds:** CREATE_TASK=20, STAKE=20, CLAIM_TASK=20 (defined in `constants/passport.js`)

## Frontend Ceramic Profile System

**Purpose:** Decentralized user profiles with DID authentication using Ceramic/ComposeDB. Replaces IPFS-based profile storage with Ceramic streams for mutable, user-controlled data.

**Dependencies:**
- `@composedb/client` - ComposeDB GraphQL client
- `@didtools/pkh-ethereum` - Ethereum-based DID authentication
- `did-session` - Session management for DIDs

**Directory Structure:**
```
frontend/src/
├── constants/
│   └── skills.js                    # 15 predefined skills with categories
├── services/ceramic/
│   ├── client.js                    # ComposeDB client singleton
│   ├── session.js                   # DID session create/restore/save
│   ├── profileService.js            # Profile CRUD via GraphQL
│   └── profileCache.js              # In-memory + localStorage caching
├── hooks/
│   ├── useCeramicSession.js         # DID auth context provider
│   ├── useProfile.js                # Profile state (modified for Ceramic)
│   └── useReputation.js             # On-chain task stats from events
└── components/profile/
    ├── SkillBadge.jsx               # Skill pill with category color
    ├── SkillSelect.jsx              # Multi-select (max 10 skills)
    ├── ProfileBadge.jsx             # Avatar + name, opens modal on click
    ├── ProfileCard.jsx              # Full profile display
    ├── ProfileModal.jsx             # Create/edit form
    ├── ProfileViewModal.jsx         # Read-only profile viewer
    ├── ProfilePromptHandler.jsx     # Auto-prompt for new users
    ├── ReputationStats.jsx          # Task counts from on-chain
    └── index.js                     # Barrel exports
```

**Hooks:**
- `useCeramicSession` - Context provider for DID session; returns `{ session, isAuthenticated, authenticate, logout, hasProfile, showProfilePrompt, dismissProfilePrompt }`
- `useProfile` - Profile CRUD; returns `{ profile, isLoading, error, updateProfile, refreshProfile, getProfile }`
- `useReputation` - On-chain stats; returns `{ reputation: { tasksAsWorker, tasksAsStakeholder, tasksAsCustomer, totalEarned }, loading }`

**Services:**
- `client.js` - `getComposeClient()`, `setClientDID()`, `isCeramicAvailable()`
- `session.js` - `createSession()`, `restoreSession()`, `saveSession()`, `clearSession()`
- `profileService.js` - `createProfile()`, `updateProfile()`, `getProfileByAddress()`, `getOwnProfile()`, `upsertProfile()`
- `profileCache.js` - TTL-based caching (30min own profile, 5min others)

**Components:**
- `ProfileBadge` - Props: `{ address, size, showName, linkToProfile, onClick }`. Displays avatar + name, fetches profile from cache
- `ProfileModal` - Props: `{ isOpen, onClose, mode }`. Create/edit form with IPFS avatar upload via Pinata
- `ProfileViewModal` - Props: `{ isOpen, onClose, address }`. Read-only display with edit button for own profile
- `ProfilePromptHandler` - Auto-renders ProfileModal for new users on wallet connect

**Integration Points:**
- `App.jsx` - `CeramicSessionProvider` wraps `ProfileProvider`, `ProfilePromptHandler` at root
- `Header.jsx` - ProfileBadge shows connected user's avatar, links to /profile
- `TaskCard.jsx` - Customer/worker/stakeholder addresses use ProfileBadge
- `ProfilePage.jsx` - Uses ProfileCard + ProfileModal for profile management

**DID Format:** `did:pkh:eip155:1:{walletAddress}` (Ethereum mainnet PKH)

**Caching Strategy:**
- DID sessions: localStorage with 24h TTL (`rose_ceramic_session_{address}`)
- Own profile: localStorage with 30min TTL (`rose_profile_{address}`)
- Other profiles: In-memory Map with 5min TTL
- Prompt dismissal: localStorage (`rose_profile_prompt_dismissed`)

**Profile Schema:**
```javascript
{
  displayName: string,    // Required, max 100 chars
  bio: string,            // Optional, max 500 chars
  avatarUrl: string,      // IPFS URI (ipfs://Qm...)
  skills: string[],       // Skill IDs, max 10
  website: string,
  twitter: string,
  github: string,
  walletAddress: string,  // Lowercase, set on creation
  joinedAt: DateTime,     // Set on creation
  lastActiveAt: DateTime  // Updated on save
}
```

**Skills (15 predefined in constants/skills.js):**
- Blockchain: Solidity, Rust, Smart Contracts, Security Auditing
- Frontend: TypeScript, React, Frontend Development
- Backend: Node.js, Python, Backend Development, Data Engineering
- Other: UI/UX Design, DevOps, Testing/QA, Documentation

## Testing

```bash
# 4 test suites covering:
test/RoseMarketplace.test.js    # 557 lines - Task lifecycle, payments, escrow
test/RoseToken.test.js          # 130 lines - Minting, transfers, authorization
test/TaskLifecycleEdgeCases.test.js  # 167 lines - Edge cases, error conditions
test/DetailedDescription.test.js     # 100 lines - IPFS integration
```

## Test Infrastructure

Tests use mock contracts to simulate external dependencies:

- **MockV3Aggregator**: Simulates Chainlink price feeds (BTC/USD, ETH/USD, XAU/USD)
- **MockUniswapV3Router**: Simulates Uniswap V3 swaps with configurable exchange rates
- **MockERC20**: Standard ERC20 with public mint for USDC, WBTC, rETH, PAXG

**Token acquisition in tests:** Tests obtain ROSE tokens via Treasury deposit flow (not direct minting):
1. Mint USDC to user
2. Approve Treasury to spend USDC
3. Call `roseTreasury.deposit(usdcAmount)`
4. Treasury diversifies into RWA and mints equivalent ROSE

## Backend Passport Signer

**Purpose:** Express API that verifies Gitcoin Passport scores and signs ECDSA approvals for marketplace actions.

**Directory:** `backend/signer/`

**API Endpoints:**
- `POST /api/passport/verify` - Verify passport score & get signature (`{address, action}` → `{expiry, signature}`)
- `GET /api/passport/score/:address` - Get current passport score
- `GET /api/passport/signer` - Get signer wallet address
- `GET /api/passport/thresholds` - Get action thresholds

**Signature Format:** `keccak256(abi.encodePacked(address, action, expiry))` signed with Ethereum message prefix

**Security:** CORS whitelist, rate limiting (30/min), Helmet headers, address validation

**Key Files:**
- `src/routes/passport.ts` - API endpoint handlers
- `src/services/signer.ts` - ECDSA signing with ethers.js
- `src/services/gitcoin.ts` - Gitcoin Passport API integration
- `src/config.ts` - Environment configuration

**Local Development:**
```bash
cd backend/signer
npm install && cp .env.example .env
npm run dev  # tsx watch mode
```

**Docker:** `docker-compose up --build` (port 3000)

## Backend Ceramic Node

**Purpose:** Decentralized data storage layer for off-chain user profiles, reputation tracking, and task history using Ceramic Network + ComposeDB.

**Directory:** `backend/ceramic/`

**Architecture:**
- **ceramic-one** (v0.56.0): Rust IPFS/P2P daemon for block storage and networking
- **js-ceramic**: JavaScript HTTP API (port 7007) with ComposeDB indexing
- **PostgreSQL 15**: Local database for fast GraphQL queries
- **Supervisord**: Process orchestration (startup order: PostgreSQL → ceramic-one → js-ceramic)

**Directory Structure:**
```
backend/ceramic/
├── Dockerfile              # Multi-stage build (ceramic-one + js-ceramic + PostgreSQL)
├── docker-compose.yml      # Local development stack
├── daemon.config.json      # Ceramic node configuration
├── deploy.yaml             # Akash Network deployment manifest
├── supervisord.conf        # Process manager config
├── schemas/                # ComposeDB GraphQL models
│   ├── profile.graphql     # User profile (displayName, bio, skills, wallet)
│   ├── reputation.graphql  # Aggregated metrics (tasks completed, ratings, earnings)
│   └── task-record.graphql # Task participation history
└── scripts/
    ├── entrypoint.sh       # Container initialization
    └── init-postgres.sh    # Database setup
```

**Data Schemas:**
- **Profile**: displayName, bio, avatarUrl, skills[], website, twitter, github, walletAddress, joinedAt
- **Reputation**: tasksCompletedAsWorker/Stakeholder/Customer, averageRating, totalEarned, passportScore
- **TaskRecord**: taskId, taskTitle, role, completedAt, amountEarned, ratingReceived, txHash, chainId

**API Endpoints (port 7007):**
- `POST /api/v0/ceramic/documents` - Create/update documents
- `GET /api/v0/ceramic/documents/{docId}` - Fetch document
- `GET /api/v0/node/healthcheck` - Health status
- ComposeDB GraphQL endpoint for indexed queries

**Local Development:**
```bash
cd backend/ceramic
npm run dev  # docker-compose up --build
# API available at http://localhost:7007
```

**Docker:** `docker-compose up --build` (ports 7007, 5101)

**Integration Status:** Infrastructure deployed, frontend integration planned for reputation display.

## CI/CD Workflows

**pr-build.yml:** Runs on PRs (parallel jobs)
- `build-contracts`: npm ci → hardhat test → hardhat compile → update-abi
- `build-frontend`: npm install → update-abi → vite build

**combined-deploy.yml:** Runs on main push
- Deploys contracts to Arbitrum Sepolia, verifies on Arbiscan, deploys frontend to GitHub Pages

**deploy-signer.yml:** Runs on main push (when backend/signer changes)
- Builds Docker image and pushes to GHCR
- Optionally deploys to Akash Network

**deploy-ceramic.yml:** Runs on main push (when backend/ceramic changes)
- Builds Docker image and pushes to GHCR
- Deploys to Akash Network (4 CPU, 8GB RAM, 20GB storage)

**pr-build-ceramic.yml:** Runs on PRs (backend/ceramic changes)
- Docker build + container startup test (18 retries, 10s intervals)

## Environment Variables

**Root .env (contracts):**
```bash
ARBITRUM_SEPOLIA_RPC_URL=https://sepolia-rollup.arbitrum.io/rpc
ARBITRUM_RPC_URL=https://arb1.arbitrum.io/rpc
PRIVATE_KEY=your_wallet_private_key
DAO_TREASURY_ADDRESS=0x...
ARBISCAN_API_KEY=...
PASSPORT_SIGNER_ADDRESS=0x...  # Address of passport signer wallet
```

**frontend/.env:**
```bash
VITE_MARKETPLACE_ADDRESS=0x...
VITE_TOKEN_ADDRESS=0x...
VITE_TREASURY_ADDRESS=0x...
VITE_PINATA_API_KEY=...
VITE_PINATA_SECRET_API_KEY=...
VITE_PINATA_JWT=...
VITE_PASSPORT_SIGNER_URL=https://...  # Backend signer API URL
VITE_CERAMIC_URL=https://ceramic.rose-token.com  # Ceramic node endpoint
```

**backend/signer/.env:**
```bash
PORT=3001
SIGNER_PRIVATE_KEY=0x...           # Private key for signing
VITE_GITCOIN_API_KEY=...           # Gitcoin Passport API key
VITE_GITCOIN_SCORER_ID=...         # Gitcoin Scorer ID
ALLOWED_ORIGINS=http://localhost:5173,https://yourapp.com
THRESHOLD_CREATE_TASK=20           # Min score for createTask
THRESHOLD_STAKE=20                 # Min score for stake
THRESHOLD_CLAIM=20                 # Min score for claim
SIGNATURE_TTL=3600                 # Signature validity (seconds)
RATE_LIMIT_WINDOW_MS=60000         # Rate limit window (ms)
RATE_LIMIT_MAX_REQUESTS=30         # Max requests per window
```

**backend/ceramic/.env:**
```bash
CERAMIC_NETWORK=mainnet                # Ceramic network (mainnet/testnet)
CERAMIC_ADMIN_DID=did:key:...          # Admin DID for API access
CERAMIC_ADMIN_PRIVATE_KEY=0x...        # Private key for signing
CORS_ALLOWED_ORIGINS=https://emmadorably.github.io,http://localhost:5173
```

## Key Technical Details

- **Solidity version:** 0.8.20 (contracts use OpenZeppelin v5)
- **Chainlink contracts:** v1.5.0 (import path: `@chainlink/contracts/src/v0.8/shared/interfaces/`)
- **Optimizer:** enabled with 1 run + viaIR
- **Networks:** Arbitrum Sepolia testnet (chainId: 421614), Arbitrum One mainnet (chainId: 42161)
- **Frontend bundler:** Vite 7.x (not webpack/CRA)
- **Web3 stack:** wagmi + viem + RainbowKit (not ethers.js in frontend)

## Git Workflow

Always create feature branches, create PRs, and monitor CI before merging. Never push directly to main.

```bash
git checkout -b feature/description
git push -u origin feature/description
gh pr create --title "feat: ..." --body "..."
gh pr checks --watch  # Monitor CI
```

## Bug Fixes Applied

**RoseTreasury.circulatingSupply() initial state bug (fixed):**
- Issue: When total supply is 0, function returned 1 instead of 0
- Impact: Caused `rosePrice()` to return 0 instead of initial $1 price
- Fix: Added `if (total == 0) return 0;` check at start of function

**ceramic-one "No such file or directory" crash (fixed):**
- Issue: ceramic-one v0.56.0 crashed with `Error running command: No such file or directory (os error 2)` after starting
- Root causes:
  1. Missing `/root/.ceramic-one` directory that ceramic-one expects for internal state
  2. Environment variable `CERAMIC_ONE_ETHEREUM_RPC_URLS` not passed through supervisord (it doesn't inherit shell exports)
- Fix:
  1. Added `/root/.ceramic-one` to mkdir in `entrypoint.sh` and `Dockerfile`
  2. Added `environment=CERAMIC_ONE_ETHEREUM_RPC_URLS="%(ENV_ETHEREUM_RPC_URL)s"` to `supervisord.conf`
- Key insight: Supervisord requires explicit `environment=` directives with `%(ENV_VAR)s` syntax to pass container env vars to managed processes
