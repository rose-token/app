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
     * @param _account Address to update
     * @param _status True to authorize, false to revoke
     */
    function setAuthorized(address _account, bool _status) external onlyOwner {
        if (_account == address(0)) revert ZeroAddress();
        authorized[_account] = _status;
        emit AuthorizationUpdated(_account, _status);
    }

    /**
     * @dev Transfer ownership
     * @param _newOwner New owner address
     */
    function transferOwnership(address _newOwner) external onlyOwner {
        if (_newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, _newOwner);
        owner = _newOwner;
    }

    // ============ Mint / Burn ============

    /**
     * @dev Mint new tokens to a specified address
     * @param _to Recipient address
     * @param _amount Amount to mint
     */
    function mint(address _to, uint256 _amount) external onlyAuthorized {
        if (_to == address(0)) revert ZeroAddress();
        totalSupply += _amount;
        balanceOf[_to] += _amount;
        emit Transfer(address(0), _to, _amount);
    }

    /**
     * @dev Burn tokens from a specified address (must have allowance or be the holder)
     * @param _from Address to burn from
     * @param _amount Amount to burn
     */
    function burn(address _from, uint256 _amount) external onlyAuthorized {
        if (_from == address(0)) revert ZeroAddress();
        if (balanceOf[_from] < _amount) revert InsufficientBalance();
        
        // If caller is not the holder, check allowance
        if (_from != msg.sender) {
            if (allowance[_from][msg.sender] < _amount) revert InsufficientAllowance();
            allowance[_from][msg.sender] -= _amount;
        }
        
        balanceOf[_from] -= _amount;
        totalSupply -= _amount;
        emit Transfer(_from, address(0), _amount);
    }

    /**
     * @dev Burn tokens from msg.sender (convenience function)
     * @param _amount Amount to burn
     */
    function burn(uint256 _amount) external {
        if (balanceOf[msg.sender] < _amount) revert InsufficientBalance();
        balanceOf[msg.sender] -= _amount;
        totalSupply -= _amount;
        emit Transfer(msg.sender, address(0), _amount);
    }

    // ============ ERC20 Standard ============

    /**
     * @dev Transfer tokens from msg.sender to a recipient
     */
    function transfer(address _to, uint256 _amount) external returns (bool) {
        if (_to == address(0)) revert ZeroAddress();
        if (balanceOf[msg.sender] < _amount) revert InsufficientBalance();
        balanceOf[msg.sender] -= _amount;
        balanceOf[_to] += _amount;
        emit Transfer(msg.sender, _to, _amount);
        return true;
    }

    /**
     * @dev Approve another address to spend tokens on behalf of msg.sender
     */
    function approve(address _spender, uint256 _amount) external returns (bool) {
        if (_spender == address(0)) revert ZeroAddress();
        allowance[msg.sender][_spender] = _amount;
        emit Approval(msg.sender, _spender, _amount);
        return true;
    }

    /**
     * @dev Transfer tokens from one address to another using allowance
     */
    function transferFrom(address _from, address _to, uint256 _amount) external returns (bool) {
        if (_from == address(0)) revert ZeroAddress();
        if (_to == address(0)) revert ZeroAddress();
        if (balanceOf[_from] < _amount) revert InsufficientBalance();
        if (allowance[_from][msg.sender] < _amount) revert InsufficientAllowance();
        
        balanceOf[_from] -= _amount;
        balanceOf[_to] += _amount;
        allowance[_from][msg.sender] -= _amount;
        
        emit Transfer(_from, _to, _amount);
        return true;
    }
}
