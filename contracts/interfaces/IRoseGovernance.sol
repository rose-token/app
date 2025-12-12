// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IRoseGovernance
 * @dev Interface for the Rose Token governance contract
 *
 * Two-Track Governance System:
 * - Fast Track: Abundant VP (3 days, 10% quorum) - vote with full VP on multiple proposals
 * - Slow Track: Scarce VP (14 days, 25% quorum) - VP is a global budget across proposals
 *
 * VP is computed off-chain and verified via:
 * - Merkle proofs (Fast Track)
 * - Backend attestations (Slow Track)
 */
interface IRoseGovernance {
    // ============ Enums ============

    enum Track {
        Fast,
        Slow
    }

    enum ProposalStatus {
        Pending,     // Created, waiting for merkle root (Fast Track only)
        Active,      // Voting open
        Passed,
        Failed,
        Executed,
        Cancelled
    }

    // ============ Structs ============

    struct Proposal {
        address proposer;
        Track track;
        uint256 snapshotBlock;       // Block number for VP snapshot
        bytes32 vpMerkleRoot;        // Merkle root for VP verification (Fast Track)
        uint256 votingStartsAt;      // When voting begins
        uint256 votingEndsAt;        // When voting ends
        uint256 forVotes;            // Total VP voting for
        uint256 againstVotes;        // Total VP voting against
        uint256 treasuryAmount;      // ROSE requested from treasury
        ProposalStatus status;
        string title;
        string descriptionHash;      // IPFS hash
        uint256 deadline;            // Task deadline if executed
        string deliverables;
        uint256 editCount;
        uint256 taskId;              // Marketplace task ID (after execution)
    }

    struct Vote {
        bool hasVoted;
        bool support;
        uint256 vpAmount;
    }

    // Legacy structs for compatibility (some may be removed in Phase 2)
    struct UserStats {
        uint256 tasksCompleted;
        uint256 totalTaskValue;
        uint256 disputes;
        uint256 failedProposals;
        uint256 lastTaskTimestamp;
    }

    // ============ Events ============

