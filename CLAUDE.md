# CLAUDE.md

Guidance for Claude Code. ALWAYS ASK CLARIFYING QUESTIONS. ALWAYS UPDATE CLAUDE.MD AS YOUR LAST TODO STEP.

## Quick Reference
| Contracts | `npm run compile && npm test && npm run update-abi` |
|-----------|-----------------------------------------------------|
| Frontend | `cd frontend && npm run dev` |
| Deploy | `npm run deploy:arbitrumSepolia` / `deploy:arbitrum` |
| Simulate | `npx hardhat run scripts/simulate.js --network arbitrumSepolia` |

---

## Project Overview

Web3 marketplace with task-value-based token distribution.

**Tokenomics:** Customer deposits ROSE → Stakeholder stakes 10% → On completion: Worker 95%, Stakeholder 5% + stake, DAO mints 2%.

**Auction Spread:** For auctions, customer sees midpoint price: `(maxBudget + workerBid) / 2`. Spread goes to treasury. Example: ask=100, bid=80 → customer pays 90, treasury gets 10, worker gets 80.

## Contract Architecture

| Contract | Purpose |
|----------|---------|
| RoseToken | ERC20 authorized mint/burn |
| RoseMarketplace | Task lifecycle, escrow, payments, passport verification |
| RoseTreasury | RWA-backed (BTC/Gold/USDC via Chainlink+LiFi), configurable asset registry, redemption queue, passport verification |
| RoseGovernance | Proposals, quadratic voting, delegation, rewards |
| RoseReputation | Monthly buckets, 3yr decay, eligibility checks |
| vROSE | Soulbound governance receipt |

**Deploy order:** Token → vROSE → Treasury → Marketplace → Reputation → Governance

**Post-deploy:** `setAuthorized`, `setGovernance`, `setMarketplace`, `setVRoseToken`, `setReputation`, `setRebalancer`, `setDelegationSigner`, `setPassportSigner` (Treasury), `addAsset(BTC,GOLD,STABLE,ROSE)`

## Constants

| Area | Constant | Value |
|------|----------|-------|
| Payment | Worker/Stakeholder/DAO | 95%/5%/2% mint |
| Treasury | Drift/Oracle | disabled/1h stale |
| Treasury | Allocations | BTC=30%, Gold=30%, USDC=20%, ROSE=20% |
| Governance | Vote/Quorum/Pass | 2wk/33%/58.33% |
| Reputation | Propose/Vote/Delegate | 90%+10tasks/70%/90%+10tasks |
| Reputation | Bucket/Decay | 30d/36 buckets (3yr) |

## Treasury NAV

**Formula:** `ROSE Price = HardAssetsUSD / CirculatingSupply` (BTC+Gold+USDC, excludes treasury ROSE)

**Flows:**
- **Deposit:** Passport signature required (action: "deposit") → USDC → Treasury → ROSE minted → Backend diversifies via LiFi (smart rebalancing)
- **Redeem:** Passport signature required (action: "redeem") → Instant if buffer sufficient, else queued → Backend liquidates → `fulfillRedemption()`
- **Rebalance:** No drift threshold or cooldown. `rebalance()` is owner-only; `forceRebalance()` is rebalancer-only. Backend `/api/treasury/rebalance/run` requires signed message authentication.

**Same-Block Protection:** Users cannot redeem in the same block as a deposit (prevents flash loan attacks). No time-based cooldowns - deposits and redemptions are otherwise unrestricted. Contract tracks `lastDepositBlock[user]` and checks `block.number > lastDepositBlock[user]` before allowing redemption. View function: `canRedeemAfterDeposit(address)`.

**Smart Diversification** (deposit watcher):
1. Phase 1: Fill USDC buffer deficit first (critical for redemption liquidity)
2. Phase 2: Fill BTC/GOLD deficits proportionally
3. Phase 3: Any remaining excess → RWA by target ratio
- Does NOT buy ROSE (handled by monthly rebalance buybacks)
- First deposit uses simple 50/50 BTC/GOLD ratio split

**Redemption Queue:** NAV locked at request, 1 pending/user, no cancel, FIFO. Events: `RedemptionRequested`, `RedemptionFulfilled`

