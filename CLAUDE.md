# CLAUDE.md

Guidance for Claude Code. ALWAYS ASK CLARIFYING QUESTIONS. ALWAYS UPDATE CLAUDE.MD AS YOUR LAST TODO STEP.

## Table of Contents
**Contracts:** [Overview](#project-overview) | [Architecture](#contract-architecture) | [Constants](#contract-constants) | [Errors](#contract-custom-errors) | [Treasury NAV](#treasury-nav-calculations) | [Security](#security-patterns)
**Governance:** [System](#governance-system)
**Tasks:** [Status Flow](#task-status-flow)
**Frontend:** [Architecture](#frontend-architecture) | [Routes](#frontend-routes) | [Hooks](#frontend-hooks) | [Passport](#frontend-passport-system)
**Backend:** [API](#backend-api) | [Services](#backend-services) | [Cron](#backend-scheduled-jobs) | [Deployment](#backend-deployment)
**Infrastructure:** [Testing](#testing) | [Simulation](#simulation-script) | [CI/CD](#cicd-workflows) | [Env Vars](#environment-variables) | [Decimals](#token-decimals-reference) | [Git](#git-workflow)

---

## Project Overview

Rose Token is a decentralized Web3 marketplace with task-value-based token distribution.

**Tokenomics (95/5 split + 2% DAO):** Customer deposits ROSE (escrowed) → Stakeholder stakes 10% → On completion: Worker 95%, Stakeholder 5% + stake back, Platform mints 2% to DAO treasury.

## Development Commands

```bash
# Contracts
npm run compile && npm test && npm run update-abi
npx hardhat test test/RoseMarketplace.test.js  # specific test
npm run deploy:arbitrumSepolia  # testnet
npm run deploy:arbitrum         # mainnet

# Frontend (from frontend/)
npm run dev && npm run build && npm test

# Simulation (Arbitrum Sepolia)
npx hardhat run scripts/simulate.js --network arbitrumSepolia -- --help
```

## Contract Architecture

| Contract | Lines | Purpose |
|----------|-------|---------|
| RoseToken.sol | 167 | ERC20 with authorized mint/burn |
| RoseMarketplace.sol | 562 | Task lifecycle, escrow, payments, passport verification |
| RoseTreasury.sol | 861 | RWA-backed treasury (BTC/Gold/USDC via Chainlink + Uniswap V3) |
| RoseGovernance.sol | 1024 | Proposals, quadratic voting, multi-delegation, rewards |
| vROSE.sol | 205 | Soulbound governance receipt token |
| mocks/*.sol | 224 | MockERC20, MockV3Aggregator, MockUniswapV3Router |

**Deployment order:** RoseToken → vROSE → RoseTreasury → RoseGovernance → RoseMarketplace

**Post-deployment config:**
1. `RoseToken.setAuthorized(treasury/marketplace/governance, true)`
2. `vROSE.setGovernance(governance)` + `setMarketplace(marketplace)`
3. `RoseMarketplace.setGovernance(governance)` + `setVRoseToken(vROSE)`
4. `RoseTreasury.setMarketplace(marketplace)` + `setGovernance(governance)`
5. `RoseGovernance.setDelegationSigner(signerAddress)` - Required for delegated voting

**Passport verification:** ECDSA signatures from passportSigner for `createTask`, `stakeholderStake`, `claimTask`. Replay protection via `usedSignatures` mapping.

## Contract Constants

| Contract | Constant | Value | Purpose |
|----------|----------|-------|---------|
| Marketplace | MINT_PERCENTAGE | 2 | 2% minted to DAO |
| Marketplace | WORKER_SHARE/STAKEHOLDER_SHARE | 95/5 | Payment split |
| Treasury | DRIFT_THRESHOLD | 5% | Rebalance trigger |
| Treasury | REBALANCE_COOLDOWN | 7 days | Between rebalances |
| Treasury | USER_COOLDOWN | 24h | Between deposits/redeems |
| Treasury | MAX_ORACLE_STALENESS | 1h | Oracle freshness |
| Treasury | Default allocations | BTC=30%, Gold=30%, USDC=20%, ROSE=20% | Target portfolio |
| Governance | VOTING_PERIOD | 2 weeks | Proposal voting window |
| Governance | QUORUM_THRESHOLD | 33% | Min VP participation |
| Governance | PASS_THRESHOLD | 58.33% | 7/12 supermajority |
| Governance | MAX_EDIT_CYCLES | 4 | Proposal edit limit |
| Governance | COLD_START_TASKS | 10 | Tasks before full rep |
| Governance | DEFAULT_REPUTATION | 60 | Cold start score |
| Governance | DECAY_BUCKETS | 36 | 3 years monthly decay |
| Governance | Rewards | DAO 2%, Yay voters 2%, Proposer 1% | On completion |

## Contract Custom Errors

| Contract | Error | Meaning |
|----------|-------|---------|
| RoseToken | NotAuthorized, NotOwner, ZeroAddress | Auth/validation |
| RoseToken | InsufficientBalance/Allowance | Token operations |
| Marketplace | InvalidSignature, SignatureExpired, SignatureAlreadyUsed | Passport |
| Marketplace | NotGovernance, InsufficientVRose | Permissions |
| Treasury | InvalidPrice, StaleOracle | Oracle issues |
| Treasury | InsufficientLiquidity, SlippageExceeded | Swap failures |
| Treasury | InvalidAllocation, ZeroAmount | Validation |
| Treasury | RebalanceNotNeeded, RebalanceCooldown, CooldownNotElapsed | Cooldowns |
| Governance | IneligibleToPropose (<90% rep or <10 tasks) | Eligibility |
| Governance | IneligibleToVote (<70% rep), IneligibleToDelegate | Eligibility |
| Governance | DelegationChainNotAllowed | User is both delegator and delegate (max depth 1) |
| Governance | ProposalNotActive, CannotVoteOnOwnProposal | Voting |
| Governance | CannotChangeVoteDirection, VPLockedToAnotherProposal | VP allocation |
| Governance | InsufficientAvailableVP, MaxEditCyclesReached | Limits |
| vROSE | OnlyMarketplaceTransfer/Approval, NotGovernance | Soulbound |

## Treasury NAV Calculations

**Formula:** `ROSE Price = HardAssetValueUSD / CirculatingSupply` (initial $1.00, then NAV-backed)

- **Hard Assets:** BTC + Gold + USDC value (excludes Treasury ROSE)
- **Circulating Supply:** totalSupply - balanceOf(treasury)
- **All values normalized to 6 decimals**

**Deposit:** USDC → Treasury → ROSE minted → `_diversify()` swaps to RWA
**Redeem:** ROSE burned → `_liquidateForRedemption()` if needed → USDC returned
**Rebalance:** >5% drift triggers, 7-day cooldown, owner can force, maintains 5% USDC buffer

## Security Patterns

- **ReentrancyGuard:** All 4 core contracts (deposits, withdrawals, staking, voting, payments)
- **CEI Pattern:** State updated before external calls
- **SafeERC20:** All token transfers
- **Signature replay protection:** `usedSignatures` mapping
- **Oracle staleness:** 1-hour max, reverts if stale
- **Slippage protection:** Configurable `maxSlippageBps` (default 1%)
- **User cooldowns:** 24h between deposits/redeems (flash loan protection)

## Governance System

**Vote Power:** `VP = √(staked_ROSE) × reputation`

**Reputation (^0.6 sublinear):** `(successPoints - disputePoints) / successPoints × 100` where points = Σ(taskValue^0.6). Backend computes + signs attestation. Monthly buckets, 3-year decay.

**Thresholds:** Pass 58.33%, Quorum 33%, Proposer 90% rep + 10 tasks, Voter 70% rep, Delegate 90% rep + 10 tasks

**Proposal lifecycle:** Active → [2 weeks voting] → Passed/Failed. Quorum not met resets timer. Max 4 edits. Passed → Execute → DAO Task Created.

**Two-token system:** ROSE locked in governance, vROSE as 1:1 receipt for stakeholder escrow. Withdrawal requires vROSE returned + ROSE unallocated.

**Delegated voting:** Delegates use `castDelegatedVote()`, backend computes allocations off-chain, contract verifies signature + stores hash. Gas-optimized O(1).

**Voter rewards:** Pooled at resolution, users claim via `claimVoterRewards()` with backend signature.

**Storage:** `mapping(address => mapping(uint256 => uint256)) monthlySuccessValue/monthlyDisputeValue`

## Task Status Flow

```
StakeholderRequired → Open → InProgress → Completed → ApprovedPendingPayment → Closed
         ↓            ↓
         └────────────┴─→ cancelTask() → Closed (refunds)
```

**Role separation:** Customer ≠ Stakeholder ≠ Worker on same task.

## Frontend Architecture

**Stack:** React 18 + Vite + Wagmi/RainbowKit + TailwindCSS

**Directories:**
- `pages/` - TasksPage, VaultPage, ProfilePage, HelpPage, GovernancePage, ProposalCreatePage, ProposalDetailPage, DelegatesPage, MyVotesPage
- `components/marketplace/` - TaskCard, TaskList, TaskFilters, CreateTaskForm
- `components/vault/` - VaultStats, VaultAllocation, NavHistoryChart, DepositCard, RedeemCard
- `components/governance/` - StakingPanel, VotePanel, ClaimRewardsPanel, ProposalCard, DelegateCard, QuorumBar
- `hooks/` - useNotifications, useProfile, useVaultData, useNavHistory, usePassport, usePassportVerify, useGovernance, useProposals, useDelegation, useReputation
- `contracts/` - Auto-generated ABIs (via update-abi)

**Styling:** CSS variables in `index.css`, semantic Tailwind (`bg-primary`, `text-accent`). Never hardcode colors.

**Context hierarchy:** WagmiProvider → QueryClientProvider → RainbowKitProvider → ProfileProvider → PassportProvider → PassportVerifyProvider → Router

## Frontend Routes

| Route | Page | Purpose |
|-------|------|---------|
| `/` | TasksPage | Marketplace |
| `/vault` | VaultPage | Treasury |
| `/governance` | GovernancePage | Proposals |
| `/governance/propose` | ProposalCreatePage | Create proposal |
| `/governance/:id` | ProposalDetailPage | Vote |
| `/governance/my-votes` | MyVotesPage | Personal dashboard |
| `/delegates` | DelegatesPage | Delegation |
| `/profile` | ProfilePage | User profile |
| `/help` | HelpPage | Docs |

## Frontend Hooks

| Hook | State | Methods |
|------|-------|---------|
| useVaultData | rosePrice, vaultValueUSD, breakdown, balances, cooldowns | auto-refresh 45s |
| usePassport | score, loading, error, lastUpdated, isCached | loadScore, refetch, meetsThreshold |
| usePassportVerify | loading, error, lastSignature | getSignature, getSignerAddress, getThresholds |
| useProfile | profile, isLoading, error, isAuthenticated | updateProfile (disabled), getProfile, refreshProfile |
| useReputation | tasks (worker/stakeholder/customer), totalEarned, reputationScore, canPropose/Vote/Delegate | 5-min cache |
| useGovernance | stakedRose, votingPower, availableVP, delegatedOut, vRoseBalance, totalSystemVP | deposit, withdraw, refetch |
| useProposals | proposals, userVotes, loading | createProposal, vote, voteCombined, freeVP, finalize, execute, cancel |
| useDelegation | delegations, receivedDelegations, availableDelegatedPower | delegateTo, undelegateFrom, castDelegatedVote, claimAllRewards |
| useNavHistory | snapshots, pagination | refetch (default 3 years daily) |

**Note:** deposit/withdraw/vote/delegate methods internally fetch reputation attestation from backend. `voteCombined` calls `/api/delegation/confirm-vote` after successful delegated votes for reward tracking.

## Frontend Passport System

**Hooks:** `usePassport` (Gitcoin API, 1h cache), `usePassportVerify` (backend signer)
**Components:** `PassportGate` (conditional render), `PassportStatus` (score badge)
**Thresholds:** CREATE_TASK=20, STAKE=20, CLAIM_TASK=20, PROPOSE=25

## Backend API

**Directory:** `backend/signer/`

| Endpoint | Method | Purpose |
|----------|--------|---------|
| /api/passport/verify | POST | Get signature for action |
| /api/passport/score/:address | GET | Passport score |
| /api/passport/signer | GET | Signer address |
| /api/governance/vp/:address | GET | VP breakdown |
| /api/governance/total-vp | GET | System total VP |
| /api/governance/delegations/:address | GET | Outgoing delegations |
| /api/governance/received/:delegate | GET | Incoming delegations |
| /api/governance/reputation-signed/:address | GET | Signed reputation (^0.6) |
| /api/governance/vote-signature | POST | Direct vote signature |
| /api/delegation/vote-signature | POST | Delegated vote signature |
| /api/delegation/confirm-vote | POST | Confirm vote on-chain, store allocations |
| /api/delegation/claim-signature | POST | Reward claim signature |
| /api/delegation/claimable/:user | GET | Claimable rewards |
| /api/profile | POST | Create/update (EIP-712) |
| /api/profile/:address | GET | Fetch profile |
| /api/treasury/history | GET | NAV snapshots |
| /api/treasury/rebalances | GET | Rebalance events |
| /api/treasury/stats | GET | NAV statistics |

## Backend Services

| Service | Functions |
|---------|-----------|
| signer.ts | getSignerAddress, signApproval |
| gitcoin.ts | getPassportScore (whitelist fallback) |
| governance.ts | getUserVP, getTotalSystemVP, getUserDelegations, getReceivedDelegations, getReputationNew, signReputationAttestation, calculateVotePower |
| delegation.ts | computeAllocations, signDelegatedVote, verifyAndStoreAllocations, getAvailableDelegatedPower, getClaimableRewards, signClaimApproval |
| profile.ts | createOrUpdateProfile, getProfile, getProfiles |
| eip712.ts | verifyProfileSignature, isTimestampValid |
| nav.ts | fetchNavSnapshot, storeNavSnapshot, syncRebalanceEvents, getNavHistory, getNavStats |
| treasury.ts | executeRebalance |

## Backend Scheduled Jobs

| Job | Schedule | Purpose |
|-----|----------|---------|
| Rebalance | 1st of month 00:00 UTC | treasury.forceRebalance(), retry 6h on failure |
| NAV Snapshot | Daily 00:00 UTC | Capture prices/allocations, sync Rebalanced events |

## Backend Deployment

**Docker Compose:** PostgreSQL 16 (5432) + Node.js signer (3000)
**Akash:** 0.75 CPU, 1GB RAM, signer.rose-token.com
**PostgreSQL:** 2-10 connections, 30s idle, exponential retry

**Database tables:**
- `profiles` - User profile data with EIP-712 signatures
- `nav_history` - Daily NAV snapshots for treasury
- `delegation_allocations` - Per-delegator VP allocations for proposals (cached for incremental votes + claims)

```bash
cd backend/signer && npm install && cp .env.example .env && npm run dev
```

## Testing

```bash
test/RoseMarketplace.test.js    # 557 lines - Task lifecycle, payments
test/RoseToken.test.js          # 130 lines - Minting, authorization
test/TaskLifecycleEdgeCases.test.js  # 167 lines - Edge cases
test/DetailedDescription.test.js     # 100 lines - IPFS
```

**Mocks:** MockV3Aggregator (Chainlink), MockUniswapV3Router, MockERC20
**Token acquisition:** Mint USDC → Approve Treasury → deposit() → ROSE minted

## Simulation Script

```bash
npx hardhat run scripts/simulate.js --network arbitrumSepolia -- --btc-price 100000
npx hardhat run scripts/simulate.js --network arbitrumSepolia -- --scenario bull
```

**Scenarios:** bull, bear, gold-rally, crypto-winter, deposit-redeem, nav-stress
**Required env:** WORKER_PRIVATE_KEY, CUSTOMER_PRIVATE_KEY, STAKEHOLDER_PRIVATE_KEY (different addresses with valid Gitcoin Passports)

## CI/CD Workflows

| Workflow | Trigger | Jobs |
|----------|---------|------|
| pr-build.yml | PRs | build-contracts, build-frontend (parallel) |
| combined-deploy.yml | main push | Deploy Arbitrum Sepolia, verify Arbiscan, deploy GitHub Pages |
| deploy-signer.yml | main push (backend/signer) | Build Docker, push GHCR, deploy Akash |

## Environment Variables

| Location | Key Variables |
|----------|---------------|
| Root .env | ARBITRUM_SEPOLIA_RPC_URL, PRIVATE_KEY, DAO_TREASURY_ADDRESS, ARBISCAN_API_KEY, PASSPORT_SIGNER_ADDRESS |
| frontend/.env | VITE_MARKETPLACE/TOKEN/TREASURY/GOVERNANCE/VROSE_ADDRESS, VITE_PINATA_*, VITE_PASSPORT_SIGNER_URL |
| backend/.env | PORT, ALLOWED_ORIGINS, SIGNER_PRIVATE_KEY, VITE_GITCOIN_API_KEY/SCORER_ID, THRESHOLD_*, GOVERNANCE/TREASURY_ADDRESS, RPC_URL, DATABASE_URL, DB_POOL_*, NAV_CRON_SCHEDULE |

## Token Decimals Reference

| Token | Decimals | Format Helper |
|-------|----------|---------------|
| ROSE/vROSE/stakedRose | 18 | formatUnits(value, 18) |
| VP (votingPower, availableVP, delegatedOut) | 9 | formatUnits(value, 9) |
| USDC/NAV prices | 6 | formatUnits(value, 6) |
| TBTC | 8 | - |
| PAXG | 18 | - |
| Chainlink feeds | 8 | - |

## Key Technical Details

- **Solidity:** 0.8.20, OpenZeppelin v5, Chainlink v1.5.0
- **Optimizer:** 1 run + viaIR
- **Networks:** Arbitrum Sepolia (421614), Arbitrum One (42161)
- **Frontend:** Vite 7.x, wagmi + viem + RainbowKit
- **Backend:** Express.js + TypeScript + PostgreSQL + ethers.js

## Git Workflow

```bash
git checkout -b feature/description
git push -u origin feature/description
gh pr create --title "feat: ..." --body "..."
gh pr checks --watch
```

Never push directly to main.
