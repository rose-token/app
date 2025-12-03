# Contract Architecture

## Core Contracts

| Contract | Lines | Purpose |
|----------|-------|---------|
| `RoseToken.sol` | 167 | ERC20 with authorized mint/burn (multiple authorized addresses) |
| `RoseMarketplace.sol` | 562 | Task lifecycle, escrow, payment distribution, passport verification |
| `RoseTreasury.sol` | 861 | RWA-backed treasury (BTC/Gold/USDC via Chainlink + Uniswap V3) |
| `RoseGovernance.sol` | 1024 | Governance proposals, quadratic voting, multi-delegation, voter rewards |
| `vROSE.sol` | 205 | Soulbound governance receipt token, marketplace-only transfers |

## Mock Contracts (testing)

| Contract | Purpose |
|----------|---------|
| `mocks/MockERC20.sol` | ERC20 with public mint + faucet |
| `mocks/MockV3Aggregator.sol` | Chainlink price feed mock |
| `mocks/MockUniswapV3Router.sol` | Uniswap V3 swap router mock |

## Deployment Order

1. Deploy `RoseToken` with initial authorized address
2. Deploy `vROSE` (no constructor args)
3. Deploy `RoseTreasury` with RoseToken + oracle/DEX addresses
4. Deploy `RoseGovernance` with RoseToken, vROSE, passportSigner
5. Deploy `RoseMarketplace` with RoseToken, Treasury, passportSigner

## Post-Deployment Configuration

```solidity
// Authorization setup
RoseToken.setAuthorized(treasury, true);
RoseToken.setAuthorized(marketplace, true);
RoseToken.setAuthorized(governance, true);

// Cross-contract linking
vROSE.setGovernance(governance);
vROSE.setMarketplace(marketplace);
RoseMarketplace.setGovernance(governance);
RoseMarketplace.setVRoseToken(vROSE);
RoseTreasury.setMarketplace(marketplace);
RoseTreasury.setGovernance(governance);
```

## Contract Constants

### RoseMarketplace

| Constant | Value | Purpose |
|----------|-------|---------|
| `MINT_PERCENTAGE` | 2 | 2% of task value minted to DAO treasury |
| `WORKER_SHARE` | 95 | Worker receives 95% of deposit |
| `STAKEHOLDER_SHARE` | 5 | Stakeholder receives 5% fee |
| `SHARE_DENOMINATOR` | 100 | Basis for percentage calculations |

### RoseTreasury

| Constant | Value | Purpose |
|----------|-------|---------|
| `DRIFT_THRESHOLD` | 500 (5%) | Rebalance triggers if asset drifts >5% |
| `REBALANCE_COOLDOWN` | 7 days | Minimum time between rebalances |
| `USER_COOLDOWN` | 24 hours | Between deposits/redeems per user |
| `MAX_ORACLE_STALENESS` | 1 hour | Reject stale price data |
| `MIN_SWAP_AMOUNT` | 1e6 (1 USDC) | Minimum swap to avoid dust |
| `POOL_FEE_STABLE` | 500 (0.05%) | Uniswap fee for stable pairs |
| `POOL_FEE_VOLATILE` | 3000 (0.3%) | Uniswap fee for volatile pairs |
| Default allocations | BTC=30%, Gold=30%, USDC=20%, ROSE=20% | Target portfolio |

### RoseGovernance

| Constant | Value | Purpose |
|----------|-------|---------|
| `VOTING_PERIOD` | 2 weeks | Proposal voting window |
| `QUORUM_THRESHOLD` | 3300 (33%) | Min VP participation |
| `PASS_THRESHOLD` | 5833 (58.33%) | 7/12 supermajority required |
| `MAX_EDIT_CYCLES` | 4 | Proposal edit limit |
| `COLD_START_TASKS` | 10 | Tasks before full reputation |
| `DEFAULT_REPUTATION` | 60 | Cold start reputation score |
| `TASK_DECAY_PERIOD` | 365 days | Task reputation relevance |
| `DISPUTE_DECAY_PERIOD` | 1095 days | Dispute penalty duration |
| `DAO_MINT_PERCENT` | 200 (2%) | Treasury reward on completion |
| `YAY_VOTER_REWARD` | 200 (2%) | Yay voters split |
| `PROPOSER_REWARD` | 100 (1%) | Proposer reward on completion |

