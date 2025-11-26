// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title RoseToken
 * @dev ERC20 token with mint/burn capabilities for authorized contracts.
 * Both Marketplace (task completion) and Treasury (deposit/redeem) can mint/burn.
 */
contract RoseToken {
    string public name = "Rose Token";
    string public symbol = "ROSE";
    uint8 public decimals = 18;

    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    // Multiple addresses can be authorized to mint/burn
    mapping(address => bool) public authorized;
    
    // Owner for managing authorized addresses
    address public owner;

    // Events
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event AuthorizationUpdated(address indexed account, bool status);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // Errors
    error NotAuthorized();
    error NotOwner();
    error ZeroAddress();
    error InsufficientBalance();
    error InsufficientAllowance();

    modifier onlyAuthorized() {
        if (!authorized[msg.sender]) revert NotAuthorized();
        _;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /**
     * @dev Constructor sets deployer as owner
     * @param _initialAuthorized First authorized address (typically Marketplace)
     */
    constructor(address _initialAuthorized) {
        if (_initialAuthorized == address(0)) revert ZeroAddress();
        owner = msg.sender;
        authorized[_initialAuthorized] = true;
        emit AuthorizationUpdated(_initialAuthorized, true);
    }

    // ============ Authorization Management ============

    /**
     * @dev Add or remove authorized minter/burner
     * @param account Address to update
     * @param status True to authorize, false to revoke
     */
    function setAuthorized(address account, bool status) external onlyOwner {
        if (account == address(0)) revert ZeroAddress();
        authorized[account] = status;
        emit AuthorizationUpdated(account, status);
    }

    /**
     * @dev Transfer ownership
     * @param newOwner New owner address
     */
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    // ============ Mint / Burn ============

    /**
     * @dev Mint new tokens to a specified address
     * @param to Recipient address
     * @param amount Amount to mint
     */
    function mint(address to, uint256 amount) external onlyAuthorized {
        if (to == address(0)) revert ZeroAddress();
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    /**
     * @dev Burn tokens from a specified address (must have allowance or be the holder)
     * @param from Address to burn from
     * @param amount Amount to burn
     */
    function burn(address from, uint256 amount) external onlyAuthorized {
        if (from == address(0)) revert ZeroAddress();
        if (balanceOf[from] < amount) revert InsufficientBalance();

        // If caller is not the holder, check allowance
        if (from != msg.sender) {
            if (allowance[from][msg.sender] < amount) revert InsufficientAllowance();
            allowance[from][msg.sender] -= amount;
        }

        balanceOf[from] -= amount;
        totalSupply -= amount;
        emit Transfer(from, address(0), amount);
    }

    /**
     * @dev Burn tokens from msg.sender (convenience function)
     * @param amount Amount to burn
     */
    function burn(uint256 amount) external {
        if (balanceOf[msg.sender] < amount) revert InsufficientBalance();
        balanceOf[msg.sender] -= amount;
        totalSupply -= amount;
        emit Transfer(msg.sender, address(0), amount);
    }

    // ============ ERC20 Standard ============

    /**
     * @dev Transfer tokens from msg.sender to a recipient
     */
    function transfer(address to, uint256 amount) external returns (bool) {
        if (to == address(0)) revert ZeroAddress();
        if (balanceOf[msg.sender] < amount) revert InsufficientBalance();
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    /**
     * @dev Approve another address to spend tokens on behalf of msg.sender
     */
    function approve(address spender, uint256 amount) external returns (bool) {
        if (spender == address(0)) revert ZeroAddress();
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    /**
     * @dev Transfer tokens from one address to another using allowance
     */
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (from == address(0)) revert ZeroAddress();
        if (to == address(0)) revert ZeroAddress();
        if (balanceOf[from] < amount) revert InsufficientBalance();
        if (allowance[from][msg.sender] < amount) revert InsufficientAllowance();

        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        allowance[from][msg.sender] -= amount;

        emit Transfer(from, to, amount);
        return true;
    }
}
