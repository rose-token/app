// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "./interfaces/IvROSE.sol";
import "./interfaces/IRoseGovernance.sol";
import "./interfaces/IRoseReputation.sol";

/**
 * @title RoseGovernance
 * @dev Two-Track Governance System for the Rose Token worker cooperative.
 *
 * Fast Track (Abundant VP):
 * - 3 days duration, 10% quorum
 * - Vote with full VP on multiple proposals simultaneously
 * - VP verified via merkle proof (snapshot after configurable delay)
 *
 * Slow Track (Scarce VP):
 * - 14 days duration, 25% quorum
 * - VP is a global budget to allocate across active proposals
 * - VP verified via backend attestation of available VP
 *
 * VP = sqrt(staked ROSE) * (reputation / 100)
 * VP is computed off-chain and verified on-chain via proofs/attestations.
 */
contract RoseGovernance is IRoseGovernance, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // ============ Token References ============
    IERC20 public immutable roseToken;
    IvROSE public immutable vRoseToken;
    address public marketplace;
    address public treasury;
    address public passportSigner;
    address public delegationSigner;
    address public owner;
    IRoseReputation public reputation;

    // ============ Staking State (VP computed off-chain) ============
    mapping(address => uint256) public stakedRose;
    uint256 public totalStakedRose;

    // ============ Proposals ============
    uint256 public proposalCounter;
    mapping(uint256 => Proposal) internal _proposals;
    mapping(uint256 => mapping(address => Vote)) internal _votes;
    mapping(uint256 => address[]) internal _proposalVoters;
    mapping(uint256 => uint256) internal _proposalToTask;
    mapping(uint256 => uint256) internal _taskToProposal;

    // ============ Two-Track State ============
    mapping(uint256 => uint256) public proposalTotalVP;    // Total VP at snapshot
    mapping(uint256 => uint256) public proposalExtensions; // Number of quorum extensions
    mapping(address => uint256) public allocationNonce;    // Nonce for slow track attestations
    mapping(address => bool) public isDelegateOptedIn;     // Delegate opt-in for off-chain delegation

    // ============ Reward System ============
    mapping(uint256 => uint256) public voterRewardPool;
    mapping(uint256 => uint256) public voterRewardTotalVotes;
    mapping(uint256 => bool) public voterRewardOutcome;
    mapping(uint256 => mapping(address => bool)) public voterRewardClaimed;

    // ============ Signature Replay Protection ============
    mapping(bytes32 => bool) public usedSignatures;

    // ============ Configurable Parameters ============
    uint256 public snapshotDelay = 1 days;
    uint256 public fastDuration = 3 days;
    uint256 public slowDuration = 14 days;
    uint256 public fastQuorumBps = 1000;     // 10%
    uint256 public slowQuorumBps = 2500;     // 25%
    uint256 public fastTrackLimitBps = 100;  // 1% of treasury

    // ============ Constants ============
    uint256 public constant MAX_EDIT_CYCLES = 4;
    uint256 public constant MAX_QUORUM_EXTENSIONS = 3;
    uint256 public constant BASIS_POINTS = 10000;
    uint256 public constant PASS_THRESHOLD = 5833;      // 7/12 = 58.33%

    // Reward percentages (basis points)
    uint256 public constant DAO_MINT_PERCENT = 200;     // 2%
    uint256 public constant VOTER_REWARD = 200;         // 2%
    uint256 public constant PROPOSER_REWARD = 100;      // 1%

    // ============ Modifiers ============

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyMarketplace() {
        if (msg.sender != marketplace) revert NotMarketplace();
        _;
    }

    modifier requiresPassport(string memory action, uint256 expiry, bytes memory signature) {
        if (block.timestamp > expiry) revert SignatureExpired();

        bytes32 messageHash = keccak256(abi.encodePacked(msg.sender, action, expiry));
        bytes32 ethSignedHash = messageHash.toEthSignedMessageHash();

        if (usedSignatures[ethSignedHash]) revert SignatureAlreadyUsed();
        usedSignatures[ethSignedHash] = true;

        address recovered = ethSignedHash.recover(signature);
        if (recovered != passportSigner) revert InvalidSignature();

        _;
    }

    // ============ Constructor ============

    constructor(
        address _roseToken,
        address _vRoseToken,
        address _marketplace,
        address _treasury,
        address _passportSigner,
        address _reputation
    ) {
        if (_roseToken == address(0)) revert ZeroAddress();
        if (_vRoseToken == address(0)) revert ZeroAddress();
        if (_marketplace == address(0)) revert ZeroAddress();
        if (_treasury == address(0)) revert ZeroAddress();
        if (_passportSigner == address(0)) revert ZeroAddressSigner();
        if (_reputation == address(0)) revert ZeroAddress();

        roseToken = IERC20(_roseToken);
        vRoseToken = IvROSE(_vRoseToken);
        marketplace = _marketplace;
        treasury = _treasury;
        passportSigner = _passportSigner;
        reputation = IRoseReputation(_reputation);
        owner = msg.sender;
    }

    // ============ View Functions ============

    function proposals(uint256 proposalId) external view returns (Proposal memory) {
        return _proposals[proposalId];
    }

    function votes(uint256 proposalId, address voter) external view returns (Vote memory) {
        return _votes[proposalId][voter];
    }

    /**
     * @dev Calculate vote power: sqrt(amount) * (rep / 100)
     * Used for off-chain reference - VP computed off-chain
     */
    function getVotePower(uint256 amount, uint256 rep) public pure returns (uint256) {
        if (amount == 0 || rep == 0) return 0;
        uint256 sqrtAmount = _sqrt(amount);
        return (sqrtAmount * rep) / 100;
    }

    function getQuorumProgress(uint256 proposalId) public view returns (uint256 current, uint256 required) {
        Proposal memory p = _proposals[proposalId];
        current = p.forVotes + p.againstVotes;

        uint256 totalVP = proposalTotalVP[proposalId];
        uint256 quorumBps = p.track == Track.Fast ? fastQuorumBps : slowQuorumBps;
        required = (totalVP * quorumBps) / BASIS_POINTS;
    }

    function getVoteResult(uint256 proposalId) public view returns (uint256 forPercent, uint256 againstPercent) {
        Proposal memory p = _proposals[proposalId];
        uint256 totalVotes = p.forVotes + p.againstVotes;
        if (totalVotes == 0) return (0, 0);
        forPercent = (p.forVotes * BASIS_POINTS) / totalVotes;
        againstPercent = (p.againstVotes * BASIS_POINTS) / totalVotes;
    }

    /**
     * @dev Check if user can receive delegation (off-chain delegation)
     * Must be opted in and have stake
     */
    function canReceiveDelegation(address user) public view returns (bool) {
        return isDelegateOptedIn[user] && stakedRose[user] > 0;
    }

    // ============ Staking Functions ============

    /**
     * @dev Deposit ROSE to governance, receive vROSE 1:1
     * VP is computed off-chain at snapshot time, not stored on-chain
     */
    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        roseToken.safeTransferFrom(msg.sender, address(this), amount);
        vRoseToken.mint(msg.sender, amount);

        stakedRose[msg.sender] += amount;
        totalStakedRose += amount;

        emit Deposited(msg.sender, amount);
    }

    /**
     * @dev Withdraw ROSE from governance, burn vROSE
     */
    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (stakedRose[msg.sender] < amount) revert InsufficientStake();

        uint256 vRoseBalance = vRoseToken.balanceOf(msg.sender);
        if (vRoseBalance < amount) revert InsufficientVRose();

        vRoseToken.burn(msg.sender, amount);

        stakedRose[msg.sender] -= amount;
        totalStakedRose -= amount;

        roseToken.safeTransfer(msg.sender, amount);

        emit Withdrawn(msg.sender, amount);
    }

    // ============ Proposal Functions ============

    /**
     * @dev Create a governance proposal
     * @param track Fast or Slow track
     * @param title Proposal title
     * @param descriptionHash IPFS hash of full description
     * @param treasuryAmount ROSE value requested from treasury
     * @param deadline Task deadline timestamp
     * @param deliverables Expected deliverables
     * @param expiry Passport signature expiration
     * @param signature Passport signer signature
     * @param attestedRep Backend-computed reputation score (0-100)
     * @param repExpiry Reputation attestation expiry
     * @param repSignature Reputation attestation signature
     */
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
    ) external requiresPassport("propose", expiry, signature) returns (uint256) {
        // Verify reputation attestation
        if (!reputation.validateReputationSignature(msg.sender, attestedRep, repExpiry, repSignature)) {
            revert InvalidSignature();
        }
        // Check eligibility
        UserStats memory stats = reputation.userStats(msg.sender);
        if (stats.tasksCompleted < reputation.COLD_START_TASKS()) revert IneligibleToVote();
        if (attestedRep < reputation.PROPOSER_REP_THRESHOLD()) revert IneligibleToVote();

        if (bytes(title).length == 0) revert ZeroAmount();
        if (treasuryAmount == 0) revert ZeroAmount();

        uint256 treasuryBalance = roseToken.balanceOf(treasury);
        if (treasuryAmount > treasuryBalance) revert ProposalValueExceedsTreasury();

        // Fast track limit: treasury amount must be < 1% of treasury
        if (track == Track.Fast) {
            uint256 limit = (treasuryBalance * fastTrackLimitBps) / BASIS_POINTS;
            if (treasuryAmount > limit) revert FastTrackExceedsTreasuryLimit();
        }

        proposalCounter++;
        uint256 proposalId = proposalCounter;

        // Determine voting times based on track
        uint256 duration = track == Track.Fast ? fastDuration : slowDuration;
        uint256 votingStartsAt;
        uint256 votingEndsAt;
        ProposalStatus initialStatus;

        if (track == Track.Fast) {
            // Fast track: voting starts after snapshot delay
            votingStartsAt = block.timestamp + snapshotDelay;
            votingEndsAt = votingStartsAt + duration;
            initialStatus = ProposalStatus.Pending;
        } else {
            // Slow track: voting starts immediately with attestations
            votingStartsAt = block.timestamp;
            votingEndsAt = block.timestamp + duration;
            initialStatus = ProposalStatus.Active;
        }

        _proposals[proposalId] = Proposal({
            proposer: msg.sender,
            track: track,
            snapshotBlock: block.number,
            vpMerkleRoot: bytes32(0),
            votingStartsAt: votingStartsAt,
            votingEndsAt: votingEndsAt,
            forVotes: 0,
            againstVotes: 0,
            treasuryAmount: treasuryAmount,
            status: initialStatus,
            title: title,
            descriptionHash: descriptionHash,
            deadline: deadline,
            deliverables: deliverables,
            editCount: 0,
            taskId: 0
        });

        emit ProposalCreated(proposalId, msg.sender, track, treasuryAmount);
        return proposalId;
    }

    /**
     * @dev Set merkle root for VP verification (Fast Track only)
     * Called by backend after snapshot delay
     * @param proposalId Proposal to set root for
     * @param merkleRoot Merkle root of VP snapshot
     * @param totalVP Total VP at snapshot time
     * @param expiry Signature expiration
     * @param signature Backend signer signature
     */
    function setVPMerkleRoot(
        uint256 proposalId,
        bytes32 merkleRoot,
        uint256 totalVP,
        uint256 expiry,
        bytes calldata signature
    ) external nonReentrant {
        if (delegationSigner == address(0)) revert ZeroAddressSigner();
        if (block.timestamp > expiry) revert SignatureExpired();

        Proposal storage p = _proposals[proposalId];
        if (p.proposer == address(0)) revert ProposalNotFound();
        if (p.status != ProposalStatus.Pending) revert ProposalNotPending();
        if (p.track != Track.Fast) revert ProposalNotPending();

        // Verify backend signature
        bytes32 messageHash = keccak256(abi.encodePacked(
            "setVPMerkleRoot",
            proposalId,
            merkleRoot,
            totalVP,
            expiry
        ));
        bytes32 ethSignedHash = messageHash.toEthSignedMessageHash();

        if (usedSignatures[ethSignedHash]) revert SignatureAlreadyUsed();
        usedSignatures[ethSignedHash] = true;

        address recovered = ethSignedHash.recover(signature);
        if (recovered != delegationSigner) revert InvalidSignature();

        // Activate proposal
        p.vpMerkleRoot = merkleRoot;
        p.snapshotBlock = block.number;
        p.status = ProposalStatus.Active;
        proposalTotalVP[proposalId] = totalVP;

        emit ProposalActivated(proposalId, merkleRoot, totalVP);
    }

    function editProposal(
        uint256 proposalId,
        string calldata title,
        string calldata descriptionHash,
        uint256 treasuryAmount,
        uint256 deadline,
        string calldata deliverables
    ) external {
        Proposal storage p = _proposals[proposalId];
        if (p.proposer != msg.sender) revert OnlyProposerCanEdit();
        if (p.status != ProposalStatus.Active && p.status != ProposalStatus.Failed && p.status != ProposalStatus.Pending) {
            revert ProposalNotActive();
        }
        if (p.editCount >= MAX_EDIT_CYCLES) revert MaxEditCyclesReached();

        uint256 treasuryBalance = roseToken.balanceOf(treasury);
        if (treasuryAmount > treasuryBalance) revert ProposalValueExceedsTreasury();

        // Check fast track limit if editing fast track proposal
        if (p.track == Track.Fast) {
            uint256 limit = (treasuryBalance * fastTrackLimitBps) / BASIS_POINTS;
            if (treasuryAmount > limit) revert FastTrackExceedsTreasuryLimit();
        }

        // Reset votes
        _resetProposalVotes(proposalId);

        // Update proposal
        p.title = title;
        p.descriptionHash = descriptionHash;
        p.treasuryAmount = treasuryAmount;
        p.deadline = deadline;
        p.deliverables = deliverables;
        p.forVotes = 0;
        p.againstVotes = 0;
        p.editCount++;

        // Reset voting period based on track
        uint256 duration = p.track == Track.Fast ? fastDuration : slowDuration;
        if (p.track == Track.Fast) {
            // Fast track goes back to pending, needs new merkle root
            p.votingStartsAt = block.timestamp + snapshotDelay;
            p.votingEndsAt = p.votingStartsAt + duration;
            p.status = ProposalStatus.Pending;
            p.vpMerkleRoot = bytes32(0);
            proposalTotalVP[proposalId] = 0;
        } else {
            // Slow track stays active with new voting period
            p.votingStartsAt = block.timestamp;
            p.votingEndsAt = block.timestamp + duration;
            p.status = ProposalStatus.Active;
        }

        emit ProposalEdited(proposalId, p.editCount);
    }

    function cancelProposal(uint256 proposalId) external {
        Proposal storage p = _proposals[proposalId];
        if (p.proposer != msg.sender) revert OnlyProposerCanCancel();
        if (p.status != ProposalStatus.Active && p.status != ProposalStatus.Pending) {
            revert ProposalNotActive();
        }

        _resetProposalVotes(proposalId);
        p.status = ProposalStatus.Cancelled;

        emit ProposalCancelled(proposalId);
    }

    /**
     * @dev Finalize a Fast Track proposal (anyone can call after voting ends)
     * @param proposalId Proposal to finalize
     */
    function finalizeProposal(uint256 proposalId) external {
        Proposal storage p = _proposals[proposalId];
        if (p.status != ProposalStatus.Active) revert ProposalNotActive();
        if (p.track == Track.Slow) revert ProposalNotActive(); // Slow Track must use finalizeSlowProposal
        if (block.timestamp <= p.votingEndsAt) revert ProposalNotEnded();

        _finalize(proposalId);
    }

    /**
     * @dev Finalize a Slow Track proposal with VP snapshot (backend only)
     * Backend computes VP snapshot at deadline and submits merkle root + totalVP
     * @param proposalId Proposal to finalize
     * @param merkleRoot Merkle root of VP snapshot at deadline
     * @param totalVP Total VP in the snapshot
     * @param expiry Signature expiration timestamp
     * @param signature Backend signature authorizing finalization
     */
    function finalizeSlowProposal(
        uint256 proposalId,
        bytes32 merkleRoot,
        uint256 totalVP,
        uint256 expiry,
        bytes calldata signature
    ) external {
        if (delegationSigner == address(0)) revert ZeroAddressSigner();
        if (block.timestamp > expiry) revert SignatureExpired();

        Proposal storage p = _proposals[proposalId];
        if (p.status != ProposalStatus.Active) revert ProposalNotActive();
        if (p.track != Track.Slow) revert ProposalNotActive(); // Must be Slow Track
        if (block.timestamp <= p.votingEndsAt) revert ProposalNotEnded();

        // Verify backend signature
        bytes32 messageHash = keccak256(abi.encodePacked(
            "finalizeSlowProposal",
            proposalId,
            merkleRoot,
            totalVP,
            expiry
        ));
        bytes32 ethSignedHash = messageHash.toEthSignedMessageHash();

        if (usedSignatures[ethSignedHash]) revert SignatureAlreadyUsed();
        usedSignatures[ethSignedHash] = true;

        address recovered = ethSignedHash.recover(signature);
        if (recovered != delegationSigner) revert InvalidSignature();

        // Set snapshot data
        p.vpMerkleRoot = merkleRoot;
        p.snapshotBlock = block.number;
        proposalTotalVP[proposalId] = totalVP;

        _finalize(proposalId);
    }

    /**
     * @dev Internal finalization logic shared by Fast and Slow tracks
     */
    function _finalize(uint256 proposalId) internal {
        Proposal storage p = _proposals[proposalId];

        // Check quorum
        uint256 totalVotes = p.forVotes + p.againstVotes;
        uint256 totalVP = proposalTotalVP[proposalId];
        uint256 quorumBps = p.track == Track.Fast ? fastQuorumBps : slowQuorumBps;
        uint256 requiredQuorum = (totalVP * quorumBps) / BASIS_POINTS;

        if (totalVotes < requiredQuorum) {
            // Quorum not met - check if we can extend
            if (proposalExtensions[proposalId] >= MAX_QUORUM_EXTENSIONS) {
                // Max extensions reached - proposal fails
                p.status = ProposalStatus.Failed;
                reputation.recordFailedProposal(p.proposer);
                emit ProposalFinalized(proposalId, ProposalStatus.Failed);
                return;
            }

            // Extend voting period
            uint256 duration = p.track == Track.Fast ? fastDuration : slowDuration;
            p.votingEndsAt = block.timestamp + duration;
            proposalExtensions[proposalId]++;
            emit ProposalFinalized(proposalId, ProposalStatus.Active);
            return;
        }

        // Determine outcome
        uint256 forPercent = totalVotes > 0 ? (p.forVotes * BASIS_POINTS) / totalVotes : 0;

        if (forPercent >= PASS_THRESHOLD) {
            p.status = ProposalStatus.Passed;
            emit ProposalFinalized(proposalId, ProposalStatus.Passed);
        } else {
            p.status = ProposalStatus.Failed;
            reputation.recordFailedProposal(p.proposer);
            _distributeVoterRewards(proposalId, false);
            emit ProposalFinalized(proposalId, ProposalStatus.Failed);
        }
    }

    function executeProposal(uint256 proposalId) external nonReentrant {
        Proposal storage p = _proposals[proposalId];
        if (p.status != ProposalStatus.Passed) revert ProposalNotPassed();

        uint256 taskId = IRoseMarketplace(marketplace).createDAOTask(
            p.proposer,
            p.title,
            p.treasuryAmount,
            p.descriptionHash,
            proposalId
        );

        p.taskId = taskId;
        p.status = ProposalStatus.Executed;
        _proposalToTask[proposalId] = taskId;
        _taskToProposal[taskId] = proposalId;

        emit ProposalExecuted(proposalId, taskId);
    }

    // ============ Voting Functions ============

    /**
     * @dev Vote on a Fast Track proposal with merkle proof
     * Users can vote with full VP on multiple fast track proposals
     * @param proposalId Proposal to vote on
     * @param support True for For, false for Against
     * @param vpAmount VP amount to vote with (must match merkle leaf)
     * @param merkleProof Merkle proof of (voter, vpAmount) in snapshot
     * @param expiry Passport signature expiration
     * @param signature Passport signer signature
     * @param attestedRep Backend-computed reputation score (0-100)
     * @param repExpiry Reputation attestation expiry
     * @param repSignature Reputation attestation signature
     */
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
    ) external nonReentrant {
        // Verify passport signature format
        if (block.timestamp > expiry) revert SignatureExpired();
        bytes32 messageHash = keccak256(abi.encodePacked(
            "voteFast",
            msg.sender,
            proposalId,
            support,
            vpAmount,
            expiry
        ));
        bytes32 ethSignedHash = messageHash.toEthSignedMessageHash();

        if (usedSignatures[ethSignedHash]) revert SignatureAlreadyUsed();

        address recovered = ethSignedHash.recover(signature);
        if (recovered != passportSigner) revert InvalidSignature();

        // Verify reputation
        if (!reputation.validateReputationSignature(msg.sender, attestedRep, repExpiry, repSignature)) {
            revert InvalidSignature();
        }
        if (attestedRep < reputation.VOTER_REP_THRESHOLD()) revert IneligibleToVote();

        // Proposal validations
        Proposal storage p = _proposals[proposalId];
        if (p.status != ProposalStatus.Active) revert ProposalNotActive();
        if (p.track != Track.Fast) revert ProposalNotActive();
        if (block.timestamp < p.votingStartsAt) revert VotingNotStarted();
        if (block.timestamp > p.votingEndsAt) revert VotingEnded();
        if (p.proposer == msg.sender) revert CannotVoteOnOwnProposal();
        if (vpAmount == 0) revert ZeroAmount();

        // Check already voted
        Vote storage v = _votes[proposalId][msg.sender];
        if (v.hasVoted) revert AlreadyVoted();

        // Verify merkle proof
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(msg.sender, vpAmount))));
        if (!MerkleProof.verify(merkleProof, p.vpMerkleRoot, leaf)) {
            revert InvalidMerkleProof();
        }

        // Mark signature as used AFTER all validations pass
        usedSignatures[ethSignedHash] = true;

        // Record vote
        v.hasVoted = true;
        v.support = support;
        v.vpAmount = vpAmount;
        _proposalVoters[proposalId].push(msg.sender);

        // Update proposal
        if (support) {
            p.forVotes += vpAmount;
        } else {
            p.againstVotes += vpAmount;
        }

        emit VoteCastFast(proposalId, msg.sender, support, vpAmount);
    }

    /**
     * @dev Vote on a Slow Track proposal with backend attestation
     * Users have a VP budget to allocate across slow track proposals
     * @param proposalId Proposal to vote on
     * @param support True for For, false for Against
     * @param vpAmount VP amount to allocate (from budget)
     * @param availableVP Backend-attested available VP
     * @param nonce User's allocation nonce (must match)
     * @param expiry Signature expiration
     * @param signature Backend signer signature
     * @param attestedRep Backend-computed reputation score (0-100)
     * @param repExpiry Reputation attestation expiry
     * @param repSignature Reputation attestation signature
     */
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
    ) external nonReentrant {
        if (delegationSigner == address(0)) revert ZeroAddressSigner();
        if (block.timestamp > expiry) revert SignatureExpired();

        // Verify nonce and immediately increment to prevent race conditions
        if (nonce != allocationNonce[msg.sender]) revert StaleNonce();
        allocationNonce[msg.sender]++;

        // Verify backend signature for available VP
        bytes32 messageHash = keccak256(abi.encodePacked(
            "voteSlow",
            msg.sender,
            proposalId,
            support,
            vpAmount,
            availableVP,
            nonce,
            expiry
        ));
        bytes32 ethSignedHash = messageHash.toEthSignedMessageHash();

        if (usedSignatures[ethSignedHash]) revert SignatureAlreadyUsed();
        usedSignatures[ethSignedHash] = true;

        address recovered = ethSignedHash.recover(signature);
        if (recovered != delegationSigner) revert InvalidSignature();

        // Verify reputation
        if (!reputation.validateReputationSignature(msg.sender, attestedRep, repExpiry, repSignature)) {
            revert InvalidSignature();
        }
        if (attestedRep < reputation.VOTER_REP_THRESHOLD()) revert IneligibleToVote();

        // Proposal validations
        Proposal storage p = _proposals[proposalId];
        if (p.status != ProposalStatus.Active) revert ProposalNotActive();
        if (p.track != Track.Slow) revert ProposalNotActive();
        if (block.timestamp < p.votingStartsAt) revert VotingNotStarted();
        if (block.timestamp > p.votingEndsAt) revert VotingEnded();
        if (p.proposer == msg.sender) revert CannotVoteOnOwnProposal();
        if (vpAmount == 0) revert ZeroAmount();

        // Check available VP
        if (vpAmount > availableVP) revert InsufficientAvailableVP();

        // Record or update vote
        Vote storage v = _votes[proposalId][msg.sender];

        if (v.hasVoted) {
            // Update existing vote - adjust totals
            uint256 oldAmount = v.vpAmount;
            if (v.support) {
                p.forVotes -= oldAmount;
            } else {
                p.againstVotes -= oldAmount;
            }

            v.support = support;
            v.vpAmount = vpAmount;

            emit VoteUpdated(proposalId, msg.sender, oldAmount, vpAmount);
        } else {
            // New vote
            v.hasVoted = true;
            v.support = support;
            v.vpAmount = vpAmount;
            _proposalVoters[proposalId].push(msg.sender);
        }

        // Update proposal
        if (support) {
            p.forVotes += vpAmount;
        } else {
            p.againstVotes += vpAmount;
        }

        emit VoteCastSlow(proposalId, msg.sender, support, vpAmount, nonce);
    }

    // ============ Delegation Functions ============

    /**
     * @dev Opt in or out of receiving delegations (off-chain)
     * Delegates must opt in to receive VP delegations
     */
    function setDelegateOptIn(bool optIn) external {
        isDelegateOptedIn[msg.sender] = optIn;
        emit DelegateOptInChanged(msg.sender, optIn);
    }

    // ============ Claim Functions ============

    /**
     * @dev Claim voter rewards for multiple proposals
     * @param proposalIds Array of proposal IDs to claim rewards from
     * @param expiry Signature expiration
     * @param signature Backend signer signature
     */
    function claimVoterRewards(
        uint256[] calldata proposalIds,
        uint256 expiry,
        bytes calldata signature
    ) external nonReentrant {
        if (proposalIds.length == 0) revert ZeroAmount();
        if (delegationSigner == address(0)) revert ZeroAddressSigner();
        if (block.timestamp > expiry) revert SignatureExpired();

        // Verify signature
        bytes32 messageHash = keccak256(abi.encodePacked(
            "claimVoterRewards",
            msg.sender,
            abi.encode(proposalIds),
            expiry
        ));
        bytes32 ethSignedHash = messageHash.toEthSignedMessageHash();

        if (usedSignatures[ethSignedHash]) revert SignatureAlreadyUsed();
        usedSignatures[ethSignedHash] = true;

        address recovered = ethSignedHash.recover(signature);
        if (recovered != delegationSigner) revert InvalidSignature();

        uint256 totalReward = 0;

        for (uint256 i = 0; i < proposalIds.length; i++) {
            uint256 proposalId = proposalIds[i];

            if (voterRewardPool[proposalId] == 0) continue;
            if (voterRewardTotalVotes[proposalId] == 0) continue; // Prevent division by zero
            if (voterRewardClaimed[proposalId][msg.sender]) continue;

            Vote memory v = _votes[proposalId][msg.sender];
            if (!v.hasVoted) continue;
            if (v.support != voterRewardOutcome[proposalId]) continue;

            uint256 reward = (voterRewardPool[proposalId] * v.vpAmount)
                           / voterRewardTotalVotes[proposalId];

            voterRewardClaimed[proposalId][msg.sender] = true;
            totalReward += reward;
        }

        if (totalReward > 0) {
            // Transfer reward to user's staked balance
            stakedRose[msg.sender] += totalReward;
            emit RewardClaimed(msg.sender, totalReward);
        }
    }

    // ============ Marketplace Integration ============

    function onTaskComplete(uint256 taskId) external onlyMarketplace {
        uint256 proposalId = _taskToProposal[taskId];
        if (proposalId == 0) revert TaskNotFromProposal();

        Proposal storage p = _proposals[proposalId];
        uint256 value = p.treasuryAmount;

        uint256 daoReward = (value * DAO_MINT_PERCENT) / BASIS_POINTS;
        uint256 voterReward = (value * VOTER_REWARD) / BASIS_POINTS;
        uint256 proposerReward = (value * PROPOSER_REWARD) / BASIS_POINTS;

        IRoseToken(address(roseToken)).mint(treasury, daoReward);
        IRoseToken(address(roseToken)).mint(p.proposer, proposerReward);
        _distributeVoterRewards(proposalId, true);

        emit RewardsDistributed(proposalId, daoReward + voterReward + proposerReward);
    }

    // ============ Admin Functions ============

    function setPassportSigner(address _signer) external onlyOwner {
        if (_signer == address(0)) revert ZeroAddressSigner();
        passportSigner = _signer;
        emit PassportSignerUpdated(_signer);
    }

    function setDelegationSigner(address _signer) external onlyOwner {
        if (_signer == address(0)) revert ZeroAddressSigner();
        delegationSigner = _signer;
        emit DelegationSignerUpdated(_signer);
    }

    function setMarketplace(address _marketplace) external onlyOwner {
        if (_marketplace == address(0)) revert ZeroAddress();
        marketplace = _marketplace;
    }

    function setReputation(address _reputation) external onlyOwner {
        if (_reputation == address(0)) revert ZeroAddress();
        reputation = IRoseReputation(_reputation);
    }

    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert ZeroAddress();
        treasury = _treasury;
    }

    function setSnapshotDelay(uint256 _delay) external onlyOwner {
        snapshotDelay = _delay;
        emit ConfigUpdated("snapshotDelay", _delay);
    }

    function setFastDuration(uint256 _duration) external onlyOwner {
        fastDuration = _duration;
        emit ConfigUpdated("fastDuration", _duration);
    }

    function setSlowDuration(uint256 _duration) external onlyOwner {
        slowDuration = _duration;
        emit ConfigUpdated("slowDuration", _duration);
    }

    function setFastQuorumBps(uint256 _bps) external onlyOwner {
        require(_bps <= BASIS_POINTS, "Invalid bps");
        fastQuorumBps = _bps;
        emit ConfigUpdated("fastQuorumBps", _bps);
    }

    function setSlowQuorumBps(uint256 _bps) external onlyOwner {
        require(_bps <= BASIS_POINTS, "Invalid bps");
        slowQuorumBps = _bps;
        emit ConfigUpdated("slowQuorumBps", _bps);
    }

    function setFastTrackLimitBps(uint256 _bps) external onlyOwner {
        require(_bps <= BASIS_POINTS, "Invalid bps");
        fastTrackLimitBps = _bps;
        emit ConfigUpdated("fastTrackLimitBps", _bps);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        owner = newOwner;
    }

    // ============ Internal Functions ============

    function _distributeVoterRewards(uint256 proposalId, bool forWon) internal {
        Proposal storage p = _proposals[proposalId];
        uint256 winningVotes = forWon ? p.forVotes : p.againstVotes;
        if (winningVotes == 0) return;

        uint256 totalReward = (p.treasuryAmount * VOTER_REWARD) / BASIS_POINTS;
        IRoseToken(address(roseToken)).mint(address(this), totalReward);

        voterRewardPool[proposalId] = totalReward;
        voterRewardTotalVotes[proposalId] = winningVotes;
        voterRewardOutcome[proposalId] = forWon;

        emit VoterRewardPoolCreated(proposalId, totalReward, winningVotes, forWon);
    }

    function _resetProposalVotes(uint256 proposalId) internal {
        address[] memory voters = _proposalVoters[proposalId];
        for (uint256 i = 0; i < voters.length; i++) {
            delete _votes[proposalId][voters[i]];
        }
        delete _proposalVoters[proposalId];
    }

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
}

// ============ Interface for RoseToken mint ============
interface IRoseToken {
    function mint(address to, uint256 amount) external;
    function burn(address from, uint256 amount) external;
}

// ============ Interface for RoseMarketplace ============
interface IRoseMarketplace {
    function createDAOTask(
        address proposer,
        string calldata title,
        uint256 value,
        string calldata descriptionHash,
        uint256 proposalId
    ) external returns (uint256);
}
