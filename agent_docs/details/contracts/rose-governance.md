# RoseGovernance.sol - Detailed Documentation

**Parent**: [contracts.md](../../contracts.md) | **Location**: `contracts/RoseGovernance.sol` | **Lines**: 1024

## Overview

RoseGovernance implements decentralized governance with quadratic voting, multi-delegation, reputation-based eligibility, and voter rewards. VP (Voting Power) is calculated at deposit time.

## Contract Architecture

```solidity
contract RoseGovernance is IRoseGovernance, ReentrancyGuard {
    // Token references
    IERC20 public immutable roseToken;
    IvROSE public immutable vRoseToken;

    // Core VP tracking
    mapping(address => uint256) public stakedRose;
    mapping(address => uint256) public votingPower;
    uint256 public totalStakedRose;
    uint256 public totalVotingPower;

    // Multi-delegation
    mapping(address => mapping(address => uint256)) public delegatedVP;
    mapping(address => uint256) public totalDelegatedOut;
    mapping(address => uint256) public totalDelegatedIn;
}
```

## Vote Power Formula

```solidity
function getVotePower(uint256 amount, uint256 reputation) public pure returns (uint256) {
    if (amount == 0 || reputation == 0) return 0;
    uint256 sqrtAmount = _sqrt(amount);
    return (sqrtAmount * reputation) / 100;
}

// Integer square root using Babylonian method
function _sqrt(uint256 x) internal pure returns (uint256) {
    if (x == 0) return 0;
    uint256 z = (x + 1) / 2;
    uint256 y = x;
    while (z < y) {
        y = z;
        z = (x / z + z) / 2;
    }
    return y;
}
```

**Example**: 1000 ROSE staked with 80% reputation:
- sqrt(1000e18) ≈ 31.62e9
- VP = 31.62e9 * 80 / 100 = 25.3e9

## Constants

### Voting Parameters

| Constant | Value | Purpose |
|----------|-------|---------|
| `VOTING_PERIOD` | 2 weeks | Proposal voting window |
| `QUORUM_THRESHOLD` | 3300 (33%) | Min VP participation for valid vote |
| `PASS_THRESHOLD` | 5833 (58.33%) | 7/12 supermajority required |
| `MAX_EDIT_CYCLES` | 4 | Proposal edit limit |
| `BASIS_POINTS` | 10000 | Percentage denominator |

### Reputation Parameters

| Constant | Value | Purpose |
|----------|-------|---------|
| `COLD_START_TASKS` | 10 | Tasks before full reputation |
| `DEFAULT_REPUTATION` | 60 | Cold start reputation score |
| `TASK_DECAY_PERIOD` | 365 days | Task reputation relevance |
| `DISPUTE_DECAY_PERIOD` | 1095 days (3 years) | Dispute penalty duration |
| `PROPOSER_REP_THRESHOLD` | 90 | Min reputation to propose |
| `VOTER_REP_THRESHOLD` | 70 | Min reputation to vote |
| `DELEGATE_REP_THRESHOLD` | 90 | Min reputation to be delegate |

### Reward Percentages

| Constant | Value | Purpose |
|----------|-------|---------|
| `DAO_MINT_PERCENT` | 200 (2%) | Treasury reward on task completion |
| `YAY_VOTER_REWARD` | 200 (2%) | Yay voters split on passed proposals |
| `NAY_VOTER_REWARD` | 200 (2%) | Nay voters split on failed proposals |
| `PROPOSER_REWARD` | 100 (1%) | Proposer reward on execution |

## Staking System

### Deposit

```solidity
function deposit(uint256 amount) external nonReentrant {
    if (amount == 0) revert ZeroAmount();

    // Transfer ROSE to governance
    roseToken.safeTransferFrom(msg.sender, address(this), amount);

    // Mint vROSE receipt token 1:1
    vRoseToken.mint(msg.sender, amount);

    // Calculate VP at deposit time
    uint256 rep = getReputation(msg.sender);
    uint256 newTotalStaked = stakedRose[msg.sender] + amount;
    uint256 newVP = getVotePower(newTotalStaked, rep);
    uint256 oldVP = votingPower[msg.sender];
    uint256 vpIncrease = newVP - oldVP;

    // Update state
    stakedRose[msg.sender] = newTotalStaked;
    votingPower[msg.sender] = newVP;
    totalStakedRose += amount;
    totalVotingPower += vpIncrease;

    emit Deposited(msg.sender, amount);
}
```

### Withdraw

