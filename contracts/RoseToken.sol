// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title RoseToken
 * @dev A simplified ERC20 token that allows a designated minter (the Marketplace) 
 * to mint new tokens on task completion. For a real deployment, 
 * import OpenZeppelin's ERC20 standard rather than coding inline.
 */
contract RoseToken {
    string public name = "Rose Token";
    string public symbol = "ROSE";
    uint8 public decimals = 18;

    // The total supply of tokens in circulation
    uint256 public totalSupply;

    // Track balances by address
    mapping(address => uint256) public balanceOf;

    // Track allowances for ERC20 approve/transferFrom
    mapping(address => mapping(address => uint256)) public allowance;

    // Events
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    // The address allowed to mint new tokens (the marketplace)
    address public minter;

    // Modifier to restrict functions to the minter
    modifier onlyMinter() {
        require(msg.sender == minter, "Not authorized to mint");
        _;
    }

    /**
     * @dev Set the initial minter (in practice, you'd likely have a more robust approach, 
     * such as Ownable or AccessControl from OpenZeppelin).
     */
    constructor(address _minter) {
        require(_minter != address(0), "Minter cannot be zero address");
        minter = _minter;
    }

    /**
     * @dev Mint new tokens to a specified address
     */
    function mint(address _to, uint256 _amount) external onlyMinter {
        require(_to != address(0), "Cannot mint to zero address");
        totalSupply += _amount;
        balanceOf[_to] += _amount;
        emit Transfer(address(0), _to, _amount);
    }

    /**
     * @dev Transfer tokens from msg.sender to a recipient
     */
    function transfer(address _to, uint256 _amount) external returns (bool) {
        require(_to != address(0), "Cannot transfer to zero address");
        require(balanceOf[msg.sender] >= _amount, "Insufficient balance");
        balanceOf[msg.sender] -= _amount;
        balanceOf[_to] += _amount;
        emit Transfer(msg.sender, _to, _amount);
        return true;
    }

    /**
     * @dev Approve another address to spend tokens on behalf of msg.sender
     */
    function approve(address _spender, uint256 _amount) external returns (bool) {
        require(_spender != address(0), "Cannot approve zero address");
        allowance[msg.sender][_spender] = _amount;
        emit Approval(msg.sender, _spender, _amount);
        return true;
    }

    /**
     * @dev Transfer tokens from one address to another using allowance
     */
    function transferFrom(address _from, address _to, uint256 _amount) external returns (bool) {
        require(_from != address(0), "Cannot transfer from zero address");
        require(_to != address(0), "Cannot transfer to zero address");
        require(balanceOf[_from] >= _amount, "Insufficient balance");
        require(allowance[_from][msg.sender] >= _amount, "Insufficient allowance");
        
        balanceOf[_from] -= _amount;
        balanceOf[_to] += _amount;
        allowance[_from][msg.sender] -= _amount;
        
        emit Transfer(_from, _to, _amount);
        return true;
    }
}
