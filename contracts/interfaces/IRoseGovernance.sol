// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IRoseGovernance
 * @dev Interface for the Rose Token governance contract
 *
 * VP-Centric Model:
 * - VP = sqrt(staked ROSE) * (reputation / 100)
 * - VP calculated at deposit time and stored
 * - Multi-delegation: users can split VP across multiple delegates
 * - VP locked to ONE proposal at a time
 */
interface IRoseGovernance {
    // ============ Enums ============

    enum ProposalStatus {
        Active,
        Passed,
        Failed,
        Executed,
        Cancelled
    }

    // ============ Structs ============

    struct UserStats {
        uint256 tasksCompleted;
        uint256 totalTaskValue;
        uint256 disputes;
        uint256 failedProposals;
        uint256 lastTaskTimestamp;
    }

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
        uint256 totalAllocated;
        ProposalStatus status;
        uint256 editCount;
        uint256 taskId;
    }

    struct Vote {
        bool hasVoted;
        bool support;
        uint256 votePower;
        uint256 allocatedAmount;  // Legacy field, not used in VP model
    }

    struct DelegatedVoteRecord {
        bool hasVoted;
        bool support;
        uint256 totalPowerUsed;
    }

    // ============ Events ============

    // Staking events
    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);

    // VP tracking events
    event VotingPowerChanged(address indexed user, uint256 stakedRose, uint256 votingPower, uint256 reputation);
    event TotalVPUpdated(uint256 newTotalVP);

    // Delegation events (multi-delegation)
    event DelegationChanged(address indexed delegator, address indexed delegate, uint256 vpAmount, bool isDelegating);

    // Legacy delegation events (kept for compatibility)
    event DelegatedTo(address indexed delegator, address indexed delegate, uint256 amount);
    event Undelegated(address indexed delegator, address indexed delegate, uint256 amount);
    event DelegationRefreshed(address indexed user, uint256 oldPower, uint256 newPower);

    // Proposal events
    event ProposalCreated(uint256 indexed proposalId, address indexed proposer, uint256 value);
    event ProposalEdited(uint256 indexed proposalId, uint256 editCount);
    event ProposalCancelled(uint256 indexed proposalId);
    event ProposalFinalized(uint256 indexed proposalId, ProposalStatus status);
    event ProposalExecuted(uint256 indexed proposalId, uint256 taskId);

    // Voting events
    event VoteCast(uint256 indexed proposalId, address indexed voter, bool support, uint256 votePower);
    event VoteIncreased(uint256 indexed proposalId, address indexed voter, uint256 additionalAmount, uint256 newVotePower);
    event VPAllocatedToProposal(uint256 indexed proposalId, address indexed voter, uint256 vpAmount, bool support, bool isDelegatedVote);
    event VPFreedFromProposal(uint256 indexed proposalId, address indexed voter, uint256 vpAmount);

    // Delegated voting events
    event DelegatedVoteCast(uint256 indexed proposalId, address indexed delegate, bool support, uint256 votePower);
    event DelegatedVoteIncreased(uint256 indexed proposalId, address indexed delegate, uint256 additionalPower, uint256 newTotalPower);
    event VoteUnallocated(uint256 indexed proposalId, address indexed voter, uint256 amount);

    // Reward events
    event RewardsDistributed(uint256 indexed proposalId, uint256 totalRewards);
    event RewardClaimed(address indexed user, uint256 amount);
    event VoterRewardPoolCreated(uint256 indexed proposalId, uint256 poolAmount, uint256 totalVotes, bool support);
    event DirectVoterRewardClaimed(uint256 indexed proposalId, address indexed voter, uint256 amount);
    event DelegatorRewardClaimed(uint256 indexed proposalId, address indexed delegate, address indexed delegator, uint256 amount);
    event TotalRewardsClaimed(address indexed user, uint256 totalAmount);

    // Admin events
    event UserStatsUpdated(address indexed user, uint256 tasksCompleted, uint256 totalTaskValue);
    event PassportSignerUpdated(address indexed newSigner);
    event DelegationSignerUpdated(address indexed newSigner);

    // ============ Errors ============

    error NotOwner();
    error NotMarketplace();
    error NotTreasury();
    error ZeroAddress();
    error ZeroAmount();
    error InsufficientStake();
    error InsufficientUnallocated();
    error InsufficientVRose();
    error InvalidSignature();
    error SignatureExpired();
    error SignatureAlreadyUsed();
    error ZeroAddressSigner();
    error IneligibleToPropose();
    error IneligibleToVote();
    error IneligibleToDelegate();
    error ProposalNotActive();
    error ProposalNotEnded();
    error ProposalValueExceedsTreasury();
    error AlreadyVoted();
    error CannotVoteOnOwnProposal();
    error ProposalNotFound();
    error MaxEditCyclesReached();
    error OnlyProposerCanEdit();
    error OnlyProposerCanCancel();
    error AlreadyDelegating();
    error NotDelegating();
    error DelegationChainNotAllowed();
    error CannotDelegateToSelf();
    error QuorumNotMet();
    error TaskNotFromProposal();
    error CannotChangeVoteDirection();
    error InsufficientDelegatedPower();
    error InvalidDelegationSignature();
    error ZeroAddressDelegationSigner();
    error NoRewardPool();
    error AlreadyClaimed();
    error EmptyClaims();

    // New VP-related errors
    error VPLocked();
    error VPLockedToAnotherProposal();
    error InsufficientAvailableVP();
    error InsufficientDelegated();

    // ============ Enums for Claims ============

    enum ClaimType { DirectVoter, Delegator }

    // ============ Structs for Claims ============

    struct ClaimData {
        uint256 proposalId;
        ClaimType claimType;
        address delegate;
        uint256 votePower;
    }

    // ============ View Functions ============

    // Core state
    function stakedRose(address user) external view returns (uint256);
    function votingPower(address user) external view returns (uint256);
    function totalStakedRose() external view returns (uint256);
    function totalVotingPower() external view returns (uint256);

    // Delegation state (multi-delegation)
    function delegatedVP(address delegator, address delegate) external view returns (uint256);
    function totalDelegatedOut(address user) external view returns (uint256);
    function totalDelegatedIn(address delegate) external view returns (uint256);

    // Proposal allocation
    function allocatedToProposal(address user) external view returns (uint256);
    function proposalVPLocked(address user) external view returns (uint256);

    // Monthly bucket storage (for new reputation formula)
    function monthlySuccessValue(address user, uint256 bucket) external view returns (uint256);
    function monthlyDisputeValue(address user, uint256 bucket) external view returns (uint256);

    // Reputation constants
    function BUCKET_DURATION() external view returns (uint256);
    function DECAY_BUCKETS() external view returns (uint256);

    // User data
    function userStats(address user) external view returns (UserStats memory);
    function proposals(uint256 proposalId) external view returns (Proposal memory);
    function votes(uint256 proposalId, address voter) external view returns (Vote memory);
    function proposalCounter() external view returns (uint256);

    // Computed values
    function getReputation(address user) external view returns (uint256);
    function getReputationSimple(address user) external view returns (uint256);
    function validateReputationSignature(
        address user,
        uint256 reputation,
        uint256 expiry,
        bytes memory signature
    ) external view returns (bool);
    function getVotePower(uint256 amount, uint256 reputation) external pure returns (uint256);
    function getAvailableVP(address user) external view returns (uint256);
    function getUserDelegations(address user) external view returns (address[] memory delegates, uint256[] memory amounts);
    function canPropose(address user) external view returns (bool);
    function canVote(address user) external view returns (bool);
    function canDelegate(address user) external view returns (bool);
    function canReceiveDelegation(address user) external view returns (bool);
    function canDelegateOut(address user) external view returns (bool);
    function getQuorumProgress(uint256 proposalId) external view returns (uint256 current, uint256 required);
    function getVoteResult(uint256 proposalId) external view returns (uint256 yayPercent, uint256 nayPercent);
    function getAvailableDelegatedPower(address delegate, uint256 proposalId) external view returns (uint256);
    function getDelegatedVote(uint256 proposalId, address delegate) external view returns (DelegatedVoteRecord memory);
    function getProposalDelegates(uint256 proposalId) external view returns (address[] memory);

    // ============ Staking Functions ============

    function deposit(
        uint256 amount,
        uint256 attestedRep,
        uint256 repExpiry,
        bytes calldata repSignature
    ) external;

    function withdraw(
        uint256 amount,
        uint256 attestedRep,
        uint256 repExpiry,
        bytes calldata repSignature
    ) external;

    // ============ Delegation Functions (Multi-Delegation) ============

    function delegate(
        address delegateAddr,
        uint256 vpAmount,
        uint256 attestedRep,
        uint256 repExpiry,
        bytes calldata repSignature
    ) external;
    function undelegate(address delegate, uint256 vpAmount) external;
    function refreshVP(address user, uint256 newRep, uint256 expiry, bytes calldata signature) external;

    // ============ Voting Functions ============

    function vote(
        uint256 proposalId,
        uint256 vpAmount,
        bool support,
        uint256 expiry,
        bytes calldata signature,
        uint256 attestedRep,
        uint256 repExpiry,
        bytes calldata repSignature
    ) external;

    function freeVP(uint256 proposalId) external;

    function castDelegatedVote(
        uint256 proposalId,
        uint256 amount,
        bool support,
        bytes32 allocationsHash,
        uint256 expiry,
        bytes calldata signature
    ) external;

    // ============ Claim Functions ============

    function claimVoterRewards(
        ClaimData[] calldata claims,
        uint256 expiry,
        bytes calldata signature,
        uint256 attestedRep,
        uint256 repExpiry,
        bytes calldata repSignature
    ) external;

    // ============ Proposal Functions ============

    function propose(
        string calldata title,
        string calldata descriptionHash,
        uint256 value,
        uint256 deadline,
        string calldata deliverables,
        uint256 expiry,
        bytes calldata signature,
        uint256 attestedRep,
        uint256 repExpiry,
        bytes calldata repSignature
    ) external returns (uint256);

    function editProposal(
        uint256 proposalId,
        string calldata title,
        string calldata descriptionHash,
        uint256 value,
        uint256 deadline,
        string calldata deliverables
    ) external;

    function cancelProposal(uint256 proposalId) external;
    function finalizeProposal(uint256 proposalId) external;
    function executeProposal(uint256 proposalId) external;

    // ============ Marketplace Integration ============

    function updateUserStats(address user, uint256 taskValue, bool isDispute) external;
    function onTaskComplete(uint256 taskId) external;

    // ============ Admin Functions ============

    function setPassportSigner(address _signer) external;
    function setDelegationSigner(address _signer) external;
}
