// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IRoseGovernance.sol";

interface IRoseReputation {
    // ============ Events ============
    event UserStatsUpdated(address indexed user, uint256 tasksCompleted, uint256 totalTaskValue);
    event ReputationSignerUpdated(address indexed newSigner);
    event GovernanceUpdated(address indexed newGovernance);
    event MarketplaceUpdated(address indexed newMarketplace);

    // ============ Errors ============
    error NotOwner();
    error NotGovernance();
    error NotMarketplace();
    error ZeroAddress();
    error ZeroAddressSigner();

    // ============ View Functions ============
    function reputationSigner() external view returns (address);
    function governance() external view returns (address);
    function marketplace() external view returns (address);

    function COLD_START_TASKS() external view returns (uint256);
    function PROPOSER_REP_THRESHOLD() external view returns (uint256);
    function VOTER_REP_THRESHOLD() external view returns (uint256);
    function DELEGATE_REP_THRESHOLD() external view returns (uint256);
    function DEFAULT_REPUTATION() external view returns (uint256);
    function BUCKET_DURATION() external view returns (uint256);
    function DECAY_BUCKETS() external view returns (uint256);

    function userStats(address user) external view returns (IRoseGovernance.UserStats memory);
    function monthlySuccessValue(address user, uint256 bucket) external view returns (uint256);
    function monthlyDisputeValue(address user, uint256 bucket) external view returns (uint256);

    function getReputation(address user) external view returns (uint256);
    function getReputationSimple(address user) external view returns (uint256);
    function validateReputationSignature(
        address user,
        uint256 reputation,
        uint256 expiry,
        bytes memory signature
    ) external view returns (bool);
    function canPropose(address user) external view returns (bool);
    function canVote(address user) external view returns (bool);
    function canDelegate(address user) external view returns (bool);

    // ============ Mutating Functions ============
    function updateUserStats(address user, uint256 taskValue, bool isDispute) external;
    function recordFailedProposal(address proposer) external;

    function setReputationSigner(address signer) external;
    function setGovernance(address governance_) external;
    function setMarketplace(address marketplace_) external;
}
