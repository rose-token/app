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
| RoseTreasury | RWA-backed (BTC/Gold/USDC via Chainlink+LiFi), configurable asset registry, redemption queue |
| RoseGovernance | Proposals, quadratic voting, delegation, rewards |
| RoseReputation | Monthly buckets, 3yr decay, eligibility checks |
| vROSE | Soulbound governance receipt |

**Deploy order:** Token → vROSE → Treasury → Marketplace → Reputation → Governance

**Post-deploy:** `setAuthorized`, `setGovernance`, `setMarketplace`, `setVRoseToken`, `setReputation`, `setRebalancer`, `setDelegationSigner`, `addAsset(BTC,GOLD,STABLE,ROSE)`

## Constants

| Area | Constant | Value |
|------|----------|-------|
| Payment | Worker/Stakeholder/DAO | 95%/5%/2% mint |
| Treasury | Drift/Cooldown/Oracle | disabled/disabled/24h/1h stale |
| Treasury | Allocations | BTC=30%, Gold=30%, USDC=20%, ROSE=20% |
| Governance | Vote/Quorum/Pass | 2wk/33%/58.33% |
| Reputation | Propose/Vote/Delegate | 90%+10tasks/70%/90%+10tasks |
| Reputation | Bucket/Decay | 30d/36 buckets (3yr) |

## Treasury NAV

**Formula:** `ROSE Price = HardAssetsUSD / CirculatingSupply` (BTC+Gold+USDC, excludes treasury ROSE)

**Flows:**
- **Deposit:** USDC → Treasury → ROSE minted → Backend diversifies via LiFi (smart rebalancing)
- **Redeem:** Instant if buffer sufficient, else queued → Backend liquidates → `fulfillRedemption()`
- **Rebalance:** No drift threshold or cooldown. `rebalance()` is owner-only; `forceRebalance()` is rebalancer-only. Backend `/api/treasury/rebalance/run` requires signed message authentication.

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
3. Rounds up token amounts to sell (+1 wei) to ensure sufficient USDC
4. Never sells ROSE - only liquidates BTC/GOLD (furthest over-allocation first)

## Governance System

**VP:** `√(stakedRose) × reputation` where reputation = `(success-dispute)/success×100` using ^0.6 sublinear points

**Liquid Democracy:** Max depth 1. `delegationNonce` prevents stale signatures. `delegatedUsedTotal` = global VP budget across proposals. `delegatorVoteContribution[proposal][delegate][delegator]` = on-chain allocations.

**Lifecycle:** Active → 2wk voting → Passed/Failed. Quorum miss resets timer. Max 4 edits. Rewards: DAO 2%, Yay voters 2%, Proposer 1%.

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

## Security Patterns

ReentrancyGuard (all 5 contracts), CEI pattern, SafeERC20, `usedSignatures` replay protection, 1h oracle staleness, 1% default slippage, 24h user cooldowns.

## Frontend

**Stack:** React 18 + Vite + Wagmi/RainbowKit + TailwindCSS

**Routes:** `/` Tasks, `/vault` Treasury, `/governance` Proposals, `/governance/:id` Vote, `/delegates` Delegation, `/profile` User, `/admin` Admin (owner-only), `/admin/disputes` Dispute Resolution (owner-only)

**Key Hooks:** useVaultData (45s refresh), useGovernance (staking/VP), useProposals, useDelegation, useAuction, useReputation (5m cache), useIsAdmin (Treasury owner check), useRebalance (trigger rebalance), useDispute (dispute actions + admin queries), useBackup (database backup/restore)

**Admin Page:** Only visible/accessible to Treasury contract owner (read via `Treasury.owner()`). Non-owners silently redirected to `/`. Features: manual treasury rebalance trigger, database backup/restore, whitelist management.

**Passport:** `usePassport` (Gitcoin 1h cache), `usePassportVerify` (backend). Thresholds: CREATE=20, STAKE=20, CLAIM=20, PROPOSE=25

**Site-Wide Gate:** `ProtectedRoutes` component gates entire app with Passport score >= 20 check. Flow: Connect wallet → Verify passport → Access site. `/help` route bypasses gate. Whitelisted addresses bypass automatically via `usePassport`. Strict blocking (no graceful degradation) for sybil protection.

## Backend API (`backend/signer/`)

| Category | Endpoints |
|----------|-----------|
| Passport | `/api/passport/verify`, `/score/:addr`, `/signer` |
| Governance | `/api/governance/vp/:addr`, `/total-vp`, `/delegations/:addr`, `/received/:delegate`, `/reputation-signed/:addr`, `/vote-signature` |
| Delegation | `/api/delegation/vote-signature`, `/confirm-vote`, `/claim-signature`, `/claimable/:user`, `/undelegate-signature`, `/global-power/:delegate`, `/confirm-undelegate` |
| Reconciliation | `/api/reconciliation/status`, `/last`, `/run`, `/proposal/:id`, `/sync`, `/stats` |
| Delegate Scoring | `/api/delegate-scoring/score/:delegate`, `/eligibility/:delegate`, `/leaderboard`, `/stats`, `/run` |
| VP Refresh | `/api/vp-refresh/stats`, `/pending`, `/config`, `/check/:addr`, `/process` |
| Treasury | `/api/treasury/history`, `/rebalances`, `/stats`, `/vault-status`, `/rebalance/status`, `/rebalance/run`, `/rebalance/trigger`, `/redeem-check`, `/redemption/:id`, `/user-pending/:addr`, `/pending-redemptions`, `/redemption-watcher/*` |
| Auction | `/api/auction/register`, `/bid`, `/:taskId/bids`, `/:taskId/count`, `/:taskId/my-bid/:worker`, `/:taskId`, `/select-winner`, `/confirm-winner`, `/:taskId/sync` |
| Profile | `/api/profile` POST, `/api/profile/:addr` GET |
| Whitelist | `/api/whitelist` GET/POST, `/api/whitelist/:address` GET/DELETE (owner-only mutations) |
| Dispute | `/api/dispute/list`, `/api/dispute/stats`, `/api/dispute/:taskId` (admin queries, on-chain events synced to DB) |
| Backup | `/api/backup/create`, `/status`, `/restore` (owner-only, pg_dump → Pinata Hot Swaps) |

