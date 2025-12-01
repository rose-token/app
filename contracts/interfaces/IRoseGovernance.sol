// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IRoseGovernance
 * @dev Interface for the Rose Token governance contract
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
        uint256 allocatedAmount;
    }

    struct TaskRecord {
        uint256 timestamp;
        uint256 value;
        bool isDispute;
    }

    struct DelegatedVoteRecord {
        bool hasVoted;
        bool support;
        uint256 totalPowerUsed;
    }

    // ============ Events ============

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event DelegatedTo(address indexed delegator, address indexed delegate, uint256 amount);
    event Undelegated(address indexed delegator, address indexed delegate, uint256 amount);
    event DelegationRefreshed(address indexed user, uint256 oldPower, uint256 newPower);
    event ProposalCreated(uint256 indexed proposalId, address indexed proposer, uint256 value);
    event ProposalEdited(uint256 indexed proposalId, uint256 editCount);
    event ProposalCancelled(uint256 indexed proposalId);
    event ProposalFinalized(uint256 indexed proposalId, ProposalStatus status);
    event ProposalExecuted(uint256 indexed proposalId, uint256 taskId);
    event VoteCast(uint256 indexed proposalId, address indexed voter, bool support, uint256 votePower);
    event VoteIncreased(uint256 indexed proposalId, address indexed voter, uint256 additionalAmount, uint256 newVotePower);
    event DelegatedVoteCast(uint256 indexed proposalId, address indexed delegate, bool support, uint256 votePower);
    event DelegatedVoteIncreased(uint256 indexed proposalId, address indexed delegate, uint256 additionalPower, uint256 newTotalPower);
    event VoteUnallocated(uint256 indexed proposalId, address indexed voter, uint256 amount);
    event RewardsDistributed(uint256 indexed proposalId, uint256 totalRewards);
    event RewardClaimed(address indexed user, uint256 amount);
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

    // ============ View Functions ============

    function stakedRose(address user) external view returns (uint256);
    function allocatedRose(address user) external view returns (uint256);
    function delegatedTo(address user) external view returns (address);
    function cachedVotePower(address user) external view returns (uint256);
    function totalDelegatedPower(address delegate) external view returns (uint256);
    function userStats(address user) external view returns (UserStats memory);
    function proposals(uint256 proposalId) external view returns (Proposal memory);
    function votes(uint256 proposalId, address voter) external view returns (Vote memory);
    function proposalCounter() external view returns (uint256);
    function totalStakedRose() external view returns (uint256);

    function getReputation(address user) external view returns (uint256);
    function getVotePower(uint256 amount, uint256 reputation) external pure returns (uint256);
    function canPropose(address user) external view returns (bool);
    function canVote(address user) external view returns (bool);
    function canDelegate(address user) external view returns (bool);
    function getQuorumProgress(uint256 proposalId) external view returns (uint256 current, uint256 required);
    function getVoteResult(uint256 proposalId) external view returns (uint256 yayPercent, uint256 nayPercent);
    function getTaskHistory(address user) external view returns (TaskRecord[] memory);
    function getAvailableDelegatedPower(address delegate, uint256 proposalId) external view returns (uint256);
    function getDelegatedVote(uint256 proposalId, address delegate) external view returns (DelegatedVoteRecord memory);
    function getDelegatorVotePower(uint256 proposalId, address delegate, address delegator) external view returns (uint256);
    function getProposalDelegates(uint256 proposalId) external view returns (address[] memory);

    // ============ Staking Functions ============

    function deposit(uint256 amount) external;
    function withdraw(uint256 amount) external;

    // ============ Delegation Functions ============

    function allocateToDelegate(address delegate, uint256 amount) external;
    function unallocateFromDelegate() external;
    function refreshDelegation(address user) external;

    // ============ Voting Functions ============

    function allocateToProposal(uint256 proposalId, uint256 amount, bool support) external;
    function unallocateFromProposal(uint256 proposalId) external;
    function castDelegatedVote(uint256 proposalId, uint256 amount, bool support) external;
    function castDelegatedVoteWithSignature(
        uint256 proposalId,
        uint256 amount,
        bool support,
        bytes32 allocationsHash,
        uint256 expiry,
        bytes calldata signature
    ) external;

    // ============ Proposal Functions ============

    function propose(
        string calldata title,
        string calldata descriptionHash,
        uint256 value,
        uint256 deadline,
        string calldata deliverables,
        uint256 expiry,
        bytes calldata signature
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
