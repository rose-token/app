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
    enum TaskStatus { Open, StakeholderRequired, InProgress, Completed, Disputed, Closed, ApprovedPendingPayment, RefundRequested }
    
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
        t.status = TaskStatus.Open;
        
        // Award experience to stakeholder for staking on a task
        roseReputation.awardExperience(msg.sender, RoseReputation.Role.Stakeholder, roseReputation.STAKEHOLDER_STAKE_EXP());
        
        emit StakeholderStaked(_taskId, msg.sender, _tokenAmount);
    }

    /**
     * @dev Worker claims an open task and provides story points estimation
     * @param _taskId ID of the task to be claimed
     * @param _storyPoints Integer value representing the estimated effort in story points
     */
    function claimTask(uint256 _taskId, uint256 _storyPoints) external {
        Task storage t = tasks[_taskId];
        require(t.status == TaskStatus.Open, "Task must be open to be claimed");
        require(t.worker == address(0), "Task already claimed");
        require(t.customer != msg.sender, "Customer cannot claim their own task");
        require(t.stakeholder != address(0), "Task must have a stakeholder");
        require(_storyPoints > 0, "Story points must be greater than zero");
        require(msg.sender != address(0), "Worker cannot be zero address");

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
}
