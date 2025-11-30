# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository. ALWAYS ASK CLARIFYING QUESTIONS.

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

**5 core contracts + 3 mocks (in contracts/):**

| Contract | Lines | Purpose |
|----------|-------|---------|
| RoseToken.sol | 167 | ERC20 with authorized mint/burn (multiple authorized addresses) |
| RoseMarketplace.sol | 362 | Task lifecycle, escrow, payment distribution |
| RoseTreasury.sol | 589 | RWA-backed treasury (BTC/rETH/Gold/USDC via Chainlink + Uniswap) |
| RoseGovernance.sol | ~750 | Governance proposals, quadratic voting, reputation-weighted delegation |
| vROSE.sol | 205 | Soulbound governance receipt token, marketplace-only transfers |
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

## Governance System

**Contracts:**
- `RoseGovernance.sol` (~750 lines) - Proposal lifecycle, quadratic voting, delegation
- `vROSE.sol` (205 lines) - Soulbound receipt token for stakeholder collateral

**Vote Power Formula:** `√(staked_ROSE) × (reputation_score / 100)`

**Thresholds:**
- Pass: 7/12 (58.33%) Yay votes
- Quorum: 33% of total staked ROSE
- Proposer eligibility: 90% reputation + 10 tasks completed
- Voter eligibility: 70% reputation
- Delegate eligibility: 90% reputation + 10 tasks completed

**Reputation Decay:**
- Tasks count for 1 year (`TASK_DECAY_PERIOD = 365 days`)
- Disputes count for 3 years (`DISPUTE_DECAY_PERIOD = 1095 days`)
- Cold start: Default 60% reputation until 10 tasks completed

**Proposal Lifecycle:**
```
Active → [Voting 2 weeks] → Passed/Failed
  ↓                            ↓
Quorum not met → timer resets  Failed → Nay voters get 2% mint
  ↓                            ↓
Max 4 edit cycles              Passed → Execute → DAO Task Created
```

**DAO Task Rewards (minted on completion):**
- Treasury: 2%
- Yay voters: 2% (split by vote power)
- Proposer: 1%

**Two-Token System:**
- ROSE: Locked in governance, allocated to votes/delegates
- vROSE: 1:1 receipt token, used for stakeholder escrow in marketplace

**Withdrawal Requires:**
1. vROSE returned (not locked in active task)
2. ROSE unallocated (manually unvote/undelegate)

**Vote Splitting:**
- Users can increase existing vote allocation (same direction only)
- Cannot change vote direction after voting

**Frontend Pages:**
- `/governance` - Proposal dashboard
- `/governance/propose` - Create proposal (90% rep + passport required)
- `/governance/:id` - Vote on proposal
- `/governance/my-votes` - Personal governance dashboard
- `/delegates` - Browse and manage delegation

**Frontend Hooks:**
- `useGovernance` - Staking, vROSE balance, eligibility
- `useDelegation` - Delegate management
- `useProposals` - Proposal CRUD operations
- `useReputation` - On-chain reputation score + event-based task counts

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

## Frontend Profile System

**Status:** Profile editing is currently disabled (display-only stub). PostgreSQL backend integration planned for future.

**Current Components (in `frontend/src/components/profile/`):**
- `SkillBadge.jsx` - Skill pill with category color
- `SkillSelect.jsx` - Multi-select (max 10 skills)
- `ProfileBadge.jsx` - Avatar + name display
- `ProfileCard.jsx` - Full profile display
- `ProfileModal.jsx` - Edit form (currently shows "coming soon")
- `ProfileViewModal.jsx` - Read-only profile viewer
- `ReputationStats.jsx` - Task counts from on-chain events

**Hooks:**
- `useProfile` - Profile state; returns `{ profile, isLoading, error, updateProfile, refreshProfile, getProfile }` (updateProfile currently disabled)
- `useReputation` - Combined reputation data; returns `{ reputation: { tasksAsWorker, tasksAsStakeholder, tasksAsCustomer, totalEarned, reputationScore, canPropose, canVote, canDelegate, governanceStats }, loading }`

**Skills (15 predefined in `constants/skills.js`):**
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

## CI/CD Workflows

**pr-build.yml:** Runs on PRs (parallel jobs)
- `build-contracts`: npm ci → hardhat test → hardhat compile → update-abi
- `build-frontend`: npm install → update-abi → vite build

**combined-deploy.yml:** Runs on main push
- Deploys contracts to Arbitrum Sepolia, verifies on Arbiscan, deploys frontend to GitHub Pages

**deploy-signer.yml:** Runs on main push (when backend/signer changes)
- Builds Docker image and pushes to GHCR
- Optionally deploys to Akash Network

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
