# CLAUDE.md 

Guidance for Claude Code. ALWAYS ASK CLARIFYING QUESTIONS. ALWAYS UPDATE CLAUDE.MD AS YOUR LAST TODO STEP.

## Quick Reference
| Contracts | `npm run compile && npm test && npm run update-abi` |
|-----------|-----------------------------------------------------|
| Frontend | `cd frontend && npm run dev` |
| Deploy | `npm run deploy:arbitrumSepolia` / `deploy:arbitrum` |
| Simulate | `npx hardhat run scripts/simulate.js --network arbitrumSepolia` |

## Project Overview

Web3 marketplace with task-value-based token distribution.

**Tokenomics:** Customer deposits ROSE → Stakeholder stakes 10% → On completion: Worker 95%, Stakeholder 5% + stake, DAO mints 2%.

**Auction Spread:** Customer sees midpoint: `(maxBudget + workerBid) / 2`. Spread → treasury. Example: ask=100, bid=80 → customer pays 90, treasury 10, worker 80.

## Contract Architecture

| Contract | Purpose |
|----------|---------|
| RoseToken | ERC20 authorized mint/burn |
| RoseMarketplace | Task lifecycle, escrow, payments, passport verification |
| RoseTreasury | RWA-backed (BTC/Gold/USDC via Chainlink+LiFi), asset registry, redemption queue |
| RoseGovernance | Proposals, quadratic voting, delegation, rewards |
| RoseReputation | Monthly buckets, 3yr decay, eligibility checks |
| vROSE | Soulbound governance receipt |

**Deploy order:** Token → vROSE → Treasury → Marketplace → Reputation → Governance

**Post-deploy:** `setAuthorized`, `setGovernance`, `setMarketplace`, `setVRoseToken`, `setReputation`, `setRebalancer`, `setDelegationSigner`, `setPassportSigner`, `addAsset(BTC,GOLD,STABLE,ROSE)`

## Constants

| Area | Values |
|------|--------|
| Payment | Worker 95%, Stakeholder 5%, DAO 2% mint |
| Treasury | Allocations: BTC=30%, Gold=30%, USDC=20%, ROSE=20%. Oracle 1h stale |
| Governance | 2wk vote, 33% quorum, 58.33% pass |
| Reputation | Propose/Delegate: 90%+10tasks, Vote: 70%. 30d buckets, 36 buckets (3yr) |
| Decimals | ROSE/vROSE/tBTC: 18, VP: 9, USDC/NAV/XAUt: 6, Chainlink: 8 |

## Treasury NAV

**Formula:** `ROSE Price = HardAssetsUSD / CirculatingSupply` (BTC+Gold+USDC, excludes treasury ROSE)

**Flows:**
- **Deposit:** Passport sig → USDC → Treasury → ROSE minted → Backend diversifies via LiFi
- **Redeem:** Passport sig → Instant if buffer sufficient, else queued → Backend liquidates → `fulfillRedemption()`
- **Rebalance:** Owner-only `rebalance()`, rebalancer-only `forceRebalance()`. No drift/cooldown

**Same-Block Protection:** `block.number > lastDepositBlock[user]` required for redemption (flash loan prevention). View: `canRedeemAfterDeposit(address)`

**Smart Diversification:** Phase 1: USDC buffer deficit → Phase 2: BTC/GOLD deficits proportionally → Phase 3: Excess → RWA by ratio. Never buys ROSE. First deposit: 50/50 BTC/GOLD.

**Redemption Queue:** NAV locked at request, 1 pending/user, no cancel, FIFO.

**Redemption Liquidation:** Waterfall algorithm - sell highest-value RWA first to equalize USD values. Never sells ROSE. Adds 0.1% rounding buffer.

**ROSE Price Protection:** 10% threshold (1000 bps) prevents buying at premium or selling at discount. Config: `REBALANCE_MAX_ROSE_PREMIUM_BPS`, `REBALANCE_MAX_ROSE_DISCOUNT_BPS`

## Governance (Two-Track)

**VP:** `√(stakedRose) × reputation` where reputation = `(success-dispute)/success×100` using ^0.6 sublinear

| Track | Duration | Quorum | VP Model | Treasury Limit |
|-------|----------|--------|----------|----------------|
| Fast | 3 days | 10% | Abundant (full VP per proposal) | ≤1% |
| Slow | 14 days | 25% | Scarce (VP budget across proposals) | Any |

