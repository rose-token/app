// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title RoseMarketplace
 * @dev A feature-rich MVP combining escrowed tasks with a stakeholder-based
 * validation process and RoseToken minting logic.
 *
 * Updated to accept an existing RoseToken address rather than deploying its own.
 * Includes Gitcoin Passport signature verification for sybil resistance.
 */
contract RoseMarketplace is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // Reference to the RoseToken contract (external, not deployed by this contract)
    IERC20 public immutable roseToken;

    // A designated DAO Treasury that will receive a portion of newly minted tokens
    address public daoTreasury;

    // Passport signer (backend service that verifies Gitcoin Passport)
    address public passportSigner;

    // Track used signatures to prevent replay attacks
    mapping(bytes32 => bool) public usedSignatures;

    // Custom errors for passport verification
    error InvalidSignature();
    error SignatureExpired();
    error SignatureAlreadyUsed();
    error ZeroAddressSigner();

    // A simple enum to track task status
    enum TaskStatus { Open, StakeholderRequired, InProgress, Completed, Closed, ApprovedPendingPayment }
    

    // Basic structure to store details about each task
    struct Task {
        address customer;
        address worker;
        address stakeholder;
        uint256 deposit;           // Payment in ROSE tokens the customer puts up
        uint256 stakeholderDeposit; // 10% deposit from stakeholder in ROSE tokens
        string title;              // Short public title (on-chain)
        string detailedDescriptionHash; // IPFS hash for detailed description (mandatory, off-chain)
        string prUrl;              // GitHub Pull Request URL (mandatory on completion)
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
    event TaskCompleted(uint256 taskId, string prUrl);
    event PaymentReleased(uint256 taskId, address indexed worker, uint256 amount);
    event TaskClosed(uint256 taskId);
    event TaskReadyForPayment(uint256 taskId, address indexed worker, uint256 amount);
    event TokensMinted(address indexed to, uint256 amount);
    event TaskCancelled(uint256 indexed taskId, address indexed cancelledBy, uint256 customerRefund, uint256 stakeholderRefund);
    event TaskUnclaimed(uint256 indexed taskId, address indexed previousWorker);

    // Tokenomics parameters
    // On successful task completion, we mint 2% of task value to DAO treasury (separate)
    // Total distribution pot = customer payment only (minted tokens go directly to DAO)
    // Distribution from pot: 95% worker, 5% stakeholder fee, stakeholder gets 10% stake back

    // Minting percentage (2% of task value goes to DAO as new tokens)
    uint256 public constant MINT_PERCENTAGE = 2;

    // Distribution percentages from the total pot (customer payment only)
    uint256 public constant WORKER_SHARE = 95;      // 95% of pot
    uint256 public constant STAKEHOLDER_SHARE = 5;  // 5% of pot (as fee, plus stake returned)
    uint256 public constant SHARE_DENOMINATOR = 100;

    // Burn address (commonly the zero address or a dead address)
    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    /**
     * @dev Constructor accepts existing RoseToken, DAO treasury, and passport signer addresses.
     * @param _roseToken The address of the deployed RoseToken contract
     * @param _daoTreasury The address where part of minted tokens go (RoseTreasury)
     * @param _passportSigner The address of the backend signer for Gitcoin Passport verification
     */
    constructor(address _roseToken, address _daoTreasury, address _passportSigner) Ownable(msg.sender) {
        require(_roseToken != address(0), "RoseToken cannot be zero address");
        require(_daoTreasury != address(0), "Treasury cannot be zero address");
        if (_passportSigner == address(0)) revert ZeroAddressSigner();

        roseToken = IERC20(_roseToken);
        daoTreasury = _daoTreasury;
        passportSigner = _passportSigner;
    }

    /**
     * @dev Modifier to verify Gitcoin Passport signature from backend
     * @param action The action being performed (createTask, stake, claim)
     * @param expiry The expiry timestamp of the signature
     * @param signature The signature from the passport signer backend
     */
    modifier requiresPassport(string memory action, uint256 expiry, bytes memory signature) {
        // Check expiry
        if (block.timestamp > expiry) revert SignatureExpired();

        // Build message hash (must match backend signing)
        bytes32 messageHash = keccak256(abi.encodePacked(msg.sender, action, expiry));
        bytes32 ethSignedHash = messageHash.toEthSignedMessageHash();

        // Prevent replay attacks
        if (usedSignatures[ethSignedHash]) revert SignatureAlreadyUsed();
        usedSignatures[ethSignedHash] = true;

        // Verify signer
        address recovered = ethSignedHash.recover(signature);
        if (recovered != passportSigner) revert InvalidSignature();

        _;
    }

    /**
     * @dev Update the passport signer address (owner only)
     * @param _signer The new signer address
     */
    function setPassportSigner(address _signer) external onlyOwner {
        if (_signer == address(0)) revert ZeroAddressSigner();
        passportSigner = _signer;
    }

    /**
     * @dev Create a new task with a title and IPFS hash for detailed description
     * @param _title Short public title of the task
     * @param _tokenAmount Amount of ROSE tokens to deposit
     * @param _detailedDescriptionHash IPFS hash containing detailed task description (mandatory)
     * @param _expiry Signature expiry timestamp
     * @param _signature Passport verification signature from backend
     */
    function createTask(
        string calldata _title,
        uint256 _tokenAmount,
        string calldata _detailedDescriptionHash,
        uint256 _expiry,
        bytes calldata _signature
    ) external requiresPassport("createTask", _expiry, _signature) {
        require(_tokenAmount > 0, "Token amount must be greater than zero");
        require(bytes(_title).length > 0, "Title cannot be empty");
        require(bytes(_detailedDescriptionHash).length > 0, "Detailed description hash is required");

        // Transfer tokens from customer to the contract using SafeERC20
        roseToken.safeTransferFrom(msg.sender, address(this), _tokenAmount);

        taskCounter++;
        Task storage newTask = tasks[taskCounter];
        newTask.customer = msg.sender;
        newTask.deposit = _tokenAmount;
        newTask.title = _title;
        newTask.detailedDescriptionHash = _detailedDescriptionHash;
        newTask.status = TaskStatus.StakeholderRequired;
        newTask.customerApproval = false;
        newTask.stakeholderApproval = false;

        emit TaskCreated(taskCounter, msg.sender, _tokenAmount);
    }

    /**
     * @dev Stakeholder stakes 10% of the task deposit in ROSE tokens to become the stakeholder for a task
     * @param _taskId ID of the task to stake on
     * @param _tokenAmount Amount of ROSE tokens to stake (must be exactly 10% of task deposit)
     * @param _expiry Signature expiry timestamp
     * @param _signature Passport verification signature from backend
     */
    function stakeholderStake(
        uint256 _taskId,
        uint256 _tokenAmount,
        uint256 _expiry,
        bytes calldata _signature
    ) external nonReentrant requiresPassport("stake", _expiry, _signature) {
        Task storage t = tasks[_taskId];
        require(t.status == TaskStatus.StakeholderRequired, "Task must be waiting for stakeholder");
        require(t.stakeholder == address(0), "Task already has a stakeholder");
        require(t.customer != msg.sender, "Customer cannot be stakeholder for their own task");
        require(t.worker != msg.sender, "Worker cannot be stakeholder for their own task");

        // Calculate required 10% deposit
        uint256 requiredDeposit = t.deposit / 10;
        require(_tokenAmount == requiredDeposit, "Must deposit exactly 10% of task value");

        // Transfer tokens from stakeholder to the contract using SafeERC20
        roseToken.safeTransferFrom(msg.sender, address(this), _tokenAmount);

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
    function cancelTask(uint256 _taskId) external nonReentrant {
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

        // Initialize refund amounts
        uint256 customerRefund = 0;
        uint256 stakeholderRefund = 0;

        // Refund customer deposit
        if (t.deposit > 0) {
            customerRefund = t.deposit;
            uint256 depositCache = t.deposit;
            t.deposit = 0;
            roseToken.safeTransfer(t.customer, depositCache);
        }

        // Refund stakeholder deposit if they staked
        if (t.stakeholderDeposit > 0) {
            stakeholderRefund = t.stakeholderDeposit;
            uint256 stakeCache = t.stakeholderDeposit;
            t.stakeholderDeposit = 0;
            roseToken.safeTransfer(t.stakeholder, stakeCache);
        }

        // Mark task as closed
        t.status = TaskStatus.Closed;

        emit TaskCancelled(_taskId, msg.sender, customerRefund, stakeholderRefund);
    }

    /**
     * @dev Worker claims an open task, assigns themselves as the worker, and marks it in progress.
     * @param _taskId ID of the task to claim
     * @param _expiry Signature expiry timestamp
     * @param _signature Passport verification signature from backend
     */
    function claimTask(
        uint256 _taskId,
        uint256 _expiry,
        bytes calldata _signature
    ) external requiresPassport("claim", _expiry, _signature) {
        Task storage t = tasks[_taskId];
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
     * @param _prUrl GitHub Pull Request URL for the completed work (mandatory)
     */
    function markTaskCompleted(uint256 _taskId, string calldata _prUrl) external {
        Task storage t = tasks[_taskId];
        require(t.worker == msg.sender, "Only assigned worker can mark completion");
        require(t.status == TaskStatus.InProgress, "Task must be in progress");
        require(bytes(_prUrl).length > 0, "PR URL cannot be empty");

        t.status = TaskStatus.Completed;
        t.prUrl = _prUrl;

        emit TaskCompleted(_taskId, _prUrl);
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
        
        // Once both approvals are in, mark task as ready for worker to accept payment
        if (t.stakeholderApproval) {
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
        
        // Check if both customer and stakeholder have approved
        if (t.customerApproval) {
            t.status = TaskStatus.ApprovedPendingPayment;
            emit TaskReadyForPayment(_taskId, t.worker, t.deposit);
        }
    }

    /**
     * @dev Worker accepts payment for an approved task.
     * This allows workers to control when they incur gas fees.
     * @param _taskId ID of the task to accept payment for
     */
    function acceptPayment(uint256 _taskId) external nonReentrant {
        Task storage t = tasks[_taskId];
        require(t.worker == msg.sender, "Only assigned worker can accept payment");
        require(t.status == TaskStatus.ApprovedPendingPayment, "Task must be approved and pending payment");
        require(t.customerApproval && t.stakeholderApproval, "Task must be approved by customer and stakeholder");

        _finalizeTask(_taskId, true);
    }


    /**
     * @dev Internally finalize the task if both approvals are met in a non-disputed scenario.
     * New tokenomics:
     * - Mint 2% of task value to DAO (separate, goes directly to DAO)
     * - Total pot = customer payment only (minted tokens not included in pot)
     * - Distribute from pot: 95% worker, 5% stakeholder (fee), stakeholder gets stake back
     */
    function _finalizeTask(uint256 _taskId, bool _payout) internal {
        Task storage t = tasks[_taskId];
        t.status = TaskStatus.Closed;
        emit TaskClosed(_taskId);

        if (_payout) {
            uint256 taskValue = t.deposit;

            // Mint 2% of task value to DAO treasury (this creates the 2% growth)
            // This goes directly to DAO, NOT to the distribution pot
            uint256 mintAmount = (taskValue * MINT_PERCENTAGE) / SHARE_DENOMINATOR;
            IRoseToken(address(roseToken)).mint(daoTreasury, mintAmount);
            emit TokensMinted(daoTreasury, mintAmount);

            // Total pot = customer deposit ONLY (minted tokens already went to DAO)
            uint256 totalPot = taskValue;

            // Calculate distributions from the pot
            uint256 workerAmount = (totalPot * WORKER_SHARE) / SHARE_DENOMINATOR;
            uint256 stakeholderFee = (totalPot * STAKEHOLDER_SHARE) / SHARE_DENOMINATOR;

            // Update state before external calls (checks-effects-interactions pattern)
            t.deposit = 0;
            uint256 stakeholderDepositCache = t.stakeholderDeposit;
            t.stakeholderDeposit = 0;

            // Transfer to worker (from customer's deposit) using SafeERC20
            roseToken.safeTransfer(t.worker, workerAmount);
            emit PaymentReleased(_taskId, t.worker, workerAmount);

            // Return stakeholder's stake + their fee using SafeERC20
            uint256 stakeholderTotal = stakeholderDepositCache + stakeholderFee;
            roseToken.safeTransfer(t.stakeholder, stakeholderTotal);
        }
    }


    /**
     * @dev Check if caller is a participant in the task (customer, worker, or stakeholder)
     * @param _taskId ID of the task
     * @return bool True if caller is a participant
     */
    function isTaskParticipant(uint256 _taskId) external view returns (bool) {
        Task storage t = tasks[_taskId];
        return (
            t.customer == msg.sender ||
            t.worker == msg.sender ||
            t.stakeholder == msg.sender
        );
    }
}

// ============ Interface for RoseToken mint ============
interface IRoseToken {
    function mint(address to, uint256 amount) external;
}