**Redemption Liquidation** (redemption watcher):
1. Calculates shortfall including 20% USDC target buffer post-redemption
2. Adds 0.1% rounding buffer to cover integer division losses in swaps
3. Uses ceiling division for token amounts to ensure sufficient USDC
4. Never sells ROSE - only liquidates BTC/GOLD using **waterfall algorithm**:
   - Goal: Bring all sellable RWA assets to equal USD values after liquidation
   - Sells from highest-value asset first until it matches the next
   - Once assets equalize, splits remaining shortfall equally among them
   - Example: BTC=$150k, GOLD=$50k, need $150k → sell $125k BTC, $25k GOLD → both end at $25k

## Governance System (Two-Track)

**VP:** `√(stakedRose) × reputation` where reputation = `(success-dispute)/success×100` using ^0.6 sublinear points

**Two Tracks:**
| Track | Duration | Quorum | VP Model | Treasury Limit |
|-------|----------|--------|----------|----------------|
| Fast | 3 days | 10% | Abundant (vote full VP on multiple proposals) | ≤1% of treasury |
| Slow | 14 days | 25% | Scarce (VP is budget across proposals) | Any amount |

**Fast Track Flow:**
1. Proposal created (status: Pending)
2. Backend computes VP snapshot after `snapshotDelay` (1 day)
3. Backend submits merkle root via `setVPMerkleRoot()`
4. Proposal activates, voting begins
5. Users vote with merkle proof of their VP
6. Voting ends → Backend auto-calls `finalizeProposal()` → Pass/Fail

**Slow Track Flow:**
1. Proposal created (status: Active, voting starts immediately)
2. Users request attestation of available VP from backend
3. Backend tracks allocations across proposals
4. Users vote with backend-signed attestation
5. Voting ends → Backend computes VP snapshot at deadline
6. Backend calls `finalizeSlowProposal(merkleRoot, totalVP, sig)` → Pass/Fail

**Off-Chain Delegation:** EIP-712 signed delegations stored in DB. Delegates must opt-in via `setDelegateOptIn(true)`. Delegations have `vpAmount` (0 = full delegation), `nonce` (sequential per delegator for replay protection), `expiry` (auto-expire), and `signature`. Revocation requires signed authorization. Reflected in VP snapshots via `vpSnapshot.getActiveDelegations()`.

**Lifecycle:** Active → voting period → Passed/Failed. Quorum miss extends (max 3). Max 4 edits. Rewards: DAO 2%, Yay voters 2%, Proposer 1%.

**Two-token:** ROSE locked in governance, vROSE as 1:1 receipt for stakeholder escrow.

## Task Status Flow

```
StakeholderRequired → Open → InProgress → Completed → ApprovedPendingPayment → Closed
        ↓               ↓           ↓           ↓
        │               │           │           └─→ disputeTaskAsWorker() → Disputed
        │               │           └─→ disputeTaskAsCustomer() → Disputed
        │               └─→ unstakeStakeholder() → StakeholderRequired (stakeholder exits, task remains)
        └───────────────┴─→ cancelTask() → Closed (refunds both parties)

Disputed → resolveDispute(workerPct) → Closed (split payment, no DAO mint)
```

**Unstake:** Stakeholders can exit tasks in `Open` status via `unstakeStakeholder()`. Returns vROSE to stakeholder, task reverts to `StakeholderRequired` for another stakeholder to step in.

**Dispute Resolution:**
- Customer can dispute `InProgress` tasks via `disputeTaskAsCustomer(taskId, reasonHash)`
- Worker can dispute `Completed` tasks via `disputeTaskAsWorker(taskId, reasonHash)`
- Owner resolves via `resolveDispute(taskId, workerPct)` where `workerPct` is 0-100
- Resolution: worker gets `workerPct%` of deposit, customer gets rest, stakeholder gets vROSE back
- NO DAO mint for disputed tasks
- Reason stored as IPFS hash on-chain

**Auction Mode:** Bids off-chain, customer sees midpoint as "bid". `selectAuctionWinner` uses actual worker bid. On completion: spread (midpoint - bid) → treasury, reduced surplus (deposit - midpoint) → customer.

**GitHub Integration:** On-chain `githubIntegration` bool in Task struct controls PR URL requirement. When `true`, `markTaskCompleted()` requires non-empty PR URL; when `false`, empty string allowed. Set at task creation via `createTask(..., githubIntegration, ...)` and `createAuctionTask()`. DAO tasks default to `true`. Frontend's TaskCard skips PR URL modal when `githubIntegration=false`.

## Security Patterns

