// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "./RoseToken.sol";
import "./RoseReputation.sol";
import "./RoseMarketplace.sol";
import "./TokenStaking.sol";

/**
 * @title RoseGovernance
 * @dev A governance contract with single stakeholder approval model.
 * Stakeholders stake 10% of proposal amount to validate and approve proposals.
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
    uint256 public constant STAKE_PERCENTAGE = 10; // 10% stake required

    enum ProposalType { Work, Governance }
    enum FundingSource { DAO, Customer }

    enum ProposalStatus { Active, Staked, Approved, Rejected, Executed }

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
        address stakeholder; // Single stakeholder who staked
        uint256 stakedAmount; // Amount staked by stakeholder
    }
    
    // Store proposals by ID
    mapping(uint256 => TaskProposal) public proposals;
    
    // Track locked tokens for governance participation
    mapping(address => uint256) public lockedTokens;
    mapping(address => uint256) public lockEndTime;
    
    // Events
    event ProposalCreated(uint256 proposalId, address proposer, string description, uint256 tokenAmount);
    event ProposalStaked(uint256 proposalId, address stakeholder, uint256 stakedAmount);
    event ProposalApproved(uint256 proposalId, address stakeholder);
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
     * @dev Set the BidEvaluationManager contract reference in the marketplace
     * This is a deployment helper function that can be called during contract setup
     */
    function setMarketplaceBidEvaluationManager(address _bidEvaluationManager) external {
        roseMarketplace.setBidEvaluationManager(_bidEvaluationManager);
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
     * @dev Stakeholder stakes 10% of proposal amount to validate it
     * @param _proposalId ID of the proposal to stake on
     */
    function stakeOnProposal(uint256 _proposalId) external {
        TaskProposal storage proposal = proposals[_proposalId];

        // Check if proposal is active and not already staked
        require(proposal.status == ProposalStatus.Active, "Proposal is not active");
        require(proposal.stakeholder == address(0), "Proposal already has a stakeholder");
        require(proposal.proposer != msg.sender, "Proposer cannot stake on their own proposal");

        // Calculate required 10% stake
        uint256 requiredStake = (proposal.tokenAmount * STAKE_PERCENTAGE) / 100;

        // Transfer tokens from stakeholder to this contract
        require(roseToken.transferFrom(msg.sender, address(this), requiredStake), "Token transfer failed");

        proposal.stakeholder = msg.sender;
        proposal.stakedAmount = requiredStake;
        proposal.status = ProposalStatus.Staked;

        emit ProposalStaked(_proposalId, msg.sender, requiredStake);
    }

    /**
     * @dev Stakeholder approves the proposal
     * @param _proposalId ID of the proposal to approve
     */
    function approveProposal(uint256 _proposalId) external {
        TaskProposal storage proposal = proposals[_proposalId];

        // Check if stakeholder is the one who staked
        require(proposal.stakeholder == msg.sender, "Only the stakeholder can approve");
        require(proposal.status == ProposalStatus.Staked, "Proposal must be staked first");

        // Mark as approved and set execution time
        proposal.status = ProposalStatus.Approved;
        proposal.executionTime = block.timestamp + executionDelay;

        emit ProposalApproved(_proposalId, msg.sender);
    }

    /**
     * @dev Reject a proposal (stakeholder or proposer can reject)
     * @param _proposalId ID of the proposal to reject
     */
    function rejectProposal(uint256 _proposalId) external {
        TaskProposal storage proposal = proposals[_proposalId];

        // Only stakeholder or proposer can reject
        require(
            proposal.stakeholder == msg.sender || proposal.proposer == msg.sender,
            "Only stakeholder or proposer can reject"
        );
        require(
            proposal.status == ProposalStatus.Active || proposal.status == ProposalStatus.Staked,
            "Proposal already finalized"
        );

        // Return stake if it was staked
        if (proposal.stakedAmount > 0) {
            uint256 stakeToReturn = proposal.stakedAmount;
            proposal.stakedAmount = 0;
            require(roseToken.transfer(proposal.stakeholder, stakeToReturn), "Stake return failed");
        }

        proposal.status = ProposalStatus.Rejected;
        emit ProposalRejected(_proposalId);
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

        // Return stake to stakeholder
        if (proposal.stakedAmount > 0) {
            uint256 stakeToReturn = proposal.stakedAmount;
            proposal.stakedAmount = 0;
            require(roseToken.transfer(proposal.stakeholder, stakeToReturn), "Stake return failed");
        }

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
