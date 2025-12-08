// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IRoseReputation.sol";

contract RoseReputation is IRoseReputation, ReentrancyGuard {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // ============ Roles ============
    address public owner;
    address public override governance;
    address public override marketplace;
    address public override reputationSigner;

    // ============ Reputation Storage ============
    mapping(address => IRoseGovernance.UserStats) internal _userStats;
    mapping(address => mapping(uint256 => uint256)) internal _monthlySuccessValue;
    mapping(address => mapping(uint256 => uint256)) internal _monthlyDisputeValue;

    // ============ Constants ============
    uint256 public constant override COLD_START_TASKS = 10;
    uint256 public constant override PROPOSER_REP_THRESHOLD = 90;
    uint256 public constant override VOTER_REP_THRESHOLD = 70;
    uint256 public constant override DELEGATE_REP_THRESHOLD = 90;
    uint256 public constant override DEFAULT_REPUTATION = 60;
    uint256 public constant override BUCKET_DURATION = 30 days;
    uint256 public constant override DECAY_BUCKETS = 36; // 3 years of monthly buckets

    // ============ Modifiers ============

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyGovernance() {
        if (msg.sender != governance) revert NotGovernance();
        _;
    }

    modifier onlyMarketplace() {
        if (msg.sender != marketplace) revert NotMarketplace();
        _;
    }

    constructor(address _governance, address _marketplace, address _reputationSigner) {
        if (_governance == address(0)) revert ZeroAddress();
        if (_marketplace == address(0)) revert ZeroAddress();
        if (_reputationSigner == address(0)) revert ZeroAddressSigner();

        owner = msg.sender;
        governance = _governance;
        marketplace = _marketplace;
        reputationSigner = _reputationSigner;
    }

    // ============ Admin Setters ============

    function setReputationSigner(address signer) external onlyOwner {
        if (signer == address(0)) revert ZeroAddressSigner();
        reputationSigner = signer;
        emit ReputationSignerUpdated(signer);
    }

    function setGovernance(address governance_) external onlyOwner {
        if (governance_ == address(0)) revert ZeroAddress();
        governance = governance_;
        emit GovernanceUpdated(governance_);
    }

    function setMarketplace(address marketplace_) external onlyOwner {
        if (marketplace_ == address(0)) revert ZeroAddress();
        marketplace = marketplace_;
        emit MarketplaceUpdated(marketplace_);
    }

    // ============ View Functions ============

    function userStats(address user) external view override returns (IRoseGovernance.UserStats memory) {
        return _userStats[user];
    }

    function monthlySuccessValue(address user, uint256 bucket) external view override returns (uint256) {
        return _monthlySuccessValue[user][bucket];
    }

    function monthlyDisputeValue(address user, uint256 bucket) external view override returns (uint256) {
        return _monthlyDisputeValue[user][bucket];
    }

    /**
     * @dev Primary reputation getter. Delegates to getReputationSimple which runs entirely on-chain.
     */
    function getReputation(address user) public view override returns (uint256) {
        return getReputationSimple(user);
    }

    /**
     * @dev Get simplified reputation using monthly buckets (O(36) vs O(n))
     * Uses linear formula (not ^0.6) as on-chain fallback
     */
    function getReputationSimple(address user) public view override returns (uint256) {
        IRoseGovernance.UserStats memory stats = _userStats[user];

        // Cold start check
        if (stats.tasksCompleted < COLD_START_TASKS) {
            return DEFAULT_REPUTATION;
        }

        uint256 currentBucket = block.timestamp / BUCKET_DURATION;
        uint256 successSum = 0;
        uint256 disputeSum = 0;

        // Sum last 36 months (3 years)
        for (uint256 i = 0; i < DECAY_BUCKETS; i++) {
            uint256 bucket = currentBucket - i;
            successSum += _monthlySuccessValue[user][bucket];
            disputeSum += _monthlyDisputeValue[user][bucket];
        }

        if (successSum == 0) {
            return DEFAULT_REPUTATION;
        }

        // Simplified: linear with 2x dispute multiplier (not ^0.6)
        // Add failed proposals penalty converted to equivalent dispute value
        uint256 failedPenalty = (stats.failedProposals * successSum)
            / (stats.tasksCompleted > 0 ? stats.tasksCompleted : 1)
            / 5;
        uint256 adjustedDisputeSum = (disputeSum * 2) + failedPenalty;

        if (adjustedDisputeSum >= successSum) {
            return 0;
        }

        return ((successSum - adjustedDisputeSum) * 100) / successSum;
    }

    function validateReputationSignature(
        address user,
        uint256 reputation,
        uint256 expiry,
        bytes memory signature
    ) public view override returns (bool) {
        if (block.timestamp > expiry) return false;

        bytes32 messageHash = keccak256(abi.encodePacked(
            "reputation",
            user,
            reputation,
            expiry
        ));
        bytes32 ethSignedHash = messageHash.toEthSignedMessageHash();

        address recovered = ethSignedHash.recover(signature);
        return recovered == reputationSigner;
    }

    function canPropose(address user) external view override returns (bool) {
        IRoseGovernance.UserStats memory stats = _userStats[user];
        if (stats.tasksCompleted < COLD_START_TASKS) return false;
        return getReputation(user) >= PROPOSER_REP_THRESHOLD;
    }

    function canVote(address user) external view override returns (bool) {
        return getReputation(user) >= VOTER_REP_THRESHOLD;
    }

    function canDelegate(address user) external view override returns (bool) {
        IRoseGovernance.UserStats memory stats = _userStats[user];
        if (stats.tasksCompleted < COLD_START_TASKS) return false;
        return getReputation(user) >= DELEGATE_REP_THRESHOLD;
    }

    // ============ Mutating Functions ============

    function updateUserStats(address user, uint256 taskValue, bool isDispute) external override onlyMarketplace nonReentrant {
        uint256 bucket = block.timestamp / BUCKET_DURATION;
        if (isDispute) {
            _monthlyDisputeValue[user][bucket] += taskValue;
        } else {
            _monthlySuccessValue[user][bucket] += taskValue;
        }

        IRoseGovernance.UserStats storage stats = _userStats[user];
        if (isDispute) {
            stats.disputes++;
        } else {
            stats.tasksCompleted++;
            stats.totalTaskValue += taskValue;
        }
        stats.lastTaskTimestamp = block.timestamp;

        emit UserStatsUpdated(user, stats.tasksCompleted, stats.totalTaskValue);
    }

    function recordFailedProposal(address proposer) external override onlyGovernance {
        _userStats[proposer].failedProposals++;
    }
}
