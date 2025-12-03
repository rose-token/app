# RoseTreasury.sol - Detailed Documentation

**Parent**: [contracts.md](../../contracts.md) | **Location**: `contracts/RoseTreasury.sol` | **Lines**: 861

## Overview

RoseTreasury manages the NAV-backed treasury with real-world asset (RWA) diversification via Chainlink price feeds and Uniswap V3 swaps. Users deposit USDC to mint ROSE tokens at NAV price.

## Contract Architecture

```solidity
contract RoseTreasury is ReentrancyGuard, Ownable {
    // Token references
    IERC20 public immutable roseToken;
    IERC20 public immutable usdc;
    IERC20 public immutable wbtc;
    IERC20 public immutable paxg;  // Gold-backed token

    // Chainlink price feeds
    AggregatorV3Interface public btcPriceFeed;
    AggregatorV3Interface public goldPriceFeed;

    // Uniswap V3 router
    ISwapRouter public swapRouter;
}
```

## Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| `DRIFT_THRESHOLD` | 500 (5%) | Triggers rebalance if asset drifts >5% from target |
| `REBALANCE_COOLDOWN` | 7 days | Minimum time between rebalances |
| `USER_COOLDOWN` | 24 hours | Between deposits/redeems per user |
| `MAX_ORACLE_STALENESS` | 1 hour | Reject stale price data |
| `MIN_SWAP_AMOUNT` | 1e6 (1 USDC) | Minimum swap to avoid dust |
| `POOL_FEE_STABLE` | 500 (0.05%) | Uniswap fee for stable pairs |
| `POOL_FEE_VOLATILE` | 3000 (0.3%) | Uniswap fee for volatile pairs |

### Default Allocations

```solidity
uint256 public btcAllocation = 3000;   // 30%
uint256 public goldAllocation = 3000;  // 30%
uint256 public usdcAllocation = 2000;  // 20%
uint256 public roseAllocation = 2000;  // 20%
```

## NAV Price Calculation

### Core Formula

```solidity
function rosePrice() public view returns (uint256) {
    uint256 supply = circulatingSupply();
    if (supply == 0) return 1e6;  // Initial price: $1.00

    uint256 hardAssets = hardAssetValueUSD();
    return (hardAssets * 1e18) / supply;
}
```

### Hard Asset Value

```solidity
function hardAssetValueUSD() public view returns (uint256) {
    uint256 btcValue = getBtcValueUSD();
    uint256 goldValue = getGoldValueUSD();
    uint256 usdcValue = usdc.balanceOf(address(this));
    // Note: Treasury's ROSE holdings are NOT counted
    return btcValue + goldValue + usdcValue;
}
```

### Circulating Supply

```solidity
function circulatingSupply() public view returns (uint256) {
    uint256 total = roseToken.totalSupply();
    if (total == 0) return 0;  // Fixed: was returning 1 incorrectly

    uint256 treasuryBalance = roseToken.balanceOf(address(this));
    return total - treasuryBalance;
}
```

## Chainlink Integration

### Price Feed Validation

```solidity
function _getPrice(AggregatorV3Interface feed) internal view returns (uint256) {
    (
        /* uint80 roundId */,
        int256 price,
        /* uint256 startedAt */,
        uint256 updatedAt,
        /* uint80 answeredInRound */
    ) = feed.latestRoundData();

    if (price <= 0) revert InvalidPrice();
    if (block.timestamp - updatedAt > MAX_ORACLE_STALENESS) revert StaleOracle();

    return uint256(price);  // 8 decimals
}
```

### Asset Value Calculation

```solidity
function getBtcValueUSD() public view returns (uint256) {
    uint256 btcBalance = wbtc.balanceOf(address(this));
    if (btcBalance == 0) return 0;

    uint256 btcPrice = _getPrice(btcPriceFeed);  // 8 decimals
    // WBTC: 8 decimals, price: 8 decimals, result: 6 decimals (USDC)
    return (btcBalance * btcPrice) / 1e10;
}
```

## Deposit Flow

```solidity
function deposit(uint256 usdcAmount) external nonReentrant {
    // 1. Cooldown check
    if (block.timestamp < lastDeposit[msg.sender] + USER_COOLDOWN) {
        revert CooldownNotElapsed();
    }

    // 2. Calculate ROSE to mint
    uint256 price = rosePrice();
    uint256 roseToMint = (usdcAmount * 1e18) / price;

    // 3. Transfer USDC to treasury
    usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);

    // 4. Mint ROSE to user
    IRoseToken(address(roseToken)).mint(msg.sender, roseToMint);

    // 5. Diversify into RWA
    _diversify(usdcAmount);

    // 6. Update cooldown
    lastDeposit[msg.sender] = block.timestamp;

    emit Deposited(msg.sender, usdcAmount, roseToMint);
}
```

### Diversification Logic

```solidity
function _diversify(uint256 usdcAmount) internal {
    // Calculate target amounts based on allocations
    uint256 btcTarget = (usdcAmount * btcAllocation) / BASIS_POINTS;
    uint256 goldTarget = (usdcAmount * goldAllocation) / BASIS_POINTS;
    // USDC portion stays as USDC, ROSE portion not swapped (mint only)

    // Execute swaps
    if (btcTarget >= MIN_SWAP_AMOUNT) {
        _swapUSDCForBTC(btcTarget);
    }
    if (goldTarget >= MIN_SWAP_AMOUNT) {
        _swapUSDCForGold(goldTarget);
    }
}
```

## Redeem Flow

