// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "./TokenStaking.sol";
import "./RoseToken.sol";
import "./RoseReputation.sol";

interface IRoseMarketplace {
    enum BidStatus { Active, Shortlisted, Selected, Rejected, Withdrawn }
    
    struct Bid {
        address worker;
        uint256 bidAmount;
        uint256 storyPoints;
        uint256 stakingAmount;
        BidStatus status;
        uint256 timestamp;
    }
    
    struct BiddingPhase {
        uint256 startTime;
        uint256 endTime;
        bool isActive;
        bool isClosed;
        Bid[] bids;
        uint256 selectedBidIndex;
    }
    
    function taskBidding(uint256 taskId) external view returns (BiddingPhase memory);
    function taskStakeholders(uint256 taskId, uint256 index) external view returns (address);
    function getTaskStakeholderCount(uint256 taskId) external view returns (uint256);
    function finalizeWorkerSelection(uint256 taskId, uint256 bidIndex) external;
}

contract BidEvaluationManager {
    TokenStaking public tokenStaking;
    IRoseMarketplace public marketplace;
    
    mapping(uint256 => uint256) public taskBidEvaluationElections;
    mapping(uint256 => uint256) public electionToTask;
    
    event StakeholderBidEvaluationStarted(uint256 taskId, uint256 electionId, address[] shortlistedBidders);
    event StakeholderBidEvaluationCompleted(uint256 taskId, uint256 electionId, address selectedWorker);
    
    modifier onlyMarketplace() {
        require(msg.sender == address(marketplace), "Only marketplace can call");
        _;
    }
    
    constructor(TokenStaking _tokenStaking, IRoseMarketplace _marketplace) {
        tokenStaking = _tokenStaking;
        marketplace = _marketplace;
    }
    
    function startStakeholderBidEvaluation(uint256 _taskId, uint256[] calldata _selectedBidIndices) external onlyMarketplace {
        require(_selectedBidIndices.length > 1, "Need multiple bids for evaluation");
        require(marketplace.getTaskStakeholderCount(_taskId) > 1, "Need multiple stakeholders");
        
        IRoseMarketplace.BiddingPhase memory bidding = marketplace.taskBidding(_taskId);
        
        address[] memory bidders = new address[](_selectedBidIndices.length);
        for (uint i = 0; i < _selectedBidIndices.length; i++) {
            bidders[i] = bidding.bids[_selectedBidIndices[i]].worker;
        }
        
        uint256 electionId = tokenStaking.startBidEvaluationElection(_taskId, bidders, "bid-eval");
        taskBidEvaluationElections[_taskId] = electionId;
        electionToTask[electionId] = _taskId;
        
        emit StakeholderBidEvaluationStarted(_taskId, electionId, bidders);
    }
    
    function finalizeStakeholderBidEvaluation(uint256 _electionId) external {
        uint256 taskId = electionToTask[_electionId];
        require(taskId > 0, "Invalid election");
        require(taskBidEvaluationElections[taskId] == _electionId, "Election mismatch");
        
        (, , , address winner, bool isFinalized,) = tokenStaking.getElection(_electionId);
        require(isFinalized && winner != address(0), "Election not complete");
        
        IRoseMarketplace.BiddingPhase memory bidding = marketplace.taskBidding(taskId);
        
        uint256 winningBidIndex = 0;
        bool found = false;
        for (uint i = 0; i < bidding.bids.length; i++) {
            if (bidding.bids[i].worker == winner && bidding.bids[i].status == IRoseMarketplace.BidStatus.Shortlisted) {
                winningBidIndex = i;
                found = true;
                break;
            }
        }
        require(found, "Winner not in shortlist");
        
        marketplace.finalizeWorkerSelection(taskId, winningBidIndex);
        
        emit StakeholderBidEvaluationCompleted(taskId, _electionId, winner);
    }
    
    function getBidEvaluationElection(uint256 _taskId) external view returns (uint256) {
        return taskBidEvaluationElections[_taskId];
    }
    
    function isStakeholderElectionComplete(uint256 _taskId) external view returns (bool) {
        uint256 electionId = taskBidEvaluationElections[_taskId];
        if (electionId == 0) return true;
        
        (, , , , bool isFinalized,) = tokenStaking.getElection(electionId);
        return isFinalized;
    }
}
