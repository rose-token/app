// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "./RoseToken.sol";
import "./RoseReputation.sol";
import "./StakeholderRegistry.sol";
import "./TokenStaking.sol";
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
    
    // Reference to the StakeholderRegistry contract
    StakeholderRegistry public stakeholderRegistry;
    
    // Reference to the TokenStaking contract
    TokenStaking public tokenStaking;
    
    address public bidEvaluationManager;

    // A designated DAO Treasury that will receive a portion of newly minted tokens
    address public daoTreasury;
    
    // DAO Governance contract that can create tasks using treasury funds
    address public governanceContract;

    // A simple enum to track task status
    enum TaskStatus { Open, StakeholderRequired, InProgress, Completed, Closed, ApprovedPendingPayment }
    

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
        uint256 storyPoints;       // Estimated effort in story points
    }
    

    // Keep a count to assign unique task IDs
    uint256 public taskCounter;

    // Maps task ID => Task details
    mapping(uint256 => Task) public tasks;
    

    // Events for logging
    event TaskCreated(uint256 taskId, address indexed customer, uint256 deposit);
    event StakeholderStaked(uint256 taskId, address indexed stakeholder, uint256 stakeholderDeposit);
    event TaskClaimed(uint256 taskId, address indexed worker, uint256 storyPoints);
    event TaskCompleted(uint256 taskId);
    event PaymentReleased(uint256 taskId, address indexed worker, uint256 amount);
    event TaskClosed(uint256 taskId);
    event TaskReadyForPayment(uint256 taskId, address indexed worker, uint256 amount);
    event TokensMinted(address indexed to, uint256 amount);
    event FaucetTokensClaimed(address indexed to, uint256 amount);

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
        require(_daoTreasury != address(0));
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
        require(governanceContract == address(0));
        require(_governanceContract != address(0));
        governanceContract = _governanceContract;
    }
    
    /**
     * @dev Set the stakeholder registry contract address
     * @param _stakeholderRegistry Address of the StakeholderRegistry contract
     */
    function setStakeholderRegistry(address _stakeholderRegistry) external {
        // In a production system, you would add access control here
        // For this example, we're allowing anyone to set this initially
        // In reality, you would restrict this to owner or multisig
        require(_stakeholderRegistry != address(0));
        stakeholderRegistry = StakeholderRegistry(_stakeholderRegistry);
    }
    
    /**
     * @dev Set the token staking contract address
     */
    function setTokenStaking(TokenStaking _tokenStaking) external {
        require(msg.sender == address(roseToken) || msg.sender == governanceContract);
        tokenStaking = _tokenStaking;
    }
    
    function setBidEvaluationManager(address _bidEvaluationManager) external {
        require(msg.sender == address(roseToken) || msg.sender == governanceContract);
        bidEvaluationManager = _bidEvaluationManager;
    }
    
    /**
     * @dev Modifier to restrict access to governance contract
     */
    modifier onlyGovernance() {
        require(msg.sender == governanceContract);
        _;
    }

    /**
     * @dev Create a new task, depositing ROSE tokens that will be paid to the worker upon successful completion.
     * @param _description A brief description of the task
     * @param _tokenAmount Amount of ROSE tokens to deposit
     * @param _detailedDescription Optional detailed information about the task (can be empty string)
     */
    function createTask(string calldata _description, uint256 _tokenAmount, string calldata _detailedDescription) external {
        require(_tokenAmount > 0);
        
        // Transfer tokens from customer to the contract
        require(roseToken.transferFrom(msg.sender, address(this), _tokenAmount));

        taskCounter++;
        Task storage newTask = tasks[taskCounter];
        newTask.customer = msg.sender;
        newTask.deposit = _tokenAmount;
        newTask.description = _description;
        newTask.detailedDescription = _detailedDescription; // Store the detailed description (can be empty)
        newTask.status = TaskStatus.StakeholderRequired;
        newTask.customerApproval = false;
        newTask.stakeholderApproval = false;

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
        require(_tokenAmount > 0);
        
        // Transfer tokens from treasury to the contract
        require(roseToken.transferFrom(daoTreasury, address(this), _tokenAmount));

        taskCounter++;
        Task storage newTask = tasks[taskCounter];
        newTask.customer = daoTreasury; // Treasury is the customer
        newTask.deposit = _tokenAmount;
        newTask.description = _description;
        newTask.detailedDescription = _detailedDescription;
        newTask.status = TaskStatus.StakeholderRequired;
        newTask.customerApproval = false;
        newTask.stakeholderApproval = false;
        
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
        
        // Check stakeholder registry eligibility (if registry is set)
        if (address(stakeholderRegistry) != address(0)) {
            require(stakeholderRegistry.isEligibleStakeholder(msg.sender), "Not eligible stakeholder");
            require(!stakeholderRegistry.checkRoleConflict(msg.sender, t.customer, t.worker), "Role conflict detected");
        }
        
        // Calculate required 10% deposit
        uint256 requiredDeposit = t.deposit / 10;
        require(_tokenAmount == requiredDeposit, "Must deposit exactly 10% of task value");
        
        // Transfer tokens from stakeholder to the contract
        require(roseToken.transferFrom(msg.sender, address(this), _tokenAmount));
        
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
        // Check specific conditions first to ensure proper error messages
        require(t.worker == address(0), "Task already claimed");
        require(t.customer != msg.sender, "Customer cannot claim their own task");
        require(_storyPoints > 0, "Story points must be greater than zero");
        require(msg.sender != address(0), "Worker cannot be zero address");
        require(t.stakeholder != address(0), "Task must have a stakeholder");

        // Tasks can only be claimed when status is Open (after stakeholder has staked)
        require(t.status == TaskStatus.Open,
                "Task must be Open for claiming");

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
     * @dev Stakeholder approves the work. If the customer also approved,
     * we mark the task as ready for payment acceptance.
     * @param _taskId ID of the task to approve
     */
    function approveCompletionByStakeholder(uint256 _taskId) external {
        Task storage t = tasks[_taskId];
        require(t.stakeholder == msg.sender, "Only the designated stakeholder can approve");
        require(t.status == TaskStatus.Completed, "Task must be completed first");
        
        // Record stakeholder approval
        t.stakeholderApproval = true;
        
        // Add debug logging
        console.log("Task", _taskId, "stakeholder approved");
        console.log("Customer approval status:", t.customerApproval);
        
        // Check if both customer and stakeholder have approved
        if (t.customerApproval) {
            console.log("Both customer and stakeholder approved, marking task ready for payment acceptance");
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
        require(t.customerApproval && t.stakeholderApproval, "Task must be approved by customer and stakeholder");
        
        console.log("Worker accepting payment for task", _taskId);
        _finalizeTask(_taskId, true);
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
     * This is where you can customize the "worker-focused" logic: 
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
     * @dev Faucet function to mint test ROSE tokens for users
     * @param _amount Amount of ROSE tokens to mint (limited to prevent abuse)
     */
    function claimFaucetTokens(uint256 _amount) external {
        require(_amount <= 100 ether, "Cannot claim more than 100 ROSE tokens at once");
        
        // Mint tokens to the caller
        roseToken.mint(msg.sender, _amount);
        
        emit FaucetTokensClaimed(msg.sender, _amount);
    }



    
    
}
