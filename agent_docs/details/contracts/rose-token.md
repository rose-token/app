# RoseToken.sol - Detailed Documentation

**Parent**: [contracts.md](../../contracts.md) | **Location**: `contracts/RoseToken.sol` | **Lines**: 167

## Overview

RoseToken is the native ERC20 token of the Rose Token ecosystem. It implements authorized minting/burning through an access control mapping, allowing multiple contracts to mint/burn tokens.

## Contract Architecture

```solidity
contract RoseToken is ERC20, ReentrancyGuard {
    address public owner;
    mapping(address => bool) public authorized;
}
```

## Key Design Decisions

### Multi-Authorized Minting

Unlike traditional owner-only minting, RoseToken uses an authorization mapping:

```solidity
mapping(address => bool) public authorized;

modifier onlyAuthorized() {
    if (!authorized[msg.sender]) revert NotAuthorized();
    _;
}

function setAuthorized(address account, bool status) external onlyOwner {
    authorized[account] = status;
    emit AuthorizationChanged(account, status);
}
```

**Why**: Multiple contracts need mint/burn access:
- Treasury: Mints on deposit, burns on redeem
- Marketplace: Mints DAO rewards on task completion
- Governance: Mints voter rewards

### ERC20 Implementation

Standard OpenZeppelin ERC20 with 18 decimals:

```solidity
constructor(string memory name, string memory symbol, address initialOwner)
    ERC20(name, symbol) {
    owner = initialOwner;
    authorized[initialOwner] = true;
}
```

## Functions

### Admin Functions

| Function | Access | Description |
|----------|--------|-------------|
| `setAuthorized(address, bool)` | onlyOwner | Add/remove authorized minter/burner |
| `transferOwnership(address)` | onlyOwner | Transfer contract ownership |

### Token Operations

| Function | Access | Description |
|----------|--------|-------------|
| `mint(address to, uint256 amount)` | onlyAuthorized | Mint tokens to address |
| `burn(address from, uint256 amount)` | onlyAuthorized | Burn tokens from address |

### Standard ERC20

- `transfer`, `transferFrom`, `approve` - Standard ERC20
- `balanceOf`, `allowance`, `totalSupply` - View functions

## Custom Errors

```solidity
error NotAuthorized();      // Caller not in authorized mapping
error NotOwner();           // Caller not contract owner
error ZeroAddress();        // Invalid zero address provided
error InsufficientBalance();    // Not enough tokens
error InsufficientAllowance();  // Not enough approval
```

## Events

```solidity
event AuthorizationChanged(address indexed account, bool status);
```

## Security Considerations

1. **ReentrancyGuard**: Applied to mint/burn operations
2. **Zero Address Checks**: All functions validate addresses
3. **Balance Checks**: Burn validates sufficient balance before operation

## Integration Points

### Treasury Integration
```solidity
// On deposit: Treasury mints ROSE to user
roseToken.mint(user, roseAmount);

// On redeem: Treasury burns ROSE from user
roseToken.burn(user, roseAmount);
```

### Marketplace Integration
```solidity
// On task completion: Mint DAO reward
roseToken.mint(treasury, daoRewardAmount);
```

### Governance Integration
```solidity
// On proposal resolution: Mint voter rewards
roseToken.mint(address(this), voterRewardPool);
```

## Deployment

```javascript
// 1. Deploy with initial owner
const roseToken = await RoseToken.deploy("Rose Token", "ROSE", deployer);

// 2. Authorize other contracts after deployment
await roseToken.setAuthorized(treasury.address, true);
await roseToken.setAuthorized(marketplace.address, true);
await roseToken.setAuthorized(governance.address, true);
```

## Gas Optimization

- No external calls in mint/burn (single storage write)
- Authorization check is single SLOAD
- Uses custom errors (cheaper than require strings)