    // Staking events
    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);

    // Proposal events
    event ProposalCreated(
        uint256 indexed proposalId,
        address indexed proposer,
        Track track,
        uint256 treasuryAmount
    );
    event ProposalEdited(uint256 indexed proposalId, uint256 editCount);
    event ProposalCancelled(uint256 indexed proposalId);
    event ProposalActivated(uint256 indexed proposalId, bytes32 vpMerkleRoot, uint256 totalVP);
    event ProposalFinalized(uint256 indexed proposalId, ProposalStatus status);
    event ProposalExecuted(uint256 indexed proposalId, uint256 taskId);

    // Voting events
    event VoteCastFast(
        uint256 indexed proposalId,
        address indexed voter,
        bool support,
        uint256 vpAmount
    );
    event VoteCastSlow(
        uint256 indexed proposalId,
        address indexed voter,
        bool support,
        uint256 vpAmount,
        uint256 nonce
    );
    event VoteUpdated(
        uint256 indexed proposalId,
        address indexed voter,
        uint256 oldAmount,
        uint256 newAmount
    );

    // Delegation events (off-chain delegation)
    event DelegateOptInChanged(address indexed delegate, bool optedIn);

    // Reward events
    event RewardsDistributed(uint256 indexed proposalId, uint256 totalRewards);
    event RewardClaimed(address indexed user, uint256 amount);
    event VoterRewardPoolCreated(uint256 indexed proposalId, uint256 poolAmount, uint256 totalVotes, bool support);

    // Admin events
    event PassportSignerUpdated(address indexed newSigner);
    event DelegationSignerUpdated(address indexed newSigner);
    event ConfigUpdated(string param, uint256 newValue);

    // ============ Errors ============

    error NotOwner();
    error NotMarketplace();
    error NotTreasury();
    error ZeroAddress();
    error ZeroAmount();
    error InvalidSignature();
    error SignatureExpired();
    error SignatureAlreadyUsed();
    error ZeroAddressSigner();

    // Proposal errors
    error ProposalNotFound();
    error ProposalNotPending();
    error ProposalNotActive();
    error ProposalNotEnded();
    error ProposalNotPassed();
    error ProposalValueExceedsTreasury();
    error FastTrackExceedsTreasuryLimit();
    error MaxEditCyclesReached();
    error OnlyProposerCanEdit();
    error OnlyProposerCanCancel();

    // Voting errors
    error VotingNotStarted();
    error VotingEnded();
    error AlreadyVoted();
    error CannotVoteOnOwnProposal();
    error InvalidMerkleProof();
    error IneligibleToVote();
    error InsufficientAvailableVP();
    error StaleNonce();

    // Staking errors
    error InsufficientStake();
    error InsufficientVRose();

    // Task errors
    error TaskNotFromProposal();

    // ============ View Functions ============

    // Core state
    function stakedRose(address user) external view returns (uint256);
    function totalStakedRose() external view returns (uint256);
    function proposalCounter() external view returns (uint256);
    function proposals(uint256 proposalId) external view returns (Proposal memory);
    function votes(uint256 proposalId, address voter) external view returns (Vote memory);

    // Two-track specific
    function proposalTotalVP(uint256 proposalId) external view returns (uint256);
    function proposalExtensions(uint256 proposalId) external view returns (uint256);
    function allocationNonce(address user) external view returns (uint256);
    function isDelegateOptedIn(address delegate) external view returns (bool);

    // Configurable parameters
    function snapshotDelay() external view returns (uint256);
    function fastDuration() external view returns (uint256);
    function slowDuration() external view returns (uint256);
    function fastQuorumBps() external view returns (uint256);
    function slowQuorumBps() external view returns (uint256);
    function fastTrackLimitBps() external view returns (uint256);

    // Computed values
    function getQuorumProgress(uint256 proposalId) external view returns (uint256 current, uint256 required);
    function getVoteResult(uint256 proposalId) external view returns (uint256 forPercent, uint256 againstPercent);
    function canReceiveDelegation(address user) external view returns (bool);

    // VP calculation (pure - for off-chain reference)
    function getVotePower(uint256 amount, uint256 rep) external pure returns (uint256);

    // ============ Staking Functions ============

    function deposit(uint256 amount) external;

    function withdraw(uint256 amount) external;

    // ============ Proposal Functions ============

    function createProposal(
        Track track,
        string calldata title,
        string calldata descriptionHash,
        uint256 treasuryAmount,
        uint256 deadline,
        string calldata deliverables,
        uint256 expiry,
        bytes calldata signature,
        uint256 attestedRep,
        uint256 repExpiry,
        bytes calldata repSignature
    ) external returns (uint256);

    function setVPMerkleRoot(
        uint256 proposalId,
        bytes32 merkleRoot,
        uint256 totalVP,
        uint256 expiry,
        bytes calldata signature
    ) external;

    function editProposal(
        uint256 proposalId,
        string calldata title,
        string calldata descriptionHash,
        uint256 treasuryAmount,
        uint256 deadline,
        string calldata deliverables
    ) external;

    function cancelProposal(uint256 proposalId) external;

    function finalizeProposal(uint256 proposalId) external;

    function finalizeSlowProposal(
        uint256 proposalId,
        bytes32 merkleRoot,
        uint256 totalVP,
        uint256 expiry,
        bytes calldata signature
    ) external;

    function executeProposal(uint256 proposalId) external;

    // ============ Voting Functions ============

    function voteFast(
        uint256 proposalId,
        bool support,
        uint256 vpAmount,
        bytes32[] calldata merkleProof,
        uint256 expiry,
        bytes calldata signature,
        uint256 attestedRep,
        uint256 repExpiry,
        bytes calldata repSignature
    ) external;

    function voteSlow(
        uint256 proposalId,
        bool support,
        uint256 vpAmount,
        uint256 availableVP,
        uint256 nonce,
        uint256 expiry,
        bytes calldata signature,
        uint256 attestedRep,
        uint256 repExpiry,
        bytes calldata repSignature
    ) external;

    // ============ Delegation Functions ============

    function setDelegateOptIn(bool optIn) external;

    // ============ Claim Functions ============

    function claimVoterRewards(
        uint256[] calldata proposalIds,
        uint256 expiry,
        bytes calldata signature
    ) external;

    // ============ Marketplace Integration ============

    function onTaskComplete(uint256 taskId) external;

    // ============ Admin Functions ============

    function setPassportSigner(address _signer) external;
    function setDelegationSigner(address _signer) external;
    function setReputation(address _reputation) external;
    function setMarketplace(address _marketplace) external;
    function setTreasury(address _treasury) external;
    function setSnapshotDelay(uint256 _delay) external;
    function setFastDuration(uint256 _duration) external;
    function setSlowDuration(uint256 _duration) external;
    function setFastQuorumBps(uint256 _bps) external;
    function setSlowQuorumBps(uint256 _bps) external;
    function setFastTrackLimitBps(uint256 _bps) external;
    function transferOwnership(address newOwner) external;
}
