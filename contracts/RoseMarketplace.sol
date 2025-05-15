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
    enum TaskStatus { Open, InProgress, Completed, Disputed, Closed, ApprovedPendingPayment }

    // Basic structure to store details about each task
    struct Task {
        address customer;
        address worker;
        address stakeholder;
        uint256 deposit;           // Payment in ETH the customer puts up
        string description;        // Basic metadata or instructions
        TaskStatus status;
        bool customerApproval;     
        bool stakeholderApproval;  
    }

    // Keep a count to assign unique task IDs
    uint256 public taskCounter;

    // Maps task ID => Task details
    mapping(uint256 => Task) public tasks;

    // Events for logging
    event TaskCreated(uint256 taskId, address indexed customer, address indexed stakeholder, uint256 deposit);
    event TaskClaimed(uint256 taskId, address indexed worker);
    event TaskCompleted(uint256 taskId);
    event TaskDisputed(uint256 taskId);
    event PaymentReleased(uint256 taskId, address indexed worker, uint256 amount);
    event TaskClosed(uint256 taskId);
    event TaskReadyForPayment(uint256 taskId, address indexed worker, uint256 amount);

    // Reward parameters for demonstration
    // On successful task completion, we mint a fixed base of 100 ROSE tokens
    // then split them among the worker, stakeholder, treasury, and burn a fraction
    uint256 public constant BASE_REWARD = 100 ether; // if decimals = 18, "100 ether" means 100 tokens

    // Example splits: 50% to worker, 20% to stakeholder, 20% to treasury, 10% burned
    // (This is just an example ratio, tweak as desired.)
    uint256 public constant WORKER_SHARE = 50;      // 50%
    uint256 public constant STAKEHOLDER_SHARE = 20; // 20%
    uint256 public constant TREASURY_SHARE = 20;    // 20%
    uint256 public constant BURN_SHARE = 10;        // 10%
    uint256 public constant SHARE_DENOMINATOR = 100;

    // Burn address (commonly the zero address or a dead address)
    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    /**
     * @dev Constructor sets up the RoseToken contract and DAO treasury address.
     * In a production design, you'd likely manage these addresses with Ownable logic.
     * @param _daoTreasury The address where part of minted tokens go
     */
    constructor(address _daoTreasury) {
        require(_daoTreasury != address(0), "DAO treasury cannot be zero");
        daoTreasury = _daoTreasury;

        // Deploy the RoseToken, designating this marketplace as its minter
        roseToken = new RoseToken(address(this));
    }

    /**
     * @dev Create a new task, depositing ETH that will be paid to the worker upon successful completion.
     * @param _description A brief description of the task
     * @param _stakeholder The address that will validate or arbitrate the final output
     */
    function createTask(string calldata _description, address _stakeholder) external payable {
        require(msg.value > 0, "Must deposit some ETH as payment");
        require(_stakeholder != address(0), "Stakeholder cannot be zero address");

        taskCounter++;
        Task storage newTask = tasks[taskCounter];
        newTask.customer = msg.sender;
        newTask.stakeholder = _stakeholder;
        newTask.deposit = msg.value;
        newTask.description = _description;
        newTask.status = TaskStatus.Open;
        newTask.customerApproval = false;
        newTask.stakeholderApproval = false;

        emit TaskCreated(taskCounter, msg.sender, _stakeholder, msg.value);
    }

    /**
     * @dev Worker claims an open task
     * @param _taskId ID of the task to be claimed
     */
    function claimTask(uint256 _taskId) external {
        Task storage t = tasks[_taskId];
        require(t.status == TaskStatus.Open, "Task must be open to be claimed");
        require(t.worker == address(0), "Task already claimed");
        require(t.customer != msg.sender, "Customer cannot claim their own task");

        t.worker = msg.sender;
        t.status = TaskStatus.InProgress;
        emit TaskClaimed(_taskId, msg.sender);
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

        t.status = TaskStatus.Closed;
        emit TaskClosed(_taskId);

        uint256 amountToPay = t.deposit;
        t.deposit = 0; // prevent re-entrancy double-withdraw

        if (_refundToCustomer) {
            (bool success, ) = t.customer.call{value: amountToPay}("");
            require(success, "Refund failed");
        } else {
            // If the worker wins, pay them the deposit 
            // and also treat it as 'completion' for token minting
            (bool success, ) = t.worker.call{value: amountToPay}("");
            require(success, "Worker payment failed");

            // Mint tokens to the worker, stakeholder, treasury, and burn portion
            _mintReward(t.worker, t.stakeholder);
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
            console.log("Paying out", amountToPay, "to worker", t.worker);
            t.deposit = 0;
            (bool success, ) = t.worker.call{value: amountToPay}("");
            console.log("Payment transfer success:", success);
            require(success, "Transfer to worker failed");
            
            emit PaymentReleased(_taskId, t.worker, amountToPay);
            
            // Mint tokens to the worker, stakeholder, treasury, and burn portion
            console.log("Minting rewards");
            _mintReward(t.worker, t.stakeholder);
        }
    }

    /**
     * @dev Mint the reward to the worker, stakeholder, treasury, and burn address according to splits. 
     * This is where you can customize the "socialist" logic: 
     * e.g., more to worker, some to stakeholder, some to treasury, etc.
     */
    function _mintReward(address _worker, address _stakeholder) internal {
        // For demonstration, we just use a fixed BASE_REWARD
        // Then we split it by the percentages defined above.
        uint256 workerAmount = (BASE_REWARD * WORKER_SHARE) / SHARE_DENOMINATOR;
        uint256 stakeholderAmount = (BASE_REWARD * STAKEHOLDER_SHARE) / SHARE_DENOMINATOR;
        uint256 treasuryAmount = (BASE_REWARD * TREASURY_SHARE) / SHARE_DENOMINATOR;
        uint256 burnAmount = (BASE_REWARD * BURN_SHARE) / SHARE_DENOMINATOR;

        // Mint to worker
        roseToken.mint(_worker, workerAmount);

        // Mint to stakeholder
        roseToken.mint(_stakeholder, stakeholderAmount);

        // Mint to the DAO treasury
        roseToken.mint(daoTreasury, treasuryAmount);

        // Mint directly to a burn address to simulate deflation
        // (Remember, "deflationary" is somewhat offset by the fact we keep minting new tokens.)
        roseToken.mint(BURN_ADDRESS, burnAmount);
    }

    /**
     * @dev Fallback to accept raw ETH if ever needed (e.g., direct transfers).
     */
    receive() external payable {}
}