ReentrancyGuard (all 5 contracts), CEI pattern, SafeERC20, `usedSignatures` replay protection, 1h oracle staleness, 1% default slippage, same-block deposit/redeem protection (prevents flash loan attacks).

## Frontend

**Stack:** React 18 + Vite + Wagmi/RainbowKit + TailwindCSS

**Routes:** `/` Task Table, `/create-task` Create Task, `/task/:id` Task Detail, `/vault` Treasury, `/governance` Proposals, `/governance/:id` Vote, `/delegates` Delegation, `/profile` User, `/admin` Admin (owner-only), `/admin/disputes` Dispute Resolution (owner-only), `/admin/analytics` Analytics Dashboard (owner-only)

**Key Hooks:** useTasks (single task + action handlers), useTasksAPI (paginated task list from backend API, scales to 1000+ tasks), useTaskSkills (IPFS skill fetching + matching), useVaultData (45s refresh, includes `isPaused`), useGovernance (staking/VP), useProposals, useDelegation, useAuction, useReputation (5m cache), useIsAdmin (Treasury owner check), useRebalance (trigger rebalance), useDispute (dispute actions + admin queries), useBackup (database backup/restore), usePause (pause/unpause Treasury), useTruncateDatabase (truncate all database tables), useIPFSImage (fetches private IPFS images with JWT auth, returns blob URLs - MUST be called before any conditional returns per React Rules of Hooks; never use `getGatewayUrl()` directly for images as browser `<img>` cannot include auth headers), useAnalytics (60s poll, overview/daily/marketplace/governance/treasury/users endpoints)

**Task Table Pagination:** The task table uses backend pagination via `/api/tasks` endpoint (20 items per page). Data is sourced from `analytics_tasks` table, which is event-synced by analyticsWatcher. This scales to 100k+ tasks. Single task detail pages still use direct contract reads for authoritative data.

**Task Table Filtering:** By default, the task table hides `Closed` and `Disputed` tasks. Users must explicitly select these statuses in the filter dropdown to view them.

**Task Skills Matching:** Tasks can have optional required skills (stored in IPFS). When creating a task, users can select up to 10 skills from the predefined list. In the task table, a gold star icon appears before tasks where the user's profile skills overlap with the task's required skills. The "Skills Match" filter checkbox shows only matching tasks (disabled if user has no profile skills). Skills data is fetched progressively from IPFS with 5-minute caching via `useTaskSkills` hook. On the task detail page (`/task/:id`), required skills are displayed prominently via auto-fetch from IPFS.

**Admin Page:** Only visible/accessible to Treasury contract owner (read via `Treasury.owner()`). Non-owners silently redirected to `/`. Features: System Status card (pause/unpause Treasury with two-step confirmation), manual treasury rebalance trigger, database backup/restore, whitelist management, database truncation (danger zone with mandatory backup).

**Pause System:** Treasury contract inherits OpenZeppelin Pausable. When paused, deposits, redemptions, rebalancing, and swaps are disabled. Admin can pause/unpause via System Status card (two-step confirmation). Vault page shows warning banner when paused. DepositCard/RedeemCard disable operations when paused.

**Vault Copy:** User-facing terminology differs from contract functions: "Exchange ROSE" (UI) maps to `redeem()`/`requestRedemption()` (contract). Vault page displays beta banner, NAV tooltip on price, and uses neutral language (no "guaranteed", "backed", "always"). Header: "Diversified On-chain Assets, Transparent Holdings".

**Passport:** `usePassport` (Gitcoin 1h cache), `usePassportVerify` (backend). Thresholds: CREATE=20, STAKE=20, CLAIM=20, PROPOSE=25, DEPOSIT=20, REDEEM=20

**Site-Wide Gate:** `ProtectedRoutes` component gates entire app with Passport score >= 20 check. Flow: Connect wallet → Verify passport → Access site. `/help` route bypasses gate. Whitelisted addresses bypass automatically via `usePassport`. Strict blocking (no graceful degradation) for sybil protection.

**UI Components:** Reusable components in `frontend/src/components/ui/`. Use `<Spinner />` for all loading states (default h-4 w-4, customize via className prop).

**Transaction History:** `TransactionHistory.jsx` fetches deposit/redemption events directly from blockchain (7-day lookback). Shows `Deposit` and `Exchange` labels in UI (mapping to `Deposited`/`Redeemed`/`RedemptionFulfilled` events). Real-time updates via event watchers.

