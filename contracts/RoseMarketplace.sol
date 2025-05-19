// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "./RoseToken.sol";
import "./RoseReputation.sol";
import "hardhat/console.sol";

/**
 * @title RoseMarketplace
 * @dev A feature-rich MVP combining escrowed tasks with a stakeholder-based
 * validation process and RoseToken minting logic.
 *
 * DISCLAIMER:
 * This code is purely for illustration, not production. 
 * Use at your own risk, and always get audits and security reviews.
 */
contract RoseMarketplace {

    // Reference to the RoseToken contract
    RoseToken public roseToken;
    
    // Reference to the RoseReputation contract
    RoseReputation public roseReputation;

    // A designated DAO Treasury that will receive a portion of newly minted tokens
    address public daoTreasury;
    
    // DAO Governance contract that can create tasks using treasury funds
    address public governanceContract;

    // A simple enum to track task status
    enum TaskStatus { Open, StakeholderRequired, InProgress, Completed, Disputed, Closed, ApprovedPendingPayment, RefundRequested, Bidding, ShortlistSelected }
    
    // Structure for task comments with threading support
    struct Comment {
        address author;           // Address that created the comment
        uint256 timestamp;        // When comment was created
        bytes32 contentHash;      // Hashed content (for verification)
        uint256 parentCommentId;  // For threaded replies (0 for top-level comments)
        string ipfsCid;           // IPFS CID for comment content
    }

    // Basic structure to store details about each task
    struct Task {
        address customer;
        address worker;
        address stakeholder;
        uint256 deposit;           // Payment in ROSE tokens the customer puts up
        uint256 stakeholderDeposit; // 10% deposit from stakeholder in ROSE tokens
        string description;        // Basic metadata or instructions
        string detailedDescription; // Optional detailed information about the task
        TaskStatus status;
        bool customerApproval;     
        bool stakeholderApproval;  
        bool workerApproval;       // Added for triple-approval refund mechanism
        bool refundRequested;      // Flag to track if refund was requested
        uint256 storyPoints;       // Estimated effort in story points
    }
    
    // Bid status for tracking progression
    enum BidStatus { Active, Shortlisted, Selected, Rejected, Withdrawn }
    
    // Structure to store worker bids
    struct WorkerBid {
        address worker;
        uint256 bidAmount;          // Amount worker is willing to accept
        uint256 stakingAmount;      // Tokens staked when bidding
        uint256 estimatedDuration;  // In days
        uint256 storyPoints;        // Effort estimation
        string portfolioLink;       // IPFS hash of portfolio/relevant experience
        string implementationPlan;  // IPFS hash of implementation approach
        uint256 reputationScore;    // Calculated from RoseReputation
        uint256 bidTime;            // When bid was placed
        BidStatus status;           // Current bid status
    }
    
    // Bidding phase for a task
    struct BiddingPhase {
        uint256 startTime;          // When bidding started
        uint256 endTime;            // When bidding ends
        uint256 minStake;           // Minimum tokens required to place bid
        uint256 selectedBidIndex;   // Index of selected bid in the bids array
        bool isClosed;              // Whether bidding phase is closed
        WorkerBid[] bids;           // Array of all bids received
        mapping(address => uint256) workerToBidIndex; // For quick lookup
        mapping(address => bool) workerHasBid;        // Check if worker already bid
    }
    
    // Maps task ID => BiddingPhase details
    mapping(uint256 => BiddingPhase) public taskBidding;

    // Keep a count to assign unique task IDs
    uint256 public taskCounter;

    // Maps task ID => Task details
    mapping(uint256 => Task) public tasks;
    
    // Maps task ID => array of comments
    mapping(uint256 => Comment[]) public taskComments;
    
    // Keep track of comment count per task
    mapping(uint256 => uint256) public taskCommentCount;
    
    // Maps user address to their public PGP key
    mapping(address => string) public userPublicKeys;

    // Events for logging
    event TaskCreated(uint256 taskId, address indexed customer, uint256 deposit);
    event StakeholderStaked(uint256 taskId, address indexed stakeholder, uint256 stakeholderDeposit);
    event TaskClaimed(uint256 taskId, address indexed worker, uint256 storyPoints);
    event TaskCompleted(uint256 taskId);
    event TaskDisputed(uint256 taskId);
    event PaymentReleased(uint256 taskId, address indexed worker, uint256 amount);
    event TaskClosed(uint256 taskId);
    event TaskReadyForPayment(uint256 taskId, address indexed worker, uint256 amount);
    event CommentAdded(uint256 taskId, uint256 commentId, address indexed author, uint256 parentCommentId);
    event TokensMinted(address indexed to, uint256 amount);
    event FaucetTokensClaimed(address indexed to, uint256 amount);
    event RefundRequested(uint256 taskId, address requestedBy);
    event RefundProcessed(uint256 taskId, uint256 customerRefund, uint256 stakeholderRefund);
    event BiddingStarted(uint256 taskId, uint256 startTime, uint256 endTime, uint256 minStake);
    event BidPlaced(uint256 taskId, address indexed worker, uint256 bidAmount, uint256 storyPoints, uint256 reputationScore);
    event ShortlistSelected(uint256 taskId, uint256[] selectedBidIndices);
    event WorkerSelected(uint256 taskId, address indexed worker, uint256 bidAmount);
    event BidWithdrawn(uint256 taskId, address indexed worker);
    event BiddingPeriodExtended(uint256 taskId, uint256 newEndTime);
    event BiddingRestarted(uint256 taskId);

    // Reward parameters for demonstration
    // On successful task completion, we mint a fixed base of 100 ROSE tokens
    // then split them among the worker, stakeholder, treasury, and burn a fraction
    uint256 public constant BASE_REWARD = 100 ether; // if decimals = 18, "100 ether" means 100 tokens

    // Example splits: 60% to worker, 20% to stakeholder, 20% to treasury, 0% burned
    // (This is just an example ratio, tweak as desired.)
    uint256 public constant WORKER_SHARE = 60;      // 60%
    uint256 public constant STAKEHOLDER_SHARE = 20; // 20%
    uint256 public constant TREASURY_SHARE = 20;    // 20%
    uint256 public constant BURN_SHARE = 0;         // 0%
    uint256 public constant SHARE_DENOMINATOR = 100;

    // Burn address (commonly the zero address or a dead address)
    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    /**
     * @dev Constructor sets up the RoseToken contract, RoseReputation contract, and DAO treasury address.
     * In a production design, you'd likely manage these addresses with Ownable logic.
     * @param _daoTreasury The address where part of minted tokens go
     */
    constructor(address _daoTreasury) {
        require(_daoTreasury != address(0), "DAO treasury cannot be zero");
        daoTreasury = _daoTreasury;
        governanceContract = address(0); // Initially no governance contract

        // Deploy the RoseToken, designating this marketplace as its minter
        roseToken = new RoseToken(address(this));
        
        // Deploy the RoseReputation contract for tracking experience and levels
        roseReputation = new RoseReputation();
    }
    
    /**
     * @dev Set the governance contract address
     * @param _governanceContract Address of the governance contract
     */
    function setGovernanceContract(address _governanceContract) external {
        // In a production system, you would add access control here
        // For this example, we're allowing anyone to set this initially
        // In reality, you would restrict this to owner or multisig
        require(governanceContract == address(0), "Governance contract already set");
        require(_governanceContract != address(0), "Governance contract cannot be zero address");
        governanceContract = _governanceContract;
    }
    
    /**
     * @dev Modifier to restrict access to governance contract
     */
    modifier onlyGovernance() {
        require(msg.sender == governanceContract, "Only governance contract can call");
        _;
    }

    /**
     * @dev Create a new task, depositing ROSE tokens that will be paid to the worker upon successful completion.
     * @param _description A brief description of the task
     * @param _tokenAmount Amount of ROSE tokens to deposit
     * @param _detailedDescription Optional detailed information about the task (can be empty string)
     */
    function createTask(string calldata _description, uint256 _tokenAmount, string calldata _detailedDescription) external {
        require(_tokenAmount > 0, "Must deposit some ROSE tokens as payment");
        
        // Transfer tokens from customer to the contract
        require(roseToken.transferFrom(msg.sender, address(this), _tokenAmount), "Token transfer failed");

        taskCounter++;
        Task storage newTask = tasks[taskCounter];
        newTask.customer = msg.sender;
        newTask.deposit = _tokenAmount;
        newTask.description = _description;
        newTask.detailedDescription = _detailedDescription; // Store the detailed description (can be empty)
        newTask.status = TaskStatus.StakeholderRequired;
        newTask.customerApproval = false;
        newTask.stakeholderApproval = false;
        newTask.workerApproval = false;
        newTask.refundRequested = false;

        // Award experience to customer for creating a task
        roseReputation.awardExperience(msg.sender, RoseReputation.Role.Customer, roseReputation.CUSTOMER_TASK_CREATION_EXP());

        emit TaskCreated(taskCounter, msg.sender, _tokenAmount);
    }
    

    /**
     * @dev Create a task from the governance contract using treasury funds
     * @param _description A brief description of the task
     * @param _tokenAmount Amount of ROSE tokens to deposit 
     * @param _detailedDescription Optional detailed information about the task
     * @return The ID of the created task
     */
    function createTaskFromGovernance(
        string calldata _description, 
        uint256 _tokenAmount, 
        string calldata _detailedDescription
    ) external onlyGovernance returns (uint256) {
        require(_tokenAmount > 0, "Must deposit some ROSE tokens as payment");
        
        // Transfer tokens from treasury to the contract
        require(roseToken.transferFrom(daoTreasury, address(this), _tokenAmount), "Token transfer failed");

        taskCounter++;
        Task storage newTask = tasks[taskCounter];
        newTask.customer = daoTreasury; // Treasury is the customer
        newTask.deposit = _tokenAmount;
        newTask.description = _description;
        newTask.detailedDescription = _detailedDescription;
        newTask.status = TaskStatus.StakeholderRequired;
        newTask.customerApproval = false;
        newTask.stakeholderApproval = false;
        newTask.workerApproval = false;
        newTask.refundRequested = false;
        
        emit TaskCreated(taskCounter, daoTreasury, _tokenAmount);
        return taskCounter;
    }

    /**
     * @dev Stakeholder stakes 10% of the task deposit in ROSE tokens to become the stakeholder for a task
     * @param _taskId ID of the task to stake on
     * @param _tokenAmount Amount of ROSE tokens to stake (must be exactly 10% of task deposit)
     */
    function stakeholderStake(uint256 _taskId, uint256 _tokenAmount) external {
        Task storage t = tasks[_taskId];
        require(t.status == TaskStatus.StakeholderRequired, "Task must be waiting for stakeholder");
        require(t.stakeholder == address(0), "Task already has a stakeholder");
        require(t.customer != msg.sender, "Customer cannot be stakeholder for their own task");
        
        // Calculate required 10% deposit
        uint256 requiredDeposit = t.deposit / 10;
        require(_tokenAmount == requiredDeposit, "Must deposit exactly 10% of task value");
        
        // Transfer tokens from stakeholder to the contract
        require(roseToken.transferFrom(msg.sender, address(this), _tokenAmount), "Token transfer failed");
        
        t.stakeholder = msg.sender;
        t.stakeholderDeposit = _tokenAmount;
        t.status = TaskStatus.Bidding;
        
        // Award experience to stakeholder for staking on a task
        roseReputation.awardExperience(msg.sender, RoseReputation.Role.Stakeholder, roseReputation.STAKEHOLDER_STAKE_EXP());
        
        emit StakeholderStaked(_taskId, msg.sender, _tokenAmount);
    }

    /**
     * @dev Start bidding phase after stakeholder has staked
     * @param _taskId ID of the task
     * @param _biddingDuration Duration of bidding period in days
     * @param _minStake Minimum ROSE tokens required to place a bid
     */
    function startBiddingPhase(uint256 _taskId, uint256 _biddingDuration, uint256 _minStake) external {
        Task storage t = tasks[_taskId];
        require(t.status == TaskStatus.Bidding, "Task must be in Bidding state");
        require(t.stakeholder == msg.sender || t.customer == msg.sender, "Only stakeholder or customer can start bidding");
        require(_biddingDuration >= 1 days && _biddingDuration <= 30 days, "Bidding duration must be between 1 and 30 days");
        
        BiddingPhase storage bidding = taskBidding[_taskId];
        bidding.startTime = block.timestamp;
        bidding.endTime = block.timestamp + _biddingDuration;
        bidding.minStake = _minStake;
        bidding.isClosed = false;
        
        emit BiddingStarted(_taskId, bidding.startTime, bidding.endTime, _minStake);
    }
    
    /**
     * @dev Worker places a bid on a task
     * @param _taskId ID of the task
     * @param _bidAmount Amount of tokens worker is willing to accept
     * @param _estimatedDuration Estimated completion time in days
     * @param _storyPoints Estimated effort in story points
     * @param _portfolioLink IPFS hash of portfolio/experience
     * @param _implementationPlan IPFS hash of implementation approach
     */
    function placeBid(
        uint256 _taskId,
        uint256 _bidAmount,
        uint256 _estimatedDuration,
        uint256 _storyPoints,
        string calldata _portfolioLink,
        string calldata _implementationPlan
    ) external {
        Task storage t = tasks[_taskId];
        BiddingPhase storage bidding = taskBidding[_taskId];
        
        require(t.status == TaskStatus.Bidding, "Task must be in bidding phase");
        require(block.timestamp < bidding.endTime, "Bidding period has ended");
        require(!bidding.workerHasBid[msg.sender], "Worker has already placed a bid");
        require(t.customer != msg.sender, "Customer cannot bid on own task");
        require(t.stakeholder != msg.sender, "Stakeholder cannot bid on this task");
        
        // Transfer stake from worker to contract
        require(roseToken.transferFrom(msg.sender, address(this), bidding.minStake), "Stake transfer failed");
        
        // Calculate reputation score for sorting/ranking
        uint256 reputationScore = calculateBidReputationScore(msg.sender);
        
        // Create and store the bid
        WorkerBid memory newBid = WorkerBid({
            worker: msg.sender,
            bidAmount: _bidAmount,
            stakingAmount: bidding.minStake,
            estimatedDuration: _estimatedDuration,
            storyPoints: _storyPoints,
            portfolioLink: _portfolioLink,
            implementationPlan: _implementationPlan,
            reputationScore: reputationScore,
            bidTime: block.timestamp,
            status: BidStatus.Active
        });
        
        bidding.bids.push(newBid);
        bidding.workerToBidIndex[msg.sender] = bidding.bids.length - 1;
        bidding.workerHasBid[msg.sender] = true;
        
        // Award experience points for bidding
        roseReputation.awardExperience(msg.sender, RoseReputation.Role.Worker, 5);
        
        emit BidPlaced(_taskId, msg.sender, _bidAmount, _storyPoints, reputationScore);
    }
    
    /**
     * @dev Calculate a reputation score for bid ranking
     * @param _worker Address of the worker
     * @return Score based on reputation and past performance
     */
    function calculateBidReputationScore(address _worker) public view returns (uint256) {
        // Get worker level from reputation contract
        uint256 workerLevel = roseReputation.getLevel(_worker, RoseReputation.Role.Worker);
        
        // Get task completion statistics (would need to be tracked separately)
        uint256 tasksCompleted = getWorkerCompletedTasks(_worker);
        uint256 tasksCancelled = getWorkerCancelledTasks(_worker);
        
        // Weight factors
        uint256 levelWeight = 40;
        uint256 completionWeight = 40;   
        uint256 cancelWeight = 20;
        
        // Calculate scores for each component
        uint256 levelScore = workerLevel * 10;  // 0-100 scale
        
        uint256 completionScore = 0;
        if (tasksCompleted + tasksCancelled > 0) {
            completionScore = (tasksCompleted * 100) / (tasksCompleted + tasksCancelled);
        }
        
        // Final weighted score
        return (levelScore * levelWeight + completionScore * completionWeight) / 100;
    }
    
    /**
     * @dev Get the number of completed tasks for a worker
     * @param _worker Address of the worker
     * @return Number of tasks completed
     */
    function getWorkerCompletedTasks(address _worker) internal view returns (uint256) {
        // Implementation would track completed tasks in a mapping
        // For now, return a placeholder value
        return 0;
    }
    
    /**
     * @dev Get the number of cancelled tasks for a worker
     * @param _worker Address of the worker
     * @return Number of tasks cancelled
     */
    function getWorkerCancelledTasks(address _worker) internal view returns (uint256) {
        // Implementation would track cancelled tasks in a mapping
        // For now, return a placeholder value
        return 0;
    }
    
    /**
     * @dev Customer selects a short list of top bids for stakeholder review
     * @param _taskId ID of the task
     * @param _selectedBidIndices Array of indices of selected bids
     */
    function selectShortlist(uint256 _taskId, uint256[] calldata _selectedBidIndices) external {
        Task storage t = tasks[_taskId];
        BiddingPhase storage bidding = taskBidding[_taskId];
        
        require(t.customer == msg.sender, "Only customer can select shortlist");
        require(t.status == TaskStatus.Bidding, "Task must be in bidding phase");
        require(block.timestamp >= bidding.endTime, "Bidding period must have ended");
        require(_selectedBidIndices.length > 0 && _selectedBidIndices.length <= 5, "Must select 1-5 bids");
        
        // Mark selected bids for stakeholder review
        for (uint i = 0; i < _selectedBidIndices.length; i++) {
            require(_selectedBidIndices[i] < bidding.bids.length, "Invalid bid index");
            bidding.bids[_selectedBidIndices[i]].status = BidStatus.Shortlisted;
        }
        
        t.status = TaskStatus.ShortlistSelected;
        emit ShortlistSelected(_taskId, _selectedBidIndices);
    }
    
    /**
     * @dev Stakeholder reviews shortlisted bids and makes final selection
     * @param _taskId ID of the task
     * @param _finalBidIndex Index of the finally selected bid
     */
    function finalizeWorkerSelection(uint256 _taskId, uint256 _finalBidIndex) external {
        Task storage t = tasks[_taskId];
        BiddingPhase storage bidding = taskBidding[_taskId];
        
        require(t.stakeholder == msg.sender, "Only stakeholder can finalize selection");
        require(t.status == TaskStatus.ShortlistSelected, "Task must have shortlisted bids");
        require(_finalBidIndex < bidding.bids.length, "Invalid bid index");
        require(bidding.bids[_finalBidIndex].status == BidStatus.Shortlisted, "Can only select from shortlisted bids");
        
        // Set the selected worker
        address selectedWorker = bidding.bids[_finalBidIndex].worker;
        bidding.selectedBidIndex = _finalBidIndex;
        bidding.bids[_finalBidIndex].status = BidStatus.Selected;
        bidding.isClosed = true;
        
        // Update task with selected worker and parameters
        t.worker = selectedWorker;
        t.storyPoints = bidding.bids[_finalBidIndex].storyPoints;
        t.status = TaskStatus.InProgress;
        
        // Return stakes to all non-selected bidders
        for (uint i = 0; i < bidding.bids.length; i++) {
            if (i != _finalBidIndex && bidding.bids[i].status != BidStatus.Withdrawn) {
                address bidder = bidding.bids[i].worker;
                uint256 stakeAmount = bidding.bids[i].stakingAmount;
                bidding.bids[i].stakingAmount = 0;
                bidding.bids[i].status = BidStatus.Rejected;
                
                // Return stake to non-selected bidder
                roseToken.transfer(bidder, stakeAmount);
            }
        }
        
        // Award experience to the selected worker
        roseReputation.awardExperience(selectedWorker, RoseReputation.Role.Worker, roseReputation.WORKER_CLAIM_EXP());
        
        emit WorkerSelected(_taskId, selectedWorker, bidding.bids[_finalBidIndex].bidAmount);
    }
    
    /**
     * @dev Worker withdraws their bid and reclaims stake
     * @param _taskId ID of the task
     */
    function withdrawBid(uint256 _taskId) external {
        Task storage t = tasks[_taskId];
        BiddingPhase storage bidding = taskBidding[_taskId];
        
        require(t.status == TaskStatus.Bidding, "Task must be in bidding phase");
        require(bidding.workerHasBid[msg.sender], "Worker has not placed a bid");
        
        uint256 bidIndex = bidding.workerToBidIndex[msg.sender];
        WorkerBid storage bid = bidding.bids[bidIndex];
        
        require(bid.status == BidStatus.Active, "Bid must be active to withdraw");
        
        // Update bid status
        bid.status = BidStatus.Withdrawn;
        
        // Return staked tokens
        uint256 stakeAmount = bid.stakingAmount;
        bid.stakingAmount = 0;
        roseToken.transfer(msg.sender, stakeAmount);
        
        emit BidWithdrawn(_taskId, msg.sender);
    }
    
    /**
     * @dev Get all bids for a task with transparency
     * @param _taskId ID of the task
     */
    function getTaskBids(uint256 _taskId) external view returns (WorkerBid[] memory) {
        BiddingPhase storage bidding = taskBidding[_taskId];
        return bidding.bids;
    }
    
    /**
     * @dev Extend bidding period (if few bids received)
     * @param _taskId ID of the task
     * @param _additionalTime Time to extend in seconds
     */
    function extendBiddingPeriod(uint256 _taskId, uint256 _additionalTime) external {
        Task storage t = tasks[_taskId];
        BiddingPhase storage bidding = taskBidding[_taskId];
        
        require(t.customer == msg.sender || t.stakeholder == msg.sender, "Only customer or stakeholder can extend");
        require(t.status == TaskStatus.Bidding, "Task must be in bidding phase");
        require(block.timestamp <= bidding.endTime, "Bidding period already ended");
        require(_additionalTime <= 14 days, "Cannot extend more than 14 days");
        
        bidding.endTime += _additionalTime;
        
        emit BiddingPeriodExtended(_taskId, bidding.endTime);
    }
    
    /**
     * @dev Emergency function to handle bidding disputes
     * @param _taskId ID of the task
     * @param _action Action to take (1: restart bidding, 2: cancel task)
     */
    function handleBiddingDispute(uint256 _taskId, uint8 _action) external {
        Task storage t = tasks[_taskId];
        
        require(t.stakeholder == msg.sender, "Only stakeholder can resolve disputes");
        require(t.status == TaskStatus.Bidding || t.status == TaskStatus.ShortlistSelected,
                "Task must be in bidding or shortlist phase");
        
        if (_action == 1) {
            // Restart bidding phase
            BiddingPhase storage bidding = taskBidding[_taskId];
            
            // Return all stakes
            for (uint i = 0; i < bidding.bids.length; i++) {
                if (bidding.bids[i].stakingAmount > 0) {
                    roseToken.transfer(bidding.bids[i].worker, bidding.bids[i].stakingAmount);
                    bidding.bids[i].stakingAmount = 0;
                }
            }
            
            // Reset bidding phase
            bidding.startTime = block.timestamp;
            bidding.endTime = block.timestamp + 7 days;
            bidding.isClosed = false;
            delete bidding.bids;
            
            emit BiddingRestarted(_taskId);
        } else if (_action == 2) {
            // Cancel task and return deposits
            _processRefund(_taskId);
        }
    }
    
    /**
     * @dev Worker claims an open task and provides story points estimation
     * @param _taskId ID of the task to be claimed
     * @param _storyPoints Integer value representing the estimated effort in story points
     */
    function claimTask(uint256 _taskId, uint256 _storyPoints) external {
        Task storage t = tasks[_taskId];
        // Check specific conditions first to ensure proper error messages
        require(t.worker == address(0), "Task already claimed");
        require(t.customer != msg.sender, "Customer cannot claim their own task");
        require(_storyPoints > 0, "Story points must be greater than zero");
        require(msg.sender != address(0), "Worker cannot be zero address");
        require(t.stakeholder != address(0), "Task must have a stakeholder");
        
        // Tasks can be claimed directly if they are in Open or StakeholderRequired status
        // For tasks with bidding enabled, they must go through the bidding process
        require(t.status == TaskStatus.Open || t.status == TaskStatus.StakeholderRequired || 
                t.status == TaskStatus.Bidding || t.status == TaskStatus.ShortlistSelected, 
                "Task must be in a claimable state");

        t.worker = msg.sender;
        t.storyPoints = _storyPoints;
        t.status = TaskStatus.InProgress;
        
        // Award experience to worker for claiming a task
        roseReputation.awardExperience(msg.sender, RoseReputation.Role.Worker, roseReputation.WORKER_CLAIM_EXP());
        
        emit TaskClaimed(_taskId, msg.sender, _storyPoints);
    }

    /**
     * @dev Worker marks a task as completed. Customer & stakeholder still must approve to release funds & mint tokens.
     * @param _taskId ID of the task to mark completed
     */
    function markTaskCompleted(uint256 _taskId) external {
        Task storage t = tasks[_taskId];
        require(t.worker == msg.sender, "Only assigned worker can mark completion");
        require(t.status == TaskStatus.InProgress, "Task must be in progress");
        t.status = TaskStatus.Completed;
        
        // Award experience to worker for completing a task
        roseReputation.awardExperience(msg.sender, RoseReputation.Role.Worker, roseReputation.WORKER_TASK_COMPLETION_EXP());
        
        emit TaskCompleted(_taskId);
    }

    /**
     * @dev Customer approves completed work. If the stakeholder also approved, 
     * we mark the task as ready for payment acceptance.
     * @param _taskId ID of the task to approve
     */
    function approveCompletionByCustomer(uint256 _taskId) external {
        Task storage t = tasks[_taskId];
        require(t.customer == msg.sender, "Only the customer can approve");
        require(t.status == TaskStatus.Completed, "Task must be completed first");
        t.customerApproval = true;
        
        // Add debug logging
        console.log("Task", _taskId, "customer approved");
        console.log("Stakeholder approval status:", t.stakeholderApproval);
        
        // Once both approvals are in, mark task as ready for worker to accept payment
        if (t.stakeholderApproval) {
            console.log("Both approvals received, marking task ready for payment acceptance");
            t.status = TaskStatus.ApprovedPendingPayment;
            emit TaskReadyForPayment(_taskId, t.worker, t.deposit);
        }
    }

    /**
     * @dev Stakeholder approves the work. If the customer also approved, we finalize the task, pay the worker, 
     * and mint tokens to the worker, stakeholder, and treasury. 
     * @param _taskId ID of the task to approve
     */
    function approveCompletionByStakeholder(uint256 _taskId) external {
        Task storage t = tasks[_taskId];
        require(t.stakeholder == msg.sender, "Only the designated stakeholder can approve");
        require(t.status == TaskStatus.Completed, "Task must be completed first");
        t.stakeholderApproval = true;
        
        // Add debug logging
        console.log("Task", _taskId, "stakeholder approved");
        console.log("Customer approval status:", t.customerApproval);
        
        // Once both approvals are in, mark task as ready for worker to accept payment
        if (t.customerApproval) {
            console.log("Both approvals received, marking task ready for payment acceptance");
            t.status = TaskStatus.ApprovedPendingPayment;
            emit TaskReadyForPayment(_taskId, t.worker, t.deposit);
        }
    }

    /**
     * @dev Worker accepts payment for an approved task. 
     * This allows workers to control when they incur gas fees.
     * @param _taskId ID of the task to accept payment for
     */
    function acceptPayment(uint256 _taskId) external {
        Task storage t = tasks[_taskId];
        require(t.worker == msg.sender, "Only assigned worker can accept payment");
        require(t.status == TaskStatus.ApprovedPendingPayment, "Task must be approved and pending payment");
        require(t.customerApproval && t.stakeholderApproval, "Task must be approved by both customer and stakeholder");
        
        console.log("Worker accepting payment for task", _taskId);
        _finalizeTask(_taskId, true);
    }

    /**
     * @dev A simple method to dispute a task. Moves it into Disputed status.
     * @param _taskId ID of the task to dispute
     */
    function disputeTask(uint256 _taskId) external {
        Task storage t = tasks[_taskId];
        require(
            t.status == TaskStatus.Completed || t.status == TaskStatus.InProgress,
            "Invalid status for dispute"
        );
        require(msg.sender == t.customer || msg.sender == t.worker, "Only customer or worker can dispute");
        t.status = TaskStatus.Disputed;
        emit TaskDisputed(_taskId);
    }

    /**
     * @dev The stakeholder resolves a dispute. In this simplistic example, the stakeholder either refunds the customer 
     * or pays the worker. If the worker is paid, we treat that as successful completion and mint the tokens.
     * @param _taskId ID of the task
     * @param _refundToCustomer True if the stakeholder sides with the customer, false if the worker is in the right
     */
    function resolveDispute(uint256 _taskId, bool _refundToCustomer) external {
        Task storage t = tasks[_taskId];
        require(t.stakeholder == msg.sender, "Only stakeholder can resolve disputes");
        require(t.status == TaskStatus.Disputed, "Task not in dispute");

        // Fix ordering to follow checks-effects-interactions pattern
        t.status = TaskStatus.Closed;
        uint256 amountToPay = t.deposit;
        t.deposit = 0; // prevent re-entrancy double-withdraw
        
        // Always return stakeholder deposit regardless of dispute outcome
        uint256 stakeholderRefund = t.stakeholderDeposit;
        t.stakeholderDeposit = 0;
        emit TaskClosed(_taskId);

        if (_refundToCustomer) {
            // Transfer ROSE tokens back to customer
            require(roseToken.transfer(t.customer, amountToPay), "Refund failed");
        } else {
            // If the worker wins, pay them the deposit 
            // and also treat it as 'completion' for token minting
            require(roseToken.transfer(t.worker, amountToPay), "Worker payment failed");

            // Mint tokens to the worker, stakeholder, treasury, and burn portion
            _mintReward(t.customer, t.worker, t.stakeholder);
        }
        
        // Return stakeholder deposit
        if (stakeholderRefund > 0) {
            require(roseToken.transfer(t.stakeholder, stakeholderRefund), "Return of stakeholder deposit failed");
        }
    }

    /**
     * @dev Internally finalize the task if both approvals are met in a non-disputed scenario.
     */
    function _finalizeTask(uint256 _taskId, bool _payout) internal {
        Task storage t = tasks[_taskId];
        t.status = TaskStatus.Closed;
        emit TaskClosed(_taskId);
        
        if (_payout) {
            uint256 amountToPay = t.deposit;
            console.log("Paying out", amountToPay, "ROSE tokens to worker", t.worker);
            t.deposit = 0;
            
            // Transfer ROSE tokens to worker
            require(roseToken.transfer(t.worker, amountToPay), "Transfer to worker failed");
            console.log("Payment transfer success:", true);
            
            emit PaymentReleased(_taskId, t.worker, amountToPay);
            
            // Return stakeholder deposit
            if (t.stakeholderDeposit > 0) {
                uint256 stakeholderRefund = t.stakeholderDeposit;
                t.stakeholderDeposit = 0;
                require(roseToken.transfer(t.stakeholder, stakeholderRefund), "Return of stakeholder deposit failed");
            }
            
            // Award experience to customer and stakeholder for task completion
            roseReputation.awardExperience(t.customer, RoseReputation.Role.Customer, roseReputation.CUSTOMER_TASK_COMPLETION_EXP());
            roseReputation.awardExperience(t.stakeholder, RoseReputation.Role.Stakeholder, roseReputation.STAKEHOLDER_TASK_COMPLETION_EXP());
            
            // Mint tokens to the worker, stakeholder, treasury, and burn portion
            console.log("Minting rewards");
            _mintReward(t.customer, t.worker, t.stakeholder);
        }
    }

    /**
     * @dev Mint the reward to the worker, stakeholder, and treasury according to splits. 
     * This is where you can customize the "socialist" logic: 
     * e.g., more to worker, some to stakeholder, some to treasury, etc.
     * Applies reputation bonus based on combined levels of customer, worker, and stakeholder.
     */
    function _mintReward(address _customer, address _worker, address _stakeholder) internal {
        // Calculate reputation bonus percentage (0-50%)
        uint256 bonusPercentage = roseReputation.calculateMintingBonus(_customer, _stakeholder, _worker);
        
        // Calculate the total reward with bonus
        uint256 totalReward = BASE_REWARD;
        if (bonusPercentage > 0) {
            // Apply bonus (e.g., 5% bonus = BASE_REWARD * 105 / 100)
            totalReward = (BASE_REWARD * (100 + bonusPercentage)) / 100;
        }
        
        // Split the total reward by the percentages defined above
        uint256 workerAmount = (totalReward * WORKER_SHARE) / SHARE_DENOMINATOR;
        uint256 stakeholderAmount = (totalReward * STAKEHOLDER_SHARE) / SHARE_DENOMINATOR;
        uint256 treasuryAmount = (totalReward * TREASURY_SHARE) / SHARE_DENOMINATOR;
        // No burn amount calculation needed since BURN_SHARE is 0

        console.log("Minting with reputation bonus:", bonusPercentage, "%");
        console.log("Total reward with bonus:", totalReward);
        
        // Mint to worker
        roseToken.mint(_worker, workerAmount);

        // Mint to stakeholder
        roseToken.mint(_stakeholder, stakeholderAmount);

        // Mint to the DAO treasury
        roseToken.mint(daoTreasury, treasuryAmount);
    }

    /**
     * @dev Add a comment to a task. Allows threaded replies if parentCommentId is provided.
     * @param _taskId ID of the task to comment on
     * @param _ipfsCid IPFS CID for the comment content
     * @param _parentCommentId ID of the parent comment (0 for top-level comments)
     */
    function addComment(uint256 _taskId, string calldata _ipfsCid, uint256 _parentCommentId) external {
        require(_taskId > 0 && _taskId <= taskCounter, "Task does not exist");
        
        // If parentCommentId is provided, ensure it exists
        if (_parentCommentId > 0) {
            require(_parentCommentId <= taskCommentCount[_taskId], "Parent comment does not exist");
        }
        
        // Hash the CID to save gas and enable verification
        bytes32 contentHash = keccak256(abi.encodePacked(_ipfsCid));
        
        // Create and store the comment
        taskCommentCount[_taskId]++;
        uint256 commentId = taskCommentCount[_taskId];
        
        Comment memory newComment = Comment({
            author: msg.sender,
            timestamp: block.timestamp,
            contentHash: contentHash,
            parentCommentId: _parentCommentId,
            ipfsCid: _ipfsCid
        });
        
        taskComments[_taskId].push(newComment);
        
        // Emit event for frontend to listen for
        emit CommentAdded(_taskId, commentId, msg.sender, _parentCommentId);
    }
    
    /**
     * @dev Get all comments for a task
     * @param _taskId ID of the task
     */
    function getTaskComments(uint256 _taskId) external view returns (Comment[] memory) {
        require(_taskId > 0 && _taskId <= taskCounter, "Task does not exist");
        return taskComments[_taskId];
    }
    
    /**
     * @dev Faucet function to mint test ROSE tokens for users
     * @param _amount Amount of ROSE tokens to mint (limited to prevent abuse)
     */
    function claimFaucetTokens(uint256 _amount) external {
        require(_amount <= 100 ether, "Cannot claim more than 100 ROSE tokens at once");
        
        // Mint tokens to the caller
        roseToken.mint(msg.sender, _amount);
        
        emit FaucetTokensClaimed(msg.sender, _amount);
    }

    /**
     * @dev Request a refund for a task. Can be called by customer, worker, or stakeholder.
     * @param _taskId ID of the task to request refund for
     */
    function requestRefund(uint256 _taskId) external {
        Task storage t = tasks[_taskId];
        require(
            msg.sender == t.customer || msg.sender == t.worker || msg.sender == t.stakeholder,
            "Only customer, worker, or stakeholder can request refund"
        );
        require(
            t.status == TaskStatus.InProgress || t.status == TaskStatus.Completed,
            "Invalid status for refund request"
        );
        
        t.status = TaskStatus.RefundRequested;
        t.customerApproval = false;
        t.workerApproval = false;
        t.stakeholderApproval = false;
        t.refundRequested = true;
        
        emit RefundRequested(_taskId, msg.sender);
    }

    /**
     * @dev Customer approves a refund request
     * @param _taskId ID of the task to approve refund for
     */
    function approveRefundByCustomer(uint256 _taskId) external {
        Task storage t = tasks[_taskId];
        require(t.customer == msg.sender, "Only the customer can approve");
        require(t.status == TaskStatus.RefundRequested, "Refund must be requested first");
        t.customerApproval = true;
        
        _checkRefundApprovals(_taskId);
    }

    /**
     * @dev Worker approves a refund request
     * @param _taskId ID of the task to approve refund for
     */
    function approveRefundByWorker(uint256 _taskId) external {
        Task storage t = tasks[_taskId];
        require(t.worker == msg.sender, "Only the worker can approve");
        require(t.status == TaskStatus.RefundRequested, "Refund must be requested first");
        t.workerApproval = true;
        
        _checkRefundApprovals(_taskId);
    }

    /**
     * @dev Stakeholder approves a refund request
     * @param _taskId ID of the task to approve refund for
     */
    function approveRefundByStakeholder(uint256 _taskId) external {
        Task storage t = tasks[_taskId];
        require(t.stakeholder == msg.sender, "Only the stakeholder can approve");
        require(t.status == TaskStatus.RefundRequested, "Refund must be requested first");
        t.stakeholderApproval = true;
        
        _checkRefundApprovals(_taskId);
    }

    /**
     * @dev Check if all parties have approved the refund and process it if they have
     * @param _taskId ID of the task to check approvals for
     */
    function _checkRefundApprovals(uint256 _taskId) internal {
        Task storage t = tasks[_taskId];
        
        if (t.customerApproval && t.workerApproval && t.stakeholderApproval) {
            _processRefund(_taskId);
        }
    }

    /**
     * @dev Process a refund after all parties have approved
     * @param _taskId ID of the task to process refund for
     */
    function _processRefund(uint256 _taskId) internal {
        Task storage t = tasks[_taskId];
        t.status = TaskStatus.Closed;
        
        // Store the amounts to refund
        uint256 customerRefund = t.deposit;
        uint256 stakeholderRefund = t.stakeholderDeposit;
        
        // Reset the values to prevent reentrancy
        t.deposit = 0;
        t.stakeholderDeposit = 0;
        
        // Transfer tokens back to original owners
        require(roseToken.transfer(t.customer, customerRefund), "Customer refund failed");
        if (stakeholderRefund > 0) {
            require(roseToken.transfer(t.stakeholder, stakeholderRefund), "Stakeholder refund failed");
        }
        
        emit RefundProcessed(_taskId, customerRefund, stakeholderRefund);
    }

    /**
     * @dev Set the user's public PGP key
     * @param _publicKey The user's PGP public key in armored format
     */
    function setPublicKey(string calldata _publicKey) external {
        userPublicKeys[msg.sender] = _publicKey;
    }
    
    /**
     * @dev Get the minimum stake required to place a bid on a task
     * @param _taskId ID of the task
     * @return The minimum amount of ROSE tokens required to place a bid
     */
    function getMinimumBidStake(uint256 _taskId) external view returns (uint256) {
        require(_taskId > 0 && _taskId <= taskCounter, "Task does not exist");
        require(tasks[_taskId].status == TaskStatus.Bidding, "Task not in bidding phase");
        
        BiddingPhase storage bidding = taskBidding[_taskId];
        require(bidding.startTime > 0, "Bidding has not started for this task");
        
        return bidding.minStake;
    }
}