```solidity
function withdraw(uint256 amount) external nonReentrant {
    if (amount == 0) revert ZeroAmount();
    if (stakedRose[msg.sender] < amount) revert InsufficientStake();

    // Calculate available VP (not delegated, not on proposals)
    uint256 currentVP = votingPower[msg.sender];
    uint256 lockedVP = totalDelegatedOut[msg.sender] + proposalVPLocked[msg.sender];
    uint256 availableVP = currentVP > lockedVP ? currentVP - lockedVP : 0;

    // Calculate VP being withdrawn
    uint256 newTotalStaked = stakedRose[msg.sender] - amount;
    uint256 rep = getReputation(msg.sender);
    uint256 newVP = getVotePower(newTotalStaked, rep);
    uint256 vpDecrease = currentVP - newVP;

    if (availableVP < vpDecrease) revert VPLocked();

    // Check vROSE balance (may be locked in marketplace tasks)
    uint256 vRoseBalance = vRoseToken.balanceOf(msg.sender);
    if (vRoseBalance < amount) revert InsufficientVRose();

    // Burn vROSE
    vRoseToken.burn(msg.sender, amount);

    // Update state
    stakedRose[msg.sender] = newTotalStaked;
    votingPower[msg.sender] = newVP;
    totalStakedRose -= amount;
    totalVotingPower -= vpDecrease;

    // Transfer ROSE back
    roseToken.safeTransfer(msg.sender, amount);

    emit Withdrawn(msg.sender, amount);
}
```

## Multi-Delegation System

### Delegate VP

```solidity
function delegate(address delegateAddr, uint256 vpAmount) external nonReentrant {
    if (delegateAddr == address(0)) revert ZeroAddress();
    if (delegateAddr == msg.sender) revert CannotDelegateToSelf();
    if (vpAmount == 0) revert ZeroAmount();
    if (!canVote(msg.sender)) revert IneligibleToVote();
    if (!canDelegate(delegateAddr)) revert IneligibleToDelegate();

    // Check available VP
    uint256 availableVP = getAvailableVP(msg.sender);
    if (availableVP < vpAmount) revert InsufficientAvailableVP();

    // Track new delegation target
    if (delegatedVP[msg.sender][delegateAddr] == 0) {
        _delegationTargets[msg.sender].push(delegateAddr);
        _delegators[delegateAddr].add(msg.sender);
    }

    // Update delegation
    delegatedVP[msg.sender][delegateAddr] += vpAmount;
    totalDelegatedOut[msg.sender] += vpAmount;
    totalDelegatedIn[delegateAddr] += vpAmount;

    emit DelegationChanged(msg.sender, delegateAddr, vpAmount, true);
}
```

### Undelegate VP

```solidity
function undelegate(address delegateAddr, uint256 vpAmount) external nonReentrant {
    if (vpAmount == 0) revert ZeroAmount();
    if (delegatedVP[msg.sender][delegateAddr] < vpAmount) revert InsufficientDelegated();

    delegatedVP[msg.sender][delegateAddr] -= vpAmount;
    totalDelegatedOut[msg.sender] -= vpAmount;
    totalDelegatedIn[delegateAddr] -= vpAmount;

    // Remove from targets if fully undelegated
    if (delegatedVP[msg.sender][delegateAddr] == 0) {
        _removeDelegationTarget(msg.sender, delegateAddr);
        _delegators[delegateAddr].remove(msg.sender);
    }

    emit DelegationChanged(msg.sender, delegateAddr, vpAmount, false);
}
```

## Voting System

### Direct Vote

VP is locked to ONE proposal at a time:

```solidity
function vote(
    uint256 proposalId,
    uint256 vpAmount,
    bool support,
    uint256 expiry,
    bytes calldata signature
) external nonReentrant {
    // Verify passport signature
    _verifySignature("vote", msg.sender, proposalId, vpAmount, support, expiry, signature);

    // Proposal validations
    Proposal storage p = _proposals[proposalId];
    if (p.status != ProposalStatus.Active) revert ProposalNotActive();
    if (block.timestamp > p.votingEndsAt) revert ProposalNotActive();
    if (p.proposer == msg.sender) revert CannotVoteOnOwnProposal();
    if (!canVote(msg.sender)) revert IneligibleToVote();

    // Check VP not locked to another proposal
    uint256 existingProposal = allocatedToProposal[msg.sender];
    if (existingProposal != 0 && existingProposal != proposalId) {
        revert VPLockedToAnotherProposal();
    }

    // Check available VP
    uint256 availableVP = getAvailableVP(msg.sender);
    if (availableVP < vpAmount) revert InsufficientAvailableVP();

    // Check vote direction (can increase, cannot change)
    Vote storage v = _votes[proposalId][msg.sender];
    if (v.hasVoted && v.support != support) revert CannotChangeVoteDirection();

    // Lock VP to proposal
    allocatedToProposal[msg.sender] = proposalId;
    proposalVPLocked[msg.sender] += vpAmount;

    // Record vote
    v.hasVoted = true;
    v.support = support;
    v.votePower += vpAmount;

    // Update proposal totals
    if (support) {
        p.yayVotes += vpAmount;
    } else {
        p.nayVotes += vpAmount;
    }
}
```