## Backend Services

| Service | Purpose |
|---------|---------|
| governance.ts | VP calculation, reputation attestation |
| delegation.ts | Allocations, delegated votes, claims, vote reductions |
| reconciliation.ts | DB↔chain sync, discrepancy auto-fix |
| delegateScoring.ts | Win/loss tracking, eligibility gating |
| vpRefresh.ts | Auto-refresh VP on reputation changes |
| lifi.ts | Swap quotes, diversification, testnet mock |
| treasury.ts | Rebalance orchestration, vault status |
| depositWatcher.ts | Watch `Deposited`, diversify |
| redemptionWatcher.ts | Watch `RedemptionRequested`, liquidate, fulfill |
| auction.ts | Off-chain bids, winner selection |
| dispute.ts | Dispute queries, on-chain event recording |
| backup.ts | Database backup/restore, Pinata upload, Hot Swaps |

## Scheduled Jobs

| Job | Schedule | Purpose |
|-----|----------|---------|
| NAV Snapshot | Daily 00:00 UTC | Prices/allocations |
| Rebalance | 1st of month | Multi-swap via LiFi |
| Reconciliation | Every 6h | DB↔chain sync |
| Delegate Scoring | Every 1h | Score proposals, free VP |
| VP Refresh | Event-driven | ReputationChanged → refresh |
| Deposit Watcher | Event-driven | Deposited → diversify |
| Redemption Watcher | Event-driven | RedemptionRequested → liquidate → fulfill |
| Database Backup | Daily 02:00 UTC | pg_dump → Pinata Hot Swaps |

## Database Tables

`profiles`, `nav_history`, `delegation_allocations`, `delegate_scores`, `scored_proposals`, `proposal_blocks`, `auction_tasks`, `auction_bids`, `disputes`

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
| Backend | `PORT`, `ALLOWED_ORIGINS`, `SIGNER_PRIVATE_KEY`, `VITE_GITCOIN_API_KEY/SCORER_ID`, `THRESHOLD_*`, `*_ADDRESS`, `RPC_URL`, `DATABASE_URL`, `DB_POOL_*`, `PINATA_GATEWAY` |
| Watchers | `*_WATCHER_ENABLED`, `*_WATCHER_DEBOUNCE_MS`, `*_WATCHER_EXECUTE`, `*_WATCHER_SLIPPAGE_BPS`, `*_WATCHER_STARTUP_LOOKBACK` |
| Delegation | `RECONCILIATION_CRON_SCHEDULE`, `RECONCILIATION_ON_STARTUP`, `DELEGATE_SCORING_*`, `DELEGATE_MIN_*`, `DELEGATE_GATE_ON_SCORE`, `VP_FREEING_ENABLED` |
| VP Refresh | `VP_REFRESH_ENABLED`, `VP_REFRESH_MIN_DIFFERENCE` (1e9), `VP_REFRESH_DEBOUNCE_MS` (30000), `VP_REFRESH_MAX_BATCH_SIZE` (10), `VP_REFRESH_EXECUTE` |

## Pinata IPFS (Private Files)

**API:** Pinata V3 (`https://uploads.pinata.cloud/v3/files`) with JWT auth. All uploads are **private** by default.

**Groups:** Content is organized into Pinata groups for management:
| Group | ID | Content |
|-------|-----|---------|
| Governance | `019b0af9-c866-7bc5-b659-8d6b70da8cd8` | Proposals |
| Tasks | `019b0aec-a5a0-7338-be66-3d604b7ba713` | Task descriptions, Disputes |
| Profiles | `019b0aec-c443-7ada-bcb7-5221e69121db` | Avatars |
| Backups | `019b0aec-e295-7e9d-8ace-fb5cd077c919` | Database backups |

**Gateway:** `https://coffee-glad-felidae-720.mypinata.cloud` (dedicated gateway for private file access)

**Environment:**
- Frontend: `VITE_PINATA_JWT` (required), `VITE_PINATA_GATEWAY` (optional, has default)
- Backend: `PINATA_GATEWAY` (optional, has default)
- Legacy: `VITE_PINATA_API_KEY`, `VITE_PINATA_SECRET_API_KEY` (deprecated, kept for backward compat)

## Database Backup (Pinata Hot Swaps)

**Storage:** PostgreSQL backups in custom format (pg_dump -Fc, self-compressing) uploaded to Pinata IPFS as private files.

**Hot Swaps:** Uses Pinata's Hot Swaps plugin for mutable CID references. First backup creates a reference CID; subsequent backups update the swap mapping so the same reference CID always points to the latest backup.

**Reference CID:** Stored in `BACKUP_REFERENCE_CID` environment variable (GitHub secret). Set this after the first backup is created.

**Schedule:** Daily at 02:00 UTC (cron job) + manual trigger via admin panel.

**Commands:**
- **Backup:** `pg_dump -Fc → upload to Pinata → Hot Swap update`
- **Restore:** `download from Pinata → pg_restore --clean --if-exists`

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
