# Frontend Architecture

## Stack

React 18 + Vite + Wagmi/RainbowKit + TailwindCSS

## Directory Structure

```
frontend/src/
├── pages/                    # Route components
├── components/
│   ├── marketplace/          # TaskCard, TaskList, TaskFilters, CreateTaskForm
│   ├── vault/                # VaultStats, VaultAllocation, DepositCard, RedeemCard
│   ├── governance/           # StakingPanel, VotePanel, ProposalCard, DelegateCard
│   ├── wallet/               # TokenBalance, NetworkSelector
│   └── profile/              # ProfileCard, SkillBadge, ReputationStats
├── hooks/                    # Custom React hooks
├── constants/                # Config files
├── utils/ipfs/               # Pinata service
└── contracts/                # Auto-generated ABIs
```

## Routes

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

## Context Provider Hierarchy

```
WagmiProvider (wagmi config)
  └─ QueryClientProvider (react-query)
      └─ RainbowKitProvider (wallet UI)
          └─ ProfileProvider (useProfile)
              └─ PassportProvider (usePassport)
                  └─ PassportVerifyProvider (usePassportVerify)
                      └─ Router → Layout → Routes
```

## Hooks

### useVaultData
Treasury data with 45-second auto-refresh.
```javascript
{
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
```

### usePassport
Gitcoin Passport score with 1-hour localStorage caching.
```javascript
{ score, loading, error, lastUpdated, isCached }
Methods: loadScore(forceRefresh), refetch(), meetsThreshold(threshold)
```

### usePassportVerify
Backend signer communication.
```javascript
{ loading, error, lastSignature, lastAction }
Methods: getSignature(action), getSignerAddress(), getThresholds(), getScore(), clearError()
```

### useProfile
User profile with EIP-712 signing (edit currently disabled).
```javascript
{ profile, isLoading, error, isAuthenticated }
Methods: updateProfile(data), getProfile(address), refreshProfile()
```

### useReputation
On-chain reputation with 5-minute cache.
```javascript
{
  reputation: {
    tasksAsWorker, tasksAsStakeholder, tasksAsCustomer, tasksClaimed,
    totalEarned, reputationScore, canPropose, canVote, canDelegate,
    governanceStats
  },
  loading
}
// Sources: RoseMarketplace events + RoseGovernance.getReputation()
```

### useGovernance
Core governance state from backend `/api/governance/vp` + contract calls.
```javascript
{ stakedRose, votingPower, availableVP, delegatedOut, proposalVPLocked, vRoseBalance, reputation, totalSystemVP }
Methods: deposit(amount), withdraw(amount), refetch()
```

### useProposals
Proposal lifecycle management.
```javascript
{ proposals, userVotes, loading }
Methods: createProposal(data), vote(...), voteCombined(...), freeVP(proposalId),
         finalizeProposal(proposalId), executeProposal(proposalId), cancelProposal(proposalId)
Filters: active, passed, executed, failed, myProposals, myVotes
```

### useDelegation
Multi-delegation management.
```javascript
{ delegations, receivedDelegations, availableDelegatedPower }
Methods: delegateTo(address, vpAmount), undelegateFrom(address, vpAmount), undelegateAll(),
         castDelegatedVote(...), fetchClaimableRewards(), claimAllRewards()
```

## Constants

### contracts.js
- Contract addresses: TOKEN, TREASURY, MARKETPLACE, GOVERNANCE, VROSE, USDC
- `ProposalStatus` enum: Active(0), Passed(1), Failed(2), Executed(3), Cancelled(4)
- `calculateVotePower(stakedAmount, reputation)`: sqrt(staked) × (rep/100)
- `formatVotePower(vp)`: K notation for large numbers

### passport.js
- `PASSPORT_THRESHOLDS`: CREATE_TASK=20, STAKE=20, CLAIM_TASK=20, PROPOSE=25
- `PASSPORT_CONFIG`: API URL, cacheTTL=1h, timeout=10s
- `PASSPORT_LEVELS`: HIGH(30+), MEDIUM(20+), LOW(1+), NONE(0)

### networks.js
- `NETWORK_IDS`: ARBITRUM=42161, ARBITRUM_SEPOLIA=421614
- `DEFAULT_NETWORK`: Arbitrum Sepolia (testnet)

### skills.js
- 15 predefined skills in 6 categories
- `MAX_SKILLS`: 10 per profile
- Utilities: `getSkillById()`, `getSkillsByCategory()`, `validateSkills()`

## Passport System

**Components**:
- `PassportGate` - Conditional rendering based on score threshold
- `PassportStatus` - Score display (compact badge or full card)

**Integration Points**:
- Header: Compact PassportStatus badge
- CreateTaskForm: Wrapped in PassportGate (threshold: 20)
- ProfilePage: Full PassportStatus in "Sybil Resistance" section

## Profile System

**Status**: Profile editing currently disabled (display-only). PostgreSQL backend planned.

**Components** (`components/profile/`):
- `SkillBadge.jsx` - Skill pill with category color
- `SkillSelect.jsx` - Multi-select (max 10 skills)
- `ProfileBadge.jsx` - Avatar + name display
- `ProfileCard.jsx` - Full profile display
- `ProfileModal.jsx` - Edit form (shows "coming soon")
- `ProfileViewModal.jsx` - Read-only viewer
- `ReputationStats.jsx` - Task counts from on-chain events

## Governance Components

- `StakingPanel.jsx` - Deposit/withdraw ROSE for governance
- `ClaimRewardsPanel.jsx` - View and claim pending voter rewards
- `VotePanel.jsx` - Vote on proposals with own/delegated power
- `DelegateCard.jsx` - Delegate profile and delegation form
- `ProposalCard.jsx` - Compact proposal display
- `ProposalFilters.jsx` - Status/sort/personal filters
- `QuorumBar.jsx` - Visual quorum progress indicator
- `ReputationBadge.jsx` - Color-coded reputation display

## Styling

Use CSS variables in `index.css` with semantic Tailwind classes:
- `bg-primary`, `bg-secondary`, `bg-accent`
- `text-primary`, `text-secondary`, `text-accent`

**Never use hardcoded colors** - always use semantic classes.