### Delegated Vote (Backend-Signed)

```solidity
function castDelegatedVote(
    uint256 proposalId,
    uint256 amount,
    bool support,
    bytes32 allocationsHash,  // Hash of per-delegator allocations
    uint256 expiry,
    bytes calldata signature
) external nonReentrant {
    // Verify delegation signer signature
    _verifyDelegationSignature(...);

    // Check delegate has enough received VP
    uint256 available = getAvailableDelegatedPower(msg.sender, proposalId);
    if (amount > available) revert InsufficientDelegatedPower();

    // Store allocation hash for reward verification
    allocationHashes[proposalId][msg.sender] = allocationsHash;

    // Update tracking
    delegatedVoteAllocated[proposalId][msg.sender] += amount;

    // Update proposal
    if (support) {
        p.yayVotes += amount;
    } else {
        p.nayVotes += amount;
    }
}
```

## Proposal Lifecycle

### Create Proposal

```solidity
function propose(
    string calldata title,
    string calldata descriptionHash,  // IPFS hash
    uint256 value,
    uint256 deadline,
    string calldata deliverables,
    uint256 expiry,
    bytes calldata signature
) external requiresPassport("propose", expiry, signature) returns (uint256) {
    if (!canPropose(msg.sender)) revert IneligibleToPropose();

    // Validate treasury can fund proposal
    uint256 treasuryBalance = roseToken.balanceOf(treasury);
    if (value > treasuryBalance) revert ProposalValueExceedsTreasury();

    proposalCounter++;
    uint256 proposalId = proposalCounter;

    _proposals[proposalId] = Proposal({
        proposer: msg.sender,
        title: title,
        descriptionHash: descriptionHash,
        value: value,
        deadline: deadline,
        deliverables: deliverables,
        createdAt: block.timestamp,
        votingEndsAt: block.timestamp + VOTING_PERIOD,
        yayVotes: 0,
        nayVotes: 0,
        status: ProposalStatus.Active,
        editCount: 0,
        taskId: 0
    });

    return proposalId;
}
```

### Finalize Proposal

```solidity
function finalizeProposal(uint256 proposalId) external {
    Proposal storage p = _proposals[proposalId];
    if (p.status != ProposalStatus.Active) revert ProposalNotActive();
    if (block.timestamp <= p.votingEndsAt) revert ProposalNotEnded();

    // Check quorum
    uint256 totalVotes = p.yayVotes + p.nayVotes;
    uint256 requiredQuorum = (totalVotingPower * QUORUM_THRESHOLD) / BASIS_POINTS;

    if (totalVotes < requiredQuorum) {
        // Reset voting period, don't finalize
        p.votingEndsAt = block.timestamp + VOTING_PERIOD;
        return;
    }

    uint256 yayPercent = (p.yayVotes * BASIS_POINTS) / totalVotes;

    if (yayPercent >= PASS_THRESHOLD) {
        p.status = ProposalStatus.Passed;
    } else {
        p.status = ProposalStatus.Failed;
        _userStats[p.proposer].failedProposals++;
        _distributeNayRewards(proposalId);  // Mint rewards to nay voters
    }
}
```

### Execute Proposal

```solidity
function executeProposal(uint256 proposalId) external nonReentrant {
    Proposal storage p = _proposals[proposalId];
    if (p.status != ProposalStatus.Passed) revert ProposalNotActive();

    // Create DAO task in marketplace
    uint256 taskId = IRoseMarketplace(marketplace).createDAOTask(
        p.proposer,
        p.title,
        p.value,
        p.descriptionHash,
        proposalId
    );

    p.taskId = taskId;
    p.status = ProposalStatus.Executed;
}
```

## Reputation System

