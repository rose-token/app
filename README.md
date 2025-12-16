# Rose Protocol

A worker-focused decentralized marketplace with real-world asset (RWA)-backed treasury, two-track governance, and reputation-gated participation.

![License](https://img.shields.io/badge/license-PPL-blue.svg)
![Solidity](https://img.shields.io/badge/solidity-0.8.20-purple.svg)
![Network](https://img.shields.io/badge/network-Arbitrum-blue.svg)

## Overview

Rose Protocol is a Web3 cooperative platform that connects customers with workers through transparent, blockchain-based task completion. The platform features:

- **RWA-Backed Treasury**: ROSE tokens backed by BTC, Gold, and USDC with NAV-based pricing
- **Three-Party Task System**: Customers, workers, and stakeholders collaborate with aligned incentives
- **Two-Track Governance**: Fast track (3 days) for small proposals, slow track (14 days) for major decisions
- **Reputation System**: 36-month decay with eligibility gating for proposals, voting, and delegation
- **Sybil Resistance**: Gitcoin Passport verification on all user actions

## Quick Start

```bash
# Smart Contracts
npm install
npm test                              # Run all tests
npm run compile                       # Compile contracts
npm run deploy:arbitrumSepolia        # Deploy to testnet

# Frontend
cd frontend && npm install && npm run dev

# Backend
cd backend/signer && npm install && npm run dev
```

## Architecture

### Smart Contracts (6 Core)

| Contract | Purpose | Lines |
|----------|---------|-------|
| **RoseToken** | ERC20 with authorized mint/burn | 168 |
| **vROSE** | Soulbound governance receipt (1:1 with staked ROSE) | 205 |
| **RoseTreasury** | NAV-based pricing, RWA management, redemption queue | 931 |
| **RoseMarketplace** | Task escrow, stakeholder validation, dispute resolution | 911 |
| **RoseGovernance** | Two-track proposals, quadratic VP, voter rewards | 966 |
| **RoseReputation** | 36-month decay buckets, eligibility thresholds | 205 |

### Deployment Order

```
1. RoseToken (temp auth: deployer)
2. vROSE
3. RoseTreasury (+ add assets: BTC 30%, GOLD 30%, STABLE 20%, ROSE 20%)
4. RoseMarketplace
5. RoseReputation (temp governance: deployer)
6. RoseGovernance

Post-deploy: Wire contracts via setAuthorized(), setGovernance(), setMarketplace(), etc.
```

## Tokenomics

### Payment Distribution

For a **10 ROSE task**:
- Customer deposits: **10 ROSE** (escrowed)
- Stakeholder stakes: **1 vROSE** (10% as collateral)

On completion:
- **Worker**: 9.5 ROSE (95%)
- **Stakeholder**: 0.5 ROSE fee + 1 vROSE returned (50% ROI)
- **DAO Treasury**: 0.2 ROSE minted (2%)

### Treasury NAV Formula

```
ROSE Price = Hard Assets USD / Circulating Supply

Hard Assets = BTC + Gold + USDC (excludes treasury ROSE holdings)
Circulating Supply = Total Supply - Treasury ROSE Balance
```

### Target Allocations

| Asset | Allocation | Oracle |
|-------|------------|--------|
| BTC (tBTC) | 30% | Chainlink BTC/USD |
| Gold (XAUt) | 30% | Chainlink XAU/USD |
| USDC | 20% | $1.00 (stable) |
| ROSE | 20% | NAV price |

## Task Lifecycle

```
Customer creates task
         ↓
   StakeholderRequired ←────────────────┐
         ↓ stakeholderStake()           │
       Open ──────────────────→ Closed  │ (cancel)
         ↓ claimTask()                  │
    InProgress ───→ Disputed ──→ Closed │ (resolve)
         ↓ markTaskCompleted()          │
     Completed ───→ Disputed ──→ Closed │
         ↓ approve × 2                  │
ApprovedPendingPayment                  │
         ↓ acceptPayment()              │
      Closed ←──────────────────────────┘
```

### Auction Mode

For competitive pricing:
1. Customer deposits max budget
2. Workers bid off-chain (backend stores bids)
3. Customer selects winner at their actual bid
4. On completion:
   - Worker receives their bid (95%)
   - Spread (midpoint - bid) → Treasury
   - Surplus (deposit - midpoint) → Customer refund

## Governance

### Two-Track System

| Feature | Fast Track | Slow Track |
|---------|------------|------------|
| Duration | 3 days | 14 days |
| Quorum | 10% | 25% |
| Treasury Limit | ≤1% | Unlimited |
| VP Model | Abundant (vote full VP on multiple) | Scarce (VP is budget) |
| Verification | Merkle proof | Backend attestation |

### Voting Power Formula

```
VP = sqrt(stakedRose) × (reputation / 100)
```

Where reputation = `(successValue - disputeValue) / successValue × 100` over 36 months.

### Eligibility Thresholds

| Action | Reputation | Tasks Required |
|--------|------------|----------------|
| Propose | 90% | 10 completed |
| Vote | 70% | - |
| Delegate | 90% | 10 completed |

### Rewards

On successful proposal completion:
- **DAO Treasury**: 2% of task value
- **Voter Pool** (winning side): 2%
- **Proposer**: 1%

## Backend Services

### Event Watchers (9)

| Watcher | Purpose |
|---------|---------|
| **DepositWatcher** | Auto-diversify USDC into BTC/Gold via LiFi |
| **RedemptionWatcher** | Liquidate RWA for redemption fulfillment |
| **AnalyticsWatcher** | Sync events to PostgreSQL for dashboards |
| **StakerIndexer** | Maintain off-chain VP cache |
| **SnapshotWatcher** | Compute VP snapshots, auto-finalize proposals |
| **DisputeWatcher** | Sync dispute events to database |
| **DelegateOptInWatcher** | Track delegate opt-in status |
| **SlowTrackWatcher** | Track Slow Track vote allocations |
| **TaskWatcher** | Trigger GitHub PR auto-merge |

### API Routes

| Route | Purpose |
|-------|---------|
| `/api/passport` | Gitcoin Passport verification |
| `/api/governance` | VP queries, merkle proofs, vote signatures |
| `/api/delegation/v2` | Off-chain EIP-712 delegations |
| `/api/treasury` | NAV history, rebalance triggers |
| `/api/auction` | Off-chain bid storage |
| `/api/tasks` | Paginated task list (scales to 100k+) |
| `/api/analytics` | Admin dashboards |
| `/api/backup` | PostgreSQL → Pinata backups |

### Scheduled Jobs

| Job | Schedule | Purpose |
|-----|----------|---------|
| NAV Snapshot | Daily 00:00 UTC | Store price history |
| Rebalance | 1st of month | Multi-swap to target allocations |
| Delegate Scoring | Hourly | Score proposals, free VP |
| Database Backup | Daily 02:00 UTC | PostgreSQL → Pinata |
| Analytics Rollup | Daily 00:00 UTC | Aggregate metrics |
| Camelot LP Fees | Daily 06:00 UTC | Collect DEX trading fees |

## Frontend

### Tech Stack

- **React 18** + **Vite 7**
- **wagmi** + **viem** for blockchain
- **RainbowKit** for wallet connection
- **TanStack Query** for caching
- **TailwindCSS** for styling
- **Pinata** for private IPFS

### Key Pages

| Route | Purpose |
|-------|---------|
| `/` | Task marketplace with pagination |
| `/vault` | Treasury deposits/redemptions |
| `/governance` | Proposals, staking, voting |
| `/delegates` | Delegation management |
| `/profile` | User profile and stats |
| `/admin` | Owner-only system management |

### Site-Wide Security

- Passport score ≥ 20 required for all routes (except `/help`)
- Whitelist bypass available for testing
- Strict blocking (no graceful degradation)

## Development

### Prerequisites

- Node.js 20+
- PostgreSQL 14+
- MetaMask or compatible wallet

### Environment Variables

**Root `.env`**:
```bash
ARBITRUM_SEPOLIA_RPC_URL=https://...
PRIVATE_KEY=0x...
DAO_TREASURY_ADDRESS=0x...
ARBISCAN_API_KEY=...
PASSPORT_SIGNER_ADDRESS=0x...
```

**Frontend `.env`**:
```bash
VITE_MARKETPLACE_ADDRESS=0x...
VITE_TOKEN_ADDRESS=0x...
VITE_TREASURY_ADDRESS=0x...
VITE_GOVERNANCE_ADDRESS=0x...
VITE_VROSE_ADDRESS=0x...
VITE_PINATA_JWT=...
VITE_PINATA_GATEWAY=https://...
```

**Backend `.env`**:
```bash
DATABASE_URL=postgresql://...
RPC_URL=https://...
RPC_WS_URL=wss://...
SIGNER_PRIVATE_KEY=0x...
VITE_GITCOIN_API_KEY=...
```

### Testing

```bash
# All tests (8 suites)
npm test

# Individual suites
npx hardhat test test/RoseTreasury.test.js
npx hardhat test test/RoseMarketplace.test.js
npx hardhat test test/RoseGovernanceV2.test.js
npx hardhat test test/vROSE.test.js
```

### ABI Workflow

After contract changes:
```bash
npm run update-abi  # Generates ABIs for frontend + backend
```

## CI/CD

### PR Build (`pr-build.yml`)

Parallel jobs:
1. **build-contracts**: Test → Compile → Update ABIs
2. **build-frontend**: Install → Build with placeholder addresses

### Deploy (`combined-deploy.yml`)

On push to main:
1. Run tests
2. Deploy contracts to Arbitrum Sepolia
3. Save addresses to `deployment-output.json`
4. Build and deploy frontend to GitHub Pages

### Backend Deploy (`deploy-signer.yml`)

Deploys to Akash Network with:
- PostgreSQL database
- WebSocket event listeners
- Scheduled cron jobs

## Security

### Smart Contract Patterns

- **ReentrancyGuard** on all 6 contracts
- **CEI Pattern** (Checks-Effects-Interactions)
- **SafeERC20** for token transfers
- **Signature replay protection** via `usedSignatures` mapping
- **Oracle staleness check** (1 hour max)
- **Same-block protection** (prevents flash loan attacks on Treasury)

### Economic Security

- Quadratic VP prevents whale dominance
- Stakeholder collateral (10%) aligns incentives
- Reputation decay prevents resting on old performance
- Passport gating prevents sybil attacks

### Centralization Points (MVP Trade-offs)

- Owner can resolve disputes
- Single passport signer
- Rebalancer wallet has swap privileges

## Mainnet Addresses (Arbitrum One)

| Asset | Address |
|-------|---------|
| USDC | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` |
| tBTC | `0x6c84a8f1c29108F47a79964b5Fe888D4f4D0de40` |
| XAUt | `0x40461291347e1ecbb09499f3371d3f17f10d7159` |
| BTC/USD Feed | `0x6ce185860a4963106506C203335A2910413708e9` |
| XAU/USD Feed | `0x1F954Dc24a49708C26E0C1777f16750B5C6d5a2c` |
| LiFi Diamond | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` |

## Technology Stack

| Layer | Technologies |
|-------|-------------|
| **Contracts** | Solidity 0.8.20, OpenZeppelin v5, Chainlink v1.5, Hardhat |
| **Frontend** | React 18, Vite 7, wagmi, viem, RainbowKit, TailwindCSS |
| **Backend** | TypeScript, Express, PostgreSQL, ethers.js v6 |
| **Infrastructure** | Arbitrum, Pinata IPFS, Akash Network, GitHub Actions |

## Git Workflow

```bash
# Never push directly to main
git checkout -b feature/your-feature
git push -u origin feature/your-feature
gh pr create --title "feat: description" --body "..."
gh pr checks --watch
```

## License

[Peer Production License (PPL)](LICENSE) - Commercial use permitted for worker-owned cooperatives only.

## Resources

- [CLAUDE.md](CLAUDE.md) - Detailed technical reference
- [Hardhat Docs](https://hardhat.org/docs)
- [wagmi Docs](https://wagmi.sh)
- [OpenZeppelin Contracts](https://docs.openzeppelin.com/contracts)
- [Chainlink Data Feeds](https://docs.chain.link/data-feeds)

---

**Network**: Arbitrum Sepolia (testnet) / Arbitrum One (mainnet)
**Solidity**: 0.8.20
**Node**: 20+
