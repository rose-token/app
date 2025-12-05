# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository. ALWAYS ASK CLARIFYING QUESTIONS. ALWAYS UPDATE CLAUDE.MD WITH THE LATEST CHANGES/INFO AS YOUR LAST TODO STEP.

## Table of Contents

**Contracts:**
- [Project Overview](#project-overview) - Tokenomics and system overview
- [Contract Architecture](#contract-architecture) - 5 core + 3 mock contracts
- [Contract Constants](#contract-constants) - Key values per contract
- [Contract Custom Errors](#contract-custom-errors) - Error definitions
- [Treasury NAV Calculations](#treasury-nav-calculations) - Price formulas
- [Security Patterns](#security-patterns) - Reentrancy, CEI, slippage

**Governance:**
- [Governance System](#governance-system) - VP, voting, delegation, rewards

**Tasks:**
- [Task Status Flow](#task-status-flow) - Lifecycle diagram

**Frontend:**
- [Frontend Architecture](#frontend-architecture) - Stack and directories
- [Frontend Routes](#frontend-routes) - 9 pages
- [Frontend Context Providers](#frontend-context-providers) - Provider hierarchy
- [Frontend Constants](#frontend-constants) - Config files
- [Frontend Hooks (Comprehensive)](#frontend-hooks-comprehensive) - All hooks
- [Frontend Passport System](#frontend-passport-system) - Gitcoin integration
- [Frontend Profile System](#frontend-profile-system) - Profile components

**Backend:**
- [Backend Passport Signer](#backend-passport-signer) - API overview
- [Backend Services](#backend-services) - Service methods
- [Backend Scheduled Jobs](#backend-scheduled-jobs) - Cron tasks
- [Signature Formats](#signature-formats) - ECDSA message formats
- [Backend Deployment](#backend-deployment) - Docker/Akash

**Infrastructure:**
- [Testing](#testing) - Test suites
- [CI/CD Workflows](#cicd-workflows) - GitHub Actions
- [Environment Variables](#environment-variables) - All env files
- [Token Decimals Reference](#token-decimals-reference) - Decimal handling
- [Key Technical Details](#key-technical-details) - Versions and stack
- [Git Workflow](#git-workflow) - Branch strategy

---

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
| RoseMarketplace.sol | 562 | Task lifecycle, escrow, payment distribution, passport verification |
| RoseTreasury.sol | 861 | RWA-backed treasury (BTC/Gold/USDC via Chainlink + Uniswap V3) |
| RoseGovernance.sol | 1024 | Governance proposals, quadratic voting, multi-delegation, voter rewards |
| vROSE.sol | 205 | Soulbound governance receipt token, marketplace-only transfers |
| mocks/MockERC20.sol | 39 | ERC20 test utility with public mint + faucet |
| mocks/MockV3Aggregator.sol | 79 | Chainlink price feed mock with configurable answers |
| mocks/MockUniswapV3Router.sol | 106 | Uniswap V3 swap router mock with exchange rates |

**Key architectural decisions:**
- RoseMarketplace accepts existing RoseToken address (not self-deployed)
- RoseToken uses authorization mapping (multiple contracts can mint/burn)
- RoseTreasury integrates Chainlink price feeds and Uniswap V3 for RWA diversification

**Deployment order:**
1. Deploy RoseToken with initial authorized address
2. Deploy vROSE (no constructor args)
3. Deploy RoseTreasury with RoseToken + oracle/DEX addresses
4. Deploy RoseGovernance with RoseToken, vROSE, passportSigner
5. Deploy RoseMarketplace with RoseToken, Treasury, passportSigner

**Post-deployment configuration:**
1. `RoseToken.setAuthorized(treasury, true)` - Allow Treasury to mint/burn
2. `RoseToken.setAuthorized(marketplace, true)` - Allow Marketplace to mint
3. `RoseToken.setAuthorized(governance, true)` - Allow Governance to mint rewards
4. `vROSE.setGovernance(governance)` - Set governance for mint/burn
5. `vROSE.setMarketplace(marketplace)` - Allow marketplace transfers
6. `RoseMarketplace.setGovernance(governance)` - Link marketplace to governance
7. `RoseMarketplace.setVRoseToken(vROSE)` - Set vROSE reference
8. `RoseTreasury.setMarketplace(marketplace)` - Link treasury to marketplace
9. `RoseTreasury.setGovernance(governance)` - Allow governance to spend

**Passport Signature Verification:**
- Contract verifies ECDSA signatures from trusted passportSigner address
- Protected functions: `createTask("createTask")`, `stakeholderStake("stake")`, `claimTask("claim")`
- Replay protection: `usedSignatures` mapping marks each signature as consumed
- Custom errors: `InvalidSignature`, `SignatureExpired`, `SignatureAlreadyUsed`, `ZeroAddressSigner`
- Admin: `setPassportSigner(address)` - owner-only signer update

## Contract Constants

**RoseMarketplace:**
| Constant | Value | Purpose |
|----------|-------|---------|
| MINT_PERCENTAGE | 2 | 2% of task value minted to DAO treasury |
| WORKER_SHARE | 95 | Worker receives 95% of deposit |
| STAKEHOLDER_SHARE | 5 | Stakeholder receives 5% fee |
| SHARE_DENOMINATOR | 100 | Basis for percentage calculations |

**RoseTreasury:**
| Constant | Value | Purpose |
|----------|-------|---------|
| DRIFT_THRESHOLD | 500 (5%) | Rebalance triggers if asset drifts >5% |
| REBALANCE_COOLDOWN | 7 days | Minimum time between rebalances |
| USER_COOLDOWN | 24 hours | Between deposits/redeems per user |
| MAX_ORACLE_STALENESS | 1 hour | Reject stale price data |
| MIN_SWAP_AMOUNT | 1e6 (1 USDC) | Minimum swap to avoid dust |
| POOL_FEE_STABLE | 500 (0.05%) | Uniswap fee for stable pairs |
| POOL_FEE_VOLATILE | 3000 (0.3%) | Uniswap fee for volatile pairs |
| Default allocations | BTC=30%, Gold=30%, USDC=20%, ROSE=20% | Target portfolio |

**RoseGovernance:**
| Constant | Value | Purpose |
|----------|-------|---------|
| VOTING_PERIOD | 2 weeks | Proposal voting window |
| QUORUM_THRESHOLD | 3300 (33%) | Min VP participation |
| PASS_THRESHOLD | 5833 (58.33%) | 7/12 supermajority required |
| MAX_EDIT_CYCLES | 4 | Proposal edit limit |
| COLD_START_TASKS | 10 | Tasks before full reputation |
| DEFAULT_REPUTATION | 60 | Cold start reputation score |
| TASK_DECAY_PERIOD | 365 days | Task reputation relevance |
| DISPUTE_DECAY_PERIOD | 1095 days | Dispute penalty duration |
| DAO_MINT_PERCENT | 200 (2%) | Treasury reward on completion |
| YAY_VOTER_REWARD | 200 (2%) | Yay voters split |
| PROPOSER_REWARD | 100 (1%) | Proposer reward on completion |

## Contract Custom Errors

**RoseToken:**
- `NotAuthorized()` - Caller not in authorized mapping
- `NotOwner()` - Caller not contract owner
- `ZeroAddress()` - Invalid zero address provided
- `InsufficientBalance()` - Insufficient token balance
- `InsufficientAllowance()` - Insufficient approval for transfer

**RoseMarketplace:**
- `InvalidSignature()` - ECDSA signature verification failed
- `SignatureExpired()` - Signature timestamp expired
- `SignatureAlreadyUsed()` - Replay attack detected
- `ZeroAddressSigner()` - Invalid signer address
- `NotGovernance()` - Caller not governance contract
- `InsufficientVRose()` - Stakeholder lacks vROSE balance

**RoseTreasury:**
- `InvalidPrice()` - Chainlink price <= 0
- `StaleOracle()` - Oracle data > 1 hour old
- `InsufficientLiquidity()` - Not enough liquidity for swap
- `SlippageExceeded()` - Actual output < minimum expected
- `InvalidAllocation()` - Allocations don't sum to 100%
- `ZeroAmount()` - Amount is zero
- `RebalanceNotNeeded()` - No drift detected
- `RebalanceCooldown()` - Within 7-day cooldown period
- `CooldownNotElapsed()` - User cooldown not elapsed

**RoseGovernance:**
- `IneligibleToPropose()` - Reputation <90% or <10 tasks
- `IneligibleToVote()` - Reputation <70%
- `IneligibleToDelegate()` - Reputation <90% or <10 tasks
- `ProposalNotActive()` - Proposal not in Active state
- `CannotVoteOnOwnProposal()` - Proposer trying to vote
- `CannotChangeVoteDirection()` - Attempted Yay→Nay or vice versa
- `VPLockedToAnotherProposal()` - VP already allocated elsewhere
- `InsufficientAvailableVP()` - Not enough unallocated VP
- `MaxEditCyclesReached()` - Exceeded 4 edits

**vROSE:**
- `OnlyMarketplaceTransfer()` - Transfer not to/from marketplace
- `OnlyMarketplaceApproval()` - Approval only allowed for marketplace
- `NotGovernance()` - Caller not governance contract
- `InsufficientBalance()` - Not enough vROSE balance

## Treasury NAV Calculations

**Core Formula:** `ROSE Price = HardAssetValueUSD / CirculatingSupply`

| Scenario | Price |
|----------|-------|
| Initial (supply = 0) | $1.00 |
| Ongoing | NAV-backed |

**Calculation Components:**
- **Hard Assets**: BTC value + Gold value + USDC value (excludes Treasury ROSE)
- **Circulating Supply**: totalSupply - balanceOf(treasury)
- **All values normalized to 6 decimals** (USDC standard)

**Deposit Flow:**
```
roseToMint = (usdcAmount × 1e18) / rosePrice()
→ USDC transferred to Treasury
→ ROSE minted to user
→ _diversify() swaps USDC into BTC/Gold per allocation
```

**Redeem Flow:**
```
usdcOwed = (roseAmount × rosePrice()) / 1e18
→ ROSE burned from user
→ If USDC insufficient, _liquidateForRedemption() sells RWA
→ USDC transferred to user
```

**Rebalancing:**
- Triggers when any asset drifts >5% from target allocation
- Requires 7-day cooldown since last rebalance
- Owner can `forceRebalance()` bypassing cooldown
- Phases: (1) Sell overweight → USDC, (2) Buy underweight with USDC
- Maintains 5% USDC buffer for liquidity

## Security Patterns

**Reentrancy Protection:**
- All 4 core contracts use OpenZeppelin `ReentrancyGuard`
- Applied to: deposits, withdrawals, staking, voting, payments

**Checks-Effects-Interactions:**
- State updated before external calls
- Example: `t.status = Closed` before `roseToken.transfer()`

**SafeERC20:**
- All token transfers use `SafeERC20.safeTransfer/safeTransferFrom`
- Prevents silent failures on non-standard ERC20s

**Signature Replay Protection:**
- `mapping(bytes32 => bool) usedSignatures`
- Each signature marked used after verification
- Prevents reuse of passport/vote approvals

**Oracle Staleness:**
- `MAX_ORACLE_STALENESS = 1 hour`
- Reverts if `block.timestamp - updatedAt > 1 hour`

**Slippage Protection:**
- `maxSlippageBps` configurable (default 1%)
- Swaps revert if output < minimum expected

**User Cooldowns:**
- 24-hour cooldown between deposits/redeems per user
- Prevents flash loan attacks on NAV

## Governance System

**Contracts:**
- `RoseGovernance.sol` (1024 lines) - Proposal lifecycle, quadratic voting, multi-delegation
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

**Delegated Voting (Gas-Optimized):**
- Delegates cast votes using `castDelegatedVote()`
- Backend computes per-delegator allocations off-chain, signs approval
- Contract verifies signature and stores aggregate + allocations hash
- Avoids O(n) on-chain loops over delegators

**Voter Rewards Claim System:**
- Rewards pooled at proposal resolution (O(1) gas, no voter loops)
- Users claim via `claimVoterRewards()` with backend signature
- Supports both direct votes and delegated votes in single batch claim
- Rewards added to stakedRose balance (can vote or withdraw)

**Frontend Pages:**
- `/governance` - Proposal dashboard
- `/governance/propose` - Create proposal (90% rep + passport required)
- `/governance/:id` - Vote on proposal
- `/governance/my-votes` - Personal governance dashboard
- `/delegates` - Browse and manage delegation

**Frontend Hooks:**
- `useGovernance` - Staking, vROSE balance, eligibility
- `useDelegation` - Delegate management, delegated voting, reward claims
- `useProposals` - Proposal CRUD operations
- `useReputation` - On-chain reputation score + event-based task counts

**Frontend Governance Components:**
- `StakingPanel.jsx` - Deposit/withdraw ROSE for governance
- `ClaimRewardsPanel.jsx` - View and claim pending voter rewards
- `VotePanel.jsx` - Vote on proposals with own/delegated power
- `DelegateCard.jsx` - Delegate profile and delegation form
- `ProposalCard.jsx` - Compact proposal display card
- `ProposalFilters.jsx` - Status/sort/personal filters
- `QuorumBar.jsx` - Visual quorum progress indicator
- `ReputationBadge.jsx` - Color-coded reputation display

**Governance Hooks (Detailed):**

`useGovernance` - Core governance state
- State: `{ stakedRose, votingPower, availableVP, delegatedOut, proposalVPLocked, vRoseBalance, reputation, totalSystemVP }`
- Methods: `deposit(amount)`, `withdraw(amount)`, `refetch()`
- Data sources: Backend `/api/governance/vp` + contract calls

`useProposals` - Proposal lifecycle
- State: `{ proposals, userVotes, loading }`
- Methods: `createProposal(data)`, `vote(proposalId, vpAmount, support)`, `voteCombined(proposalId, totalVP, support, ownAvailable, delegatedAvailable)`, `freeVP(proposalId)`, `finalizeProposal(proposalId)`, `executeProposal(proposalId)`, `cancelProposal(proposalId)`
- Filters: active, passed, executed, failed, myProposals, myVotes

`useDelegation` - Multi-delegation management
- State: `{ delegations, receivedDelegations, availableDelegatedPower }`
- Methods: `delegateTo(address, vpAmount)`, `undelegateFrom(address, vpAmount)`, `undelegateAll()`, `castDelegatedVote(...)`, `fetchClaimableRewards()`, `claimAllRewards()`
- Supports multi-delegation (different VP amounts to multiple delegates)

`useReputation` - Reputation and eligibility
- Returns: `{ reputation: { tasksAsWorker, tasksAsStakeholder, tasksAsCustomer, totalEarned, reputationScore, canPropose, canVote, canDelegate }, loading }`
- Sources: Contract `getReputation()` + RoseMarketplace events

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
- `frontend/src/pages/` - 9 pages (TasksPage, VaultPage, ProfilePage, HelpPage, GovernancePage, ProposalCreatePage, ProposalDetailPage, DelegatesPage, MyVotesPage)
- `frontend/src/components/marketplace/` - TaskCard, TaskList, TaskFilters, CreateTaskForm
- `frontend/src/components/vault/` - VaultStats, VaultAllocation, DepositCard, RedeemCard, TransactionHistory
- `frontend/src/components/governance/` - StakingPanel, VotePanel, ClaimRewardsPanel, ProposalCard, DelegateCard, QuorumBar
- `frontend/src/components/wallet/` - TokenBalance, NetworkSelector
- `frontend/src/hooks/` - useNotifications, useProfile, useVaultData, usePassport, usePassportVerify, useGovernance, useProposals, useDelegation, useReputation
- `frontend/src/utils/ipfs/` - pinataService.js for IPFS integration
- `frontend/src/contracts/` - Auto-generated ABIs (via update-abi script)

**Styling:** Uses CSS variables in `index.css` with semantic Tailwind classes (`bg-primary`, `text-accent`, etc.). Never use hardcoded colors.

**Button Styling:** Navigation links (back links, quick links, empty state CTAs) use `btn-secondary` or `btn-primary` classes. Back links use `btn-secondary inline-flex items-center gap-1 text-sm`. Action buttons (Deposit, Withdraw, Vote, Cancel) already use `btn-*` classes.

## Frontend Routes

| Route | Page | Purpose |
|-------|------|---------|
| `/` | TasksPage | Marketplace task list with filters |
| `/vault` | VaultPage | Treasury deposits/redeems |
| `/governance` | GovernancePage | Proposal dashboard |
| `/governance/propose` | ProposalCreatePage | Create proposal form |
| `/governance/:id` | ProposalDetailPage | Vote on specific proposal |
| `/governance/my-votes` | MyVotesPage | Personal voting dashboard |
| `/delegates` | DelegatesPage | Delegate management |
| `/profile` | ProfilePage | User profile and reputation |
| `/help` | HelpPage | Documentation |

## Frontend Context Providers

```
WagmiProvider (wagmi config)
  └─ QueryClientProvider (react-query)
      └─ RainbowKitProvider (wallet UI)
          └─ ProfileProvider (useProfile)
              └─ PassportProvider (usePassport)
                  └─ PassportVerifyProvider (usePassportVerify)
                      └─ Router → Layout → Routes
```

## Frontend Constants

**`/constants/contracts.js`:**
- Contract addresses: TOKEN, TREASURY, MARKETPLACE, GOVERNANCE, VROSE, USDC
- `ProposalStatus` enum: Active(0), Passed(1), Failed(2), Executed(3), Cancelled(4)
- `calculateVotePower(stakedAmount, reputation)`: sqrt(staked) × (rep/100)
- `formatVotePower(vp)`: K notation for large numbers

**`/constants/passport.js`:**
- `PASSPORT_THRESHOLDS`: CREATE_TASK=20, STAKE=20, CLAIM_TASK=20, PROPOSE=25
- `PASSPORT_CONFIG`: API URL, cacheTTL=1h, timeout=10s
- `PASSPORT_LEVELS`: HIGH(30+), MEDIUM(20+), LOW(1+), NONE(0)

**`/constants/networks.js`:**
- `NETWORK_IDS`: ARBITRUM=42161, ARBITRUM_SEPOLIA=421614
- `DEFAULT_NETWORK`: Arbitrum Sepolia (testnet)

**`/constants/skills.js`:**
- 15 predefined skills in 6 categories (blockchain, frontend, backend, design, infrastructure, quality)
- `MAX_SKILLS`: 10 per profile
- Utilities: `getSkillById()`, `getSkillsByCategory()`, `validateSkills()`

**`/constants/gas.js`:**
- Default gas settings for transactions

## Frontend Hooks (Comprehensive)

**`useVaultData`** - Treasury data with auto-refresh
```javascript
Returns: {
  rosePrice,          // USD per ROSE (6 decimals)
  vaultValueUSD,      // Total RWA value
  breakdown,          // { btc, gold, usdc, rose } with values/percentages
  circulatingSupply,  // ROSE in circulation
  roseBalance,        // User's ROSE balance
  usdcBalance,        // User's USDC balance
  depositCooldown,    // Seconds until deposit allowed
  redeemCooldown,     // Seconds until redeem allowed
  isLoading, isError
}
// Refetch interval: 45 seconds
```

**`usePassport`** - Gitcoin Passport score with caching
```javascript
Returns: {
  score,              // Passport score (0-100+)
  loading, error,
  lastUpdated,        // When score was fetched
  isCached            // Using cached value
}
Methods: loadScore(forceRefresh), refetch(), meetsThreshold(threshold)
// Cache: 1-hour localStorage, whitelist fallback for testing
```

**`usePassportVerify`** - Backend signer communication
```javascript
Returns: { loading, error, lastSignature, lastAction }
Methods: {
  getSignature(action),    // Get ECDSA sig for action
  getSignerAddress(),      // Signer wallet address
  getThresholds(),         // Action thresholds
  getScore(),              // Current score from backend
  clearError()
}
```

**`useProfile`** - User profile with EIP-712 signing
```javascript
Returns: { profile, isLoading, error, isAuthenticated }
Methods: {
  updateProfile(data),     // Sign + save (currently disabled)
  getProfile(address),     // Fetch any user's profile
  refreshProfile()         // Refresh own profile
}
// Status: Display-only, edit pending backend integration
```

**`useReputation`** - On-chain reputation with event-based counts
```javascript
Returns: {
  reputation: {
    tasksAsWorker,         // Tasks completed as worker
    tasksAsStakeholder,    // Tasks validated
    tasksAsCustomer,       // Tasks created
    tasksClaimed,          // Tasks currently claimed
    totalEarned,           // Total ROSE earned
    reputationScore,       // 0-100% on-chain score
    canPropose, canVote, canDelegate,  // Eligibility flags
    governanceStats        // From RoseGovernance.userStats
  },
  loading
}
// Sources: RoseMarketplace events + RoseGovernance.getReputation()
// Cache: 5-minute in-memory
```

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

**Delegation API Endpoints:**
- `POST /api/delegation/vote-signature` - Get signed approval for delegated vote
- `GET /api/delegation/available-power/:delegate/:proposalId` - Get available delegated power
- `POST /api/delegation/claim-signature` - Get signed approval for claiming rewards
- `GET /api/delegation/claimable/:user` - Get claimable rewards (display only)
- `GET /api/delegation/signer` - Get delegation signer address

**Governance API Endpoints:**
- `GET /api/governance/vp/:address` - Get VP breakdown
  - Response: `{ stakedRose, votingPower, availableVP, delegatedOut, proposalVPLocked, activeProposal }`
- `GET /api/governance/total-vp` - Get total system voting power
  - Response: `{ totalVP: string }`
- `GET /api/governance/available/:address` - Get available VP (not delegated/locked)
  - Response: `{ availableVP: string }`
- `GET /api/governance/delegations/:address` - Get user's outgoing delegations
  - Response: `{ delegations: [{ delegate, vpAmount }] }`
- `GET /api/governance/received/:delegate` - Get VP delegated to user
  - Response: `{ delegators: [{ delegator, vpAmount }] }`
- `GET /api/governance/reputation/:address` - Get reputation score
  - Response: `{ address, reputation: number }`
- `POST /api/governance/vote-signature` - Get signed approval for direct vote
  - Request: `{ voter, proposalId, vpAmount, support }`
  - Response: `{ voter, proposalId, vpAmount, support, expiry, signature }`
- `POST /api/governance/refresh-vp` - Get signed VP refresh after reputation change
  - Request: `{ user, newRep }`
  - Response: `{ user, newRep, expiry, signature }`
- `GET /api/governance/signer` - Get governance signer address
  - Response: `{ signer: string }`

**Profile API Endpoints:**
- `POST /api/profile` - Create/update with EIP-712 signature
  - Request: `{ message: {...profileFields, timestamp}, signature }`
  - Response: `{ success: true, profile: ProfileData }`
  - Validates field lengths, skills array, signature, timestamp TTL (5 min)
- `GET /api/profile/:address` - Fetch single profile
  - Response: `ProfileData | null`
- `GET /api/profile?addresses=...` - Batch fetch (max 100)
  - Response: `{ profiles: Record<address, ProfileData | null> }`

**Treasury API Endpoints:**
- `GET /api/treasury/history` - NAV snapshot history with pagination
  - Query params: `limit`, `offset`, `startDate`, `endDate`, `interval` (raw/daily/weekly)
  - Response: `{ snapshots: [...], pagination: { total, limit, offset, hasMore } }`
- `GET /api/treasury/rebalances` - Rebalance event history
  - Query params: `limit`, `offset`
  - Response: `{ events: [...], pagination: { total, limit, offset, hasMore } }`
- `GET /api/treasury/stats` - Aggregated NAV statistics
  - Response: `{ current, change7d, change30d, allTimeHigh, allTimeLow }`

**Profile Database Schema (PostgreSQL):**
```sql
CREATE TABLE profiles (
  address VARCHAR(42) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  bio TEXT,
  avatar VARCHAR(200),
  skills TEXT[],              -- PostgreSQL array
  github VARCHAR(100),
  twitter VARCHAR(100),
  website VARCHAR(200),
  signature TEXT NOT NULL,    -- EIP-712 signature
  signed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);
```

**Key Files:**
- `src/routes/passport.ts` - Passport API endpoint handlers
- `src/routes/delegation.ts` - Delegation API endpoint handlers
- `src/routes/governance.ts` - Governance API endpoint handlers
- `src/routes/profile.ts` - Profile API endpoint handlers
- `src/routes/treasury.ts` - Treasury NAV history API endpoint handlers
- `src/services/signer.ts` - ECDSA signing with ethers.js
- `src/services/delegation.ts` - Delegation allocation computation, claim signature generation
- `src/services/governance.ts` - VP calculations, reputation queries
- `src/services/gitcoin.ts` - Gitcoin Passport API integration
- `src/services/profile.ts` - Profile CRUD with PostgreSQL
- `src/services/eip712.ts` - EIP-712 signature verification
- `src/services/whitelist.ts` - Test whitelist with hot-reload
- `src/services/treasury.ts` - Treasury rebalance operations
- `src/config.ts` - Environment configuration
- `src/db/pool.ts` - PostgreSQL connection pool

## Backend Services

**`signer.ts`:**
- `getSignerAddress()` - Returns wallet address from SIGNER_PRIVATE_KEY
- `signApproval(address, action, expiry)` - ECDSA signature for passport

**`gitcoin.ts`:**
- `getPassportScore(address)` - Fetch from Gitcoin API, returns 0 if not found
- Whitelist fallback for testing (hot-reloads from `src/config/whitelist.json`)

**`governance.ts`:**
- `getUserVP(address)` - Complete VP breakdown from contract
- `getTotalSystemVP()` - Total voting power across all users
- `getUserDelegations(address)` - Outgoing multi-delegations
- `getReceivedDelegations(delegate)` - Incoming delegations
- `getReputation(address)` - On-chain reputation score
- `calculateVotePower(amount, reputation)` - sqrt(amount) × (rep/100)

**`delegation.ts`:**
- `computeAllocations(delegate, proposalId, amount)` - Two-pass proportional allocation
  - Returns `{ allocations: [...], allocationsHash }` for contract verification
- `signDelegatedVote(...)` - Sign delegated vote approval
- `isProposalActive(proposalId)` - Check if voting open
- `getAvailableDelegatedPower(delegate, proposalId)` - Available VP per proposal
- `getClaimableRewards(user)` - Queries events for claimable voter rewards
- `signClaimApproval(user, claims, expiry)` - Sign batch reward claim

**`profile.ts`:**
- `createOrUpdateProfile(message, signature)` - Validate + UPSERT to PostgreSQL
- `getProfile(address)` - Single profile fetch
- `getProfiles(addresses)` - Batch fetch (max 100)

**`eip712.ts`:**
- `verifyProfileSignature(message, signature, chainIds)` - Multi-chain verification
- `isTimestampValid(timestamp)` - TTL check (5 min, 60s clock skew tolerance)

**`whitelist.ts`:**
- `getWhitelistedScore(address)` - Override score for testing
- Hot-reloads `whitelist.json` on file change

**`treasury.ts`:**
- `executeRebalance()` - Call contract `forceRebalance()`

**`nav.ts`:**
- `fetchNavSnapshot()` - Fetch current NAV data from treasury contract (getVaultBreakdown, getAllocationStatus, prices)
- `storeNavSnapshot(snapshot)` - Insert snapshot into nav_snapshots table
- `syncRebalanceEvents()` - Query and store new Rebalanced events since last sync
- `getNavHistory(options)` - Query historical snapshots with pagination, date filtering, interval aggregation
- `getRebalanceHistory(options)` - Query rebalance events with pagination
- `getNavStats()` - Get current price, 7d/30d changes, all-time high/low

## Backend Scheduled Jobs

**Monthly Treasury Rebalance** (`src/cron/rebalance.ts`)
- Schedule: `0 0 1 * *` (1st of month at 00:00 UTC)
- Calls: `treasury.forceRebalance()` via ethers.js
- Retry: Every 6 hours on failure (`0 */6 * * *`), max 10 attempts
- Logs transaction hash and gas used

**Daily NAV History Snapshot** (`src/cron/nav-history.ts`)
- Schedule: `0 0 * * *` (daily at midnight UTC, configurable via NAV_CRON_SCHEDULE)
- Captures: ROSE price, asset values (BTC/Gold/USDC/ROSE), allocations, Chainlink prices
- Stores: `nav_snapshots` table in PostgreSQL
- Event sync: Queries `Rebalanced` events since last sync, stores in `rebalance_events`
- Runs initial snapshot on startup (configurable via NAV_SNAPSHOT_ON_STARTUP)
- Tracks consecutive failures (max 5), handles stale oracle gracefully

## Signature Formats

All signatures use ECDSA with ethers.js, Ethereum signed message prefix:

| Type | Message Format |
|------|---------------|
| Passport | `keccak256(address, action, expiry)` |
| Direct Vote | `keccak256("vote", voter, proposalId, vpAmount, support, expiry)` |
| Delegated Vote | `keccak256("delegatedVote", delegate, proposalId, amount, support, allocationsHash, expiry)` |
| Voter Rewards | `keccak256("claimVoterRewards", user, encodedClaims, expiry)` |
| VP Refresh | `keccak256("refreshVP", user, newRep, expiry)` |
| Profile (EIP-712) | Domain-separated with chainId, typed struct |

## Backend Deployment

**Docker Compose** (`docker-compose.yml`):
- PostgreSQL 16 (alpine): Port 5432, healthcheck via pg_isready
- Node.js signer: Port 3000, healthcheck via wget /health
- Depends on postgres healthy, restart unless-stopped

**Akash Deployment** (`deploy.yaml`):
- Container: `ghcr.io/.../passport-signer:latest`
- Resources: 0.75 CPU, 1GB RAM, 5GB persistent storage
- Domain: signer.rose-token.com

**PostgreSQL Connection:**
- Pool: 2-10 connections, 30s idle timeout
- Retry: Exponential backoff, max 15 retries
- Migrations: Auto-applied on startup

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
VITE_GOVERNANCE_ADDRESS=0x...         # RoseGovernance contract address
VITE_VROSE_ADDRESS=0x...              # vROSE token address
VITE_PINATA_API_KEY=...
VITE_PINATA_SECRET_API_KEY=...
VITE_PINATA_JWT=...
VITE_PASSPORT_SIGNER_URL=https://...  # Backend signer API URL
```

**backend/signer/.env:**
```bash
# Server
PORT=3001
ALLOWED_ORIGINS=http://localhost:5173,https://yourapp.com

# Signing
SIGNER_PRIVATE_KEY=0x...           # Private key for signing

# Gitcoin Passport
VITE_GITCOIN_API_KEY=...           # Gitcoin Passport API key
VITE_GITCOIN_SCORER_ID=...         # Gitcoin Scorer ID

# Score Thresholds
THRESHOLD_CREATE_TASK=20           # Min score for createTask
THRESHOLD_STAKE=20                 # Min score for stake
THRESHOLD_CLAIM=20                 # Min score for claim
THRESHOLD_VOTE=20                  # Min score for voting
THRESHOLD_PROPOSE=25               # Min score for creating proposals
SIGNATURE_TTL=3600                 # Signature validity (seconds)

# Rate Limiting
RATE_LIMIT_WINDOW_MS=60000         # Rate limit window (ms)
RATE_LIMIT_MAX_REQUESTS=30         # Max requests per window

# Blockchain
GOVERNANCE_ADDRESS=0x...           # RoseGovernance contract address
TREASURY_ADDRESS=0x...             # RoseTreasury contract address
RPC_URL=...                        # Blockchain RPC endpoint

# PostgreSQL Database
DATABASE_URL=postgresql://user:pass@host:port/database
DB_POOL_MAX=10                     # Max connections
DB_POOL_MIN=2                      # Min connections
DB_CONNECTION_TIMEOUT_MS=15000     # Connection timeout
DB_MAX_RETRIES=15                  # Max retry attempts
DB_RETRY_INITIAL_DELAY_MS=2000     # Initial retry delay
DB_RETRY_MAX_DELAY_MS=60000        # Max retry delay

# Profile EIP-712
PROFILE_CHAIN_IDS=42161,421614     # Arbitrum mainnet + Sepolia
PROFILE_TIMESTAMP_TTL=300          # 5 minutes

# NAV History Cron
NAV_CRON_SCHEDULE=0 0 * * *        # Daily at midnight UTC (default)
NAV_SNAPSHOT_ON_STARTUP=true       # Run snapshot on server start (default)
```

## Token Decimals Reference

| Token | Decimals | Notes |
|-------|----------|-------|
| ROSE | 18 | Native token |
| vROSE | 18 | Governance receipt token |
| VP (Voting Power) | 9 | sqrt(ROSE) reduces 18→9 decimals |
| USDC | 6 | Standard stablecoin |
| WBTC | 8 | Wrapped Bitcoin |
| PAXG | 18 | Gold-backed token |
| Chainlink feeds | 8 | Price feed decimals |
| NAV prices | 6 | Normalized to USDC |

**Formatting helpers:**
- `formatUnits(value, 18)` for ROSE/vROSE/stakedRose
- `formatUnits(value, 9)` for VP values (votingPower, availableVP, delegatedOut, totalSystemVP)
- `formatUnits(value, 6)` for USDC/prices
- Treasury normalizes all values to 6 decimals for USD calculations

## Key Technical Details

- **Solidity version:** 0.8.20 (contracts use OpenZeppelin v5)
- **Chainlink contracts:** v1.5.0 (import path: `@chainlink/contracts/src/v0.8/shared/interfaces/`)
- **Optimizer:** enabled with 1 run + viaIR
- **Networks:** Arbitrum Sepolia testnet (chainId: 421614), Arbitrum One mainnet (chainId: 42161)
- **Frontend bundler:** Vite 7.x (not webpack/CRA)
- **Web3 stack:** wagmi + viem + RainbowKit (not ethers.js in frontend)
- **Backend stack:** Express.js + TypeScript + PostgreSQL + ethers.js

## Git Workflow

Always create feature branches, create PRs, and monitor CI before merging. Never push directly to main.

```bash
git checkout -b feature/description
git push -u origin feature/description
gh pr create --title "feat: ..." --body "..."
gh pr checks --watch  # Monitor CI
```