## Custom Errors

### RoseToken
- `NotAuthorized()` - Caller not in authorized mapping
- `NotOwner()` - Caller not contract owner
- `ZeroAddress()` - Invalid zero address
- `InsufficientBalance()` - Insufficient token balance
- `InsufficientAllowance()` - Insufficient approval

### RoseMarketplace
- `InvalidSignature()` - ECDSA verification failed
- `SignatureExpired()` - Signature timestamp expired
- `SignatureAlreadyUsed()` - Replay attack detected
- `ZeroAddressSigner()` - Invalid signer address
- `NotGovernance()` - Caller not governance contract
- `InsufficientVRose()` - Stakeholder lacks vROSE balance

### RoseTreasury
- `InvalidPrice()` - Chainlink price <= 0
- `StaleOracle()` - Oracle data > 1 hour old
- `InsufficientLiquidity()` - Not enough liquidity for swap
- `SlippageExceeded()` - Actual output < minimum expected
- `InvalidAllocation()` - Allocations don't sum to 100%
- `ZeroAmount()` - Amount is zero
- `RebalanceNotNeeded()` - No drift detected
- `RebalanceCooldown()` - Within 7-day cooldown
- `CooldownNotElapsed()` - User cooldown not elapsed

### RoseGovernance
- `IneligibleToPropose()` - Reputation <90% or <10 tasks
- `IneligibleToVote()` - Reputation <70%
- `IneligibleToDelegate()` - Reputation <90% or <10 tasks
- `ProposalNotActive()` - Proposal not in Active state
- `CannotVoteOnOwnProposal()` - Proposer trying to vote
- `CannotChangeVoteDirection()` - Attempted Yay→Nay or vice versa
- `VPLockedToAnotherProposal()` - VP allocated elsewhere
- `InsufficientAvailableVP()` - Not enough unallocated VP
- `MaxEditCyclesReached()` - Exceeded 4 edits

### vROSE
- `OnlyMarketplaceTransfer()` - Transfer not to/from marketplace
- `OnlyMarketplaceApproval()` - Approval only for marketplace
- `NotGovernance()` - Caller not governance contract
- `InsufficientBalance()` - Not enough vROSE balance

## Treasury NAV Calculations

**Core Formula**: `ROSE Price = HardAssetValueUSD / CirculatingSupply`

| Scenario | Price |
|----------|-------|
| Initial (supply = 0) | $1.00 |
| Ongoing | NAV-backed |

**Components**:
- Hard Assets: BTC + Gold + USDC value (excludes Treasury ROSE)
- Circulating Supply: totalSupply - balanceOf(treasury)
- All values normalized to 6 decimals (USDC standard)

**Deposit Flow**:
```
roseToMint = (usdcAmount × 1e18) / rosePrice()
→ USDC transferred to Treasury
→ ROSE minted to user
→ _diversify() swaps USDC into BTC/Gold per allocation
```

**Redeem Flow**:
```
usdcOwed = (roseAmount × rosePrice()) / 1e18
→ ROSE burned from user
→ If USDC insufficient, _liquidateForRedemption() sells RWA
→ USDC transferred to user
```

## Security Patterns

**Reentrancy Protection**: All 4 core contracts use OpenZeppelin `ReentrancyGuard`

**Checks-Effects-Interactions**: State updated before external calls (e.g., `t.status = Closed` before `roseToken.transfer()`)

**SafeERC20**: All transfers use `SafeERC20.safeTransfer/safeTransferFrom`

**Signature Replay Protection**: `mapping(bytes32 => bool) usedSignatures` marks each used

**Oracle Staleness**: Reverts if `block.timestamp - updatedAt > 1 hour`

**Slippage Protection**: `maxSlippageBps` configurable (default 1%), swaps revert if output < minimum

**User Cooldowns**: 24-hour cooldown between deposits/redeems prevents flash loan attacks

## Passport Signature Verification

Protected functions require ECDSA signature from trusted `passportSigner`:
- `createTask("createTask")`
- `stakeholderStake("stake")`
- `claimTask("claim")`

Replay protection via `usedSignatures` mapping. Admin can update signer via `setPassportSigner(address)`.
