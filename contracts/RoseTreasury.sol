// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

/**
 * @title RoseTreasury
 * @dev Treasury vault that backs ROSE tokens with configurable real-world assets.
 *
 * Assets are registered with bytes32 keys (e.g., "BTC", "GOLD", "STABLE", "ROSE").
 * Each asset has a target allocation in basis points.
 *
 * Users deposit USDC, receive ROSE at current NAV.
 * Backend watches Deposited events and diversifies via LiFi.
 * Users redeem ROSE for USDC at current NAV (requires sufficient USDC buffer).
 *
 * NAV = Hard Assets (all non-ROSE assets) / Circulating ROSE Supply
 * Treasury ROSE is NOT counted in NAV - it's a buyback/spending reserve.
 *
 * Swap Routing:
 * - All swaps executed via LiFi Diamond with backend-generated calldata
 * - executeSwap() called by rebalancer role (backend signer)
 * - Contract is "dumb" (safety rails only), backend is "smart" (routing)
 *
 * Rebalancing:
 * - Threshold-based (5% drift triggers rebalance)
 * - 7-day cooldown between rebalances
 * - Backend orchestrates multi-swap rebalances via executeSwap()
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

    // ============ LiFi Integration ============
    address public immutable lifiDiamond;
    address public rebalancer;

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
    event SwapExecuted(bytes32 indexed fromAsset, bytes32 indexed toAsset, uint256 amountIn, uint256 amountOut);
    event RebalancerUpdated(address indexed newRebalancer);

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
    error NotRebalancer();
    error LiFiSwapFailed();

    // ============ Modifiers ============
    modifier onlyRebalancer() {
        if (msg.sender != rebalancer && msg.sender != owner()) revert NotRebalancer();
        _;
    }

    constructor(
        address _roseToken,
        address _usdc,
        address _lifiDiamond
    ) Ownable(msg.sender) {
        if (_roseToken == address(0) || _usdc == address(0) || _lifiDiamond == address(0)) {
            revert ZeroAddress();
        }

        roseToken = IERC20(_roseToken);
        usdc = IERC20(_usdc);
        lifiDiamond = _lifiDiamond;

        // Approve LiFi Diamond for base tokens
        IERC20(_usdc).approve(_lifiDiamond, type(uint256).max);
        IERC20(_roseToken).approve(_lifiDiamond, type(uint256).max);
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

        // Approve LiFi Diamond for this asset
        IERC20(token).approve(lifiDiamond, type(uint256).max);

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
        IERC20(asset.token).approve(lifiDiamond, 0);

        asset.token = newToken;

        // Approve new token for LiFi
        IERC20(newToken).approve(lifiDiamond, type(uint256).max);

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
     * Note: Backend watches Deposited events and diversifies via LiFi
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

        // NO _diversify() - backend handles via Deposited event + executeSwap()

        lastDepositTime[msg.sender] = block.timestamp;
        emit Deposited(msg.sender, usdcAmount, roseToMint);
    }

    /**
     * @dev Redeem ROSE for USDC at current NAV
     * 24hr cooldown between redemptions (owner exempt)
     * Note: Requires sufficient USDC buffer. Backend maintains buffer via rebalancing.
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

        // Check USDC buffer - backend is responsible for maintaining liquidity
        uint256 usdcBalance = usdc.balanceOf(address(this));
        if (usdcBalance < usdcOwed) revert InsufficientLiquidity();

        IRoseToken(address(roseToken)).burn(msg.sender, roseAmount);
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
     * @dev Check if rebalance is needed (any hard asset >5% off target)
     * Note: ROSE is excluded from drift calculations since treasury doesn't hold ROSE
     * (ROSE is minted to users on deposit, burned on redemption)
     */
    function needsRebalance() public view returns (bool) {
        uint256 hardAssets = hardAssetValueUSD();
        if (hardAssets == 0) return false;

        // For drift calculations, we only consider hard assets (BTC, GOLD, STABLE)
        // ROSE is excluded since treasury mints/burns rather than holds it
        for (uint256 i = 0; i < assetKeys.length; i++) {
            bytes32 key = assetKeys[i];
            if (key == ROSE_KEY) continue; // Skip ROSE - treasury doesn't hold it

            Asset memory asset = assets[key];
            if (!asset.active) continue;

            uint256 currentValue;
            if (key == STABLE_KEY) {
                currentValue = IERC20(asset.token).balanceOf(address(this));
            } else {
                uint256 balance = IERC20(asset.token).balanceOf(address(this));
                uint256 price = _getAssetPrice(asset.priceFeed);
                currentValue = _getAssetValueUSD(balance, price, asset.decimals);
            }

            // Calculate target based on hard assets only (since ROSE is excluded)
            // Rescale target: if BTC is 30% of total and ROSE is 20%, BTC is 30/80 = 37.5% of hard assets
            uint256 hardAssetTargetBps = (asset.targetBps * ALLOC_DENOMINATOR) / (ALLOC_DENOMINATOR - assets[ROSE_KEY].targetBps);
            uint256 targetValue = (hardAssets * hardAssetTargetBps) / ALLOC_DENOMINATOR;

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
     * @dev Permissionless rebalance check - anyone can call if threshold met and cooldown passed
     * Note: This only updates the timestamp. Backend handles actual swaps via executeSwap().
     */
    function rebalance() external nonReentrant whenNotPaused {
        if (!needsRebalance()) revert RebalanceNotNeeded();
        if (block.timestamp < lastRebalanceTime + REBALANCE_COOLDOWN) revert RebalanceCooldown();

        lastRebalanceTime = block.timestamp;
        emit Rebalanced(hardAssetValueUSD());
    }

    /**
     * @dev Force rebalance (owner/rebalancer only, bypasses cooldown and threshold)
     * Note: This only updates the timestamp. Backend handles actual swaps via executeSwap().
     */
    function forceRebalance() external onlyRebalancer whenNotPaused {
        lastRebalanceTime = block.timestamp;
        emit Rebalanced(hardAssetValueUSD());
    }

    // ============ LiFi Swap Functions ============

    /**
     * @dev Execute a swap via LiFi Diamond
     * Backend generates lifiData using LiFi SDK with optimal routing
     * @param fromAsset Source asset key (e.g., "STABLE", "BTC")
     * @param toAsset Destination asset key
     * @param amountIn Amount of source token to swap
     * @param minAmountOut Minimum acceptable output (slippage protection)
     * @param lifiData Calldata for LiFi Diamond (generated by backend)
     */
    function executeSwap(
        bytes32 fromAsset,
        bytes32 toAsset,
        uint256 amountIn,
        uint256 minAmountOut,
        bytes calldata lifiData
    ) external onlyRebalancer nonReentrant whenNotPaused {
        Asset memory from = assets[fromAsset];
        Asset memory to = assets[toAsset];

        if (from.token == address(0)) revert AssetNotFound();
        if (to.token == address(0)) revert AssetNotFound();
        if (!from.active) revert AssetNotActive();
        if (!to.active) revert AssetNotActive();
        if (amountIn == 0) revert ZeroAmount();

        uint256 balBefore = IERC20(to.token).balanceOf(address(this));

        // Execute swap via LiFi Diamond
        // Note: Approval already granted in addAsset() / constructor
        (bool success, ) = lifiDiamond.call(lifiData);
        if (!success) revert LiFiSwapFailed();

        uint256 received = IERC20(to.token).balanceOf(address(this)) - balBefore;
        if (received < minAmountOut) revert SlippageExceeded();

        emit SwapExecuted(fromAsset, toAsset, amountIn, received);
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

    // ============ Admin Functions ============

    /**
     * @dev Set rebalancer address (backend signer that can call executeSwap)
     */
    function setRebalancer(address _rebalancer) external onlyOwner {
        if (_rebalancer == address(0)) revert ZeroAddress();
        rebalancer = _rebalancer;
        emit RebalancerUpdated(_rebalancer);
    }

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
