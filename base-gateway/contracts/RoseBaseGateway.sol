// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/ITokenMessenger.sol";

/**
 * @title RoseBaseGateway
 * @author Rose Protocol
 * @notice Base-side gateway that lets agents deposit/redeem USDC while the
 *         Rose Treasury lives on Arbitrum.  Uses Circle CCTP for bridging.
 *
 * @dev Architecture overview:
 *
 *   DEPOSIT  (agent → gateway → CCTP → Arbitrum treasury)
 *   ─────────────────────────────────────────────────────
 *   1. Agent calls deposit(amount).
 *   2. Gateway pulls USDC, calls CCTP depositForBurn() → Arbitrum.
 *   3. Off-chain signer watches DepositInitiated, finalises on Arbitrum,
 *      then calls completeDeposit() here to credit ROSE balance.
 *
 *   REDEEM  (agent → gateway event → signer → Arb treasury → CCTP → Base)
 *   ─────────────────────────────────────────────────────────────────────
 *   1. Agent calls requestRedeem(roseAmount).
 *   2. Off-chain signer handles Arb-side redemption + CCTP back to Base.
 *   3. Signer calls completeRedeem(agent, usdcAmount) — gateway sends USDC.
 */
contract RoseBaseGateway is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ──────────────────────────────────────────────
    //  Constants & immutables
    // ──────────────────────────────────────────────

    /// @notice Base USDC token address.
    IERC20 public immutable usdc;

    /// @notice Circle CCTP TokenMessenger on Base.
    ITokenMessenger public immutable tokenMessenger;

    /// @notice CCTP domain ID for Arbitrum (destination).
    uint32 public constant ARBITRUM_DOMAIN = 3;

    /// @notice Recipient of CCTP-minted USDC on Arbitrum (signer / treasury helper).
    bytes32 public arbitrumRecipient;

    // ──────────────────────────────────────────────
    //  State
    // ──────────────────────────────────────────────

    /// @notice Virtual ROSE balance per agent (tracked on Base, held on Arb).
    mapping(address => uint256) public balances;

    /// @notice Total virtual ROSE supply tracked by this gateway.
    uint256 public totalBalances;

    /// @dev Pending deposit info keyed by CCTP nonce.
    struct DepositInfo {
        address agent;
        uint256 usdcAmount;
        bool completed;
    }
    mapping(uint64 => DepositInfo) public pendingDeposits;

    /// @dev Pending redeem info keyed by incrementing ID.
    struct RedeemInfo {
        address agent;
        uint256 roseAmount;
        bool completed;
    }
    uint256 public nextRedeemId;
    mapping(uint256 => RedeemInfo) public pendingRedeems;

    // ──────────────────────────────────────────────
    //  Events
    // ──────────────────────────────────────────────

    event DepositInitiated(
        address indexed agent,
        uint256 usdcAmount,
        uint64 indexed cctpNonce
    );
    event DepositCompleted(
        address indexed agent,
        uint256 usdcAmount,
        uint256 roseAmount,
        uint64 indexed cctpNonce
    );
    event RedeemRequested(
        address indexed agent,
        uint256 roseAmount,
        uint256 indexed redeemId
    );
    event RedeemCompleted(
        address indexed agent,
        uint256 usdcAmount,
        uint256 indexed redeemId
    );
    event ArbitrumRecipientUpdated(bytes32 newRecipient);
    event EmergencyWithdraw(address token, uint256 amount, address to);

    // ──────────────────────────────────────────────
    //  Errors
    // ──────────────────────────────────────────────

    error ZeroAmount();
    error ZeroAddress();
    error InsufficientBalance(uint256 requested, uint256 available);
    error DepositAlreadyCompleted(uint64 nonce);
    error DepositNotFound(uint64 nonce);
    error RedeemAlreadyCompleted(uint256 redeemId);
    error RedeemNotFound(uint256 redeemId);
    error InsufficientContractBalance(uint256 required, uint256 available);

    // ──────────────────────────────────────────────
    //  Constructor
    // ──────────────────────────────────────────────

    /**
     * @param _usdc Base USDC address.
     * @param _tokenMessenger Circle CCTP TokenMessenger on Base.
     * @param _arbitrumRecipient Bytes32-encoded address that receives USDC on Arbitrum.
     * @param _owner Admin / signer address.
     */
    constructor(
        address _usdc,
        address _tokenMessenger,
        bytes32 _arbitrumRecipient,
        address _owner
    ) Ownable(_owner) {
        if (_usdc == address(0) || _tokenMessenger == address(0)) revert ZeroAddress();

        usdc = IERC20(_usdc);
        tokenMessenger = ITokenMessenger(_tokenMessenger);
        arbitrumRecipient = _arbitrumRecipient;
    }

    // ══════════════════════════════════════════════
    //  DEPOSIT FLOW
    // ══════════════════════════════════════════════

    /**
     * @notice Initiate a deposit: transfer USDC from agent, bridge to Arbitrum via CCTP.
     * @param usdcAmount Amount of USDC (6 decimals) to deposit.
     */
    function deposit(uint256 usdcAmount) external whenNotPaused nonReentrant {
        if (usdcAmount == 0) revert ZeroAmount();

        // Pull USDC from agent
        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);

        // Approve CCTP TokenMessenger to spend USDC
        usdc.forceApprove(address(tokenMessenger), usdcAmount);

        // Burn USDC on Base → mint on Arbitrum
        uint64 nonce = tokenMessenger.depositForBurn(
            usdcAmount,
            ARBITRUM_DOMAIN,
            arbitrumRecipient,
            address(usdc)
        );

        pendingDeposits[nonce] = DepositInfo({
            agent: msg.sender,
            usdcAmount: usdcAmount,
            completed: false
        });

        emit DepositInitiated(msg.sender, usdcAmount, nonce);
    }

    /**
     * @notice Called by the signer after successfully depositing into the Arb treasury.
     *         Credits ROSE balance to the agent.
     * @param nonce     CCTP nonce from the original deposit.
     * @param roseAmount ROSE tokens credited (may differ from USDC due to exchange rate).
     */
    function completeDeposit(
        uint64 nonce,
        uint256 roseAmount
    ) external onlyOwner {
        DepositInfo storage info = pendingDeposits[nonce];
        if (info.agent == address(0)) revert DepositNotFound(nonce);
        if (info.completed) revert DepositAlreadyCompleted(nonce);

        info.completed = true;
        balances[info.agent] += roseAmount;
        totalBalances += roseAmount;

        emit DepositCompleted(info.agent, info.usdcAmount, roseAmount, nonce);
    }

    // ══════════════════════════════════════════════
    //  REDEEM FLOW
    // ══════════════════════════════════════════════

    /**
     * @notice Request redemption of ROSE balance for USDC.
     * @param roseAmount Amount of virtual ROSE to redeem.
     */
    function requestRedeem(uint256 roseAmount) external whenNotPaused nonReentrant {
        if (roseAmount == 0) revert ZeroAmount();
        if (balances[msg.sender] < roseAmount) {
            revert InsufficientBalance(roseAmount, balances[msg.sender]);
        }

        // Debit agent's balance immediately to prevent double-spend
        balances[msg.sender] -= roseAmount;
        totalBalances -= roseAmount;

        uint256 redeemId = nextRedeemId++;
        pendingRedeems[redeemId] = RedeemInfo({
            agent: msg.sender,
            roseAmount: roseAmount,
            completed: false
        });

        emit RedeemRequested(msg.sender, roseAmount, redeemId);
    }

    /**
     * @notice Called by the signer after bridging USDC back from Arbitrum.
     *         Sends USDC to the agent on Base.
     * @dev The signer must have already sent USDC to this contract (via CCTP mint
     *      targeting this contract, or a direct transfer).
     * @param redeemId  ID from the RedeemRequested event.
     * @param usdcAmount USDC to send to the agent.
     */
    function completeRedeem(
        uint256 redeemId,
        uint256 usdcAmount
    ) external onlyOwner nonReentrant {
        RedeemInfo storage info = pendingRedeems[redeemId];
        if (info.agent == address(0)) revert RedeemNotFound(redeemId);
        if (info.completed) revert RedeemAlreadyCompleted(redeemId);

        uint256 contractBalance = usdc.balanceOf(address(this));
        if (contractBalance < usdcAmount) {
            revert InsufficientContractBalance(usdcAmount, contractBalance);
        }

        info.completed = true;
        usdc.safeTransfer(info.agent, usdcAmount);

        emit RedeemCompleted(info.agent, usdcAmount, redeemId);
    }

    /**
     * @notice Cancel a pending redeem and refund ROSE balance to the agent.
     *         Used if the Arb-side redemption fails.
     * @param redeemId The redeem request to cancel.
     */
    function cancelRedeem(uint256 redeemId) external onlyOwner {
        RedeemInfo storage info = pendingRedeems[redeemId];
        if (info.agent == address(0)) revert RedeemNotFound(redeemId);
        if (info.completed) revert RedeemAlreadyCompleted(redeemId);

        info.completed = true; // mark as resolved
        balances[info.agent] += info.roseAmount;
        totalBalances += info.roseAmount;

        // Emit completed with 0 USDC to signal cancellation
        emit RedeemCompleted(info.agent, 0, redeemId);
    }

    // ══════════════════════════════════════════════
    //  ADMIN
    // ══════════════════════════════════════════════

    /**
     * @notice Update the Arbitrum-side CCTP recipient (bytes32).
     */
    function setArbitrumRecipient(bytes32 _recipient) external onlyOwner {
        arbitrumRecipient = _recipient;
        emit ArbitrumRecipientUpdated(_recipient);
    }

    /**
     * @notice Pause deposits and redemptions.
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Unpause deposits and redemptions.
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Emergency withdraw any ERC-20 from the contract.
     * @param token Token address to withdraw.
     * @param amount Amount to withdraw.
     * @param to Recipient address.
     */
    function emergencyWithdraw(
        address token,
        uint256 amount,
        address to
    ) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        IERC20(token).safeTransfer(to, amount);
        emit EmergencyWithdraw(token, amount, to);
    }

    // ══════════════════════════════════════════════
    //  VIEW HELPERS
    // ══════════════════════════════════════════════

    /**
     * @notice Convert an address to a bytes32 (left-padded) for CCTP.
     */
    function addressToBytes32(address addr) external pure returns (bytes32) {
        return bytes32(uint256(uint160(addr)));
    }
}