## Backend API (`backend/signer/`)

| Category | Endpoints |
|----------|-----------|
| Passport | `/api/passport/verify`, `/score/:addr`, `/signer` |
| Governance | `/api/governance/vp/:addr`, `/vp/available/:addr` (Slow Track alias), `/vp/attestation` (POST, Slow Track alias), `/proposals/:id/proof/:addr` (Fast Track merkle proof), `/total-vp`, `/delegations/:addr`, `/received/:delegate`, `/reputation-signed/:addr`, `/vote-signature` |
| Delegation | `/api/delegation/vote-signature`, `/confirm-vote`, `/claim-signature`, `/claimable/:user`, `/undelegate-signature`, `/global-power/:delegate`, `/confirm-undelegate` |
| Delegation V2 | `/api/delegation/v2/store` (POST), `/v2/user/:addr`, `/v2/received/:delegate`, `/v2/revoke` (POST, signed), `/v2/nonce/:addr`, `/v2/opt-in/:addr`, `/v2/stats`, `/v2/eip712-config/:chainId`, `/v2/delegates` (eligible delegates list) (Off-chain EIP-712 delegations) |
| Delegate Scoring | `/api/delegate-scoring/score/:delegate`, `/eligibility/:delegate`, `/leaderboard`, `/stats`, `/run` |
| VP Refresh | `/api/vp-refresh/stats`, `/pending`, `/config`, `/check/:addr`, `/process` |
| Treasury | `/api/treasury/history`, `/rebalances`, `/stats`, `/vault-status`, `/rebalance/status`, `/rebalance/run`, `/rebalance/trigger`, `/redeem-check`, `/redemption/:id`, `/user-pending/:addr`, `/pending-redemptions`, `/redemption-watcher/*` |
| Auction | `/api/auction/register`, `/bid`, `/:taskId/bids`, `/:taskId/count`, `/:taskId/my-bid/:worker`, `/:taskId`, `/select-winner`, `/confirm-winner`, `/:taskId/sync` |
| Profile | `/api/profile` POST, `/api/profile/:addr` GET |
| Whitelist | `/api/whitelist` GET/POST, `/api/whitelist/:address` GET/DELETE (owner-only mutations) |
| Dispute | `/api/dispute/list`, `/api/dispute/stats`, `/api/dispute/:taskId` (admin queries, on-chain events synced to DB) |
| Backup | `/api/backup/create`, `/status`, `/restore` (owner-only, pg_dump → Pinata Hot Swaps) |
| Database | `/api/database/tables` (GET), `/truncate` (POST, owner-only, creates backup then truncates all tables except schema_migrations) |
| Slow Track | `/api/slow-track/attestation` (POST), `/allocations/:addr`, `/available/:addr`, `/stats` (Slow Track VP allocation) |
| Analytics | `/api/analytics/overview`, `/marketplace`, `/governance`, `/treasury`, `/users`, `/daily?days=30` (system-wide metrics, admin-only) |
| Tasks | `/api/tasks` GET (paginated list: page, limit, status, myTasks, isAuction, sortBy, sortOrder), `/api/tasks/counts` GET, `/api/tasks/:taskId` GET |

## Backend Services

| Service | Purpose |
|---------|---------|
| wsProvider.ts | Shared WebSocket provider for all event watchers with auto-reconnection |
| governance.ts | VP queries (from `stakers`/`delegations` tables), reputation attestation |
| delegation.ts | Allocations, delegated votes, claims, vote reductions |
| delegationV2.ts | Off-chain EIP-712 signed delegations, store/query/revoke delegations, opt-in verification |
| delegateScoring.ts | Win/loss tracking, eligibility gating |
| vpRefresh.ts | Auto-refresh VP in database on reputation changes (VP stored off-chain in `stakers` table) |
| stakerIndexer.ts | Watch `Deposited`/`Withdrawn`, maintain staker cache |
| vpSnapshot.ts | Compute VP snapshots, build merkle trees, generate proofs |
| snapshotWatcher.ts | Watch `ProposalCreated`, schedule/submit VP snapshots; Auto-finalize proposals at deadline |
| lifi.ts | Swap quotes, diversification, testnet mock |
| treasury.ts | Rebalance orchestration, vault status |
| depositWatcher.ts | Watch `Deposited`, diversify |
| redemptionWatcher.ts | Watch `RedemptionRequested`, liquidate, fulfill |
| disputeWatcher.ts | Watch `TaskDisputed`/`DisputeResolved`, sync to DB |
| auction.ts | Off-chain bids, winner selection |
| dispute.ts | Dispute queries, on-chain event recording |
| backup.ts | Database backup/restore, Pinata upload, Hot Swaps |
| database.ts | Database admin operations, truncate all tables (excludes schema_migrations) |
| allocations.ts | Slow Track VP allocation tracking, attestation signing |
| slowTrackWatcher.ts | Watch `VoteCastSlow`/`ProposalFinalized`, sync allocations to DB |
| analyticsWatcher.ts | Watch Marketplace/Governance/Treasury events, sync to analytics tables |
| analytics.ts | Analytics query functions (overview, marketplace, governance, treasury, users, daily) |
| tasks.ts | Paginated task queries from analytics_tasks table (getTaskList, getTaskById, getTaskCountByStatus) |
| analyticsCron.ts | Daily rollup, hourly treasury snapshot, 15-min VP refresh |