```solidity
function redeem(uint256 roseAmount) external nonReentrant {
    // 1. Cooldown check
    if (block.timestamp < lastRedeem[msg.sender] + USER_COOLDOWN) {
        revert CooldownNotElapsed();
    }

    // 2. Calculate USDC owed
    uint256 price = rosePrice();
    uint256 usdcOwed = (roseAmount * price) / 1e18;

    // 3. Burn ROSE from user
    IRoseToken(address(roseToken)).burn(msg.sender, roseAmount);

    // 4. Ensure sufficient USDC (liquidate RWA if needed)
    uint256 usdcBalance = usdc.balanceOf(address(this));
    if (usdcBalance < usdcOwed) {
        _liquidateForRedemption(usdcOwed - usdcBalance);
    }

    // 5. Transfer USDC to user
    usdc.safeTransfer(msg.sender, usdcOwed);

    // 6. Update cooldown
    lastRedeem[msg.sender] = block.timestamp;

    emit Redeemed(msg.sender, roseAmount, usdcOwed);
}
```

### Liquidation Priority

```solidity
function _liquidateForRedemption(uint256 usdcNeeded) internal {
    // 1. Sell BTC first (most liquid)
    if (usdcNeeded > 0 && wbtc.balanceOf(address(this)) > 0) {
        usdcNeeded = _sellBTCForUSDC(usdcNeeded);
    }

    // 2. Sell gold if needed
    if (usdcNeeded > 0 && paxg.balanceOf(address(this)) > 0) {
        usdcNeeded = _sellGoldForUSDC(usdcNeeded);
    }

    if (usdcNeeded > 0) revert InsufficientLiquidity();
}
```

## Uniswap V3 Integration

### Swap Execution

```solidity
function _swapUSDCForBTC(uint256 usdcAmount) internal returns (uint256) {
    usdc.approve(address(swapRouter), usdcAmount);

    ISwapRouter.ExactInputSingleParams memory params = ISwapRouter.ExactInputSingleParams({
        tokenIn: address(usdc),
        tokenOut: address(wbtc),
        fee: POOL_FEE_VOLATILE,
        recipient: address(this),
        deadline: block.timestamp,
        amountIn: usdcAmount,
        amountOutMinimum: _calculateMinOut(usdcAmount, address(wbtc)),
        sqrtPriceLimitX96: 0
    });

    return swapRouter.exactInputSingle(params);
}
```

### Slippage Protection

```solidity
function _calculateMinOut(uint256 amountIn, address tokenOut) internal view returns (uint256) {
    uint256 expectedOut = _getExpectedOutput(amountIn, tokenOut);
    // Apply slippage tolerance (default 1%)
    return (expectedOut * (BASIS_POINTS - maxSlippageBps)) / BASIS_POINTS;
}
```

## Rebalancing

### Drift Detection

```solidity
function rebalanceNeeded() public view returns (bool) {
    if (block.timestamp < lastRebalance + REBALANCE_COOLDOWN) return false;

    uint256 totalValue = hardAssetValueUSD() + roseToken.balanceOf(address(this)) * rosePrice() / 1e18;
    if (totalValue == 0) return false;

    // Check each asset for drift
    uint256 btcPercent = (getBtcValueUSD() * BASIS_POINTS) / totalValue;
    if (_abs(int256(btcPercent) - int256(btcAllocation)) > DRIFT_THRESHOLD) return true;

    // ... similar for gold, USDC, ROSE
    return false;
}
```

### Rebalance Execution

```solidity
function rebalance() external {
    if (!rebalanceNeeded()) revert RebalanceNotNeeded();
    _executeRebalance();
}

function forceRebalance() external onlyOwner {
    // Owner can bypass cooldown
    _executeRebalance();
}

function _executeRebalance() internal {
    // Phase 1: Sell overweight assets to USDC
    // Phase 2: Buy underweight assets with USDC
    // Maintains 5% USDC buffer for liquidity
    lastRebalance = block.timestamp;
    emit Rebalanced(block.timestamp);
}
```

## Custom Errors

```solidity
error InvalidPrice();           // Chainlink price <= 0
error StaleOracle();            // Oracle data > 1 hour old
error InsufficientLiquidity();  // Can't liquidate enough for redemption
error SlippageExceeded();       // Swap output < minimum expected
error InvalidAllocation();      // Allocations don't sum to 100%
error ZeroAmount();             // Amount is zero
error RebalanceNotNeeded();     // No drift detected
error RebalanceCooldown();      // Within 7-day cooldown
error CooldownNotElapsed();     // User cooldown not elapsed
```

## Security Patterns

1. **User Cooldowns**: 24-hour cooldown prevents flash loan attacks on NAV
2. **Oracle Staleness**: Rejects price data older than 1 hour
3. **Slippage Protection**: Configurable max slippage (default 1%)
4. **ReentrancyGuard**: All state-changing functions protected
5. **Checks-Effects-Interactions**: State updated before external calls

## View Functions

```solidity
function getVaultBreakdown() external view returns (
    uint256 btcValue,
    uint256 goldValue,
    uint256 usdcValue,
    uint256 roseValue,
    uint256 totalHardAssets,
    uint256 currentRosePrice,
    uint256 circulatingRose,
    bool needsRebalance
);

function timeUntilDeposit(address user) external view returns (uint256);
function timeUntilRedeem(address user) external view returns (uint256);
```

## Bug Fixes Applied

**circulatingSupply() Initial State Bug (Fixed)**:
- Issue: When totalSupply is 0, function returned 1 instead of 0
- Impact: Caused rosePrice() to return 0 instead of initial $1 price
- Fix: Added `if (total == 0) return 0;` check at start
