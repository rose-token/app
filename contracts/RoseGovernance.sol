// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "./RoseToken.sol";
import "./RoseReputation.sol";
import "./RoseMarketplace.sol";
import "./TokenStaking.sol";

/**
 * @title RoseGovernance
 * @dev A governance contract that implements STAR (Score Then Automatic Runoff) voting
 * for task proposals using the DAO treasury funds.
 */
contract RoseGovernance {
    // Reference to existing contracts
    RoseToken public roseToken;
    RoseReputation public roseReputation;
    RoseMarketplace public roseMarketplace;
    TokenStaking public tokenStaking;
    
    // Governance parameters
    uint256 public proposalDuration = 7 days;
    uint256 public executionDelay = 2 days;
    uint256 public minimumTokensToPropose;
    uint256 public proposalCounter;
    uint256 public constant PAYOUT_APPROVAL_THRESHOLD = 66; // 66% threshold for final payouts
    
    // STAR voting parameters
    uint8 public constant MAX_SCORE = 5;
    
    enum ProposalType { Work, Governance }
    enum FundingSource { DAO, Customer }
    
    enum ProposalStatus { Active, Approved, Rejected, Executed, Expired }
    
    struct TaskProposal {
        uint256 id;
        address proposer;
        string description;
        string detailedDescription;
        uint256 tokenAmount; // Funding requested
        uint256 proposalTime;
        uint256 executionTime;
        ProposalStatus status;
        ProposalType proposalType; // Work or Governance
        FundingSource fundingSource; // DAO or Customer
        string ipfsDataHash; // IPFS CID for detailed proposal data
        mapping(address => uint8) scores; // Voter => Score (0-5)
        address[] voters;
        uint256 totalScoreSum; // Sum of all scores
        address finalWinner; // After runoff
    }
    
    // Store proposals by ID
    mapping(uint256 => TaskProposal) public proposals;
    
    // Track locked tokens for governance participation
    mapping(address => uint256) public lockedTokens;
    mapping(address => uint256) public lockEndTime;
    
    // Events
    event ProposalCreated(uint256 proposalId, address proposer, string description, uint256 tokenAmount);
    event VoteCast(uint256 proposalId, address voter, uint8 score);
    event ProposalApproved(uint256 proposalId, address finalWinner);
    event ProposalRejected(uint256 proposalId);
    event ProposalExecuted(uint256 proposalId, uint256 taskId);
    event TokensLocked(address user, uint256 amount, uint256 unlockTime);
    event TokensUnlocked(address user, uint256 amount);
    
    /**
     * @dev Constructor sets up references to existing contracts and governance parameters
     * @param _roseToken The RoseToken contract
     * @param _roseReputation The RoseReputation contract
     * @param _roseMarketplace The RoseMarketplace contract
     * @param _minimumTokensToPropose Minimum tokens required to create a proposal
     */
    constructor(
        RoseToken _roseToken,
        RoseReputation _roseReputation,
        RoseMarketplace _roseMarketplace,
        uint256 _minimumTokensToPropose
    ) {
        roseToken = _roseToken;
        roseReputation = _roseReputation;
        roseMarketplace = _roseMarketplace;
        minimumTokensToPropose = _minimumTokensToPropose;
    }
    
    /**
     * @dev Set the TokenStaking contract reference
     */
    function setTokenStaking(TokenStaking _tokenStaking) external {
        require(msg.sender == address(roseMarketplace) || msg.sender == address(this), "Only marketplace or governance can set token staking");
        tokenStaking = _tokenStaking;
    }
    
    /**
     * @dev Set the TokenStaking contract reference in the marketplace
     * This is a deployment helper function that can be called during contract setup
     */
    function setMarketplaceTokenStaking(TokenStaking _tokenStaking) external {
        roseMarketplace.setTokenStaking(_tokenStaking);
    }
    
    /**
     * @dev Lock tokens to participate in governance
     * @param _amount Amount of tokens to lock
     * @param _duration Duration in seconds for which to lock tokens
     */
    function lockTokens(uint256 _amount, uint256 _duration) external {
        require(_amount > 0, "Must lock some tokens");
        require(_duration >= 7 days, "Lock duration too short");
        require(_duration <= 365 days, "Lock duration too long");
        
        // Transfer tokens from user to this contract
        require(roseToken.transferFrom(msg.sender, address(this), _amount), "Token transfer failed");
        
        // Update locked tokens and unlock time
        lockedTokens[msg.sender] += _amount;
        lockEndTime[msg.sender] = block.timestamp + _duration;
        
        emit TokensLocked(msg.sender, _amount, lockEndTime[msg.sender]);
    }
    
    /**
     * @dev Unlock tokens after lock period ends
     */
    function unlockTokens() external {
        require(block.timestamp >= lockEndTime[msg.sender], "Lock period not ended");
        require(lockedTokens[msg.sender] > 0, "No tokens to unlock");
        
        uint256 amount = lockedTokens[msg.sender];
        lockedTokens[msg.sender] = 0;
        
        // Transfer tokens back to user
        require(roseToken.transfer(msg.sender, amount), "Token transfer failed");
        
        emit TokensUnlocked(msg.sender, amount);
    }
    
    /**
     * @dev Create a new task proposal
     * @param _description Brief description of the task
     * @param _detailedDescription Detailed description of the task
     * @param _tokenAmount Amount of tokens requested for the task
     */
    function createTaskProposal(
        string calldata _description,
        string calldata _detailedDescription,
        uint256 _tokenAmount,
        ProposalType _proposalType,
        FundingSource _fundingSource,
        string calldata _ipfsDataHash
    ) external returns (uint256) {
        // Ensure proposer has enough tokens locked
        require(lockedTokens[msg.sender] >= minimumTokensToPropose, "Insufficient tokens locked to propose");
        
        // Validate proposal type and funding source combination
        if (_proposalType == ProposalType.Work) {
            require(_fundingSource == FundingSource.DAO || _fundingSource == FundingSource.Customer, "Invalid funding source for work proposal");
        } else {
            require(_fundingSource == FundingSource.DAO, "Governance proposals must be DAO funded");
        }
        
        proposalCounter++;
        TaskProposal storage proposal = proposals[proposalCounter];
        proposal.id = proposalCounter;
        proposal.proposer = msg.sender;
        proposal.description = _description;
        proposal.detailedDescription = _detailedDescription;
        proposal.tokenAmount = _tokenAmount;
        proposal.proposalTime = block.timestamp;
        proposal.status = ProposalStatus.Active;
        proposal.proposalType = _proposalType;
        proposal.fundingSource = _fundingSource;
        proposal.ipfsDataHash = _ipfsDataHash;
        
        emit ProposalCreated(proposalCounter, msg.sender, _description, _tokenAmount);
        return proposalCounter;
    }
    
    /**
     * @dev Cast a vote with a score from 0-5
     * @param _proposalId ID of the proposal to vote on
     * @param _score Score from 0-5
     */
    function vote(uint256 _proposalId, uint8 _score) external {
        // Ensure voter has tokens locked for governance
        require(lockedTokens[msg.sender] > 0, "Must lock tokens to vote");
        
        TaskProposal storage proposal = proposals[_proposalId];
        
        // Check if proposal is active
        require(proposal.status == ProposalStatus.Active, "Proposal is not active");
        require(block.timestamp < proposal.proposalTime + proposalDuration, "Voting period ended");
        
        // Validate score
        require(_score <= MAX_SCORE, "Score must be between 0 and 5");
        
        // Calculate voting weight based on locked tokens and reputation
        uint256 weight = calculateVotingWeight(msg.sender);
        
        // Check if this is the first vote from this user
        bool isNewVoter = proposal.scores[msg.sender] == 0;
        
        // If updating vote, subtract previous score first
        if (!isNewVoter) {
            proposal.totalScoreSum -= proposal.scores[msg.sender] * weight;
        } else {
            proposal.voters.push(msg.sender);
        }
        
        // Record vote
        proposal.scores[msg.sender] = _score;
        proposal.totalScoreSum += _score * weight;
        
        emit VoteCast(_proposalId, msg.sender, _score);
    }
    
    /**
     * @dev Calculate voting weight based on locked tokens, staked tokens, and reputation levels
     * @param _voter Address of the voter
     * @return Weight of the voter's vote
     */
    function calculateVotingWeight(address _voter) public view returns (uint256) {
        // Base weight from locked tokens (1 token = 1 weight)
        uint256 weight = lockedTokens[_voter];
        
        // Add weight from staked tokens if TokenStaking is set
        if (address(tokenStaking) != address(0)) {
            weight += tokenStaking.getStakedAmount(_voter);
        }
        
        // Add bonus weight from reputation levels
        uint256 customerLevel = roseReputation.getLevel(_voter, RoseReputation.Role.Customer);
        uint256 stakeholderLevel = roseReputation.getLevel(_voter, RoseReputation.Role.Stakeholder);
        uint256 workerLevel = roseReputation.getLevel(_voter, RoseReputation.Role.Worker);
        
        // Each level adds 5% to voting weight
        uint256 levelBonus = (customerLevel + stakeholderLevel + workerLevel) * 5;
        weight = weight * (100 + levelBonus) / 100;
        
        return weight;
    }
    
    /**
     * @dev Finalize a proposal after voting period ends
     * @param _proposalId ID of the proposal to finalize
     */
    function finalizeProposal(uint256 _proposalId) external {
        TaskProposal storage proposal = proposals[_proposalId];
        
        // Check if voting period has ended
        require(block.timestamp >= proposal.proposalTime + proposalDuration, "Voting period not ended");
        require(proposal.status == ProposalStatus.Active, "Proposal already finalized");
        
        // STAR voting: first get weighted scores for all candidates
        address[] memory candidates = proposal.voters;
        
        // If no votes, reject proposal
        if (candidates.length == 0) {
            proposal.status = ProposalStatus.Rejected;
            emit ProposalRejected(_proposalId);
            return;
        }
        
        // Find the two highest-scoring candidates for runoff
        address firstCandidate = address(0);
        address secondCandidate = address(0);
        uint256 highestScore = 0;
        uint256 secondHighestScore = 0;
        
        // Calculate weighted scores for each voter
        for (uint i = 0; i < candidates.length; i++) {
            address voter = candidates[i];
            uint256 weight = calculateVotingWeight(voter);
            uint256 weightedScore = uint256(proposal.scores[voter]) * weight;
            
            if (weightedScore > highestScore) {
                secondHighestScore = highestScore;
                secondCandidate = firstCandidate;
                highestScore = weightedScore;
                firstCandidate = voter;
            } else if (weightedScore > secondHighestScore) {
                secondHighestScore = weightedScore;
                secondCandidate = voter;
            }
        }
        
        // Runoff between top two - compare who was scored higher by more voters
        if (secondCandidate != address(0)) {
            uint256 firstPreferred = 0;
            uint256 secondPreferred = 0;
            
            for (uint i = 0; i < proposal.voters.length; i++) {
                address voter = proposal.voters[i];
                if (proposal.scores[voter] > proposal.scores[secondCandidate]) {
                    firstPreferred++;
                } else if (proposal.scores[voter] > proposal.scores[firstCandidate]) {
                    secondPreferred++;
                }
            }
            
            proposal.finalWinner = (firstPreferred >= secondPreferred) ? firstCandidate : secondCandidate;
        } else {
            proposal.finalWinner = firstCandidate;
        }
        
        // Determine if proposal meets approval threshold (majority of possible max score)
        uint256 totalVoters = proposal.voters.length;
        uint256 maxPossibleScore = totalVoters * MAX_SCORE;
        
        if (proposal.totalScoreSum > (maxPossibleScore / 2)) {
            proposal.status = ProposalStatus.Approved;
            proposal.executionTime = block.timestamp + executionDelay;
            emit ProposalApproved(_proposalId, proposal.finalWinner);
        } else {
            proposal.status = ProposalStatus.Rejected;
            emit ProposalRejected(_proposalId);
        }
    }
    
    /**
     * @dev Execute an approved proposal after execution delay
     * @param _proposalId ID of the proposal to execute
     */
    function executeProposal(uint256 _proposalId) external {
        TaskProposal storage proposal = proposals[_proposalId];
        
        // Check if proposal is approved and execution delay has passed
        require(proposal.status == ProposalStatus.Approved, "Proposal not approved");
        require(block.timestamp >= proposal.executionTime, "Execution delay not passed");
        
        // Create the task in the marketplace using the createTaskFromGovernance function
        uint256 taskId = roseMarketplace.createTaskFromGovernance(
            proposal.description,
            proposal.tokenAmount,
            proposal.detailedDescription
        );
        
        proposal.status = ProposalStatus.Executed;
        emit ProposalExecuted(_proposalId, taskId);
    }
}
