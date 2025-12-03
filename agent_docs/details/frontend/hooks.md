# Frontend Hooks - Detailed Documentation

**Parent**: [frontend.md](../../frontend.md) | **Location**: `frontend/src/hooks/`

## Overview

All hooks use wagmi/viem for Web3 interactions. Backend API calls use native fetch.

---

## useGovernance

**File**: `useGovernance.js` | **Lines**: 522

Core hook for governance staking, VP tracking, and deposit/withdraw operations.

### State

```javascript
{
  // VP Data (from backend API)
  stakedRose: string,           // ROSE deposited in governance
  stakedRoseRaw: bigint,
  votingPower: string,          // Current VP = sqrt(staked) * (rep/100)
  votingPowerRaw: bigint,
  availableVP: string,          // VP not delegated or locked
  availableVPRaw: bigint,
  delegatedOut: string,         // VP delegated to others
  delegatedOutRaw: bigint,
  proposalVPLocked: string,     // VP locked to active proposal
  proposalVPLockedRaw: bigint,
  activeProposal: number,       // Proposal ID VP is locked to (0 = none)

  // Token Balances (from contract)
  vRoseBalance: string,         // vROSE receipt token balance
  vRoseBalanceRaw: bigint,
  roseBalance: string,          // ROSE available to deposit
  roseBalanceRaw: bigint,

  // Reputation (from contract)
  reputation: number,           // 0-100 reputation score
  reputationRaw: number,

  // System Totals
  totalStakedRose: string,      // All ROSE in governance
  totalSystemVP: string,        // All VP in system

  // Delegation Received
  totalDelegatedIn: string,     // VP others delegated to you

  // Eligibility (from contract)
  canPropose: boolean,          // Rep >= 90% + 10 tasks
  canVote: boolean,             // Rep >= 70%
  canDelegate: boolean,         // Rep >= 90% + 10 tasks
  userStats: {
    tasksCompleted: number,
    totalTaskValue: bigint,
    disputes: number,
    failedProposals: number,
    lastTaskTimestamp: number,
  },

  // UI State
  loading: { deposit: boolean, withdraw: boolean, vpFetch: boolean },
  error: string | null,
  depositStep: 'checking' | 'approving' | 'approved' | 'depositing' | 'complete' | null,
}
```

### Methods

#### deposit(amount: string)

Deposits ROSE into governance, receives vROSE 1:1.

```javascript
const { deposit, depositStep, loading, error } = useGovernance();

// Usage
try {
  const result = await deposit('100');  // Deposit 100 ROSE
  console.log('Tx hash:', result.hash);
} catch (err) {
  console.error(err.message);
}

// Step tracking for UI progress
// 'checking' → 'approving' → 'approved' → 'depositing' → 'complete'
```

**Flow**:
1. Check ROSE balance
2. Approve governance if needed
3. Call `governance.deposit(amount)`
4. Receive vROSE 1:1
5. VP calculated: sqrt(totalStaked) * (rep/100)

#### withdraw(amount: string)

Withdraws ROSE from governance, burns vROSE.

```javascript
const { withdraw, loading, error } = useGovernance();

try {
  const result = await withdraw('50');  // Withdraw 50 ROSE
} catch (err) {
  // Common errors:
  // - "VP is locked in delegation or proposals"
  // - "Insufficient vROSE balance (may be locked in marketplace tasks)"
}
```

**Requirements**:
- vROSE balance >= amount (not locked in marketplace)
- Available VP >= VP being removed

### Data Sources

- VP breakdown: `GET /api/governance/vp/:address`
- Total VP: `GET /api/governance/total-vp`
- Token balances: Direct contract reads via wagmi

### Auto-Refresh

VP data fetched on mount and account change. Manual refresh via `refetch()`.

---

## useDelegation

**File**: `useDelegation.js` | **Lines**: 667

Multi-delegation management - delegate VP to multiple addresses.

### State

```javascript
{
  // User's VP
  votingPower: string,
  availableVP: string,
  totalDelegatedOut: string,
  totalDelegatedIn: string,
  proposalVPLocked: string,

  // Delegation Arrays
  delegations: Array<{ delegate: string, vpAmount: string }>,
  receivedDelegations: Array<{ delegator: string, vpAmount: string }>,

  // Eligibility
  canDelegate: boolean,
  reputation: number,

  // Claimable Rewards
  claimableRewards: {
    claims: ClaimData[],
    totalReward: string,
  } | null,
  claimableLoading: boolean,

  // Loading States
  isLoading: boolean,
  actionLoading: {
    delegate: boolean,
    undelegate: boolean,
    [`undelegate-${address}`]: boolean,
    [`delegatedVote-${proposalId}`]: boolean,
    claimRewards: boolean,
  },
  error: string | null,
}
```