## Scheduled Jobs

| Job | Schedule | Purpose |
|-----|----------|---------|
| NAV Snapshot | Daily 00:00 UTC | Prices/allocations |
| Rebalance | 1st of month | Multi-swap via LiFi |
| Delegate Scoring | Every 1h | Score proposals, free VP |
| VP Refresh | Event-driven | ReputationChanged → refresh |
| Staker Indexer | Event-driven | Deposited/Withdrawn → update staker cache |
| Snapshot Watcher | Event-driven + 60s poll | ProposalCreated (Fast) → compute VP snapshot → submit merkle root; Auto-finalize both tracks at deadline |
| Staker Validation | Weekly Sun 03:00 UTC | Verify staker cache matches on-chain |
| Deposit Watcher | Event-driven | Deposited → diversify |
| Redemption Watcher | Event-driven | RedemptionRequested → liquidate → fulfill |
| Dispute Watcher | Event-driven | TaskDisputed/DisputeResolved → sync to DB |
| Slow Track Watcher | Event-driven | VoteCastSlow → sync allocations, ProposalFinalized → cleanup |
| Database Backup | Daily 02:00 UTC | pg_dump → Pinata Hot Swaps |
| Analytics Watcher | Event-driven | TaskCreated/AuctionTaskCreated/VoteCast/Deposited → sync to analytics tables |
| Analytics Daily Rollup | Daily 00:00 UTC | Aggregate daily metrics |
| Analytics Treasury Snapshot | Hourly | Snapshot NAV and allocations |
| Analytics VP Refresh | Every 15 min | Sync voting power to analytics_users |

## Database Tables

`profiles`, `nav_history`, `delegate_scores`, `scored_proposals`, `proposal_blocks`, `auction_tasks`, `auction_bids`, `disputes`, `backup_verification`, `delegations`, `vp_snapshots`, `vp_allocations`, `stakers`, `staker_validations`, `analytics_tasks`, `analytics_proposals`, `analytics_treasury`, `analytics_users`, `analytics_daily`

## Token Decimals

| Token | Decimals |
|-------|----------|
| ROSE/vROSE/stakedRose | 18 |
| VP | 9 |
| USDC/NAV/XAUt | 6 |
| TBTC | 8 |
| Chainlink | 8 |

## Environment Variables

