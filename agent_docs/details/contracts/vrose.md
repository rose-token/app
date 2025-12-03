# vROSE.sol - Detailed Documentation

**Parent**: [contracts.md](../../contracts.md) | **Location**: `contracts/vROSE.sol` | **Lines**: 205

## Overview

vROSE is a soulbound governance receipt token minted 1:1 when users deposit ROSE into governance. It enables real escrow in the marketplace while keeping ROSE locked in governance.

## Key Design Pattern

vROSE solves the problem of needing collateral in the marketplace while participating in governance:

1. User deposits ROSE into governance → receives vROSE 1:1
2. User can use vROSE as stakeholder collateral in marketplace tasks
3. vROSE is transferred to marketplace contract (real escrow)
4. On task completion/cancellation, vROSE returns to user
5. User can then withdraw ROSE from governance (burns vROSE)

## Transfer Restrictions

```
User → User:        ❌ BLOCKED (soulbound)
User → Marketplace: ✓ ALLOWED (stake as stakeholder)
Marketplace → User: ✓ ALLOWED (return on completion)
```

## Contract Architecture

```solidity
contract vROSE is IvROSE {
    string public constant name = "Voting Rose Token";
    string public constant symbol = "vROSE";
    uint8 public constant decimals = 18;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) private _allowances;

    address public governance;   // Can mint/burn
    address public marketplace;  // Can receive transfers
    address public owner;
}
```

## Transfer Implementation

### transfer()

```solidity
function transfer(address to, uint256 amount) external returns (bool) {
    // Allow: user → marketplace OR marketplace → user
    if (to != marketplace && msg.sender != marketplace) {
        revert OnlyMarketplaceTransfer();
    }
    _transfer(msg.sender, to, amount);
    return true;
}
```

### transferFrom()

```solidity
function transferFrom(address from, address to, uint256 amount) external returns (bool) {
    // Either from or to must be marketplace
    if (to != marketplace && from != marketplace) {
        revert OnlyMarketplaceTransfer();
    }

    // Check and update allowance
    if (from != msg.sender) {
        uint256 currentAllowance = _allowances[from][msg.sender];
        if (currentAllowance < amount) revert InsufficientBalance();
        _allowances[from][msg.sender] = currentAllowance - amount;
    }

    _transfer(from, to, amount);
    return true;
}
```

### approve()

```solidity
function approve(address spender, uint256 amount) external returns (bool) {
    // Can only approve marketplace (no other spenders allowed)
    if (spender != marketplace) revert OnlyMarketplaceApproval();

    _allowances[msg.sender][spender] = amount;
    emit Approval(msg.sender, spender, amount);
    return true;
}
```

## Governance Integration

### mint()

Called by governance when user deposits ROSE:

```solidity
function mint(address to, uint256 amount) external onlyGovernance {
    if (to == address(0)) revert ZeroAddress();
    if (amount == 0) revert ZeroAmount();

    totalSupply += amount;
    balanceOf[to] += amount;

    emit Transfer(address(0), to, amount);
}
```

### burn()

Called by governance when user withdraws ROSE:

```solidity
function burn(address from, uint256 amount) external onlyGovernance {
    if (from == address(0)) revert ZeroAddress();
    if (amount == 0) revert ZeroAmount();
    if (balanceOf[from] < amount) revert InsufficientBalance();

    balanceOf[from] -= amount;
    totalSupply -= amount;

    emit Transfer(from, address(0), amount);
}
```

## Marketplace Escrow Flow

### Stakeholder Stakes on Task

```
User                    vROSE Contract              Marketplace
  │                           │                           │
  │  approve(marketplace, X)  │                           │
  │──────────────────────────>│                           │
  │                           │                           │
  │  stakeholderStake(taskId) │                           │
  │───────────────────────────────────────────────────────>
  │                           │                           │
  │                           │  transferFrom(user, mp, X)│
  │                           │<──────────────────────────│
  │                           │                           │
  │                           │  vROSE now in marketplace │
```

### Task Completes/Cancels

```
Marketplace             vROSE Contract              User
  │                           │                       │
  │  transfer(user, X)        │                       │
  │──────────────────────────>│                       │
  │                           │                       │
  │                           │  vROSE returned       │
  │                           │──────────────────────>│
```

## Custom Errors

```solidity
error OnlyMarketplaceTransfer();  // Transfer not to/from marketplace
error OnlyMarketplaceApproval();  // Approval only allowed for marketplace
error NotGovernance();            // Caller not governance contract
error NotOwner();                 // Caller not owner
error ZeroAddress();              // Invalid zero address
error ZeroAmount();               // Amount is zero
error InsufficientBalance();      // Not enough vROSE balance
```

## Events

Standard ERC20 events:

```solidity
event Transfer(address indexed from, address indexed to, uint256 value);
event Approval(address indexed owner, address indexed spender, uint256 value);
event GovernanceUpdated(address indexed newGovernance);
event MarketplaceUpdated(address indexed newMarketplace);
```

## Admin Functions

```solidity
function setGovernance(address _governance) external onlyOwner {
    if (_governance == address(0)) revert ZeroAddress();
    governance = _governance;
    emit GovernanceUpdated(_governance);
}

function setMarketplace(address _marketplace) external onlyOwner {
    if (_marketplace == address(0)) revert ZeroAddress();
    marketplace = _marketplace;
    emit MarketplaceUpdated(_marketplace);
}

function transferOwnership(address newOwner) external onlyOwner {
    if (newOwner == address(0)) revert ZeroAddress();
    owner = newOwner;
}
```

## Deployment Sequence

```javascript
// 1. Deploy vROSE (no constructor args)
const vROSE = await vROSE.deploy();

// 2. After governance and marketplace are deployed:
await vROSE.setGovernance(governance.address);
await vROSE.setMarketplace(marketplace.address);
```

## Security Considerations

1. **Soulbound by Design**: Users cannot transfer vROSE to each other, preventing secondary markets
2. **Real Escrow**: vROSE actually moves to marketplace contract (not just accounting)
3. **Governance-Only Minting**: Prevents inflation attacks
4. **Marketplace-Only Transfers**: Strict access control on transfer paths

## Interaction with Withdrawal

When user wants to withdraw ROSE from governance:

1. Check: User has enough vROSE balance (not locked in marketplace tasks)
2. Check: User has enough available VP (not delegated or on proposals)
3. Burn vROSE
4. Return ROSE to user

If vROSE is locked in an active marketplace task, withdrawal will fail with `InsufficientVRose` error.

## Gas Optimization

- No external calls in transfer (single storage read/write)
- Custom errors instead of require strings
- Simple address comparison for marketplace check