```solidity
function getReputation(address user) public view returns (uint256) {
    TaskRecord[] memory history = _taskHistory[user];
    uint256 failedProposals = _userStats[user].failedProposals;

    uint256 taskCutoff = block.timestamp - TASK_DECAY_PERIOD;
    uint256 disputeCutoff = block.timestamp - DISPUTE_DECAY_PERIOD;

    uint256 recentTaskCount = 0;
    uint256 recentTaskValue = 0;
    uint256 recentDisputes = 0;

    for (uint256 i = 0; i < history.length; i++) {
        TaskRecord memory record = history[i];

        if (record.isDispute) {
            if (record.timestamp >= disputeCutoff) {
                recentDisputes++;
            }
        } else {
            if (record.timestamp >= taskCutoff) {
                recentTaskCount++;
                recentTaskValue += record.value;
            }
        }
    }

    // Cold start: default 60% until 10 tasks
    if (recentTaskCount < COLD_START_TASKS) {
        return DEFAULT_REPUTATION;
    }

    // Penalties: disputes + failed proposals/5
    uint256 penalties = recentDisputes + (failedProposals / 5);
    if (penalties >= recentTaskCount) {
        return 0;
    }

    uint256 effectiveValue = recentTaskValue - (penalties * recentTaskValue / recentTaskCount);
    return (effectiveValue * 100) / recentTaskValue;
}
```

## Voter Rewards

### Pool Creation (O(1))

```solidity
function _distributeYayRewards(uint256 proposalId, uint256 totalReward) internal {
    Proposal storage p = _proposals[proposalId];
    if (p.yayVotes == 0) return;

    // Mint rewards to governance contract
    IRoseToken(address(roseToken)).mint(address(this), totalReward);

    // Store pool data for later claims
    voterRewardPool[proposalId] = totalReward;
    voterRewardTotalVotes[proposalId] = p.yayVotes;
    voterRewardOutcome[proposalId] = true;  // Yay won
}
```

### Claim Rewards (Backend-Signed)

```solidity
function claimVoterRewards(
    ClaimData[] calldata claims,
    uint256 expiry,
    bytes calldata signature
) external nonReentrant {
    // Verify signature
    _verifyClaimSignature(claims, expiry, signature);

    uint256 totalReward = 0;
    for (uint256 i = 0; i < claims.length; i++) {
        ClaimData calldata c = claims[i];

        // Calculate proportional reward
        uint256 reward = (voterRewardPool[c.proposalId] * c.votePower)
                        / voterRewardTotalVotes[c.proposalId];

        // Mark as claimed
        if (c.claimType == ClaimType.DirectVoter) {
            directVoterRewardClaimed[c.proposalId][msg.sender] = true;
        } else {
            delegatorRewardClaimed[c.proposalId][c.delegate][msg.sender] = true;
        }

        totalReward += reward;
    }

    // Add to staked balance (auto-compounds)
    if (totalReward > 0) {
        stakedRose[msg.sender] += totalReward;
        // Recalculate VP
        votingPower[msg.sender] = getVotePower(stakedRose[msg.sender], getReputation(msg.sender));
    }
}
```

## Custom Errors

```solidity
error IneligibleToPropose();        // Rep <90% or <10 tasks
error IneligibleToVote();           // Rep <70%
error IneligibleToDelegate();       // Rep <90% or <10 tasks
error ProposalNotActive();          // Wrong status
error CannotVoteOnOwnProposal();    // Proposer can't vote
error CannotChangeVoteDirection();  // Can't switch Yay↔Nay
error VPLockedToAnotherProposal();  // VP already allocated
error InsufficientAvailableVP();    // Not enough free VP
error MaxEditCyclesReached();       // Exceeded 4 edits
error InsufficientDelegatedPower(); // Delegate doesn't have enough VP
error VPLocked();                   // VP locked, can't withdraw
error InsufficientVRose();          // vROSE locked in marketplace
```

## Structs

```solidity
struct Proposal {
    address proposer;
    string title;
    string descriptionHash;
    uint256 value;
    uint256 deadline;
    string deliverables;
    uint256 createdAt;
    uint256 votingEndsAt;
    uint256 yayVotes;
    uint256 nayVotes;
    ProposalStatus status;
    uint256 editCount;
    uint256 taskId;
}

struct Vote {
    bool hasVoted;
    bool support;
    uint256 votePower;
}

struct UserStats {
    uint256 tasksCompleted;
    uint256 totalTaskValue;
    uint256 disputes;
    uint256 failedProposals;
    uint256 lastTaskTimestamp;
}

struct TaskRecord {
    uint256 timestamp;
    uint256 value;
    bool isDispute;
}

struct ClaimData {
    uint256 proposalId;
    ClaimType claimType;
    address delegate;
    uint256 votePower;
}
```

## State Machine

```
Active → [Voting 2 weeks] → Passed/Failed
  ↓                            ↓
Quorum not met → timer resets  Failed → Nay voters get 2% mint
  ↓                            ↓
Max 4 edit cycles              Passed → Execute → DAO Task Created
                                          ↓
                               Task Completed → Yay voters + Proposer rewarded
```
