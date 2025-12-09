# CLAUDE.md

Guidance for Claude Code. ALWAYS ASK CLARIFYING QUESTIONS. ALWAYS UPDATE CLAUDE.MD AS YOUR LAST TODO STEP.

## Table of Contents
**Contracts:** [Overview](#project-overview) | [Architecture](#contract-architecture) | [Constants](#contract-constants) | [Errors](#contract-custom-errors) | [Treasury NAV](#treasury-nav-calculations) | [Security](#security-patterns)
**Governance:** [System](#governance-system)
**Tasks:** [Status Flow](#task-status-flow) | [Auction System](#auction-system)
**Frontend:** [Architecture](#frontend-architecture) | [Routes](#frontend-routes) | [Hooks](#frontend-hooks) | [Passport](#frontend-passport-system)
**Backend:** [API](#backend-api) | [Services](#backend-services) | [Cron](#backend-scheduled-jobs) | [Deployment](#backend-deployment)
**Infrastructure:** [Testing](#testing) | [Simulation](#simulation-script) | [CI/CD](#cicd-workflows) | [Env Vars](#environment-variables) | [Decimals](#token-decimals-reference) | [Mainnet Addresses](#arbitrum-one-mainnet-addresses) | [Git](#git-workflow)

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
| RoseMarketplace.sol | 572 | Task lifecycle, escrow, payments, passport verification |
| RoseTreasury.sol | ~700 | RWA-backed treasury (BTC/Gold/USDC via Chainlink + LiFi), configurable asset registry |
| RoseGovernance.sol | 1235 | Proposals, quadratic voting, multi-delegation, rewards, Phase 1 liquid democracy |
| RoseReputation.sol | 205 | User reputation tracking, monthly buckets, eligibility checks |
| vROSE.sol | 205 | Soulbound governance receipt token |
| mocks/*.sol | 560 | MockERC20, MockV3Aggregator, MockUniswapV3Router, MockMarketplace, MockLiFiDiamond |

**Deployment order:** RoseToken → vROSE → RoseTreasury → RoseMarketplace → RoseReputation → RoseGovernance

**Post-deployment config:**
1. `RoseToken.setAuthorized(treasury/marketplace/governance, true)`
2. `vROSE.setGovernance(governance)` + `setMarketplace(marketplace)`
3. `RoseReputation.setGovernance(governance)` - After governance deployed
4. `RoseMarketplace.setGovernance(governance)` + `setVRoseToken(vROSE)` + `setReputation(reputation)`
5. `RoseTreasury.setRebalancer(signerAddress)` - Required for backend-driven swaps
6. `RoseGovernance.setDelegationSigner(signerAddress)` - Required for delegated voting
7. `RoseTreasury.addAsset(...)` - Register initial assets (BTC, GOLD, STABLE, ROSE)

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
| Governance | Rewards | DAO 2%, Yay voters 2%, Proposer 1% | On completion |
| Reputation | COLD_START_TASKS | 10 | Tasks before full rep |
| Reputation | DEFAULT_REPUTATION | 60 | Cold start score |
| Reputation | PROPOSER_REP_THRESHOLD | 90 | Min rep to propose |
| Reputation | VOTER_REP_THRESHOLD | 70 | Min rep to vote |
| Reputation | DELEGATE_REP_THRESHOLD | 90 | Min rep to receive delegation |
| Reputation | BUCKET_DURATION | 30 days | Monthly bucket period |
| Reputation | DECAY_BUCKETS | 36 | 3 years monthly decay |

## Contract Custom Errors

| Contract | Error | Meaning |
|----------|-------|---------|
| RoseToken | NotAuthorized, NotOwner, ZeroAddress | Auth/validation |
| RoseToken | InsufficientBalance/Allowance | Token operations |
| Marketplace | InvalidSignature, SignatureExpired, SignatureAlreadyUsed | Passport |
| Marketplace | NotGovernance, InsufficientVRose | Permissions |
| Treasury | InvalidPrice, StaleOracle | Oracle issues |
| Treasury | InsufficientLiquidity, SlippageExceeded, LiFiSwapFailed | Swap failures |
| Treasury | InvalidAllocation, ZeroAmount, AssetNotFound, AssetNotActive | Validation |
| Treasury | RebalanceNotNeeded, RebalanceCooldown, CooldownNotElapsed | Cooldowns |
| Treasury | NotRebalancer, AssetAlreadyExists, CannotDeactivateRequired | Admin/asset |
| Treasury | UserHasPendingRedemption, RequestNotFound, RequestAlreadyFulfilled | Redemption queue (Phase 5) |
| Reputation | NotOwner, NotGovernance, NotMarketplace | Auth |
| Reputation | ZeroAddress, ZeroAddressSigner | Validation |
| Governance | IneligibleToPropose (<90% rep or <10 tasks) | Eligibility |
| Governance | IneligibleToVote (<70% rep), IneligibleToDelegate | Eligibility |
| Governance | DelegationChainNotAllowed | User is both delegator and delegate (max depth 1) |
| Governance | ProposalNotActive, CannotVoteOnOwnProposal | Voting |
| Governance | CannotChangeVoteDirection, VPLockedToAnotherProposal | VP allocation |
| Governance | InsufficientAvailableVP, MaxEditCyclesReached | Limits |
| Governance | StaleSignature | Nonce mismatch (Phase 1) |
| Governance | AllocationHashMismatch | Allocations don't match hash (Phase 1) |
| Governance | InsufficientGlobalDelegatedPower | Global VP budget exceeded (Phase 1) |
| Governance | ProposalStillActive | Cannot free VP while proposal active (Phase 1) |
| vROSE | OnlyMarketplaceTransfer/Approval, NotGovernance | Soulbound |

## Treasury NAV Calculations

**Formula:** `ROSE Price = HardAssetValueUSD / CirculatingSupply` (initial $1.00, then NAV-backed)

- **Hard Assets:** BTC + Gold + USDC value (excludes Treasury ROSE)
- **Circulating Supply:** totalSupply - balanceOf(treasury)
- **All values normalized to 6 decimals**

**Deposit:** USDC → Treasury → ROSE minted → Backend watches `Deposited` event → Diversifies via LiFi
**Redeem:** User approves ROSE → ROSE burned → USDC returned (requires USDC buffer)
**Rebalance:** >5% drift triggers (hard assets only), 7-day cooldown, rebalancer/owner can force

### LiFi Integration (Phase 3)

**Architecture:** Contract is "dumb" (safety rails only), backend is "smart" (routing decisions).

**Testnet Support:** LiFi API only supports mainnet chains. On Arbitrum Sepolia, the backend generates mock calldata for `MockLiFiDiamond.swapSimple()` instead of calling LiFi API. The mock does 1:1 swaps (adjusted for decimals), which is sufficient for testing. Detection via `isTestnet()` in `lifi.ts`.

**Key Changes:**
- `executeSwap(fromAsset, toAsset, amountIn, minAmountOut, lifiData)` - Backend-driven swaps via LiFi Diamond
- Deposits no longer auto-diversify - backend watches `Deposited` events and calls `executeSwap()`
- Redemptions require USDC buffer - no auto-liquidation, backend must ensure buffer via swaps
- Rebalancer role added - `onlyRebalancer` modifier for `executeSwap()` and `forceRebalance()`
- ROSE excluded from drift calculations (treasury doesn't hold ROSE)

**Asset Registry:**
```solidity
struct Asset {
    address token;
    address priceFeed;    // Chainlink (or ZeroAddress for USDC/ROSE)
    uint8 decimals;
    uint256 targetBps;    // Target allocation in basis points
    bool active;
}
mapping(bytes32 => Asset) public assets;  // e.g., encodeBytes32String("BTC") => Asset
```

**Functions:**
- `addAsset(key, token, priceFeed, decimals, targetBps)` - Register new asset
- `updateAssetAllocation(key, newTargetBps)` - Change target allocation
- `deactivateAsset(key)` / `reactivateAsset(key)` - Toggle asset (ROSE/STABLE cannot be deactivated)
- `getAllAssets()` - Returns all registered assets
- `setRebalancer(address)` - Set rebalancer wallet (usually same as signer)

### Rebalance Automation (Phase 4)

**Purpose:** Backend orchestrates multi-swap rebalances to keep vault allocations within 5% drift threshold.

**Rebalance Strategy:**
1. Calculate current vs target allocations for all hard assets (ROSE excluded)
2. Identify over-allocated assets (>5% above target) and under-allocated (<5% below target)
3. Sell over-allocated assets to USDC first (most liquid intermediate)
4. Buy under-allocated assets with USDC proceeds
5. Call `forceRebalance()` to update timestamp and emit event

**Backend Functions (`treasury.ts`):**
- `getAssetBreakdowns()` - Get all asset balances and USD values from contract
- `getVaultStatus()` - Full vault status including rebalance need
- `calculateRebalanceSwaps(assets)` - Calculate optimal swap sequence
- `executeRebalance()` - Execute multi-swap rebalance via LiFi
- `checkRebalanceNeeded()` - View-only check with planned swaps
- `getLastRebalanceInfo()` - Last rebalance time and cooldown status

**API Endpoints (Phase 4 Rebalance):**
- `GET /api/treasury/vault-status` - Full vault status with asset breakdowns
- `GET /api/treasury/rebalance/status` - Check if rebalance needed + planned swaps
- `GET /api/treasury/rebalance/last` - Last rebalance info
- `POST /api/treasury/rebalance/run` - Manually trigger rebalance (admin only in production)

**Cron Schedule:** 1st of month at 00:00 UTC. Retries every 6 hours on failure, max 10 attempts.

### Redemption Queue (Phase 5)

**Purpose:** Hybrid redemption: instant when USDC buffer sufficient, queued liquidation when depleted.

**Design Decisions:**
- NAV locked at request time (protects user from price changes during liquidation)
- ONE pending request per user (prevents queue flooding)
- No cancellation (guarantees fulfillment)
- FIFO processing order

**Contract Storage:**
```solidity
struct RedemptionRequest {
    address user;
    uint256 roseAmount;
    uint256 usdcOwed;      // Locked at request NAV
    uint256 requestedAt;
    bool fulfilled;
}

mapping(uint256 => RedemptionRequest) public redemptionRequests;
uint256 public nextRedemptionId;
mapping(address => uint256) public userPendingRedemptionId;
uint256 public totalPendingUsdcOwed;
```

**Contract Functions:**
- `requestRedemption(roseAmount)` - Create queued redemption, auto-fulfills if USDC available
- `fulfillRedemption(requestId)` - Rebalancer-only, fulfill single request
- `fulfillMultipleRedemptions(requestIds[])` - Batch fulfillment
- `getRedemptionRequest(requestId)` - View request details
- `getUserPendingRedemption(user)` - Get user's pending request ID (0 if none)
- `canRedeemInstantly(roseAmount)` - Check if instant redemption possible
- `emergencyRefundRedemption(requestId)` - Owner-only, refund ROSE instead of USDC

**Contract Events:**
- `RedemptionRequested(requestId, user, roseAmount, usdcOwed)` - When request created
- `RedemptionFulfilled(requestId, user, usdcAmount)` - When fulfilled (usdcAmount=0 for refund)

**Flow:**
1. User calls `requestRedemption()` → ROSE locked, request queued
2. If USDC buffer sufficient → instant fulfillment
3. If insufficient → backend liquidates assets via LiFi
4. Backend calls `fulfillRedemption()` → ROSE burned, USDC sent

**Frontend Integration:**
- `RedeemCard.jsx` checks availability via `/api/treasury/redeem-check`
- If instant: uses existing `redeem()` flow
- If queued: calls `requestRedemption()`, polls `/api/treasury/redemption/:id` for fulfillment
- Shows "Processing Redemption" UI with spinner while awaiting fulfillment

## Security Patterns

- **ReentrancyGuard:** All 5 core contracts (Marketplace, Treasury, Governance, Reputation, vROSE)
- **CEI Pattern:** State updated before external calls
- **SafeERC20:** All token transfers
- **Signature replay protection:** `usedSignatures` mapping
- **Oracle staleness:** 1-hour max, reverts if stale
- **Slippage protection:** Configurable `maxSlippageBps` (default 1%)
- **User cooldowns:** 24h between deposits/redeems (flash loan protection)

## Governance System

**Vote Power:** `VP = √(staked_ROSE) × reputation`

**Reputation (^0.6 sublinear):** `(successPoints - disputePoints) / successPoints × 100` where points = Σ(taskValue^0.6). Backend computes + signs attestation. Monthly buckets, 3-year decay. Stored in separate RoseReputation contract.

**Thresholds:** Pass 58.33%, Quorum 33%, Proposer 90% rep + 10 tasks, Voter 70% rep, Delegate 90% rep + 10 tasks

**Proposal lifecycle:** Active → [2 weeks voting] → Passed/Failed. Quorum not met resets timer. Max 4 edits. Passed → Execute → DAO Task Created.

**Two-token system:** ROSE locked in governance, vROSE as 1:1 receipt for stakeholder escrow. Withdrawal requires vROSE returned + ROSE unallocated.

**Max Depth 1 Liquid Democracy:** Delegators can delegate to delegates, but delegates cannot re-delegate. Enforced by `totalDelegatedIn/Out` checks.

### Phase 1: Liquid Democracy Enhancements

**Delegation Nonce:** `delegationNonce[delegate]` bumped on delegation/undelegation. Signatures include nonce to prevent stale signature attacks. If delegation state changes between signing and execution, signature is invalidated.

**Global VP Budget:** `delegatedUsedTotal[delegate]` tracks VP used across ALL active proposals. Prevents double-spend where delegate could theoretically use same VP on multiple proposals. Call `freeDelegatedVP(proposalId)` after proposal ends to release.

**On-Chain Allocations:** Per-delegator contributions stored in `delegatorVoteContribution[proposalId][delegate][delegator]`. Enables vote reduction on undelegation and DB-independent recovery.

**Vote Reduction on Undelegation:** `undelegateWithVoteReduction()` allows delegators to revoke delegation AND proportionally reduce their contribution from active votes. Backend computes reductions via `/api/delegation/undelegate-signature`.

**Delegated Voting (Updated):**
- Backend computes allocations + gets current nonce
- Delegate calls `castDelegatedVote(proposalId, amount, support, allocationsHash, allocations[], nonce, expiry, signature)`
- Contract verifies nonce matches, hash matches allocations, stores per-delegator contributions

**New Storage:**
```solidity
mapping(address => uint256) public delegationNonce;           // Bumped on delegation changes
mapping(address => uint256) public delegatedUsedTotal;        // Global VP budget
mapping(uint256 => mapping(address => mapping(address => uint256))) public delegatorVoteContribution;
```

**New Functions:**
- `freeDelegatedVP(proposalId)` - Release global VP after proposal ends (delegate calls)
- `freeDelegatedVPFor(proposalId, delegate, expiry, signature)` - Backend-triggered VP freeing for any delegate
- `undelegateWithVoteReduction(delegate, vpAmount, reductions[], expiry, signature)` - Undelegate with vote reduction
- `getGlobalAvailableDelegatedPower(delegate)` - View global available VP

### Phase 2: Backend Hardening

**Reconciliation Service:** Compares DB `delegation_allocations` with on-chain `allocationHashes` and `delegatorVoteContribution`. Auto-syncs discrepancies from chain.

**Claims Validation:** `getClaimableRewards()` now uses ON-CHAIN `delegatorVoteContribution` as source of truth instead of DB. Logs discrepancies but returns valid on-chain data.

**DB Cleanup on Undelegation:** `/api/delegation/confirm-undelegate` endpoint clears DB allocations after successful vote reduction. Frontend calls this after `undelegateWithVoteReduction` tx confirms.

**Reconciliation Cron:** Runs every 6 hours (configurable via `RECONCILIATION_CRON_SCHEDULE`). Auto-fixes POWER_MISMATCH discrepancies by syncing from chain.

**Discrepancy Types:**
- `MISSING_ON_CHAIN` - DB has record but no on-chain vote
- `POWER_MISMATCH` - Individual delegator power differs from on-chain `delegatorVoteContribution`
- `ORPHANED_DB_RECORD` - DB record exists but no on-chain vote

**Why No Hash Comparison:** On-chain `allocationHashes` is set in `castDelegatedVote` and never updated. After `undelegateWithVoteReduction`, the hash becomes stale (doesn't reflect reduced contributions). Reconciliation compares individual `delegatorVoteContribution` values which ARE updated during reductions.

**New Env Vars:**
- `RECONCILIATION_CRON_SCHEDULE` - Cron schedule (default: `0 */6 * * *`)
- `RECONCILIATION_ON_STARTUP` - Run on startup (default: true)

### Phase 3: Delegate Scoring

**Purpose:** Track delegate voting quality to help delegators choose effective representatives and optionally gate poor performers from casting delegated votes.

**Win/Loss Tracking:** When proposals are finalized (Passed/Failed/Executed), the system records whether each delegate who voted was on the winning side.

**Database Tables:**
- `delegate_scores` - Per-delegate voting statistics (total votes, winning votes, missed votes)
- `scored_proposals` - Tracks which proposals have been processed to prevent double-counting
- `proposal_blocks` - Caches discovered block ranges for efficient future queries

**Scoring Cron:** Runs every hour (configurable via `DELEGATE_SCORING_CRON_SCHEDULE`). Scans for finalized proposals and updates delegate scores. Also auto-frees delegated VP for all delegates on finalized proposals (configurable via `VP_FREEING_ENABLED`).

**Historical Backfill:** For proposals without stored block ranges, queries from `GOVERNANCE_DEPLOYMENT_BLOCK` (env var) to current block. Once events are found, the actual block range is cached in `proposal_blocks` for efficient future queries. Set `GOVERNANCE_DEPLOYMENT_BLOCK` to the governance contract's deployment block for optimal performance.

**Eligibility Gating:** When `DELEGATE_GATE_ON_SCORE=true`, delegates with:
- >= `DELEGATE_MIN_VOTES_FOR_WIN_RATE` votes (default: 5), AND
- < `DELEGATE_MIN_WIN_RATE` win rate (default: 40%)

...are blocked from requesting delegated vote signatures via `/api/delegation/vote-signature`.

**API Endpoints (Phase 3):**
- `GET /api/delegate-scoring/score/:delegate` - Get delegate's voting score
- `GET /api/delegate-scoring/eligibility/:delegate` - Check if delegate can cast votes
- `GET /api/delegate-scoring/leaderboard` - Ranked delegates by win rate
- `GET /api/delegate-scoring/stats` - Scoring system statistics
- `GET /api/delegate-scoring/last` - Last scoring cron result
- `POST /api/delegate-scoring/run` - Manually trigger scoring
- `POST /api/delegate-scoring/score-proposal/:id` - Score a specific proposal

**New Env Vars (Phase 3):**
- `DELEGATE_SCORING_ENABLED` - Enable scoring (default: true)
- `DELEGATE_SCORING_CRON_SCHEDULE` - Cron schedule (default: `0 * * * *`)
- `DELEGATE_SCORING_ON_STARTUP` - Run on startup (default: true)
- `DELEGATE_MIN_VOTES_FOR_WIN_RATE` - Min votes before win rate enforced (default: 5)
- `DELEGATE_MIN_WIN_RATE` - Min win rate threshold, 0-1 (default: 0.4)
- `DELEGATE_GATE_ON_SCORE` - Block low-performers from voting (default: false)
- `GOVERNANCE_DEPLOYMENT_BLOCK` - Block number where governance was deployed (default: 0, set for optimal backfill performance)
- `VP_FREEING_ENABLED` - Auto-free delegated VP after proposals finalize (default: true)

### Phase 4: Automatic VP Refresh

**Purpose:** Keep VP current when reputation changes due to task completions, disputes, or stakeholder activities. VP is calculated at deposit time (`VP = √(stakedRose) × reputation`) and becomes stale if reputation changes without manual refresh.

**Event Watcher:** Watches marketplace `ReputationChanged`, `PaymentReleased`, and `StakeholderFeeEarned` events. When reputation-affecting events occur, affected users are queued for VP check.

**Refresh Logic:**
1. When reputation-affecting event occurs, user is queued for check
2. After debounce period (default 30s), batch of users is processed
3. For each user: calculate expected VP using backend ^0.6 reputation formula, compare to current on-chain VP
4. If VP difference exceeds threshold, sign attestation and call `refreshVP(user, newRep, expiry, signature)`

**Note:** Only VP difference is checked, not reputation difference. The on-chain `getReputation()` uses a simplified formula that intentionally differs from the backend's ^0.6 sublinear formula.

**Debounce & Batching:** Multiple events for same user within debounce window are consolidated. Maximum batch size limits gas costs per processing cycle.

**Dry Run Mode:** Set `VP_REFRESH_EXECUTE=false` to log what would be refreshed without executing on-chain. By default, on-chain refreshes are enabled.

**Startup Catch-Up:** On startup, queries recent `ReputationChanged` events (configurable lookback) to catch up on any missed events during downtime.

**API Endpoints (Phase 4):**
- `GET /api/vp-refresh/stats` - Watcher statistics and pending users
- `GET /api/vp-refresh/pending` - List of users awaiting VP check
- `GET /api/vp-refresh/config` - Current configuration
- `POST /api/vp-refresh/check/:address` - Manually check and refresh specific user
- `POST /api/vp-refresh/process` - Force process all pending users immediately

**New Env Vars (Phase 4):**
- `VP_REFRESH_ENABLED` - Enable VP refresh watcher (default: true)
- `VP_REFRESH_MIN_DIFFERENCE` - Min VP difference in wei to trigger (default: 1e9 = 1 VP unit). Note: Only VP difference is used (not reputation) because on-chain `getReputation()` uses a different formula than backend.
- `VP_REFRESH_DEBOUNCE_MS` - Debounce time before processing (default: 30000)
- `VP_REFRESH_MAX_BATCH_SIZE` - Max users per processing batch (default: 10)
- `VP_REFRESH_EXECUTE` - Execute on-chain refreshes vs dry run (default: true)
- `VP_REFRESH_STARTUP_LOOKBACK` - Blocks to scan on startup (default: 1000)
- `MARKETPLACE_ADDRESS` - Marketplace contract address (from CI/CD artifact)

**Gas Considerations:** The signer wallet needs ETH for gas when `VP_REFRESH_EXECUTE=true`. Consider:
- Using low gas price settings
- Setting high thresholds to reduce refresh frequency
- Running in dry run mode to monitor before enabling execution

**Voter rewards:** Pooled at resolution, users claim via `claimVoterRewards()` with backend signature.

**Storage (RoseReputation):** `mapping(address => mapping(uint256 => uint256)) monthlySuccessValue/monthlyDisputeValue`

## Task Status Flow

```
StakeholderRequired → Open → InProgress → Completed → ApprovedPendingPayment → Closed
         ↓            ↓
         └────────────┴─→ cancelTask() → Closed (refunds)
```

**Role separation:** Customer ≠ Stakeholder ≠ Worker on same task.

## Auction System

**Purpose:** Reverse auction where customers post tasks with max budgets, workers submit competitive bids off-chain, and customers select winners. Only the final outcome goes on-chain.

### Design Decisions

| Decision | Choice |
|----------|--------|
| Stakeholder stake basis | 10% of MAX budget upfront, refunded excess when winner selected |
| Surplus refund timing | Customer refunded at task completion |
| Bid visibility | Real-time visible to customer only, blind to workers/stakeholders/public |
| Task type selection | Customer chooses fixed-price OR auction at creation time |

### Status Flow Comparison

**Fixed-Price (unchanged):**
```
StakeholderRequired → [stake 10%] → Open → [claim] → InProgress → ... → Closed
```

**Auction Mode:**
```
StakeholderRequired → [stake 10% of max] → Open (bids collected off-chain)
    → [selectWinner: refund excess stake] → InProgress → ... → Closed (refund surplus to customer)
```

**Auction Unclaim + Re-selection:**
```
InProgress → [worker unclaims] → Open (winningBid reset to 0)
    → [customer selects new winner] → InProgress → ...
```

When a worker unclaims an auction task:
- Contract: `unclaimTask` resets `winningBid = 0` for auction tasks (allows fresh re-selection)
- Backend: `signWinnerSelection` checks on-chain status; if Open but DB has `winner_address`, clears stale DB data
- Endpoint: `POST /api/auction/:taskId/sync` can manually sync auction state from chain

**RPC Sync Handling:** `concludeAuction` uses exponential backoff retry (7 attempts, max 127s) to handle RPC lag between frontend and backend nodes when verifying on-chain winner selection.

### Contract Functions

| Function | Purpose |
|----------|---------|
| `createAuctionTask(title, maxBudget, ipfsHash, expiry, signature)` | Create auction task (sets `isAuction=true`) |
| `selectAuctionWinner(taskId, worker, winningBid, expiry, signature)` | Customer selects winner, refunds excess stake to stakeholder |

### Contract Events

| Event | Parameters | When |
|-------|------------|------|
| `AuctionTaskCreated` | taskId, customer, maxBudget | After `createAuctionTask` |
| `AuctionWinnerSelected` | taskId, worker, winningBid, stakeholderRefund | After `selectAuctionWinner` |
| `SurplusRefunded` | taskId, customer, amount | At task completion (deposit - winningBid) |

### Contract Storage

Task struct extended with:
```solidity
bool isAuction;        // true = auction mode
uint256 winningBid;    // Final price (0 until winner selected)
```

### Payment Flow Example

**1000 ROSE max budget, 600 ROSE winning bid:**

| Stage | Action | Amount |
|-------|--------|--------|
| Create | Customer deposits | 1000 ROSE |
| Stake | Stakeholder locks 10% of max | 100 vROSE |
| Select Winner | Stakeholder refund (100 - 60) | 40 vROSE |
| Select Winner | Remaining stake | 60 vROSE |
| Finalize | Worker (95% of 600) | 570 ROSE |
| Finalize | Stakeholder (5% of 600) | 30 ROSE |
| Finalize | Stake returned | 60 vROSE |
| Finalize | DAO mint (2% of 600) | 12 ROSE |
| Finalize | Customer surplus (1000 - 600) | 400 ROSE |

### Frontend Components

| Component | Purpose |
|-----------|---------|
| `CreateTaskForm.jsx` | Dropdown for Fixed Price / Auction mode (default: Auction) |
| `BidSubmissionModal.jsx` | Workers submit/update bids with optional message |
| `BidSelectionModal.jsx` | Customers view bids sorted by amount, select winner |
| `TaskCard.jsx` | Shows bid count, "Place Bid" / "View Bids" buttons |

### Bid Visibility Rules

| Role | Can See |
|------|---------|
| Customer | All bids with worker addresses, amounts, messages |
| Worker | Own bid only |
| Stakeholder | Bid count only |
| Public | Bid count only |

### UI State Indicators

| Status | Display Text | Badge |
|--------|--------------|-------|
| Open auction | "Accepting Bids" | Bid count |
| After selection | Shows winning bid amount | Worker assigned |
| Lowest bid | Green "Lowest" badge | Savings % shown |

## Frontend Architecture

**Stack:** React 18 + Vite + Wagmi/RainbowKit + TailwindCSS

**Directories:**
- `pages/` - TasksPage, VaultPage, ProfilePage, HelpPage, GovernancePage, ProposalCreatePage, ProposalDetailPage, DelegatesPage, MyVotesPage
- `components/marketplace/` - TaskCard, TaskList, TaskFilters, CreateTaskForm, BidSubmissionModal, BidSelectionModal
- `components/vault/` - VaultStats, VaultAllocation, NavHistoryChart, DepositCard, RedeemCard
- `components/governance/` - StakingPanel, VotePanel, ClaimRewardsPanel, ProposalCard, DelegateCard, QuorumBar
- `hooks/` - useNotifications, useProfile, useVaultData, useNavHistory, usePassport, usePassportVerify, useGovernance, useProposals, useDelegation, useReputation, useAuction
- `contracts/` - Auto-generated ABIs (via update-abi)

**Dynamic Vault Display (Phase 5):**
- `VaultAllocation` uses dynamic assets from `getAllAssets()` contract call
- Supports arbitrary number of assets with auto-generated colors for unknown assets
- Shows target vs actual allocation percentages with drift indicators
- Highlights assets >5% off target with orange border
- "Rebalance Needed" badge when vault drift detected

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
| useVaultData | rosePrice, vaultValueUSD, breakdown, assets, needsRebalance, balances, cooldowns, pendingRedemptionId | auto-refresh 45s |
| usePassport | score, loading, error, lastUpdated, isCached | loadScore, refetch, meetsThreshold |
| usePassportVerify | loading, error, lastSignature | getSignature, getSignerAddress, getThresholds |
| useProfile | profile, isLoading, error, isAuthenticated | updateProfile (disabled), getProfile, refreshProfile |
| useReputation | tasks (worker/stakeholder/customer), totalEarned, reputationScore, canPropose/Vote/Delegate | 5-min cache |
| useGovernance | stakedRose, votingPower, availableVP, delegatedOut, vRoseBalance, totalSystemVP | deposit, withdraw, refetch |
| useProposals | proposals, userVotes, loading | createProposal, vote, voteCombined, freeVP, finalize, execute, cancel |
| useDelegation | delegations, receivedDelegations, availableDelegatedPower | delegateTo, undelegateFrom (auto-uses vote reduction if active votes), castDelegatedVote, claimAllRewards |
| useNavHistory | snapshots, pagination | refetch (default 3 years daily) |
| useAuction | error, actionLoading | registerAuction, submitBid, getBids, getBidCount, getMyBid, getAuctionInfo, selectWinner, confirmWinner |
| useAuctionTask | task, auctionInfo, bidCount, myBid, maxBudget, winningBid | refetch, refetchBid (auto-fetches on mount) |

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
| /api/delegation/vote-signature | POST | Delegated vote signature (Phase 1: includes nonce) |
| /api/delegation/confirm-vote | POST | Confirm vote on-chain, store allocations |
| /api/delegation/claim-signature | POST | Reward claim signature |
| /api/delegation/claimable/:user | GET | Claimable rewards |
| /api/delegation/undelegate-signature | POST | Phase 1: Vote reduction signature for undelegation |
| /api/delegation/global-power/:delegate | GET | Phase 1: Global available VP + nonce |
| /api/delegation/confirm-undelegate | POST | Phase 2: Clear DB allocations after vote reduction |
| /api/reconciliation/status | GET | Phase 2: Reconciliation status + last result |
| /api/reconciliation/last | GET | Phase 2: Full last reconciliation result |
| /api/reconciliation/run | POST | Phase 2: Trigger manual reconciliation |
| /api/reconciliation/proposal/:id | GET | Phase 2: Reconcile specific proposal |
| /api/reconciliation/sync | POST | Phase 2: Sync allocations from chain |
| /api/reconciliation/stats | GET | Phase 2: DB allocation statistics |
| /api/profile | POST | Create/update (EIP-712) |
| /api/profile/:address | GET | Fetch profile |
| /api/treasury/history | GET | NAV snapshots |
| /api/treasury/rebalances | GET | Rebalance events |
| /api/treasury/stats | GET | NAV statistics |
| /api/treasury/vault-status | GET | Phase 4: Full vault status with asset breakdowns |
| /api/treasury/rebalance/status | GET | Phase 4: Check if rebalance needed + planned swaps |
| /api/treasury/rebalance/last | GET | Phase 4: Last rebalance info |
| /api/treasury/rebalance/run | POST | Phase 4: Manually trigger rebalance |
| /api/vp-refresh/stats | GET | Phase 4: VP refresh watcher statistics |
| /api/vp-refresh/pending | GET | Phase 4: Users pending VP check |
| /api/vp-refresh/config | GET | Phase 4: VP refresh configuration |
| /api/vp-refresh/check/:address | POST | Phase 4: Manually check and refresh user VP |
| /api/vp-refresh/process | POST | Phase 4: Force process all pending users |
| /api/treasury/redeem-check | GET | Phase 5: Check instant redemption availability |
| /api/treasury/redemption/:id | GET | Phase 5: Get redemption request status |
| /api/treasury/user-pending/:address | GET | Phase 5: Get user's pending redemption |
| /api/treasury/pending-redemptions | GET | Phase 5: Admin view of all pending redemptions |
| /api/treasury/redemption-watcher/stats | GET | Phase 5: Redemption watcher statistics |
| /api/treasury/redemption-watcher/process | POST | Phase 5: Force process pending redemptions |
| /api/auction/register | POST | Register auction task after on-chain creation |
| /api/auction/bid | POST | Submit/update bid (requires worker signature) |
| /api/auction/:taskId/bids | GET | Get all bids for auction (customer only) |
| /api/auction/:taskId/count | GET | Get bid count (public) |
| /api/auction/:taskId/my-bid/:worker | GET | Get worker's own bid |
| /api/auction/:taskId | GET | Get auction task info (public) |
| /api/auction/:taskId/exists | GET | Check if auction exists |
| /api/auction/select-winner | POST | Get signature for on-chain winner selection |
| /api/auction/confirm-winner | POST | Confirm winner after on-chain tx |
| /api/auction/:taskId/sync | POST | Sync auction state from chain (clears stale winner after unclaim) |

## Backend Services

| Service | Functions |
|---------|-----------|
| signer.ts | getSignerAddress, signApproval |
| gitcoin.ts | getPassportScore (whitelist fallback) |
| governance.ts | getUserVP, getTotalSystemVP, getUserDelegations, getReceivedDelegations, getReputationNew, signReputationAttestation, calculateVotePower |
| delegation.ts | computeAllocations, signDelegatedVote, verifyAndStoreAllocations, getAvailableDelegatedPower, getClaimableRewards, signClaimApproval, getDelegationNonce, getGlobalAvailableDelegatedPower, computeVoteReductions, signUndelegateWithReduction, getDelegatesWithPendingVP, signFreeDelegatedVPFor (Phase 1) |
| reconciliation.ts | runReconciliation, reconcileProposal, syncAllocationsFromChain, clearDelegatorAllocations, validateDelegatorClaimPower, getReconciliationStats (Phase 2) |
| delegateScoring.ts | getDelegateScore, getAllDelegateScores, validateDelegateEligibility, scoreProposal, scoreAllUnscoredProposals, getScoringStats, freeVPForProposal, freeAllPendingVP (Phase 3) |
| vpRefresh.ts | startVPRefreshWatcher, stopVPRefreshWatcher, getVPRefreshStats, checkAndRefreshUser, forceProcessPending, getPendingUsers (Phase 4) |
| lifi.ts | isTestnet, getSwapQuote, applySlippage, calculateDiversificationSwaps, executeDiversificationSwap, getAssetTokenAddress, getTargetAllocations (Phase 3 Treasury LiFi) |
| depositWatcher.ts | startDepositWatcher, stopDepositWatcher, getDepositWatcherStats, forceProcessPending, getPendingDeposits (Phase 3 Treasury LiFi) |
| redemptionWatcher.ts | startRedemptionWatcher, stopRedemptionWatcher, getRedemptionWatcherStats, forceProcessPending, getPendingRedemptions, calculateLiquidationSwaps, processPendingRedemptions (Phase 5) |
| auction.ts | registerAuctionTask, submitBid, getBidsForTask, getBidCount, getWorkerBid, signWinnerSelection, concludeAuction, auctionExists, getAuctionTask, syncAuctionFromChain |
| profile.ts | createOrUpdateProfile, getProfile, getProfiles |
| eip712.ts | verifyProfileSignature, isTimestampValid |
| nav.ts | fetchNavSnapshot, storeNavSnapshot, syncRebalanceEvents, getNavHistory, getNavStats |
| treasury.ts | executeRebalance, getAssetBreakdowns, getVaultStatus, calculateRebalanceSwaps, checkRebalanceNeeded, getLastRebalanceInfo (Phase 4 Treasury LiFi Rebalance) |

## Backend Scheduled Jobs

| Job | Schedule | Purpose |
|-----|----------|---------|
| Rebalance | 1st of month 00:00 UTC | Multi-swap rebalance via LiFi: calculate drifted assets, execute swaps, call forceRebalance(), retry 6h on failure (Phase 4) |
| NAV Snapshot | Daily 00:00 UTC | Capture prices/allocations, sync Rebalanced events |
| Reconciliation | Every 6 hours | Compare DB allocations with on-chain, auto-sync discrepancies (Phase 2) |
| Delegate Scoring | Every hour | Score finalized proposals, update delegate win/loss records, auto-free delegated VP (Phase 3) |
| VP Refresh Watcher | Event-driven | Watch ReputationChanged events, auto-refresh VP when reputation changes (Phase 4) |
| Deposit Watcher | Event-driven | Watch Deposited events, diversify via LiFi (Phase 3 Treasury LiFi) |
| Redemption Watcher | Event-driven | Watch RedemptionRequested events, liquidate assets via LiFi, fulfill redemptions (Phase 5) |

## Backend Deployment

**Docker Compose:** PostgreSQL 16 (5432) + Node.js signer (3000)
**Akash:** 0.75 CPU, 1GB RAM, signer.rose-token.com
**PostgreSQL:** 2-10 connections, 30s idle, exponential retry

**Database tables:**
- `profiles` - User profile data with EIP-712 signatures
- `nav_history` - Daily NAV snapshots for treasury
- `delegation_allocations` - Per-delegator VP allocations for proposals (cached for incremental votes + claims)
- `delegate_scores` - Per-delegate voting statistics (Phase 3)
- `scored_proposals` - Tracks which proposals have been scored (Phase 3)
- `proposal_blocks` - Cached block ranges for efficient event queries (Phase 3)
- `auction_tasks` - Auction task registry with max_budget, winner, bid_count
- `auction_bids` - Off-chain bids per worker per task (UNIQUE task_id, worker_address)

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

**Mocks:** MockV3Aggregator (Chainlink), MockLiFiDiamond (swap aggregator), MockERC20
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
| backend/.env | PORT, ALLOWED_ORIGINS, SIGNER_PRIVATE_KEY, VITE_GITCOIN_API_KEY/SCORER_ID, THRESHOLD_*, GOVERNANCE/TREASURY_ADDRESS, RPC_URL, DATABASE_URL, DB_POOL_*, NAV_CRON_SCHEDULE, RECONCILIATION_CRON_SCHEDULE, RECONCILIATION_ON_STARTUP, DELEGATE_SCORING_*, DELEGATE_MIN_*, DELEGATE_GATE_ON_SCORE, DEPOSIT_WATCHER_*, REDEMPTION_WATCHER_* |

**Deposit Watcher Env Vars (Phase 3 Treasury LiFi):**
- `DEPOSIT_WATCHER_ENABLED` - Enable deposit watching (default: true)
- `DEPOSIT_WATCHER_DEBOUNCE_MS` - Debounce time in ms (default: 30000)
- `DEPOSIT_WATCHER_EXECUTE` - Execute swaps vs dry run (default: true when enabled)
- `DEPOSIT_WATCHER_SLIPPAGE_BPS` - Slippage tolerance (default: 100 = 1%)
- `DEPOSIT_WATCHER_STARTUP_LOOKBACK` - Blocks to look back on startup (default: 0)

**Redemption Watcher Env Vars (Phase 5):**
- `REDEMPTION_WATCHER_ENABLED` - Enable redemption watching (default: true)
- `REDEMPTION_WATCHER_DEBOUNCE_MS` - Debounce time before processing (default: 15000)
- `REDEMPTION_WATCHER_EXECUTE` - Execute liquidation swaps vs dry run (default: true)
- `REDEMPTION_WATCHER_SLIPPAGE_BPS` - Slippage tolerance for liquidations (default: 150 = 1.5%)
- `REDEMPTION_WATCHER_STARTUP_LOOKBACK` - Blocks to scan for pending on startup (default: 100)

## Token Decimals Reference

| Token | Decimals | Format Helper |
|-------|----------|---------------|
| ROSE/vROSE/stakedRose | 18 | formatUnits(value, 18) |
| VP (votingPower, availableVP, delegatedOut) | 9 | formatUnits(value, 9) |
| USDC/NAV prices | 6 | formatUnits(value, 6) |
| TBTC | 8 | - |
| XAUt (Tether Gold) | 6 | - |
| Chainlink feeds | 8 | - |

## Key Technical Details

- **Solidity:** 0.8.20, OpenZeppelin v5, Chainlink v1.5.0
- **Optimizer:** 1 run + viaIR
- **Networks:** Arbitrum Sepolia (421614), Arbitrum One (42161)
- **Frontend:** Vite 7.x, wagmi + viem + RainbowKit
- **Backend:** Express.js + TypeScript + PostgreSQL + ethers.js

## Arbitrum One Mainnet Addresses

| Asset | Address | Notes |
|-------|---------|-------|
| USDC | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` | Native USDC on Arbitrum |
| TBTC | `0x6c84a8f1c29108F47a79964b5Fe888D4f4D0de40` | Threshold BTC |
| XAUt | `0x40461291347e1ecbb09499f3371d3f17f10d7159` | Tether Gold |
| BTC/USD Feed | `0x6ce185860a4963106506C203335A2910D6ce18586` | Chainlink |
| XAU/USD Feed | `0x1F954Dc24a49708C26E0C1777f16750B5C6d5a2c` | Chainlink |
| LiFi Diamond | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` | DEX Aggregator |

**Testnet:** All addresses are mocked via `MockERC20`, `MockV3Aggregator`, and `MockLiFiDiamond`.

## Git Workflow

```bash
git checkout -b feature/description
git push -u origin feature/description
gh pr create --title "feat: ..." --body "..."
gh pr checks --watch
```

Never push directly to main.
