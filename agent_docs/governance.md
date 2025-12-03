# Governance System

## Overview

Two-token governance with quadratic voting and multi-delegation.

**Contracts**:
- `RoseGovernance.sol` (1024 lines) - Proposal lifecycle, voting, delegation
- `vROSE.sol` (205 lines) - Soulbound receipt token for stakeholder collateral

## Vote Power Formula

```
VP = √(staked_ROSE) × (reputation_score / 100)
```

## Eligibility Thresholds

| Action | Requirement |
|--------|-------------|
| Propose | 90% reputation + 10 tasks completed |
| Vote | 70% reputation |
| Delegate | 90% reputation + 10 tasks completed |
| Quorum | 33% of total staked ROSE |
| Pass | 7/12 (58.33%) Yay votes |

## Reputation System

**Decay Periods**:
- Tasks count for 1 year (`TASK_DECAY_PERIOD = 365 days`)
- Disputes count for 3 years (`DISPUTE_DECAY_PERIOD = 1095 days`)

**Cold Start**:
- Default 60% reputation until 10 tasks completed
- After 10 tasks, full reputation calculation applies

## Proposal Lifecycle

```
Active → [Voting 2 weeks] → Passed/Failed
  ↓                            ↓
Quorum not met → timer resets  Failed → Nay voters get 2% mint
  ↓                            ↓
Max 4 edit cycles              Passed → Execute → DAO Task Created
```

**States**: Active(0), Passed(1), Failed(2), Executed(3), Cancelled(4)

## DAO Task Rewards

Minted on proposal execution/completion:
- **Treasury**: 2%
- **Yay voters**: 2% (split by vote power)
- **Proposer**: 1%

## Two-Token System

| Token | Purpose |
|-------|---------|
| ROSE | Locked in governance, allocated to votes/delegates |
| vROSE | 1:1 receipt token, used for stakeholder escrow in marketplace |

**Withdrawal Requirements**:
1. vROSE returned (not locked in active task)
2. ROSE unallocated (manually unvote/undelegate)

## Voting Mechanics

**Vote Splitting**:
- Users can increase existing vote allocation (same direction only)
- Cannot change vote direction after voting (Yay→Nay or vice versa)

**Gas-Optimized Delegated Voting**:
1. Delegates cast votes using `castDelegatedVote()`
2. Backend computes per-delegator allocations off-chain, signs approval
3. Contract verifies signature and stores aggregate + allocations hash
4. Avoids O(n) on-chain loops over delegators

## Voter Rewards System

**Pooling** (O(1) gas):
- Rewards pooled at proposal resolution, no voter loops

**Claiming**:
- Users claim via `claimVoterRewards()` with backend signature
- Supports both direct votes and delegated votes in single batch claim
- Rewards added to stakedRose balance (can vote or withdraw)

## Multi-Delegation

- Users can delegate different VP amounts to multiple delegates
- Delegates receive VP proportional to delegation amount
- Delegates can use delegated power in votes (with backend signature)

## Frontend Pages

| Route | Purpose |
|-------|---------|
| `/governance` | Proposal dashboard |
| `/governance/propose` | Create proposal (90% rep + passport required) |
| `/governance/:id` | Vote on proposal |
| `/governance/my-votes` | Personal governance dashboard |
| `/delegates` | Browse and manage delegation |

## Frontend Hooks

### useGovernance
```javascript
State: { stakedRose, votingPower, availableVP, delegatedOut, proposalVPLocked, vRoseBalance, reputation, totalSystemVP }
Methods: deposit(amount), withdraw(amount), refetch()
Data sources: Backend /api/governance/vp + contract calls
```

### useProposals
```javascript
State: { proposals, userVotes, loading }
Methods: createProposal(data), vote(proposalId, vpAmount, support), voteCombined(...),
         freeVP(proposalId), finalizeProposal(proposalId), executeProposal(proposalId), cancelProposal(proposalId)
Filters: active, passed, executed, failed, myProposals, myVotes
```

### useDelegation
```javascript
State: { delegations, receivedDelegations, availableDelegatedPower }
Methods: delegateTo(address, vpAmount), undelegateFrom(address, vpAmount), undelegateAll(),
         castDelegatedVote(...), fetchClaimableRewards(), claimAllRewards()
```

### useReputation
```javascript
Returns: { reputation: { tasksAsWorker, tasksAsStakeholder, tasksAsCustomer, totalEarned,
           reputationScore, canPropose, canVote, canDelegate, governanceStats }, loading }
Sources: Contract getReputation() + RoseMarketplace events
```

## Frontend Components

| Component | Purpose |
|-----------|---------|
| `StakingPanel.jsx` | Deposit/withdraw ROSE for governance |
| `ClaimRewardsPanel.jsx` | View and claim pending voter rewards |
| `VotePanel.jsx` | Vote on proposals with own/delegated power |
| `DelegateCard.jsx` | Delegate profile and delegation form |
| `ProposalCard.jsx` | Compact proposal display |
| `ProposalFilters.jsx` | Status/sort/personal filters |
| `QuorumBar.jsx` | Visual quorum progress indicator |
| `ReputationBadge.jsx` | Color-coded reputation display |

## Backend API

| Endpoint | Purpose |
|----------|---------|
| GET `/api/governance/vp/:address` | VP breakdown |
| GET `/api/governance/total-vp` | Total system VP |
| GET `/api/governance/delegations/:address` | Outgoing delegations |
| GET `/api/governance/received/:delegate` | Incoming delegations |
| GET `/api/governance/reputation/:address` | Reputation score |
| POST `/api/governance/vote-signature` | Direct vote signature |
| POST `/api/delegation/vote-signature` | Delegated vote signature |
| POST `/api/delegation/claim-signature` | Reward claim signature |