| Location | Variables |
|----------|-----------|
| Root | `ARBITRUM_SEPOLIA_RPC_URL`, `PRIVATE_KEY`, `DAO_TREASURY_ADDRESS`, `ARBISCAN_API_KEY`, `PASSPORT_SIGNER_ADDRESS` |
| Frontend | `VITE_MARKETPLACE/TOKEN/TREASURY/GOVERNANCE/VROSE_ADDRESS`, `VITE_PINATA_JWT`, `VITE_PINATA_GATEWAY`, `VITE_PASSPORT_SIGNER_URL` |
| Backend | `PORT`, `ALLOWED_ORIGINS`, `SIGNER_PRIVATE_KEY`, `VITE_GITCOIN_API_KEY/SCORER_ID`, `THRESHOLD_*`, `*_ADDRESS`, `RPC_URL`, `RPC_WS_URL` (WebSocket for events), `DATABASE_URL`, `DB_POOL_*`, `PINATA_GATEWAY` |
| Watchers | `*_WATCHER_ENABLED`, `*_WATCHER_DEBOUNCE_MS`, `*_WATCHER_EXECUTE`, `*_WATCHER_SLIPPAGE_BPS`, `*_WATCHER_STARTUP_LOOKBACK` |
| Delegation | `DELEGATE_SCORING_*`, `DELEGATE_MIN_*`, `DELEGATE_GATE_ON_SCORE`, `VP_FREEING_ENABLED` |
| VP Refresh | `VP_REFRESH_ENABLED`, `VP_REFRESH_MIN_DIFFERENCE` (1e9), `VP_REFRESH_DEBOUNCE_MS` (30000), `VP_REFRESH_MAX_BATCH_SIZE` (10), `VP_REFRESH_EXECUTE` |
| Dispute Watcher | `DISPUTE_WATCHER_ENABLED` (default: true), `DISPUTE_WATCHER_STARTUP_LOOKBACK` (default: 10000 blocks) |
| Staker Indexer | `STAKER_INDEXER_ENABLED` (true), `STAKER_INDEXER_STARTUP_LOOKBACK` (10000), `STAKER_VALIDATION_CRON` (weekly Sun 03:00 UTC) |
| Snapshot Watcher | `SNAPSHOT_WATCHER_ENABLED` (true), `SNAPSHOT_WATCHER_STARTUP_LOOKBACK` (10000), `SNAPSHOT_WATCHER_COMPUTE_BUFFER` (300s), `SNAPSHOT_WATCHER_EXECUTE` (true) |
| Slow Track Watcher | `SLOW_TRACK_WATCHER_ENABLED` (true), `SLOW_TRACK_WATCHER_STARTUP_LOOKBACK` (10000) |
| Analytics Watcher | `ANALYTICS_WATCHER_ENABLED` (true), `ANALYTICS_WATCHER_STARTUP_LOOKBACK` (50000) |
| Analytics Cron | `ANALYTICS_CRON_ENABLED` (true), `ANALYTICS_DAILY_ROLLUP_SCHEDULE` (`0 0 * * *`), `ANALYTICS_TREASURY_SNAPSHOT_SCHEDULE` (`0 * * * *`), `ANALYTICS_VP_REFRESH_SCHEDULE` (`*/15 * * * *`) |
| GitHub Bot | `MERGEBOT_APP_ID`, `MERGEBOT_PRIVATE_KEY` (base64-encoded PEM), `GITHUB_BOT_ENABLED` |

**Note:** `MERGEBOT_PRIVATE_KEY` must be base64-encoded. Encode with: `cat private-key.pem | base64 -w 0`

## Pinata IPFS (Private Files)

**Frontend SDK:** Uses official `pinata` package (npm). Singleton pattern with lazy initialization. All uploads are **private** by default.

**Backend API:** Pinata V3 (`https://uploads.pinata.cloud/v3/files`) with JWT auth.

**Groups:** Content is organized into Pinata groups for management:
| Group | ID | Content |
|-------|-----|---------|
| Governance | `019b0af9-c866-7bc5-b659-8d6b70da8cd8` | Proposals |
| Tasks | `019b0aec-a5a0-7338-be66-3d604b7ba713` | Task descriptions, Disputes |
| Profiles | `019b0aec-c443-7ada-bcb7-5221e69121db` | Avatars |
| Backups | `019b0aec-e295-7e9d-8ace-fb5cd077c919` | Database backups |

**Gateway:** `https://coffee-glad-felidae-720.mypinata.cloud` (dedicated gateway for private file access)

**Private File Downloads:** All uploads are private by default. SDK handles auth automatically. Without auth, returns 403 "The owner of this gateway does not have this content".

**Environment:**
- Frontend: `VITE_PINATA_JWT` (required), `VITE_PINATA_GATEWAY` (optional, has default)
- Backend: `PINATA_GATEWAY` (optional, has default)

## Database Backup (Pinata Hot Swaps)

**Storage:** PostgreSQL backups in custom format (pg_dump -Fc, self-compressing) uploaded to Pinata IPFS as private files.

**Hot Swaps:** Uses Pinata's Hot Swaps plugin for mutable CID references. First backup creates a reference CID; subsequent backups update the swap mapping so the same reference CID always points to the latest backup.

**Reference CID:** Stored in `BACKUP_REFERENCE_CID` environment variable (GitHub secret). Set this after the first backup is created.

**Schedule:** Daily at 02:00 UTC (cron job) + manual trigger via admin panel.

