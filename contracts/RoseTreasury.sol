// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";

/**
 * @title RoseTreasury
 * @dev Treasury vault that backs ROSE tokens with real-world assets (BTC, Gold, USDC).
 *
 * Allocation: 30% WBTC / 30% PAXG / 20% USDC / 20% ROSE (buyback reserve)
 *
 * Users deposit USDC, receive ROSE at current NAV.
 * Treasury automatically diversifies into RWA.
 * Users redeem ROSE for USDC at current NAV.
 *
 * NAV = Hard Assets (BTC + Gold + USDC) / Circulating ROSE Supply
 * Treasury ROSE is NOT counted in NAV - it's a buyback/spending reserve.
 *
 * Rebalancing:
 * - Threshold-based (5% drift triggers rebalance)
 * - 7-day cooldown between rebalances
 * - Buys ROSE from LP when underweight (reduces circulating supply)
 * - Sells ROSE to LP when overweight (or spends on dev)
 */
contract RoseTreasury is ReentrancyGuard, Ownable, Pausable {
    using SafeERC20 for IERC20;

    // ============ Tokens ============
    IERC20 public immutable roseToken;
    IERC20 public immutable usdc;
    IERC20 public immutable wbtc;
    IERC20 public immutable paxg;

    // ============ Chainlink Price Feeds ============
    AggregatorV3Interface public immutable btcUsdFeed;
    AggregatorV3Interface public immutable xauUsdFeed;

    // ============ DEX ============
    ISwapRouter public immutable swapRouter;
    uint24 public constant POOL_FEE_STABLE = 500;   // 0.05% for USDC pairs
    uint24 public constant POOL_FEE_VOLATILE = 3000; // 0.3% for volatile pairs

    // ============ Allocation Targets (basis points, 10000 = 100%) ============
    uint256 public allocBTC = 3000;   // 30%
    uint256 public allocGold = 3000;  // 30%
    uint256 public allocUSDC = 2000;  // 20%
    uint256 public allocROSE = 2000;  // 20% buyback reserve
    uint256 public constant ALLOC_DENOMINATOR = 10000;

    // ============ Rebalancing ============
    uint256 public constant DRIFT_THRESHOLD = 500; // 5% drift triggers rebalance
    uint256 public constant REBALANCE_COOLDOWN = 7 days;
    uint256 public lastRebalanceTime;

    // ============ Decimals ============
    uint8 public constant USDC_DECIMALS = 6;
    uint8 public constant WBTC_DECIMALS = 8;
    uint8 public constant PAXG_DECIMALS = 18;
    uint8 public constant ROSE_DECIMALS = 18;
    uint8 public constant CHAINLINK_DECIMALS = 8;

    // ============ Slippage Protection ============
    uint256 public maxSlippageBps = 100; // 1% default

    // ============ Oracle Staleness ============
    uint256 public constant MAX_ORACLE_STALENESS = 1 hours;

    // ============ Minimum Swap Threshold ============
    uint256 public constant MIN_SWAP_AMOUNT = 1e6; // 1 USDC minimum

    // ============ Marketplace Integration ============
    address public marketplace;

    // ============ Governance Integration ============
    address public governance;

    // ============ User Cooldowns ============
    uint256 public constant USER_COOLDOWN = 24 hours;
    mapping(address => uint256) public lastDepositTime;
    mapping(address => uint256) public lastRedeemTime;

    // ============ Events ============
    event Deposited(address indexed user, uint256 usdcIn, uint256 roseMinted);
    event Redeemed(address indexed user, uint256 roseBurned, uint256 usdcOut);
    event Rebalanced(
        uint256 btcValue,
        uint256 goldValue,
        uint256 usdcValue,
        uint256 roseValue,
        uint256 totalHardAssets
    );
    event AllocationUpdated(uint256 btc, uint256 gold, uint256 usdc, uint256 rose);
    event RoseSpent(address indexed to, uint256 amount, string reason);
    event RoseBuyback(uint256 usdcSpent, uint256 roseBought);
    event MarketplaceUpdated(address indexed newMarketplace);
    event GovernanceUpdated(address indexed newGovernance);
    event RebalanceDebug(
        uint256 hardAssets,
        uint256 roseValue,
        uint256 roseBalance,
        uint256 targetROSE,
        uint256 roseToSell,
        uint256 excessUSDC
    );

    // ============ Errors ============
    error InvalidPrice();
    error StaleOracle();
    error InsufficientLiquidity();
    error SlippageExceeded();
    error InvalidAllocation();
    error ZeroAmount();
    error ZeroAddress();
    error InsufficientBuffer();
    error InsufficientBalance();
    error RebalanceNotNeeded();
    error RebalanceCooldown();
    error CooldownNotElapsed(uint256 timeRemaining);

    constructor(
        address _roseToken,
        address _usdc,
        address _wbtc,
        address _paxg,
        address _btcUsdFeed,
        address _xauUsdFeed,
        address _swapRouter
    ) Ownable(msg.sender) {
        roseToken = IERC20(_roseToken);
        usdc = IERC20(_usdc);
        wbtc = IERC20(_wbtc);
        paxg = IERC20(_paxg);

        btcUsdFeed = AggregatorV3Interface(_btcUsdFeed);
        xauUsdFeed = AggregatorV3Interface(_xauUsdFeed);

        swapRouter = ISwapRouter(_swapRouter);

        // Approve router for swaps
        IERC20(_usdc).approve(_swapRouter, type(uint256).max);
        IERC20(_wbtc).approve(_swapRouter, type(uint256).max);
        IERC20(_paxg).approve(_swapRouter, type(uint256).max);
        IERC20(_roseToken).approve(_swapRouter, type(uint256).max);
    }

    // ============ Core Functions ============

    /**
     * @dev Deposit USDC, receive ROSE at current NAV
     * 24hr cooldown between deposits (owner exempt)
     */
    function deposit(uint256 usdcAmount) external nonReentrant whenNotPaused {
        if (msg.sender != owner()) {
            uint256 nextAllowed = lastDepositTime[msg.sender] + USER_COOLDOWN;
            if (block.timestamp < nextAllowed) {
                revert CooldownNotElapsed(nextAllowed - block.timestamp);
            }
        }
        if (usdcAmount == 0) revert ZeroAmount();
        if (usdc.balanceOf(msg.sender) < usdcAmount) revert InsufficientBalance();

        uint256 roseToMint = calculateRoseForDeposit(usdcAmount);

        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);
        IRoseToken(address(roseToken)).mint(msg.sender, roseToMint);

        _diversify(usdcAmount);

        lastDepositTime[msg.sender] = block.timestamp;
        emit Deposited(msg.sender, usdcAmount, roseToMint);
    }

    /**
     * @dev Redeem ROSE for USDC at current NAV
     * 24hr cooldown between redemptions (owner exempt)
     */
    function redeem(uint256 roseAmount) external nonReentrant whenNotPaused {
        if (msg.sender != owner()) {
            uint256 nextAllowed = lastRedeemTime[msg.sender] + USER_COOLDOWN;
            if (block.timestamp < nextAllowed) {
                revert CooldownNotElapsed(nextAllowed - block.timestamp);
            }
        }
        if (roseAmount == 0) revert ZeroAmount();
        if (roseToken.balanceOf(msg.sender) < roseAmount) revert InsufficientBalance();

        uint256 usdcOwed = calculateUsdcForRedemption(roseAmount);

        IRoseToken(address(roseToken)).burn(msg.sender, roseAmount);

        uint256 usdcBalance = usdc.balanceOf(address(this));
        if (usdcBalance < usdcOwed) {
            _liquidateForRedemption(usdcOwed - usdcBalance);
        }

        usdc.safeTransfer(msg.sender, usdcOwed);

        lastRedeemTime[msg.sender] = block.timestamp;
        emit Redeemed(msg.sender, roseAmount, usdcOwed);
    }

    // ============ NAV Functions ============

    /**
     * @dev Get total hard asset value in USD (6 decimals)
     * EXCLUDES treasury ROSE - only counts BTC, Gold, USDC
     */
    function hardAssetValueUSD() public view returns (uint256) {
        uint256 btcValue = _getAssetValueUSD(
            wbtc.balanceOf(address(this)),
            getBTCPrice(),
            WBTC_DECIMALS
        );

        uint256 goldValue = _getAssetValueUSD(
            paxg.balanceOf(address(this)),
            getGoldPrice(),
            PAXG_DECIMALS
        );

        uint256 usdcValue = usdc.balanceOf(address(this));

        return btcValue + goldValue + usdcValue;
    }

    /**
     * @dev Get treasury ROSE value at current NAV (for rebalancing calculations only)
     * This is NOT included in NAV calculation
     */
    function treasuryRoseValueUSD() public view returns (uint256) {
        uint256 treasuryRose = roseToken.balanceOf(address(this));
        if (treasuryRose == 0) return 0;
        
        uint256 nav = rosePrice();
        return (treasuryRose * nav) / 1e18;
    }

    /**
     * @dev Get current ROSE price (NAV) in USD (6 decimals)
     * NAV = Hard Assets / Circulating Supply
     */
    function rosePrice() public view returns (uint256) {
        uint256 circulating = circulatingSupply();
        if (circulating == 0) {
            return 1e6; // $1.00 initial price
        }
        
        return (hardAssetValueUSD() * 1e18) / circulating;
    }

    /**
     * @dev Get circulating supply (total - treasury held)
     */
    function circulatingSupply() public view returns (uint256) {
        uint256 total = roseToken.totalSupply();
        if (total == 0) return 0;

        uint256 treasuryHeld = roseToken.balanceOf(address(this));
        if (treasuryHeld >= total) return 1;

        return total - treasuryHeld;
    }

    /**
     * @dev Calculate ROSE to mint for USDC deposit
     */
    function calculateRoseForDeposit(uint256 usdcAmount) public view returns (uint256) {
        uint256 currentPrice = rosePrice();
        return (usdcAmount * 1e18) / currentPrice;
    }

    /**
     * @dev Calculate USDC for ROSE redemption
     */
    function calculateUsdcForRedemption(uint256 roseAmount) public view returns (uint256) {
        uint256 currentPrice = rosePrice();
        return (roseAmount * currentPrice) / 1e18;
    }

    // ============ Rebalancing ============

    /**
     * @dev Check if rebalance is needed (any asset >5% off target)
     */
    function needsRebalance() public view returns (bool) {
        uint256 hardAssets = hardAssetValueUSD();
        if (hardAssets == 0) return false;

        uint256 btcValue = _getAssetValueUSD(wbtc.balanceOf(address(this)), getBTCPrice(), WBTC_DECIMALS);
        uint256 goldValue = _getAssetValueUSD(paxg.balanceOf(address(this)), getGoldPrice(), PAXG_DECIMALS);
        uint256 usdcValue = usdc.balanceOf(address(this));
        uint256 roseValue = treasuryRoseValueUSD();

        uint256 totalForAlloc = hardAssets + roseValue;

        // Check each allocation for drift
        uint256 btcTarget = (totalForAlloc * allocBTC) / ALLOC_DENOMINATOR;
        uint256 goldTarget = (totalForAlloc * allocGold) / ALLOC_DENOMINATOR;
        uint256 usdcTarget = (totalForAlloc * allocUSDC) / ALLOC_DENOMINATOR;
        uint256 roseTarget = (totalForAlloc * allocROSE) / ALLOC_DENOMINATOR;

        if (_isDrifted(btcValue, btcTarget)) return true;
        if (_isDrifted(goldValue, goldTarget)) return true;
        if (_isDrifted(usdcValue, usdcTarget)) return true;
        if (_isDrifted(roseValue, roseTarget)) return true;

        return false;
    }

    /**
     * @dev Check if value has drifted more than threshold from target
     */
    function _isDrifted(uint256 current, uint256 target) internal pure returns (bool) {
        if (target == 0) return current > 0;
        
        uint256 diff;
        if (current > target) {
            diff = current - target;
        } else {
            diff = target - current;
        }
        
        return (diff * ALLOC_DENOMINATOR) / target > DRIFT_THRESHOLD;
    }

    /**
     * @dev Permissionless rebalance - anyone can call if threshold met and cooldown passed
     */
    function rebalance() external nonReentrant whenNotPaused {
        if (!needsRebalance()) revert RebalanceNotNeeded();
        if (block.timestamp < lastRebalanceTime + REBALANCE_COOLDOWN) revert RebalanceCooldown();

        lastRebalanceTime = block.timestamp;
        _executeRebalance();
    }

    /**
     * @dev Force rebalance (owner only, bypasses cooldown and threshold)
     */
    function forceRebalance() external onlyOwner whenNotPaused {
        lastRebalanceTime = block.timestamp;
        _executeRebalance();
    }

    /**
     * @dev Internal rebalance logic
     */
    function _executeRebalance() internal {
        uint256 hardAssets = hardAssetValueUSD();
        uint256 roseValue = treasuryRoseValueUSD();
        uint256 totalForAlloc = hardAssets + roseValue;

        // Calculate targets
        uint256 targetBTC = (totalForAlloc * allocBTC) / ALLOC_DENOMINATOR;
        uint256 targetGold = (totalForAlloc * allocGold) / ALLOC_DENOMINATOR;
        uint256 targetUSDC = (totalForAlloc * allocUSDC) / ALLOC_DENOMINATOR;
        uint256 targetROSE = (totalForAlloc * allocROSE) / ALLOC_DENOMINATOR;

        // Get current values
        uint256 currentBTC = _getAssetValueUSD(wbtc.balanceOf(address(this)), getBTCPrice(), WBTC_DECIMALS);
        uint256 currentGold = _getAssetValueUSD(paxg.balanceOf(address(this)), getGoldPrice(), PAXG_DECIMALS);
        uint256 currentROSE = roseValue;

        // Emit debug event for diagnostics
        {
            uint256 roseBalance = roseToken.balanceOf(address(this));
            uint256 roseToSellCalc = currentROSE > targetROSE && currentROSE > 0
                ? (roseBalance * (currentROSE - targetROSE)) / currentROSE
                : 0;
            uint256 usdcBal = usdc.balanceOf(address(this));
            uint256 excessUsdcCalc = usdcBal > targetUSDC
                ? usdcBal - targetUSDC
                : 0;
            emit RebalanceDebug(
                hardAssets,
                roseValue,
                roseBalance,
                targetROSE,
                roseToSellCalc,
                excessUsdcCalc
            );
        }

        // Phase 1: Sell overweight hard assets to USDC
        if (currentBTC > targetBTC) {
            uint256 diff = currentBTC - targetBTC;
            uint256 btcToSell = (wbtc.balanceOf(address(this)) * diff) / currentBTC;
            if (btcToSell > 0) _swapAssetToUSDC(address(wbtc), btcToSell);
        }
        if (currentGold > targetGold) {
            uint256 diff = currentGold - targetGold;
            uint256 goldToSell = (paxg.balanceOf(address(this)) * diff) / currentGold;
            if (goldToSell > 0) _swapAssetToUSDC(address(paxg), goldToSell);
        }

        // Phase 2: Sell overweight ROSE to USDC (if significantly over)
        if (currentROSE > targetROSE && currentROSE > 0) {
            uint256 diff = currentROSE - targetROSE;
            uint256 roseToSell = (roseToken.balanceOf(address(this)) * diff) / currentROSE;
            if (roseToSell >= MIN_SWAP_AMOUNT) {
                _swapROSEToUSDC(roseToSell);
            }
        }

        // Refresh USDC balance after sells
        uint256 currentUSDC = usdc.balanceOf(address(this));

        // Phase 3: Buy underweight assets with excess USDC
        uint256 minBuffer = (totalForAlloc * 500) / ALLOC_DENOMINATOR; // 5% min buffer

        if (currentUSDC > targetUSDC && currentUSDC > minBuffer) {
            uint256 excess = currentUSDC - targetUSDC;
            uint256 maxSpend = currentUSDC - minBuffer;
            if (excess > maxSpend) excess = maxSpend;

            // Recalculate current values after sells
            currentBTC = _getAssetValueUSD(wbtc.balanceOf(address(this)), getBTCPrice(), WBTC_DECIMALS);
            currentGold = _getAssetValueUSD(paxg.balanceOf(address(this)), getGoldPrice(), PAXG_DECIMALS);
            currentROSE = treasuryRoseValueUSD();

            // Calculate deficits
            uint256 deficitBTC = targetBTC > currentBTC ? targetBTC - currentBTC : 0;
            uint256 deficitGold = targetGold > currentGold ? targetGold - currentGold : 0;
            uint256 deficitROSE = targetROSE > currentROSE ? targetROSE - currentROSE : 0;

            uint256 totalDeficit = deficitBTC + deficitGold + deficitROSE;

            if (totalDeficit > 0 && excess > 0) {
                // Buy underweight assets proportionally
                if (deficitBTC > 0) {
                    uint256 buyAmount = (excess * deficitBTC) / totalDeficit;
                    if (buyAmount >= MIN_SWAP_AMOUNT) _swapUSDCToAsset(address(wbtc), buyAmount);
                }
                if (deficitGold > 0) {
                    uint256 buyAmount = (excess * deficitGold) / totalDeficit;
                    if (buyAmount >= MIN_SWAP_AMOUNT) _swapUSDCToAsset(address(paxg), buyAmount);
                }
                if (deficitROSE > 0) {
                    uint256 buyAmount = (excess * deficitROSE) / totalDeficit;
                    if (buyAmount >= MIN_SWAP_AMOUNT) {
                        uint256 roseBought = _swapUSDCToROSE(buyAmount);
                        emit RoseBuyback(buyAmount, roseBought);
                    }
                }
            }
        }

        emit Rebalanced(
            _getAssetValueUSD(wbtc.balanceOf(address(this)), getBTCPrice(), WBTC_DECIMALS),
            _getAssetValueUSD(paxg.balanceOf(address(this)), getGoldPrice(), PAXG_DECIMALS),
            usdc.balanceOf(address(this)),
            treasuryRoseValueUSD(),
            hardAssetValueUSD()
        );
    }

    /**
     * @dev Preview what rebalance would do without executing
     * @return hardAssets Total hard asset value in USD (6 decimals)
     * @return roseValue Treasury ROSE value in USD (6 decimals)
     * @return roseBalance Treasury ROSE token balance (18 decimals)
     * @return targetROSE Target ROSE value based on allocation
     * @return roseToSell Amount of ROSE that would be sold (0 if underweight)
     * @return excessUSDC USDC above target that would be spent on buying
     */
    function getRebalancePreview() external view returns (
        uint256 hardAssets,
        uint256 roseValue,
        uint256 roseBalance,
        uint256 targetROSE,
        uint256 roseToSell,
        uint256 excessUSDC
    ) {
        hardAssets = hardAssetValueUSD();
        roseValue = treasuryRoseValueUSD();
        roseBalance = roseToken.balanceOf(address(this));

        uint256 totalForAlloc = hardAssets + roseValue;
        targetROSE = (totalForAlloc * allocROSE) / ALLOC_DENOMINATOR;

        // Phase 2: Would we sell ROSE?
        if (roseValue > targetROSE && roseValue > 0) {
            uint256 diff = roseValue - targetROSE;
            roseToSell = (roseBalance * diff) / roseValue;
            if (roseToSell < MIN_SWAP_AMOUNT) roseToSell = 0;
        }

        // Phase 3: Would we spend USDC?
        uint256 usdcBalance = usdc.balanceOf(address(this));
        uint256 targetUSDC = (totalForAlloc * allocUSDC) / ALLOC_DENOMINATOR;
        uint256 minBuffer = (totalForAlloc * 500) / ALLOC_DENOMINATOR;

        if (usdcBalance > targetUSDC && usdcBalance > minBuffer) {
            uint256 excess = usdcBalance - targetUSDC;
            uint256 maxSpend = usdcBalance - minBuffer;
            excessUSDC = excess > maxSpend ? maxSpend : excess;
        }
    }

    // ============ Price Feed Functions ============

    function getBTCPrice() public view returns (uint256) {
        (, int256 price, , uint256 updatedAt, ) = btcUsdFeed.latestRoundData();
        if (price <= 0) revert InvalidPrice();
        if (block.timestamp - updatedAt > MAX_ORACLE_STALENESS) revert StaleOracle();
        return uint256(price);
    }

    function getGoldPrice() public view returns (uint256) {
        (, int256 price, , uint256 updatedAt, ) = xauUsdFeed.latestRoundData();
        if (price <= 0) revert InvalidPrice();
        if (block.timestamp - updatedAt > MAX_ORACLE_STALENESS) revert StaleOracle();
        return uint256(price);
    }

    // ============ Internal Functions ============

    /**
     * @dev Convert asset balance to USD value (6 decimals)
     */
    function _getAssetValueUSD(
        uint256 balance,
        uint256 priceUSD,
        uint8 assetDecimals
    ) internal pure returns (uint256) {
        if (assetDecimals >= 18) {
            uint256 scaledBalance = balance / 1e12;
            return (scaledBalance * priceUSD) / (10 ** CHAINLINK_DECIMALS);
        } else {
            return (balance * priceUSD) / (10 ** (assetDecimals + CHAINLINK_DECIMALS - USDC_DECIMALS));
        }
    }

    /**
     * @dev Diversify deposited USDC into RWA with smart rebalancing.
     * Prioritizes underweight assets (USDC buffer first, then RWA proportionally).
     * Only uses target ratios for excess after all deficits are filled.
     * Note: Does NOT buy ROSE - that's handled by rebalance() buybacks.
     */
    function _diversify(uint256 usdcAmount) internal {
        if (usdcAmount == 0) return;

        uint256 wbtcBal = wbtc.balanceOf(address(this));
        uint256 paxgBal = paxg.balanceOf(address(this));
        uint256 usdcBal = usdc.balanceOf(address(this));

        // First deposit - use simple ratio split
        if (wbtcBal == 0 && paxgBal == 0) {
            _diversifyByRatio(usdcAmount);
            return;
        }

        // Get current values via Chainlink
        uint256 btcPrice = getBTCPrice();
        uint256 goldPrice = getGoldPrice();

        uint256 currentBTC = _getAssetValueUSD(wbtcBal, btcPrice, WBTC_DECIMALS);
        uint256 currentGold = _getAssetValueUSD(paxgBal, goldPrice, PAXG_DECIMALS);

        // Calculate targets based on hard assets only (exclude ROSE allocation)
        uint256 hardAllocTotal = allocBTC + allocGold + allocUSDC;
        uint256 newHardTotal = currentBTC + currentGold + usdcBal;

        uint256 targetBTC = (newHardTotal * allocBTC) / hardAllocTotal;
        uint256 targetGold = (newHardTotal * allocGold) / hardAllocTotal;
        uint256 targetUSDC = (newHardTotal * allocUSDC) / hardAllocTotal;

        uint256 preDepositUSDC = usdcBal - usdcAmount;

        // Calculate deficits
        uint256 deficitUSDC = targetUSDC > preDepositUSDC ? targetUSDC - preDepositUSDC : 0;
        uint256 deficitBTC = targetBTC > currentBTC ? targetBTC - currentBTC : 0;
        uint256 deficitGold = targetGold > currentGold ? targetGold - currentGold : 0;

        uint256 remaining = usdcAmount;

        // Phase 1: Fill USDC buffer first (critical for redemption liquidity)
        if (deficitUSDC > 0 && remaining > 0) {
            uint256 toUSDC = remaining < deficitUSDC ? remaining : deficitUSDC;
            remaining -= toUSDC;
            // USDC stays in contract, no swap needed
        }

        // Phase 2: Fill RWA deficits proportionally
        if (remaining > 0) {
            uint256 totalRWADeficit = deficitBTC + deficitGold;

            if (totalRWADeficit > 0) {
                uint256 toSpend = remaining < totalRWADeficit ? remaining : totalRWADeficit;

                if (deficitBTC > 0) {
                    uint256 spentBTC = (toSpend * deficitBTC) / totalRWADeficit;
                    if (spentBTC >= MIN_SWAP_AMOUNT) _swapUSDCToAsset(address(wbtc), spentBTC);
                }
                if (deficitGold > 0) {
                    uint256 spentGold = toSpend - ((toSpend * deficitBTC) / totalRWADeficit);
                    if (spentGold >= MIN_SWAP_AMOUNT) _swapUSDCToAsset(address(paxg), spentGold);
                }

                remaining -= toSpend;
            }
        }

        // Phase 3: Excess goes to RWA by ratio
        if (remaining > 0) {
            _diversifyByRatio(remaining);
        }
    }

    /**
     * @dev Simple diversification using target ratios (for first deposit or excess)
     */
    function _diversifyByRatio(uint256 usdcAmount) internal {
        uint256 hardAllocTotal = allocBTC + allocGold + allocUSDC;
        
        uint256 toBTC = (usdcAmount * allocBTC) / hardAllocTotal;
        uint256 toGold = (usdcAmount * allocGold) / hardAllocTotal;
        // Rest stays as USDC buffer

        if (toBTC >= MIN_SWAP_AMOUNT) _swapUSDCToAsset(address(wbtc), toBTC);
        if (toGold >= MIN_SWAP_AMOUNT) _swapUSDCToAsset(address(paxg), toGold);
    }

    /**
     * @dev Liquidate RWA to USDC for redemptions
     * Uses ceiling division to ensure we liquidate enough to cover the shortfall
     */
    function _liquidateForRedemption(uint256 usdcNeeded) internal {
        uint256 hardAssets = hardAssetValueUSD();
        uint256 usdcBalance = usdc.balanceOf(address(this));
        uint256 rwaValue = hardAssets - usdcBalance;

        if (rwaValue == 0) revert InsufficientLiquidity();

        uint256 btcValue = _getAssetValueUSD(wbtc.balanceOf(address(this)), getBTCPrice(), WBTC_DECIMALS);
        uint256 goldValue = _getAssetValueUSD(paxg.balanceOf(address(this)), getGoldPrice(), PAXG_DECIMALS);

        if (btcValue > 0) {
            // Ceiling division: (a * b + c - 1) / c to ensure we sell enough
            uint256 btcBalance = wbtc.balanceOf(address(this));
            uint256 btcToSell = (btcBalance * usdcNeeded + rwaValue - 1) / rwaValue;
            // Cap at actual balance to prevent overflow
            if (btcToSell > btcBalance) btcToSell = btcBalance;
            if (btcToSell > 0) _swapAssetToUSDC(address(wbtc), btcToSell);
        }

        if (goldValue > 0) {
            // Ceiling division for gold as well
            uint256 goldBalance = paxg.balanceOf(address(this));
            uint256 goldToSell = (goldBalance * usdcNeeded + rwaValue - 1) / rwaValue;
            // Cap at actual balance to prevent overflow
            if (goldToSell > goldBalance) goldToSell = goldBalance;
            if (goldToSell > 0) _swapAssetToUSDC(address(paxg), goldToSell);
        }
    }

    /**
     * @dev Swap USDC to asset via Uniswap
     */
    function _swapUSDCToAsset(address asset, uint256 usdcAmount) internal {
        uint256 minOut = _calculateMinOut(usdcAmount, asset, true);

        ISwapRouter.ExactInputSingleParams memory params = ISwapRouter.ExactInputSingleParams({
            tokenIn: address(usdc),
            tokenOut: asset,
            fee: POOL_FEE_VOLATILE,
            recipient: address(this),
            deadline: block.timestamp,
            amountIn: usdcAmount,
            amountOutMinimum: minOut,
            sqrtPriceLimitX96: 0
        });

        swapRouter.exactInputSingle(params);
    }

    /**
     * @dev Swap asset to USDC via Uniswap
     */
    function _swapAssetToUSDC(address asset, uint256 assetAmount) internal {
        uint256 minOut = _calculateMinOut(assetAmount, asset, false);

        ISwapRouter.ExactInputSingleParams memory params = ISwapRouter.ExactInputSingleParams({
            tokenIn: asset,
            tokenOut: address(usdc),
            fee: POOL_FEE_VOLATILE,
            recipient: address(this),
            deadline: block.timestamp,
            amountIn: assetAmount,
            amountOutMinimum: minOut,
            sqrtPriceLimitX96: 0
        });

        swapRouter.exactInputSingle(params);
    }

    /**
     * @dev Swap USDC to ROSE via Uniswap (buyback)
     */
    function _swapUSDCToROSE(uint256 usdcAmount) internal returns (uint256) {
        // Use NAV as price reference for slippage
        uint256 nav = rosePrice();
        uint256 expectedRose = (usdcAmount * 1e18) / nav;
        uint256 minOut = (expectedRose * (ALLOC_DENOMINATOR - maxSlippageBps)) / ALLOC_DENOMINATOR;

        ISwapRouter.ExactInputSingleParams memory params = ISwapRouter.ExactInputSingleParams({
            tokenIn: address(usdc),
            tokenOut: address(roseToken),
            fee: POOL_FEE_STABLE,
            recipient: address(this),
            deadline: block.timestamp,
            amountIn: usdcAmount,
            amountOutMinimum: minOut,
            sqrtPriceLimitX96: 0
        });

        return swapRouter.exactInputSingle(params);
    }

    /**
     * @dev Swap ROSE to USDC via Uniswap
     */
    function _swapROSEToUSDC(uint256 roseAmount) internal returns (uint256) {
        uint256 nav = rosePrice();
        uint256 expectedUsdc = (roseAmount * nav) / 1e18;
        uint256 minOut = (expectedUsdc * (ALLOC_DENOMINATOR - maxSlippageBps)) / ALLOC_DENOMINATOR;

        ISwapRouter.ExactInputSingleParams memory params = ISwapRouter.ExactInputSingleParams({
            tokenIn: address(roseToken),
            tokenOut: address(usdc),
            fee: POOL_FEE_STABLE,
            recipient: address(this),
            deadline: block.timestamp,
            amountIn: roseAmount,
            amountOutMinimum: minOut,
            sqrtPriceLimitX96: 0
        });

        return swapRouter.exactInputSingle(params);
    }

    /**
     * @dev Calculate minimum output with slippage protection
     */
    function _calculateMinOut(
        uint256 amountIn,
        address asset,
        bool buyingAsset
    ) internal view returns (uint256) {
        uint256 price;
        uint8 assetDecimals;

        if (asset == address(wbtc)) {
            price = getBTCPrice();
            assetDecimals = WBTC_DECIMALS;
        } else if (asset == address(paxg)) {
            price = getGoldPrice();
            assetDecimals = PAXG_DECIMALS;
        } else {
            revert InvalidPrice();
        }

        uint256 expectedOut;
        if (buyingAsset) {
            expectedOut = (amountIn * (10 ** assetDecimals) * (10 ** CHAINLINK_DECIMALS)) / (price * (10 ** USDC_DECIMALS));
        } else {
            expectedOut = _getAssetValueUSD(amountIn, price, assetDecimals);
        }

        return (expectedOut * (ALLOC_DENOMINATOR - maxSlippageBps)) / ALLOC_DENOMINATOR;
    }

    // ============ Admin Functions ============

    /**
     * @dev Set marketplace address
     */
    function setMarketplace(address _marketplace) external onlyOwner {
        if (_marketplace == address(0)) revert ZeroAddress();
        marketplace = _marketplace;
        roseToken.approve(_marketplace, type(uint256).max);
        emit MarketplaceUpdated(_marketplace);
    }

    /**
     * @dev Spend treasury ROSE (dev payments, task posting, DAO task funding, etc.)
     * Callable by owner or governance contract
     */
    function spendRose(address _to, uint256 _amount, string calldata _reason) external whenNotPaused {
        require(msg.sender == owner() || msg.sender == governance, "Not authorized");
        if (_to == address(0)) revert ZeroAddress();
        uint256 balance = roseToken.balanceOf(address(this));
        if (balance < _amount) revert InsufficientLiquidity();

        roseToken.safeTransfer(_to, _amount);
        emit RoseSpent(_to, _amount, _reason);
    }

    /**
     * @dev Set the governance contract address (owner only)
     * @param _governance The new governance address
     */
    function setGovernance(address _governance) external onlyOwner {
        if (_governance == address(0)) revert ZeroAddress();
        governance = _governance;
        emit GovernanceUpdated(_governance);
    }

    /**
     * @dev Update allocation percentages (must sum to 10000)
     */
    function setAllocation(
        uint256 _btc,
        uint256 _gold,
        uint256 _usdc,
        uint256 _rose
    ) external onlyOwner {
        if (_btc + _gold + _usdc + _rose != ALLOC_DENOMINATOR) revert InvalidAllocation();
        
        allocBTC = _btc;
        allocGold = _gold;
        allocUSDC = _usdc;
        allocROSE = _rose;

        emit AllocationUpdated(_btc, _gold, _usdc, _rose);
    }

    /**
     * @dev Update max slippage
     */
    function setMaxSlippage(uint256 _maxSlippageBps) external onlyOwner {
        maxSlippageBps = _maxSlippageBps;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ============ View Functions ============

    /**
     * @dev Get current vault breakdown
     */
    function getVaultBreakdown() external view returns (
        uint256 btcValue,
        uint256 goldValue,
        uint256 usdcValue,
        uint256 roseValue,
        uint256 totalHardAssets,
        uint256 currentRosePrice,
        uint256 circulatingRose,
        bool rebalanceNeeded
    ) {
        btcValue = _getAssetValueUSD(wbtc.balanceOf(address(this)), getBTCPrice(), WBTC_DECIMALS);
        goldValue = _getAssetValueUSD(paxg.balanceOf(address(this)), getGoldPrice(), PAXG_DECIMALS);
        usdcValue = usdc.balanceOf(address(this));
        roseValue = treasuryRoseValueUSD();
        totalHardAssets = btcValue + goldValue + usdcValue;
        currentRosePrice = rosePrice();
        circulatingRose = circulatingSupply();
        rebalanceNeeded = needsRebalance();
    }

    /**
     * @dev Get allocation percentages and current actuals
     */
    function getAllocationStatus() external view returns (
        uint256 targetBTC,
        uint256 targetGold,
        uint256 targetUSDC,
        uint256 targetROSE,
        uint256 actualBTC,
        uint256 actualGold,
        uint256 actualUSDC,
        uint256 actualROSE
    ) {
        targetBTC = allocBTC;
        targetGold = allocGold;
        targetUSDC = allocUSDC;
        targetROSE = allocROSE;

        uint256 hardAssets = hardAssetValueUSD();
        uint256 roseVal = treasuryRoseValueUSD();
        uint256 total = hardAssets + roseVal;

        if (total > 0) {
            actualBTC = (_getAssetValueUSD(wbtc.balanceOf(address(this)), getBTCPrice(), WBTC_DECIMALS) * ALLOC_DENOMINATOR) / total;
            actualGold = (_getAssetValueUSD(paxg.balanceOf(address(this)), getGoldPrice(), PAXG_DECIMALS) * ALLOC_DENOMINATOR) / total;
            actualUSDC = (usdc.balanceOf(address(this)) * ALLOC_DENOMINATOR) / total;
            actualROSE = (roseVal * ALLOC_DENOMINATOR) / total;
        }
    }

    /**
     * @dev Time until next rebalance is allowed
     */
    function timeUntilRebalance() external view returns (uint256) {
        if (block.timestamp >= lastRebalanceTime + REBALANCE_COOLDOWN) {
            return 0;
        }
        return (lastRebalanceTime + REBALANCE_COOLDOWN) - block.timestamp;
    }

    /**
     * @dev Time until user can deposit again (0 if allowed now)
     */
    function timeUntilDeposit(address user) external view returns (uint256) {
        uint256 nextAllowed = lastDepositTime[user] + USER_COOLDOWN;
        if (block.timestamp >= nextAllowed) return 0;
        return nextAllowed - block.timestamp;
    }

    /**
     * @dev Time until user can redeem again (0 if allowed now)
     */
    function timeUntilRedeem(address user) external view returns (uint256) {
        uint256 nextAllowed = lastRedeemTime[user] + USER_COOLDOWN;
        if (block.timestamp >= nextAllowed) return 0;
        return nextAllowed - block.timestamp;
    }
}

// ============ Interface for RoseToken mint/burn ============
interface IRoseToken {
    function mint(address to, uint256 amount) external;
    function burn(address from, uint256 amount) external;
    function totalSupply() external view returns (uint256);
}
