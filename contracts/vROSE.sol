// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/IvROSE.sol";

/**
 * @title vROSE
 * @dev Governance receipt token with marketplace-only transfers.
 *
 * vROSE is minted 1:1 when users deposit ROSE into governance.
 * vROSE is "soulbound" - users cannot transfer to each other.
 * However, transfers to/from the marketplace contract are allowed for real escrow:
 *
 * User → User:        ❌ blocked
 * User → Marketplace: ✓ (stake as stakeholder)
 * Marketplace → User: ✓ (return on completion)
 *
 * Flow:
 * 1. User approves marketplace for vROSE
 * 2. User calls stakeholderStake() on marketplace
 * 3. Marketplace calls transferFrom(user, marketplace, amount)
 * 4. vROSE sits in marketplace contract (real escrow)
 * 5. Task completes or cancels
 * 6. Marketplace transfers vROSE back to user
 */
contract vROSE is IvROSE {
    string public constant name = "Voting Rose Token";
    string public constant symbol = "vROSE";
    uint8 public constant decimals = 18;

    uint256 public totalSupply;

    // User balances
    mapping(address => uint256) public balanceOf;

    // Allowances (only marketplace can be approved)
    mapping(address => mapping(address => uint256)) private _allowances;

    // Contract references
    address public governance;
    address public marketplace;
    address public owner;

    // ============ Modifiers ============

    modifier onlyGovernance() {
        if (msg.sender != governance) revert NotGovernance();
        _;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    // ============ Constructor ============

    /**
     * @dev Constructor sets deployer as owner
     * Governance and marketplace addresses set later via setGovernance/setMarketplace
     */
    constructor() {
        owner = msg.sender;
    }

    // ============ View Functions ============

    /**
     * @dev Returns the allowance for a spender
     * @param _owner The token owner
     * @param spender The spender address
     */
    function allowance(address _owner, address spender) external view returns (uint256) {
        return _allowances[_owner][spender];
    }

    // ============ Transfer Functions (Marketplace-Only) ============

    /**
     * @dev Transfer vROSE - only to marketplace, or by marketplace to anyone
     * Reverts with OnlyMarketplaceTransfer if not allowed
     * @param to The recipient
     * @param amount The amount to transfer
     */
    function transfer(address to, uint256 amount) external returns (bool) {
        // Allow: user → marketplace OR marketplace → user
        if (to != marketplace && msg.sender != marketplace) revert OnlyMarketplaceTransfer();
        _transfer(msg.sender, to, amount);
        return true;
    }

    /**
     * @dev Transfer vROSE from one address to another
     * At least one party (from or to) must be the marketplace
     * @param from The sender address
     * @param to The recipient address
     * @param amount The amount to transfer
     */
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        // Either from or to must be marketplace
        if (to != marketplace && from != marketplace) revert OnlyMarketplaceTransfer();

        // Check and update allowance (unless marketplace is transferring its own balance)
        if (from != msg.sender) {
            uint256 currentAllowance = _allowances[from][msg.sender];
            if (currentAllowance < amount) revert InsufficientBalance();
            _allowances[from][msg.sender] = currentAllowance - amount;
        }

        _transfer(from, to, amount);
        return true;
    }

    /**
     * @dev Approve marketplace to spend vROSE
     * Reverts with OnlyMarketplaceApproval if spender is not marketplace
     * @param spender The spender (must be marketplace)
     * @param amount The amount to approve
     */
    function approve(address spender, uint256 amount) external returns (bool) {
        if (spender != marketplace) revert OnlyMarketplaceApproval();
        _allowances[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    /**
     * @dev Internal transfer function
     */
    function _transfer(address from, address to, uint256 amount) internal {
        if (from == address(0)) revert ZeroAddress();
        if (to == address(0)) revert ZeroAddress();
        if (balanceOf[from] < amount) revert InsufficientBalance();

        balanceOf[from] -= amount;
        balanceOf[to] += amount;

        emit Transfer(from, to, amount);
    }

    // ============ Governance Functions ============

    /**
     * @dev Mint vROSE to a user (1:1 with ROSE deposited in governance)
     * @param to The recipient address
     * @param amount The amount to mint
     */
    function mint(address to, uint256 amount) external onlyGovernance {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        totalSupply += amount;
        balanceOf[to] += amount;

        emit Transfer(address(0), to, amount);
    }

    /**
     * @dev Burn vROSE from a user (when withdrawing ROSE from governance)
     * @param from The address to burn from
     * @param amount The amount to burn
     */
    function burn(address from, uint256 amount) external onlyGovernance {
        if (from == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (balanceOf[from] < amount) revert InsufficientBalance();

        balanceOf[from] -= amount;
        totalSupply -= amount;

        emit Transfer(from, address(0), amount);
    }

    // ============ Admin Functions ============

    /**
     * @dev Set the governance contract address
     * @param _governance The new governance address
     */
    function setGovernance(address _governance) external onlyOwner {
        if (_governance == address(0)) revert ZeroAddress();
        governance = _governance;
        emit GovernanceUpdated(_governance);
    }

    /**
     * @dev Set the marketplace contract address
     * @param _marketplace The new marketplace address
     */
    function setMarketplace(address _marketplace) external onlyOwner {
        if (_marketplace == address(0)) revert ZeroAddress();
        marketplace = _marketplace;
        emit MarketplaceUpdated(_marketplace);
    }

    /**
     * @dev Transfer ownership
     * @param newOwner The new owner address
     */
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        owner = newOwner;
    }
}