**Fast Track:** Proposal → 1d delay → Backend submits merkle root → Voting with proofs → Auto-finalize
**Slow Track:** Proposal (Active immediately) → Backend attestations → Voting → Backend finalizes with snapshot

**Off-Chain Delegation:** EIP-712 signed, stored in DB. Requires `setDelegateOptIn(true)`. Fields: `vpAmount` (0=full), `nonce`, `expiry`, `signature`. Delegates can vote with received VP: `/vp/available` returns `ownVP + receivedVP` breakdown. Fast Track uses merkle proof `effectiveVP`, Slow Track uses backend-calculated total.

**Lifecycle:** Active → Passed/Failed. Auto-execute after 24h grace (creates DAO task). Max 3 quorum extensions, 4 edits. Rewards: DAO 2%, Yay 2%, Proposer 1%.

## Task Status Flow

```
StakeholderRequired → Open → InProgress → Completed → ApprovedPendingPayment → Closed
        ↓               ↓           ↓           ↓
        │               │           │           └─→ disputeTaskAsWorker() → Disputed
        │               │           └─→ disputeTaskAsCustomer() → Disputed
        │               └─→ unstakeStakeholder() → StakeholderRequired
        └───────────────┴─→ cancelTask() → Closed (refunds)

Disputed → resolveDispute(workerPct 0-100) → Closed (split, no DAO mint)
```

**Dispute:** Customer disputes `InProgress`, Worker disputes `Completed`. Owner resolves with `workerPct`. Reason as IPFS hash.

**Auction:** Off-chain bids, `selectAuctionWinner` uses actual bid. Spread → treasury, surplus → customer.

**GitHub Integration:** `githubIntegration` bool controls PR URL requirement. DAO tasks default `true`.

**Repo Authorization:** OAuth link → Authorize repos (admin access required) → Bot only merges authorized. DAO tasks require configured repo (`DAO_TASK_REPO_OWNER`/`DAO_TASK_REPO_NAME`).

## Security

ReentrancyGuard (all contracts), CEI pattern, SafeERC20, 1h oracle staleness, 1% slippage, same-block protection.

**Auth Middleware Pattern:** `keccak256(abi.encodePacked(callerAddress, action, timestamp))`, 5-min TTL replay protection.