**Commands:**
- **Backup:** `pg_dump -Fc → upload to Pinata → Hot Swap update → verify`
- **Restore:** `download from Pinata → pg_restore --clean --if-exists`

**Hot Swap Verification:** After every Hot Swap update, the system waits 2 seconds for propagation, then verifies the swap by:
1. Fetching content from reference CID (should resolve via Hot Swap)
2. Fetching content directly from the new backup CID
3. Computing SHA-256 hashes and comparing (timing-safe)
4. Throwing error on mismatch (triggers cron failure tracking)

`BackupResult` now includes `swapVerified: boolean` field.

**Endpoints:** `/api/backup/create` (POST), `/status` (GET), `/restore` (POST, requires confirmation)

**Auth:** All endpoints require caller to be Treasury contract owner.

**Environment:**
| Variable | Description |
|----------|-------------|
| `BACKUP_ENABLED` | Enable backup system (default: true) |
| `BACKUP_CRON_SCHEDULE` | Cron schedule (default: `0 2 * * *`) |
| `BACKUP_ON_STARTUP` | Run backup on startup (default: false) |
| `REACT_APP_PINATA_JWT` | Pinata V3 API JWT (existing secret, shared with frontend) |
| `BACKUP_GROUP_ID` | Pinata Backups group ID (has default) |
| `BACKUP_REFERENCE_CID` | Mutable reference CID for Hot Swaps (add after first backup) |

## Mainnet Addresses (Arbitrum One)

| Asset | Address |
|-------|---------|
| USDC | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` |
| TBTC | `0x6c84a8f1c29108F47a79964b5Fe888D4f4D0de40` |
| XAUt | `0x40461291347e1ecbb09499f3371d3f17f10d7159` |
| BTC/USD | `0x6ce185860a4963106506C203335A2910D6ce18586` |
| XAU/USD | `0x1F954Dc24a49708C26E0C1777f16750B5C6d5a2c` |
| LiFi | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` |

## Technical Stack

Solidity 0.8.20, OpenZeppelin v5, Chainlink v1.5.0, 1 run + viaIR optimizer. Networks: Arbitrum Sepolia (421614), Arbitrum One (42161). Frontend: Vite 7.x + wagmi + viem + RainbowKit. Backend: Express + TypeScript + PostgreSQL + ethers.js.

**WebSocket Events:** All 8 watchers use a shared WebSocket provider (`wsProvider.ts`) for real-time event listening via `eth_subscribe`. HTTP provider is kept for `queryFilter` operations (startup catch-up). Auto-reconnection with exponential backoff (5s→60s, max 10 attempts). Default WebSocket URL: `wss://arb-sepolia.g.alchemy.com/v2/***`.

## Backend ABI Workflow

**ABI Source:** Both frontend and backend use the same ABIs extracted from Hardhat artifacts via `scripts/update-abi.js`.

**Generation:** Run `npm run update-abi` from root (compiles contracts first, then extracts ABIs to both directories):
- Frontend: `frontend/src/contracts/*ABI.json`
- Backend: `backend/signer/src/abis/*ABI.json`

**Backend Usage:** Import from centralized helper `backend/signer/src/utils/contracts.ts`:
```typescript
import { RoseMarketplaceABI, RoseGovernanceABI, RoseTreasuryABI } from '../utils/contracts';
// or use factory functions
import { getMarketplaceContract, getGovernanceContract } from '../utils/contracts';
```

**CI/CD:** The `deploy-signer.yml` workflow runs `npm run update-abi` before Docker build, ensuring ABIs are generated fresh from compiled contracts.

**Local Development:** After contract changes, run `npm run update-abi` to regenerate ABIs for both frontend and backend.

**Git Strategy:** Backend ABIs (`backend/signer/src/abis/*.json`) are in `.gitignore` - generated in CI only.

## Git Workflow

```bash
git checkout -b feature/description && git push -u origin feature/description
gh pr create --title "feat: ..." --body "..." && gh pr checks --watch
```

Never push directly to main.

## MockLiFi (Testnet)

**Critical:** MockLiFiDiamond calculates swap output **before** transferring tokens. This is required because ROSE price depends on Treasury's ROSE balance (`circulatingSupply = totalSupply - treasuryBalance`). Transferring ROSE first would change the price and cause slippage failures.

**Order in `_executeSwap()`:**
1. Calculate output amount (preserves price state)
2. Check slippage
3. Transfer tokens in/out
