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
 * @dev Treasury vault that backs ROSE tokens with configurable real-world assets.
 *
 * Assets are registered with bytes32 keys (e.g., "BTC", "GOLD", "STABLE", "ROSE").
 * Each asset has a target allocation in basis points.
 *
 * Users deposit USDC, receive ROSE at current NAV.
 * Treasury automatically diversifies into RWA.
 * Users redeem ROSE for USDC at current NAV.
 *
 * NAV = Hard Assets (all non-ROSE assets) / Circulating ROSE Supply
 * Treasury ROSE is NOT counted in NAV - it's a buyback/spending reserve.
 *
 * Rebalancing:
 * - Threshold-based (5% drift triggers rebalance)
 * - 7-day cooldown between rebalances
 * - Backend orchestrates swaps via LiFi (Phase 3)
 */
contract RoseTreasury is ReentrancyGuard, Ownable, Pausable {
    using SafeERC20 for IERC20;

    // ============ Asset Configuration ============
    struct Asset {
        address token;
        address priceFeed;    // Chainlink feed (address(0) for ROSE - uses NAV)
        uint8 decimals;
        uint256 targetBps;    // Target allocation in basis points
        bool active;
    }

    mapping(bytes32 => Asset) public assets;
    bytes32[] public assetKeys;

    // ============ Core Tokens ============
    IERC20 public immutable roseToken;
    IERC20 public immutable usdc;  // Base currency for deposits/redemptions

    // ============ Special Asset Keys ============
    bytes32 public constant ROSE_KEY = "ROSE";
    bytes32 public constant STABLE_KEY = "STABLE";

    // ============ DEX (Temporary - Phase 3 replaces with LiFi) ============
    ISwapRouter public immutable swapRouter;
    uint24 public constant POOL_FEE_STABLE = 500;   // 0.05% for USDC pairs
    uint24 public constant POOL_FEE_VOLATILE = 3000; // 0.3% for volatile pairs

    // ============ Constants ============
    uint256 public constant ALLOC_DENOMINATOR = 10000;
    uint256 public constant DRIFT_THRESHOLD = 500; // 5% drift triggers rebalance
    uint256 public constant REBALANCE_COOLDOWN = 7 days;
    uint256 public constant USER_COOLDOWN = 24 hours;
    uint256 public constant MAX_ORACLE_STALENESS = 1 hours;
    uint256 public constant MIN_SWAP_AMOUNT = 1e6; // 1 USDC minimum
    uint8 public constant USDC_DECIMALS = 6;
    uint8 public constant CHAINLINK_DECIMALS = 8;

    // ============ State ============
    uint256 public lastRebalanceTime;
    uint256 public maxSlippageBps = 100; // 1% default
    address public marketplace;
    address public governance;
    mapping(address => uint256) public lastDepositTime;
    mapping(address => uint256) public lastRedeemTime;

    // ============ Events ============
    event Deposited(address indexed user, uint256 usdcIn, uint256 roseMinted);
    event Redeemed(address indexed user, uint256 roseBurned, uint256 usdcOut);
    event Rebalanced(uint256 totalHardAssets);
    event AssetAdded(bytes32 indexed key, address token, address priceFeed, uint8 decimals, uint256 targetBps);
    event AssetUpdated(bytes32 indexed key, address token, address priceFeed, uint256 targetBps);
    event AssetDeactivated(bytes32 indexed key);
    event AssetReactivated(bytes32 indexed key);
    event RoseSpent(address indexed to, uint256 amount, string reason);
    event RoseBuyback(uint256 usdcSpent, uint256 roseBought);
    event MarketplaceUpdated(address indexed newMarketplace);
    event GovernanceUpdated(address indexed newGovernance);

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
    error AssetAlreadyExists();
    error AssetNotFound();
    error AssetNotActive();
    error InvalidTargetSum();
    error CannotDeactivateRequired();

    constructor(
        address _roseToken,
        address _usdc,
        address _swapRouter
    ) Ownable(msg.sender) {
        if (_roseToken == address(0) || _usdc == address(0) || _swapRouter == address(0)) {
            revert ZeroAddress();
        }

        roseToken = IERC20(_roseToken);
        usdc = IERC20(_usdc);
        swapRouter = ISwapRouter(_swapRouter);

        // Approve router for swaps
        IERC20(_usdc).approve(_swapRouter, type(uint256).max);
        IERC20(_roseToken).approve(_swapRouter, type(uint256).max);
    }

    // ============ Asset Management ============

    /**
     * @dev Add a new asset to the registry
     * @param key Unique identifier (e.g., "BTC", "GOLD")
     * @param token Token contract address
     * @param priceFeed Chainlink price feed (address(0) for ROSE)
     * @param decimals Token decimals
     * @param targetBps Target allocation in basis points
     */
    function addAsset(
        bytes32 key,
        address token,
        address priceFeed,
        uint8 decimals,
        uint256 targetBps
    ) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        if (assets[key].token != address(0)) revert AssetAlreadyExists();

        assets[key] = Asset({
            token: token,
            priceFeed: priceFeed,
            decimals: decimals,
            targetBps: targetBps,
            active: true
        });

        assetKeys.push(key);

        // Approve router for this asset
        IERC20(token).approve(address(swapRouter), type(uint256).max);

        emit AssetAdded(key, token, priceFeed, decimals, targetBps);
    }

    /**
     * @dev Update asset token address (e.g., swap PAXG for XAUt0)
     * @param key Asset key
     * @param newToken New token address
     */
    function updateAssetToken(bytes32 key, address newToken) external onlyOwner {
        Asset storage asset = assets[key];
        if (asset.token == address(0)) revert AssetNotFound();
        if (newToken == address(0)) revert ZeroAddress();

        // Revoke old approval
        IERC20(asset.token).approve(address(swapRouter), 0);

        asset.token = newToken;

        // Approve new token
        IERC20(newToken).approve(address(swapRouter), type(uint256).max);

        emit AssetUpdated(key, newToken, asset.priceFeed, asset.targetBps);
    }

    /**
     * @dev Update asset price feed
     * @param key Asset key
     * @param newPriceFeed New Chainlink price feed address
     */
    function updateAssetPriceFeed(bytes32 key, address newPriceFeed) external onlyOwner {
        Asset storage asset = assets[key];
        if (asset.token == address(0)) revert AssetNotFound();

        asset.priceFeed = newPriceFeed;

        emit AssetUpdated(key, asset.token, newPriceFeed, asset.targetBps);
    }

    /**
     * @dev Update asset target allocation
     * @param key Asset key
     * @param newTargetBps New target allocation in basis points
     */
    function updateAssetAllocation(bytes32 key, uint256 newTargetBps) external onlyOwner {
        Asset storage asset = assets[key];
        if (asset.token == address(0)) revert AssetNotFound();

        asset.targetBps = newTargetBps;

        emit AssetUpdated(key, asset.token, asset.priceFeed, newTargetBps);
    }

    /**
     * @dev Deactivate an asset (keeps data but excludes from calculations)
     * @param key Asset key
     */
    function deactivateAsset(bytes32 key) external onlyOwner {
        Asset storage asset = assets[key];
        if (asset.token == address(0)) revert AssetNotFound();
        // Cannot deactivate ROSE or STABLE as they are required
        if (key == ROSE_KEY || key == STABLE_KEY) revert CannotDeactivateRequired();

        asset.active = false;

        emit AssetDeactivated(key);
    }

    /**
     * @dev Reactivate a previously deactivated asset
     * @param key Asset key
     */
    function reactivateAsset(bytes32 key) external onlyOwner {
        Asset storage asset = assets[key];
        if (asset.token == address(0)) revert AssetNotFound();

        asset.active = true;

        emit AssetReactivated(key);
    }

    /**
     * @dev Validate that all active asset allocations sum to 10000 bps
     */
    function validateAllocations() public view returns (bool) {
        uint256 total = 0;
        for (uint256 i = 0; i < assetKeys.length; i++) {
            Asset memory asset = assets[assetKeys[i]];
            if (asset.active) {
                total += asset.targetBps;
            }
        }
        return total == ALLOC_DENOMINATOR;
    }

    /**
     * @dev Get all registered assets
     */
    function getAllAssets() external view returns (
        bytes32[] memory keys,
        Asset[] memory assetList
    ) {
        keys = assetKeys;
        assetList = new Asset[](assetKeys.length);
        for (uint256 i = 0; i < assetKeys.length; i++) {
            assetList[i] = assets[assetKeys[i]];
        }
    }

    /**
     * @dev Get count of registered assets
     */
    function getAssetCount() external view returns (uint256) {
        return assetKeys.length;
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
     * Excludes treasury ROSE - only counts non-ROSE assets
     */
    function hardAssetValueUSD() public view returns (uint256) {
        uint256 total = 0;

        for (uint256 i = 0; i < assetKeys.length; i++) {
            bytes32 key = assetKeys[i];
            if (key == ROSE_KEY) continue; // Skip ROSE from hard assets

            Asset memory asset = assets[key];
            if (!asset.active) continue;

            uint256 balance = IERC20(asset.token).balanceOf(address(this));
            if (balance == 0) continue;

            // STABLE (USDC) doesn't need price conversion
            if (key == STABLE_KEY) {
                total += balance;
            } else {
                uint256 price = _getAssetPrice(asset.priceFeed);
                total += _getAssetValueUSD(balance, price, asset.decimals);
            }
        }

        return total;
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

        uint256 roseValue = treasuryRoseValueUSD();
        uint256 totalForAlloc = hardAssets + roseValue;

        for (uint256 i = 0; i < assetKeys.length; i++) {
            bytes32 key = assetKeys[i];
            Asset memory asset = assets[key];
            if (!asset.active) continue;

            uint256 currentValue;
            if (key == ROSE_KEY) {
                currentValue = roseValue;
            } else if (key == STABLE_KEY) {
                currentValue = IERC20(asset.token).balanceOf(address(this));
            } else {
                uint256 balance = IERC20(asset.token).balanceOf(address(this));
                uint256 price = _getAssetPrice(asset.priceFeed);
                currentValue = _getAssetValueUSD(balance, price, asset.decimals);
            }

            uint256 targetValue = (totalForAlloc * asset.targetBps) / ALLOC_DENOMINATOR;

            if (_isDrifted(currentValue, targetValue)) return true;
        }

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
     * @dev Internal rebalance logic - sells overweight assets, buys underweight
     */
    function _executeRebalance() internal {
        uint256 hardAssets = hardAssetValueUSD();
        uint256 roseValue = treasuryRoseValueUSD();
        uint256 totalForAlloc = hardAssets + roseValue;

        // Phase 1: Sell overweight hard assets to USDC
        for (uint256 i = 0; i < assetKeys.length; i++) {
            bytes32 key = assetKeys[i];
            if (key == ROSE_KEY || key == STABLE_KEY) continue;

            Asset memory asset = assets[key];
            if (!asset.active) continue;

            uint256 balance = IERC20(asset.token).balanceOf(address(this));
            if (balance == 0) continue;

            uint256 price = _getAssetPrice(asset.priceFeed);
            uint256 currentValue = _getAssetValueUSD(balance, price, asset.decimals);
            uint256 targetValue = (totalForAlloc * asset.targetBps) / ALLOC_DENOMINATOR;

            if (currentValue > targetValue) {
                uint256 diff = currentValue - targetValue;
                uint256 toSell = (balance * diff) / currentValue;
                if (toSell > 0) _swapAssetToUSDC(asset.token, toSell, asset.priceFeed, asset.decimals);
            }
        }

        // Phase 2: Sell overweight ROSE to USDC
        Asset memory roseAsset = assets[ROSE_KEY];
        if (roseAsset.active && roseValue > 0) {
            uint256 targetROSE = (totalForAlloc * roseAsset.targetBps) / ALLOC_DENOMINATOR;
            if (roseValue > targetROSE) {
                uint256 diff = roseValue - targetROSE;
                uint256 roseToSell = (roseToken.balanceOf(address(this)) * diff) / roseValue;
                if (roseToSell >= MIN_SWAP_AMOUNT) {
                    _swapROSEToUSDC(roseToSell);
                }
            }
        }

        // Refresh values after sells
        uint256 currentUSDC = usdc.balanceOf(address(this));
        Asset memory stableAsset = assets[STABLE_KEY];
        uint256 targetUSDC = (totalForAlloc * stableAsset.targetBps) / ALLOC_DENOMINATOR;
        uint256 minBuffer = (totalForAlloc * 500) / ALLOC_DENOMINATOR; // 5% min buffer

        // Phase 3: Buy underweight assets with excess USDC
        if (currentUSDC > targetUSDC && currentUSDC > minBuffer) {
            uint256 excess = currentUSDC - targetUSDC;
            uint256 maxSpend = currentUSDC - minBuffer;
            if (excess > maxSpend) excess = maxSpend;

            // Calculate total deficit
            uint256 totalDeficit = 0;
            for (uint256 i = 0; i < assetKeys.length; i++) {
                bytes32 key = assetKeys[i];
                if (key == STABLE_KEY) continue;

                Asset memory asset = assets[key];
                if (!asset.active) continue;

                uint256 currentValue;
                if (key == ROSE_KEY) {
                    currentValue = treasuryRoseValueUSD();
                } else {
                    uint256 balance = IERC20(asset.token).balanceOf(address(this));
                    uint256 price = _getAssetPrice(asset.priceFeed);
                    currentValue = _getAssetValueUSD(balance, price, asset.decimals);
                }

                uint256 targetValue = (totalForAlloc * asset.targetBps) / ALLOC_DENOMINATOR;
                if (targetValue > currentValue) {
                    totalDeficit += targetValue - currentValue;
                }
            }

            // Buy underweight assets proportionally
            if (totalDeficit > 0 && excess > 0) {
                for (uint256 i = 0; i < assetKeys.length; i++) {
                    bytes32 key = assetKeys[i];
                    if (key == STABLE_KEY) continue;

                    Asset memory asset = assets[key];
                    if (!asset.active) continue;

                    uint256 currentValue;
                    if (key == ROSE_KEY) {
                        currentValue = treasuryRoseValueUSD();
                    } else {
                        uint256 balance = IERC20(asset.token).balanceOf(address(this));
                        uint256 price = _getAssetPrice(asset.priceFeed);
                        currentValue = _getAssetValueUSD(balance, price, asset.decimals);
                    }

                    uint256 targetValue = (totalForAlloc * asset.targetBps) / ALLOC_DENOMINATOR;
                    if (targetValue > currentValue) {
                        uint256 deficit = targetValue - currentValue;
                        uint256 buyAmount = (excess * deficit) / totalDeficit;

                        if (buyAmount >= MIN_SWAP_AMOUNT) {
                            if (key == ROSE_KEY) {
                                uint256 roseBought = _swapUSDCToROSE(buyAmount);
                                emit RoseBuyback(buyAmount, roseBought);
                            } else {
                                _swapUSDCToAsset(asset.token, buyAmount, asset.priceFeed, asset.decimals);
                            }
                        }
                    }
                }
            }
        }

        emit Rebalanced(hardAssetValueUSD());
    }

    // ============ Price Functions ============

    /**
     * @dev Get price from Chainlink feed with staleness check
     */
    function _getAssetPrice(address priceFeed) internal view returns (uint256) {
        if (priceFeed == address(0)) revert InvalidPrice();

        (, int256 price, , uint256 updatedAt, ) = AggregatorV3Interface(priceFeed).latestRoundData();
        if (price <= 0) revert InvalidPrice();
        if (block.timestamp - updatedAt > MAX_ORACLE_STALENESS) revert StaleOracle();

        return uint256(price);
    }

    /**
     * @dev Get price for an asset by key (public view function)
     */
    function getAssetPrice(bytes32 key) external view returns (uint256) {
        Asset memory asset = assets[key];
        if (asset.token == address(0)) revert AssetNotFound();
        if (key == ROSE_KEY) return rosePrice();
        if (key == STABLE_KEY) return 1e8; // $1.00 in Chainlink decimals
        return _getAssetPrice(asset.priceFeed);
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
     * Note: Does NOT buy ROSE - that's handled by rebalance() buybacks.
     */
    function _diversify(uint256 usdcAmount) internal {
        if (usdcAmount == 0) return;

        // Get total hard allocation excluding ROSE
        uint256 hardAllocTotal = 0;
        for (uint256 i = 0; i < assetKeys.length; i++) {
            bytes32 key = assetKeys[i];
            if (key == ROSE_KEY) continue;
            Asset memory asset = assets[key];
            if (asset.active) hardAllocTotal += asset.targetBps;
        }

        if (hardAllocTotal == 0) return;

        // Check if this is first deposit (no RWA held yet)
        bool isFirstDeposit = true;
        for (uint256 i = 0; i < assetKeys.length; i++) {
            bytes32 key = assetKeys[i];
            if (key == ROSE_KEY || key == STABLE_KEY) continue;
            Asset memory asset = assets[key];
            if (asset.active && IERC20(asset.token).balanceOf(address(this)) > 0) {
                isFirstDeposit = false;
                break;
            }
        }

        if (isFirstDeposit) {
            _diversifyByRatio(usdcAmount, hardAllocTotal);
            return;
        }

        // Smart diversification based on current holdings
        uint256 usdcBal = usdc.balanceOf(address(this));
        uint256 preDepositUSDC = usdcBal - usdcAmount;

        // Calculate current hard asset total
        uint256 currentHardTotal = 0;
        for (uint256 i = 0; i < assetKeys.length; i++) {
            bytes32 key = assetKeys[i];
            if (key == ROSE_KEY) continue;
            Asset memory asset = assets[key];
            if (!asset.active) continue;

            if (key == STABLE_KEY) {
                currentHardTotal += usdcBal;
            } else {
                uint256 balance = IERC20(asset.token).balanceOf(address(this));
                if (balance > 0) {
                    uint256 price = _getAssetPrice(asset.priceFeed);
                    currentHardTotal += _getAssetValueUSD(balance, price, asset.decimals);
                }
            }
        }

        // Calculate target USDC based on allocation
        Asset memory stableAsset = assets[STABLE_KEY];
        uint256 targetUSDC = (currentHardTotal * stableAsset.targetBps) / hardAllocTotal;
        uint256 deficitUSDC = targetUSDC > preDepositUSDC ? targetUSDC - preDepositUSDC : 0;

        uint256 remaining = usdcAmount;

        // Phase 1: Fill USDC buffer first
        if (deficitUSDC > 0 && remaining > 0) {
            uint256 toUSDC = remaining < deficitUSDC ? remaining : deficitUSDC;
            remaining -= toUSDC;
        }

        // Phase 2: Fill RWA deficits proportionally
        if (remaining > 0) {
            uint256 totalRWADeficit = 0;

            // Calculate RWA deficits
            for (uint256 i = 0; i < assetKeys.length; i++) {
                bytes32 key = assetKeys[i];
                if (key == ROSE_KEY || key == STABLE_KEY) continue;
                Asset memory asset = assets[key];
                if (!asset.active) continue;

                uint256 balance = IERC20(asset.token).balanceOf(address(this));
                uint256 currentValue = 0;
                if (balance > 0) {
                    uint256 price = _getAssetPrice(asset.priceFeed);
                    currentValue = _getAssetValueUSD(balance, price, asset.decimals);
                }

                uint256 targetValue = (currentHardTotal * asset.targetBps) / hardAllocTotal;
                if (targetValue > currentValue) {
                    totalRWADeficit += targetValue - currentValue;
                }
            }

            if (totalRWADeficit > 0) {
                uint256 toSpend = remaining < totalRWADeficit ? remaining : totalRWADeficit;

                for (uint256 i = 0; i < assetKeys.length; i++) {
                    bytes32 key = assetKeys[i];
                    if (key == ROSE_KEY || key == STABLE_KEY) continue;
                    Asset memory asset = assets[key];
                    if (!asset.active) continue;

                    uint256 balance = IERC20(asset.token).balanceOf(address(this));
                    uint256 currentValue = 0;
                    if (balance > 0) {
                        uint256 price = _getAssetPrice(asset.priceFeed);
                        currentValue = _getAssetValueUSD(balance, price, asset.decimals);
                    }

                    uint256 targetValue = (currentHardTotal * asset.targetBps) / hardAllocTotal;
                    if (targetValue > currentValue) {
                        uint256 deficit = targetValue - currentValue;
                        uint256 spendAmount = (toSpend * deficit) / totalRWADeficit;
                        if (spendAmount >= MIN_SWAP_AMOUNT) {
                            _swapUSDCToAsset(asset.token, spendAmount, asset.priceFeed, asset.decimals);
                        }
                    }
                }

                remaining -= toSpend;
            }
        }

        // Phase 3: Excess goes to RWA by ratio
        if (remaining > 0) {
            _diversifyByRatio(remaining, hardAllocTotal);
        }
    }

    /**
     * @dev Simple diversification using target ratios (for first deposit or excess)
     */
    function _diversifyByRatio(uint256 usdcAmount, uint256 hardAllocTotal) internal {
        for (uint256 i = 0; i < assetKeys.length; i++) {
            bytes32 key = assetKeys[i];
            if (key == ROSE_KEY || key == STABLE_KEY) continue;

            Asset memory asset = assets[key];
            if (!asset.active) continue;

            uint256 buyAmount = (usdcAmount * asset.targetBps) / hardAllocTotal;
            if (buyAmount >= MIN_SWAP_AMOUNT) {
                _swapUSDCToAsset(asset.token, buyAmount, asset.priceFeed, asset.decimals);
            }
        }
    }

    /**
     * @dev Liquidate RWA to USDC for redemptions
     */
    function _liquidateForRedemption(uint256 usdcNeeded) internal {
        uint256 hardAssets = hardAssetValueUSD();
        uint256 usdcBalance = usdc.balanceOf(address(this));
        uint256 rwaValue = hardAssets - usdcBalance;

        if (rwaValue == 0) revert InsufficientLiquidity();

        // Liquidate proportionally from each RWA asset
        for (uint256 i = 0; i < assetKeys.length; i++) {
            bytes32 key = assetKeys[i];
            if (key == ROSE_KEY || key == STABLE_KEY) continue;

            Asset memory asset = assets[key];
            if (!asset.active) continue;

            uint256 balance = IERC20(asset.token).balanceOf(address(this));
            if (balance == 0) continue;

            // Ceiling division to ensure we sell enough
            uint256 toSell = (balance * usdcNeeded + rwaValue - 1) / rwaValue;
            if (toSell > balance) toSell = balance;

            if (toSell > 0) {
                _swapAssetToUSDC(asset.token, toSell, asset.priceFeed, asset.decimals);
            }
        }
    }

    /**
     * @dev Swap USDC to asset via Uniswap
     */
    function _swapUSDCToAsset(address assetToken, uint256 usdcAmount, address priceFeed, uint8 assetDecimals) internal {
        uint256 minOut = _calculateMinOut(usdcAmount, priceFeed, assetDecimals, true);

        ISwapRouter.ExactInputSingleParams memory params = ISwapRouter.ExactInputSingleParams({
            tokenIn: address(usdc),
            tokenOut: assetToken,
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
    function _swapAssetToUSDC(address assetToken, uint256 assetAmount, address priceFeed, uint8 assetDecimals) internal {
        uint256 minOut = _calculateMinOut(assetAmount, priceFeed, assetDecimals, false);

        ISwapRouter.ExactInputSingleParams memory params = ISwapRouter.ExactInputSingleParams({
            tokenIn: assetToken,
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
        address priceFeed,
        uint8 assetDecimals,
        bool buyingAsset
    ) internal view returns (uint256) {
        uint256 price = _getAssetPrice(priceFeed);

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
     */
    function setGovernance(address _governance) external onlyOwner {
        if (_governance == address(0)) revert ZeroAddress();
        governance = _governance;
        emit GovernanceUpdated(_governance);
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
     * @dev Get current vault breakdown (dynamic based on registered assets)
     */
    function getVaultBreakdown() external view returns (
        uint256 totalHardAssets,
        uint256 currentRosePrice,
        uint256 circulatingRose,
        bool rebalanceNeeded
    ) {
        totalHardAssets = hardAssetValueUSD();
        currentRosePrice = rosePrice();
        circulatingRose = circulatingSupply();
        rebalanceNeeded = needsRebalance();
    }

    /**
     * @dev Get detailed breakdown of each asset
     */
    function getAssetBreakdown(bytes32 key) external view returns (
        address token,
        uint256 balance,
        uint256 valueUSD,
        uint256 targetBps,
        uint256 actualBps,
        bool active
    ) {
        Asset memory asset = assets[key];
        if (asset.token == address(0)) revert AssetNotFound();

        token = asset.token;
        balance = IERC20(asset.token).balanceOf(address(this));
        targetBps = asset.targetBps;
        active = asset.active;

        if (key == ROSE_KEY) {
            valueUSD = treasuryRoseValueUSD();
        } else if (key == STABLE_KEY) {
            valueUSD = balance;
        } else {
            uint256 price = _getAssetPrice(asset.priceFeed);
            valueUSD = _getAssetValueUSD(balance, price, asset.decimals);
        }

        uint256 total = hardAssetValueUSD() + treasuryRoseValueUSD();
        actualBps = total > 0 ? (valueUSD * ALLOC_DENOMINATOR) / total : 0;
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