| Type | Middleware | Verifies | Endpoints |
|------|------------|----------|-----------|
| Admin | `createAdminAuth(action)` | Treasury.owner() | rebalance/trigger, backup/*, whitelist/*, camelot-lp/collect, database/truncate |
| User | `createUserAuth(action)` | Self (callerAddress) | github/auth/unlink, github/repos/* |
| Signer | `createSignerAuth(action)` | Backend signer | delegate-scoring/*, vp-refresh/*, redemption-watcher/*, github/retry, auction/sync |
| Tx Verify | — | On-chain event | auction/register (AuctionTaskCreated), auction/confirm-winner (AuctionWinnerSelected) |

**Frontend Hooks:** `useAdminAuth` (`adminPost`/`adminDelete`), `useUserAuth` (`userPost`/`userDelete`)

## PostgreSQL Security

Localhost-only binding, `scram-sha-256` required, `POSTGRES_PASSWORD` mandatory. External connections rejected. Auto-migrates from `trust` auth.

**pg_hba.conf:** local/127.0.0.1/::1 → scram-sha-256, 0.0.0.0/:: → reject

## Frontend

**Stack:** React 18 + Vite + Wagmi/RainbowKit + TailwindCSS

**Routes:** `/` Tasks, `/create-task`, `/task/:id`, `/vault`, `/governance`, `/governance/:id`, `/delegates`, `/profile`, `/admin` (owner), `/admin/disputes`, `/admin/analytics`

**Key Hooks:** `useTasks` (single+actions), `useTasksAPI` (paginated), `useTaskSkills` (IPFS+matching), `useVaultData` (45s), `useGovernance`, `useProposals`, `useDelegation`, `useAuction`, `useReputation` (5m cache), `useIsAdmin`, `useAdminAuth`, `useRebalance`, `useDispute`, `useBackup`, `usePause`, `useTruncateDatabase`, `useWhitelist`, `useCamelotLP`, `useIPFSImage` (private IPFS with JWT, returns blob URLs), `useAnalytics` (60s poll)

**VP Precision:** `useAvailableVP` returns both display values (`ownVP`, `receivedVP`) and raw values (`ownVPRaw`, `receivedVPRaw`). Use raw values for calculations to avoid rounding errors; display values use `.toFixed(2)` and will cause precision loss if used in API requests.

**Task Table:** Backend pagination via `/api/tasks` (20/page, from `analytics_tasks`). Hides Closed/Disputed by default. Skills matching with gold star icon.

**Passport:** Thresholds: CREATE/STAKE/CLAIM/DEPOSIT/REDEEM=20, PROPOSE=25. Site-wide gate (score>=20), `/help` bypasses. Whitelisted addresses bypass.

**UI:** `<Spinner />` for loading. `useIPFSImage` required for private images (never use `getGatewayUrl()` directly).

**Vault Copy:** "Exchange ROSE" = redeem(). Neutral language, beta banner, NAV tooltip.

## Backend API

| Category | Endpoints |
|----------|-----------|
| Passport | verify, score/:addr, signer |
| Governance | vp/:addr, vp/available/:addr, vp/attestation, proposals/:id/proof/:addr, total-vp, delegations/:addr, received/:delegate, reputation-signed/:addr, vote-signature |
| Delegation | vote-signature, confirm-vote, claim-signature, claimable/:user, undelegate-signature, global-power/:delegate, confirm-undelegate |
| Delegation V2 | v2/store, v2/user/:addr, v2/received/:delegate, v2/revoke, v2/nonce/:addr, v2/opt-in/:addr, v2/stats, v2/eip712-config/:chainId, v2/delegates |
| Delegate Scoring | score/:delegate, eligibility/:delegate, leaderboard, stats, run |
| VP Refresh | stats, pending, config, check/:addr, process |
| Treasury | history, rebalances, stats, vault-status, rebalance/*, redeem-check, redemption/:id, user-pending/:addr, pending-redemptions, redemption-watcher/* |
| Auction | register, bid, :taskId/bids, :taskId/count, :taskId/my-bid/:worker, :taskId, select-winner, confirm-winner, :taskId/sync |
| Profile | POST /, GET /:addr |
| Whitelist | GET/POST /, GET/DELETE /:address |
| Dispute | list, stats, :taskId |
| Backup | create, status, restore |
| Database | tables, truncate |
| Slow Track | attestation, allocations/:addr, available/:addr, stats |
| Analytics | overview, marketplace, governance, treasury, users, daily?days=30 |
| Tasks | GET / (paginated), GET /counts, GET /:taskId |
| Camelot LP | status, position/:tokenId, collect, collect/:tokenId |
| GitHub | auth/start, auth/status, callback, auth/unlink, repos, repos/authorize, repos/revoke, repos/check |

## Backend Services

| Service | Purpose |
|---------|---------|
| wsProvider.ts | Shared WebSocket with auto-reconnect (5s→60s backoff) |
| governance.ts | VP queries, reputation attestation |
| delegation.ts / delegationV2.ts | Allocations, votes, claims; Off-chain EIP-712 |
| delegateScoring.ts | Win/loss tracking, eligibility |
| vpRefresh.ts | Auto-refresh VP on reputation changes |
| stakerIndexer.ts | Deposited/Withdrawn → staker cache |
| vpSnapshot.ts | VP snapshots, merkle trees, proofs |
| snapshotWatcher.ts | ProposalCreated → VP snapshot; Auto-finalize at deadline |
| lifi.ts | Swap quotes, diversification, testnet mock |
| treasury.ts | Rebalance orchestration |
| depositWatcher.ts | Deposited → diversify |
| redemptionWatcher.ts | RedemptionRequested → liquidate → fulfill |
| disputeWatcher.ts | TaskDisputed/DisputeResolved → DB |
| delegateOptInWatcher.ts | DelegateOptInChanged → sync stakers |
| auction.ts | Off-chain bids, winner selection |
| backup.ts | pg_dump → Pinata Hot Swaps |
| allocations.ts / slowTrackWatcher.ts | Slow Track VP allocation |
| analyticsWatcher.ts / analytics.ts / analyticsCron.ts | Event sync, queries, daily/hourly rollups |
| tasks.ts | Paginated task queries |
| camelotLP.ts | LP fee collection → Treasury |

## Scheduled Jobs

| Job | Schedule |
|-----|----------|
| NAV Snapshot | Daily 00:00 UTC |
| Rebalance | 1st of month |
| Delegate Scoring | Hourly |
| Database Backup | Daily 02:00 UTC |
| Analytics Daily Rollup | Daily 00:00 UTC |
| Analytics Treasury Snapshot | Hourly |
| Analytics VP Refresh | Every 15 min |
| Task Validation | Every 15 min |
| Staker Validation | Weekly Sun 03:00 UTC |
| Camelot LP Fee Collection | Daily 06:00 UTC |
| Event-driven | VP Refresh, Staker Indexer, Snapshot Watcher, Watchers (deposit, redemption, dispute, opt-in, slow-track, analytics) |

## Database Tables

`profiles`, `nav_history`, `delegate_scores`, `scored_proposals`, `proposal_blocks`, `auction_tasks`, `auction_bids`, `disputes`, `backup_verification`, `delegations`, `vp_snapshots`, `vp_allocations`, `stakers`, `staker_validations`, `analytics_tasks`, `analytics_proposals`, `analytics_treasury`, `analytics_users`, `analytics_daily`, `github_links`, `authorized_repos`

## Environment Variables

**Root:** `ARBITRUM_SEPOLIA_RPC_URL`, `PRIVATE_KEY`, `DAO_TREASURY_ADDRESS`, `ARBISCAN_API_KEY`, `PASSPORT_SIGNER_ADDRESS`

**Frontend:** `VITE_MARKETPLACE/TOKEN/TREASURY/GOVERNANCE/VROSE_ADDRESS`, `VITE_PINATA_JWT`, `VITE_PINATA_GATEWAY`, `VITE_PASSPORT_SIGNER_URL`

**Backend:** `PORT`, `ALLOWED_ORIGINS`, `SIGNER_PRIVATE_KEY`, `VITE_GITCOIN_API_KEY/SCORER_ID`, `THRESHOLD_*`, `*_ADDRESS`, `RPC_URL`, `RPC_WS_URL`, `DATABASE_URL`, `DB_POOL_*`, `PINATA_GATEWAY`

**Watchers (all have `*_ENABLED`, `*_STARTUP_LOOKBACK`):**
- Deposit/Redemption: `*_DEBOUNCE_MS`, `*_EXECUTE`, `*_SLIPPAGE_BPS`
- Dispute/Delegate Opt-In/Slow Track/Analytics: defaults 10000-50000 lookback
- Snapshot: `COMPUTE_BUFFER` (300s), `EXECUTE`
- Staker Indexer: `STAKER_VALIDATION_CRON`

**Delegation:** `DELEGATE_SCORING_*`, `DELEGATE_MIN_*`, `DELEGATE_GATE_ON_SCORE`, `VP_FREEING_ENABLED`

**VP Refresh:** `VP_REFRESH_MIN_DIFFERENCE` (1e9), `VP_REFRESH_DEBOUNCE_MS` (30000), `VP_REFRESH_MAX_BATCH_SIZE` (10)

**Analytics Cron:** `ANALYTICS_DAILY_ROLLUP_SCHEDULE`, `ANALYTICS_TREASURY_SNAPSHOT_SCHEDULE`, `ANALYTICS_VP_REFRESH_SCHEDULE`

**Task Validation:** `TASK_VALIDATION_SCHEDULE`, `TASK_VALIDATION_BATCH_SIZE` (50)

**GitHub Bot:** `MERGEBOT_APP_ID`, `MERGEBOT_PRIVATE_KEY` (base64 PEM), `GITHUB_BOT_ENABLED`, `MERGEBOT_CLIENT_ID/SECRET`, `MERGEBOT_CALLBACK_URL`, `FRONTEND_URL`, `DAO_TASK_REPO_OWNER/NAME`, `IS_PRODUCTION`

**Camelot LP:** `CAMELOT_POSITION_MANAGER`, `CAMELOT_LP_POSITION_IDS`, `CAMELOT_LP_CRON_SCHEDULE`

**Backup:** `BACKUP_ENABLED`, `BACKUP_CRON_SCHEDULE`, `BACKUP_ON_STARTUP`, `REACT_APP_PINATA_JWT`, `BACKUP_GROUP_ID`, `BACKUP_REFERENCE_CID`

**Rebalance:** `REBALANCE_MAX_ROSE_PREMIUM_BPS` (1000), `REBALANCE_MAX_ROSE_DISCOUNT_BPS` (1000)

## Pinata IPFS

**SDK:** Frontend uses `pinata` npm package. Backend uses Pinata V3 API. All uploads private by default.

**Groups:** Governance `019b0af9-c866-7bc5-b659-8d6b70da8cd8`, Tasks `019b0aec-a5a0-7338-be66-3d604b7ba713`, Profiles `019b0aec-c443-7ada-bcb7-5221e69121db`, Backups `019b0aec-e295-7e9d-8ace-fb5cd077c919`

**Gateway:** `https://coffee-glad-felidae-720.mypinata.cloud`

**Backup:** pg_dump -Fc → Pinata → Hot Swap update → SHA-256 verify. Daily 02:00 UTC. Reference CID in `BACKUP_REFERENCE_CID`.

## Mainnet Addresses (Arbitrum One)

| Asset | Address |
|-------|---------|
| USDC | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` |
| tBTC | `0x6c84a8f1c29108F47a79964b5Fe888D4f4D0de40` |
| XAUt | `0x40461291347e1ecbb09499f3371d3f17f10d7159` |
| BTC/USD | `0x6ce185860a4963106506C203335A2910413708e9` |
| XAU/USD | `0x1F954Dc24a49708C26E0C1777f16750B5C6d5a2c` |
| LiFi | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` |
| Camelot PM | `0x00c7f3082833e796A5b3e4Bd59f6642FF44DCD15` |

## Technical Stack

Solidity 0.8.20, OpenZeppelin v5, Chainlink v1.5.0, 1 run + viaIR. Networks: Arbitrum Sepolia (421614), Arbitrum One (42161). Frontend: Vite 7 + wagmi + viem + RainbowKit. Backend: Express + TypeScript + PostgreSQL + ethers.js.

**WebSocket:** 9 watchers share `wsProvider.ts`. analyticsWatcher uses WS for all ops. Auto-reconnect 5s→60s, max 10 attempts.

## ABI Workflow

`npm run update-abi` extracts from Hardhat artifacts to `frontend/src/contracts/` and `backend/signer/src/abis/`. Backend imports from `utils/contracts.ts`. Backend ABIs in `.gitignore`.

## Git Workflow

```bash
git checkout -b feature/description && git push -u origin feature/description
gh pr create --title "feat: ..." --body "..." && gh pr checks --watch
```

Never push directly to main.

## CI/CD Pipeline

**Job Order:** resolve-addresses → deploy-contracts → build-and-push-frontend + build-and-push-signer (parallel) → deploy-signer-akash → deploy-frontend-akash

**Pinned Contracts:** Set all 7 GitHub **variables** to skip deployment: `TOKEN_ADDRESS`, `TREASURY_ADDRESS`, `MARKETPLACE_ADDRESS`, `GOVERNANCE_ADDRESS`, `REPUTATION_ADDRESS`, `VROSE_ADDRESS`, `USDC_ADDRESS`. All set → skip, any missing → full deploy.

## Production (Mainnet)

**Workflow:** `.github/workflows/prod-deploy.yml` (push to main or manual)

**Domains:** `app.rose-token.com` (frontend), `signer.rose-token.com` (backend)

| Aspect | Dev | Prod |
|--------|-----|------|
| Script | deploy.js | deploy-mainnet.js |
| Mocks | All | None (real USDC/tBTC/XAUt, Chainlink, LiFi) |
| Seeding | Yes | None |
| Slippage | 100% | 1% |

**Required Secrets:** `ARBITRUM_RPC_URL`, `ARBITRUM_RPC_WS_URL`, `PRIVATE_KEY`, `PASSPORT_SIGNER_ADDRESS`, `AKASH_DSEQ_*_PROD`, plus all dev secrets.

## Frontend Build

`VITE_*` vars passed as Docker build-args, baked at build time. `VITE_BUILD_HASH=${{ github.sha }}` forces cache invalidation.

## MockLiFi (Testnet)

**Critical:** Calculates swap output **before** transferring tokens (preserves ROSE price state for slippage check).