### Methods

#### delegateTo(address, vpAmount)

Delegate VP to another user (multi-delegation supported).

```javascript
const { delegateTo, availableVP } = useDelegation();

// Delegate 100 VP to delegate
await delegateTo('0x123...', '100');
```

**Errors**:
- `CannotDelegateToSelf`
- `InsufficientAvailableVP`
- `IneligibleToDelegate` - Target doesn't meet 90% rep + 10 tasks

#### undelegateFrom(address, vpAmount)

Remove partial or full delegation from a delegate.

```javascript
const { undelegateFrom, delegations } = useDelegation();

// Remove 50 VP from delegate
await undelegateFrom('0x123...', '50');
```

#### undelegateAll(address)

Remove all VP delegated to a specific delegate.

```javascript
await undelegateAll('0x123...');
```

#### castDelegatedVote(proposalId, vpAmount, support)

Cast vote using delegated VP (backend-signed).

```javascript
const { castDelegatedVote, receivedDelegations } = useDelegation();

// Cast delegated vote (Yay)
const result = await castDelegatedVote(1, '500', true);
console.log('Allocations:', result.allocations);
```

**Flow**:
1. Request signature from backend (`/api/delegation/vote-signature`)
2. Backend computes per-delegator allocations
3. Call contract `castDelegatedVote` with signature
4. Allocations stored in localStorage for reference

#### fetchClaimableRewards()

Fetch pending voter rewards (direct + delegated).

```javascript
const { fetchClaimableRewards, claimableRewards } = useDelegation();

useEffect(() => {
  fetchClaimableRewards();
}, []);

// claimableRewards = { claims: [...], totalReward: '1234...' }
```

#### claimAllRewards()

Claim all pending voter rewards in one transaction.

```javascript
const { claimAllRewards, claimableRewards } = useDelegation();

if (claimableRewards?.claims.length > 0) {
  await claimAllRewards();
  // Rewards added to staked balance (auto-compounds)
}
```

---

## useDelegationForProposal(proposalId)

**File**: `useDelegation.js` | **Lines**: 593-664

Proposal-specific delegation data.

```javascript
const {
  availableDelegatedPower,     // Delegated VP available for this proposal
  delegatedVoteRecord,         // Existing delegated vote { hasVoted, support, totalPowerUsed }
  hasDelegatedVote,            // Boolean shorthand
  totalDelegatedIn,            // Total VP received
  refetch,
} = useDelegationForProposal(proposalId);
```

---

## useVaultData

**File**: `useVaultData.js` | **Lines**: 290

Treasury vault data with 45-second auto-refresh.

### State

```javascript
{
  // NAV Data
  rosePrice: number | null,           // USD per ROSE (6 decimals)
  vaultValueUSD: number | null,       // Total hard asset value
  circulatingSupply: number | null,   // ROSE in circulation

  // Asset Breakdown
  breakdown: {
    btc: { value: number, percentage: number },
    gold: { value: number, percentage: number },
    usdc: { value: number, percentage: number },
    rose: { value: number, percentage: number },
    total: number,
  } | null,

  // User Balances
  roseBalance: number | null,
  roseBalanceRaw: bigint,
  usdcBalance: number | null,
  usdcBalanceRaw: bigint,

  // Allowances
  roseAllowance: number | null,
  roseAllowanceRaw: bigint,
  usdcAllowance: number | null,
  usdcAllowanceRaw: bigint,

  // Cooldowns (seconds until allowed)
  depositCooldown: number,
  redeemCooldown: number,

  // Contract Addresses
  treasuryAddress: string,
  tokenAddress: string,
  usdcAddress: string,

  // Status
  isLoading: boolean,
  isError: boolean,
  isConnected: boolean,
}
```

### Data Sources

Contract reads via wagmi:
- `rosePrice()`, `hardAssetValueUSD()`, `getVaultBreakdown()`, `circulatingSupply()`
- User balances: `balanceOf()`, `allowance()`
- Cooldowns: `timeUntilDeposit()`, `timeUntilRedeem()`

### Auto-Refresh

45-second interval via wagmi `refetchInterval`.

---

## usePassport

**File**: `usePassport.js` | **Lines**: 241

Gitcoin Passport score with 1-hour localStorage caching.

### State

```javascript
{
  score: number | null,         // Passport score (0-100+)
  loading: boolean,
  error: string | null,
  lastUpdated: Date | null,     // When score was fetched
  isCached: boolean,            // Using cached value
  isConfigured: boolean,        // API credentials present
}
```

