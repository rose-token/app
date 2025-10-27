// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "./RoseToken.sol";
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

    // A designated DAO Treasury that will receive a portion of newly minted tokens
    address public daoTreasury;

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
    }
    

    // Keep a count to assign unique task IDs
    uint256 public taskCounter;

    // Maps task ID => Task details
    mapping(uint256 => Task) public tasks;
    

    // Events for logging
    event TaskCreated(uint256 taskId, address indexed customer, uint256 deposit);
    event StakeholderStaked(uint256 taskId, address indexed stakeholder, uint256 stakeholderDeposit);
    event TaskClaimed(uint256 taskId, address indexed worker);
    event TaskCompleted(uint256 taskId);
    event PaymentReleased(uint256 taskId, address indexed worker, uint256 amount);
    event TaskClosed(uint256 taskId);
    event TaskReadyForPayment(uint256 taskId, address indexed worker, uint256 amount);
    event TokensMinted(address indexed to, uint256 amount);
    event FaucetTokensClaimed(address indexed to, uint256 amount);
    event TaskCancelled(uint256 indexed taskId, address indexed cancelledBy, uint256 customerRefund, uint256 stakeholderRefund);
    event TaskUnclaimed(uint256 indexed taskId, address indexed previousWorker);

    // Tokenomics parameters
    // On successful task completion, we mint 2% of task value to DAO treasury
    // Total distribution pot = customer payment + minted tokens (1.02x task value)
    // Distribution: 93% worker, 5% stakeholder fee, 2% DAO (already minted)

    // Minting percentage (2% of task value goes to DAO as new tokens)
    uint256 public constant MINT_PERCENTAGE = 2;

    // Distribution percentages from the total pot (customer payment + minted amount)
    uint256 public constant WORKER_SHARE = 93;      // 93% of pot
    uint256 public constant STAKEHOLDER_SHARE = 5;  // 5% of pot (as fee, plus stake returned)
    uint256 public constant TREASURY_SHARE = 2;     // 2% of pot (already minted separately)
    uint256 public constant SHARE_DENOMINATOR = 100;

    // Burn address (commonly the zero address or a dead address)
    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    /**
     * @dev Constructor sets up the RoseToken contract and DAO treasury address.
     * In a production design, you'd likely manage these addresses with Ownable logic.
     * @param _daoTreasury The address where part of minted tokens go
     */
    constructor(address _daoTreasury) {
        require(_daoTreasury != address(0));
        daoTreasury = _daoTreasury;

        // Deploy the RoseToken, designating this marketplace as its minter
        roseToken = new RoseToken(address(this));
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

        emit TaskCreated(taskCounter, msg.sender, _tokenAmount);
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
        require(t.worker != msg.sender, "Worker cannot be stakeholder for their own task");

        // Calculate required 10% deposit
        uint256 requiredDeposit = t.deposit / 10;
        require(_tokenAmount == requiredDeposit, "Must deposit exactly 10% of task value");
        
        // Transfer tokens from stakeholder to the contract
        require(roseToken.transferFrom(msg.sender, address(this), _tokenAmount));
        
        t.stakeholder = msg.sender;
        t.stakeholderDeposit = _tokenAmount;
        t.status = TaskStatus.Open;

        emit StakeholderStaked(_taskId, msg.sender, _tokenAmount);
    }

    /**
     * @dev Cancel a task before a worker claims it. Refunds deposits to customer and stakeholder (if staked).
     * Can be called by either the customer or the stakeholder.
     * @param _taskId ID of the task to cancel
     */
    function cancelTask(uint256 _taskId) external {
        Task storage t = tasks[_taskId];

        // Check task status - only allow cancellation before worker claims
        require(
            t.status == TaskStatus.StakeholderRequired || t.status == TaskStatus.Open,
            "Task can only be cancelled in StakeholderRequired or Open status"
        );

        // Check caller is authorized (customer or stakeholder)
        require(
            msg.sender == t.customer || msg.sender == t.stakeholder,
            "Only customer or stakeholder can cancel task"
        );

        console.log("Cancelling task:", _taskId);
        console.log("Cancelled by:", msg.sender);

        // Initialize refund amounts
        uint256 customerRefund = 0;
        uint256 stakeholderRefund = 0;

        // Refund customer deposit
        if (t.deposit > 0) {
            customerRefund = t.deposit;
            console.log("Refunding customer:", customerRefund);
            require(roseToken.transfer(t.customer, customerRefund), "Customer refund failed");
            t.deposit = 0;
        }

        // Refund stakeholder deposit if they have staked
        if (t.stakeholder != address(0) && t.stakeholderDeposit > 0) {
            stakeholderRefund = t.stakeholderDeposit;
            console.log("Refunding stakeholder:", stakeholderRefund);
            require(roseToken.transfer(t.stakeholder, stakeholderRefund), "Stakeholder refund failed");
            t.stakeholderDeposit = 0;
        }

        // Set task status to Closed
        t.status = TaskStatus.Closed;

        // Emit event
        emit TaskCancelled(_taskId, msg.sender, customerRefund, stakeholderRefund);
    }









    /**
     * @dev Worker claims an open task
     * @param _taskId ID of the task to be claimed
     */
    function claimTask(uint256 _taskId) external {
        Task storage t = tasks[_taskId];
        // Check specific conditions first to ensure proper error messages
        require(t.worker == address(0), "Task already claimed");
        require(t.customer != msg.sender, "Customer cannot claim their own task");
        require(t.stakeholder != msg.sender, "Stakeholder cannot claim task they are validating");
        require(msg.sender != address(0), "Worker cannot be zero address");
        require(t.stakeholder != address(0), "Task must have a stakeholder");

        // Tasks can only be claimed when status is Open (after stakeholder has staked)
        require(t.status == TaskStatus.Open,
                "Task must be Open for claiming");

        t.worker = msg.sender;
        t.status = TaskStatus.InProgress;

        emit TaskClaimed(_taskId, msg.sender);
    }

    /**
     * @dev Worker unclaims a task they previously claimed, returning it to Open status
     * @param _taskId ID of the task to unclaim
     */
    function unclaimTask(uint256 _taskId) external {
        Task storage t = tasks[_taskId];
        require(t.worker == msg.sender, "Only assigned worker can unclaim");
        require(t.status == TaskStatus.InProgress, "Task must be in progress to unclaim");

        // Clear worker and revert to Open status
        address previousWorker = t.worker;
        t.worker = address(0);
        t.status = TaskStatus.Open;

        emit TaskUnclaimed(_taskId, previousWorker);
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
        console.log("Customer approved task:", _taskId);
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
        console.log("Stakeholder approved task:", _taskId);
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
     * New tokenomics:
     * - Mint 2% of task value to DAO
     * - Total pot = customer payment + minted amount
     * - Distribute: 93% worker, 5% stakeholder (fee), stakeholder gets stake back
     */
    function _finalizeTask(uint256 _taskId, bool _payout) internal {
        Task storage t = tasks[_taskId];
        t.status = TaskStatus.Closed;
        emit TaskClosed(_taskId);

        if (_payout) {
            uint256 taskValue = t.deposit;
            console.log("Finalizing task with value:", taskValue);

            // Mint 2% of task value to DAO treasury (this creates the 2% annual inflation)
            uint256 mintAmount = (taskValue * MINT_PERCENTAGE) / SHARE_DENOMINATOR;
            roseToken.mint(daoTreasury, mintAmount);
            console.log("Minted to DAO:", mintAmount);

            // Total pot = customer deposit + newly minted tokens
            uint256 totalPot = taskValue + mintAmount;
            console.log("Total distribution pot:", totalPot);

            // Calculate distributions from the pot
            uint256 workerAmount = (totalPot * WORKER_SHARE) / SHARE_DENOMINATOR;
            uint256 stakeholderFee = (totalPot * STAKEHOLDER_SHARE) / SHARE_DENOMINATOR;

            console.log("Worker amount:", workerAmount);
            console.log("Stakeholder fee:", stakeholderFee);

            // Transfer to worker (from customer's deposit + any bonus)
            t.deposit = 0;
            require(roseToken.transfer(t.worker, workerAmount), "Transfer to worker failed");
            emit PaymentReleased(_taskId, t.worker, workerAmount);

            // Return stakeholder's stake + their fee
            uint256 stakeholderTotal = t.stakeholderDeposit + stakeholderFee;
            console.log("Stakeholder total:", stakeholderTotal);
            console.log("Stake returned:", t.stakeholderDeposit);
            console.log("Stakeholder fee:", stakeholderFee);
            t.stakeholderDeposit = 0;
            require(roseToken.transfer(t.stakeholder, stakeholderTotal), "Transfer to stakeholder failed");
        }
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