### Methods

```javascript
const { score, loading, refetch, meetsThreshold } = usePassport();

// Force refresh (bypasses cache)
await refetch();

// Check threshold
const canCreateTask = meetsThreshold(PASSPORT_THRESHOLDS.CREATE_TASK);
```

### Score Priority

1. **Whitelist**: Check `whitelist.json` for test overrides
2. **Cache**: Use localStorage if not expired (1 hour)
3. **API**: Fetch from Gitcoin Scorer API

### Caching

```javascript
// Cache key format
`gitcoin_passport_cache_${address.toLowerCase()}`

// Cached data
{ score: number, timestamp: number }
```

---

## usePassportVerify

**File**: `usePassportVerify.js`

Backend signer communication for passport-gated actions.

### Methods

```javascript
const { getSignature, getSignerAddress, getThresholds, getScore, loading, error } = usePassportVerify();

// Get signature for action
const sig = await getSignature('createTask');
// sig = { address, action, expiry, signature }

// Use signature in contract call
await marketplace.createTask(...args, sig.expiry, sig.signature);
```

### API Endpoints

- `POST /api/passport/verify` - Get signed approval
- `GET /api/passport/score/:address` - Get current score
- `GET /api/passport/signer` - Get signer address
- `GET /api/passport/thresholds` - Get action thresholds

---

## useProfile

**File**: `useProfile.js`

User profile with EIP-712 signing.

### State

```javascript
{
  profile: {
    address: string,
    name: string,
    bio: string,
    avatar: string,
    skills: string[],
    github: string,
    twitter: string,
    website: string,
  } | null,
  isLoading: boolean,
  error: string | null,
  isAuthenticated: boolean,
}
```

### Methods

```javascript
const { profile, updateProfile, getProfile, refreshProfile } = useProfile();

// Fetch any user's profile
const userProfile = await getProfile('0x123...');

// Update own profile (currently disabled)
await updateProfile({
  name: 'Alice',
  bio: 'Web3 developer',
  skills: ['solidity', 'react'],
});
```

**Note**: Profile editing is currently disabled (display-only stub).

---

## useReputation

**File**: `useReputation.js`

On-chain reputation with 5-minute cache.

### State

```javascript
{
  reputation: {
    tasksAsWorker: number,      // Tasks completed as worker
    tasksAsStakeholder: number, // Tasks validated
    tasksAsCustomer: number,    // Tasks created
    tasksClaimed: number,       // Tasks currently claimed
    totalEarned: string,        // Total ROSE earned
    reputationScore: number,    // 0-100 on-chain score
    canPropose: boolean,
    canVote: boolean,
    canDelegate: boolean,
    governanceStats: {
      tasksCompleted: number,
      totalTaskValue: string,
      disputes: number,
      failedProposals: number,
    },
  },
  loading: boolean,
}
```

### Data Sources

- RoseMarketplace events: TaskCompleted, TaskClaimed, TaskCreated
- RoseGovernance.getReputation(): On-chain reputation score
- RoseGovernance.userStats(): Governance-specific stats

### Cache

5-minute in-memory cache to avoid excessive RPC calls.

---

## useNotifications

**File**: `useNotifications.js`

Toast notification system.

```javascript
const { addNotification, notifications, removeNotification } = useNotifications();

// Add notification
addNotification({
  type: 'success' | 'error' | 'info' | 'warning',
  message: 'Transaction confirmed!',
  duration: 5000,  // Auto-dismiss after 5s
});
```

---

## Error Handling Pattern

All hooks use this error parsing pattern:

```javascript
function parseTransactionError(err) {
  const msg = err?.message || '';

  if (msg.includes('User rejected')) return 'Transaction rejected by user';
  if (msg.includes('nonce too low')) return 'Nonce conflict - refresh and retry';
  if (msg.includes('insufficient funds')) return 'Insufficient ETH for gas fees';
  if (msg.includes('VPLocked')) return 'VP is locked in delegation or proposals';

  return 'Transaction failed - please try again';
}
```

---

## Wagmi Contract Read Pattern

Hooks use batched contract reads:

```javascript
const { data, refetch } = useReadContracts({
  contracts: [
    { address, abi, functionName: 'balanceOf', args: [account] },
    { address, abi, functionName: 'allowance', args: [account, spender] },
  ],
  query: {
    enabled: isConnected && !!account,
    refetchInterval: 45000,
  },
});

// Parse results
const balance = data?.[0]?.status === 'success' ? data[0].result : 0n;
```
