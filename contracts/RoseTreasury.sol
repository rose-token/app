// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";

/**
 * @title RoseTreasury
 * @dev Treasury vault that backs ROSE tokens with real-world assets (BTC, rETH, Gold, USDC).
 *
 * Users deposit USDC, receive ROSE at current vault price.
 * Treasury automatically diversifies into RWA.
 * Users redeem ROSE for USDC at current vault price.
 *
 * ROSE price = total vault USD value / ROSE supply
 */
contract RoseTreasury is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // ============ Tokens ============
    IERC20 public immutable roseToken;
    IERC20 public immutable usdc;
    IERC20 public immutable wbtc;
    IERC20 public immutable reth; // Rocket Pool ETH
    IERC20 public immutable paxg; // Pax Gold

    // ============ Chainlink Price Feeds ============
    AggregatorV3Interface public immutable btcUsdFeed;
    AggregatorV3Interface public immutable ethUsdFeed;
    AggregatorV3Interface public immutable xauUsdFeed; // Gold

    // ============ DEX ============
    ISwapRouter public immutable swapRouter;
    uint24 public constant POOL_FEE = 3000; // 0.3%

    // ============ Allocation Targets (basis points, 10000 = 100%) ============
    uint256 public allocBTC = 4000;  // 40%
    uint256 public allocETH = 3000;  // 30%
    uint256 public allocGold = 2000; // 20%
    uint256 public allocUSDC = 1000; // 10% buffer
    uint256 public constant ALLOC_DENOMINATOR = 10000;

    // ============ Decimals ============
    uint8 public constant USDC_DECIMALS = 6;
    uint8 public constant WBTC_DECIMALS = 8;
    uint8 public constant RETH_DECIMALS = 18;
    uint8 public constant PAXG_DECIMALS = 18;
    uint8 public constant ROSE_DECIMALS = 18;
    uint8 public constant CHAINLINK_DECIMALS = 8;

    // ============ Slippage Protection ============
    uint256 public maxSlippageBps = 100; // 1% default

    // ============ Oracle Staleness ============
    uint256 public constant MAX_ORACLE_STALENESS = 1 hours;

    // ============ Marketplace Integration ============
    address public marketplace;

    // ============ Events ============
    event Deposited(address indexed user, uint256 usdcIn, uint256 roseMinted);
    event Redeemed(address indexed user, uint256 roseBurned, uint256 usdcOut);
    event Rebalanced(
        uint256 btcValue,
        uint256 ethValue,
        uint256 goldValue,
        uint256 usdcValue,
        uint256 treasuryRoseBalance
    );
    event AllocationUpdated(uint256 btc, uint256 eth, uint256 gold, uint256 usdc);
    event RoseSpent(address indexed to, uint256 amount, string reason);
    event MarketplaceUpdated(address indexed newMarketplace);

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

    constructor(
        address _roseToken,
        address _usdc,
        address _wbtc,
        address _reth,
        address _paxg,
        address _btcUsdFeed,
        address _ethUsdFeed,
        address _xauUsdFeed,
        address _swapRouter
    ) Ownable(msg.sender) {
        roseToken = IERC20(_roseToken);
        usdc = IERC20(_usdc);
        wbtc = IERC20(_wbtc);
        reth = IERC20(_reth);
        paxg = IERC20(_paxg);

        btcUsdFeed = AggregatorV3Interface(_btcUsdFeed);
        ethUsdFeed = AggregatorV3Interface(_ethUsdFeed);
        xauUsdFeed = AggregatorV3Interface(_xauUsdFeed);

        swapRouter = ISwapRouter(_swapRouter);

        // Approve router for swaps
        IERC20(_usdc).approve(_swapRouter, type(uint256).max);
        IERC20(_wbtc).approve(_swapRouter, type(uint256).max);
        IERC20(_reth).approve(_swapRouter, type(uint256).max);
        IERC20(_paxg).approve(_swapRouter, type(uint256).max);
    }

    // ============ Core Functions ============

    /**
     * @dev Deposit USDC, receive ROSE at current vault price
     * @param usdcAmount Amount of USDC to deposit (6 decimals)
     */
    function deposit(uint256 usdcAmount) external nonReentrant {
        if (usdcAmount == 0) revert ZeroAmount();
        if (usdc.balanceOf(msg.sender) < usdcAmount) revert InsufficientBalance();

        // Calculate ROSE to mint BEFORE transferring USDC
        // This ensures price is based on vault value before the deposit
        uint256 roseToMint = calculateRoseForDeposit(usdcAmount);

        // Transfer USDC from user
        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);

        // Mint ROSE to user
        IRoseToken(address(roseToken)).mint(msg.sender, roseToMint);

        // Diversify into RWA
        _diversify(usdcAmount);

        emit Deposited(msg.sender, usdcAmount, roseToMint);
    }

    /**
     * @dev Redeem ROSE for USDC at current vault price
     * @param roseAmount Amount of ROSE to redeem (18 decimals)
     */
    function redeem(uint256 roseAmount) external nonReentrant {
        if (roseAmount == 0) revert ZeroAmount();

        // Calculate USDC owed
        uint256 usdcOwed = calculateUsdcForRedemption(roseAmount);

        // Burn ROSE from user
        IRoseToken(address(roseToken)).burn(msg.sender, roseAmount);

        // Ensure enough USDC liquidity
        uint256 usdcBalance = usdc.balanceOf(address(this));
        if (usdcBalance < usdcOwed) {
            _liquidateForRedemption(usdcOwed - usdcBalance);
        }

        // Transfer USDC to user
        usdc.safeTransfer(msg.sender, usdcOwed);

        emit Redeemed(msg.sender, roseAmount, usdcOwed);
    }

    // ============ Pricing Functions ============

    /**
     * @dev Get total vault value in USD (6 decimals to match USDC)
     */
    function vaultValueUSD() public view returns (uint256) {
        uint256 btcValue = _getAssetValueUSD(
            wbtc.balanceOf(address(this)),
            getBTCPrice(),
            WBTC_DECIMALS
        );

        uint256 ethValue = _getAssetValueUSD(
            reth.balanceOf(address(this)),
            getETHPrice(),
            RETH_DECIMALS
        );

        uint256 goldValue = _getAssetValueUSD(
            paxg.balanceOf(address(this)),
            getGoldPrice(),
            PAXG_DECIMALS
        );

        uint256 usdcValue = usdc.balanceOf(address(this));

        return btcValue + ethValue + goldValue + usdcValue;
    }

    /**
     * @dev Get current ROSE price in USD (6 decimals)
     * Uses circulating supply (excludes treasury-held ROSE)
     */
    function rosePrice() public view returns (uint256) {
        uint256 circulating = circulatingSupply();
        if (circulating == 0) {
            return 1e6; // $1.00 initial price
        }
        
        // vaultValueUSD is 6 decimals, circulating is 18 decimals
        // Result should be 6 decimals
        return (vaultValueUSD() * 1e18) / circulating;
    }

    /**
     * @dev Get circulating supply (total supply minus treasury-held ROSE)
     */
    function circulatingSupply() public view returns (uint256) {
        uint256 total = roseToken.totalSupply();

        // If no tokens exist, return 0 to trigger initial price in rosePrice()
        if (total == 0) return 0;

        uint256 treasuryHeld = roseToken.balanceOf(address(this));

        // Safety check: if treasury somehow holds more than total (shouldn't happen)
        if (treasuryHeld >= total) return 1; // Avoid division by zero

        return total - treasuryHeld;
    }

    /**
     * @dev Get treasury's ROSE balance
     */
    function treasuryRoseBalance() public view returns (uint256) {
        return roseToken.balanceOf(address(this));
    }

    /**
     * @dev Calculate ROSE to mint for a USDC deposit
     */
    function calculateRoseForDeposit(uint256 usdcAmount) public view returns (uint256) {
        uint256 currentPrice = rosePrice();
        // usdcAmount is 6 decimals, currentPrice is 6 decimals
        // Result should be 18 decimals
        return (usdcAmount * 1e18) / currentPrice;
    }

    /**
     * @dev Calculate USDC to return for ROSE redemption
     */
    function calculateUsdcForRedemption(uint256 roseAmount) public view returns (uint256) {
        uint256 currentPrice = rosePrice();
        // roseAmount is 18 decimals, currentPrice is 6 decimals
        // Result should be 6 decimals
        return (roseAmount * currentPrice) / 1e18;
    }

    // ============ Price Feed Functions ============

    function getBTCPrice() public view returns (uint256) {
        (, int256 price, , uint256 updatedAt, ) = btcUsdFeed.latestRoundData();
        if (price <= 0) revert InvalidPrice();
        if (block.timestamp - updatedAt > MAX_ORACLE_STALENESS) revert StaleOracle();
        return uint256(price);
    }

    function getETHPrice() public view returns (uint256) {
        (, int256 price, , uint256 updatedAt, ) = ethUsdFeed.latestRoundData();
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
     * Uses intermediate scaling to prevent overflow on large balances
     */
    function _getAssetValueUSD(
        uint256 balance,
        uint256 priceUSD, // 8 decimals from Chainlink
        uint8 assetDecimals
    ) internal pure returns (uint256) {
        // Scale down large balances first to prevent overflow
        // Max safe value before overflow: 2^256 / (balance * price)
        
        if (assetDecimals >= 18) {
            // For 18 decimal assets (ETH, PAXG): scale down first
            // balance (18 dec) / 1e12 = balance (6 dec)
            // then multiply by price (8 dec), divide by 1e8
            uint256 scaledBalance = balance / 1e12;
            return (scaledBalance * priceUSD) / (10 ** CHAINLINK_DECIMALS);
        } else {
            // For 8 decimal assets (WBTC): direct calculation is safe
            // balance (8 dec) * price (8 dec) / 1e10 = value (6 dec)
            return (balance * priceUSD) / (10 ** (assetDecimals + CHAINLINK_DECIMALS - USDC_DECIMALS));
        }
    }

    /**
     * @dev Diversify deposited USDC into RWA according to allocation
     */
    function _diversify(uint256 usdcAmount) internal {
        uint256 toBTC = (usdcAmount * allocBTC) / ALLOC_DENOMINATOR;
        uint256 toETH = (usdcAmount * allocETH) / ALLOC_DENOMINATOR;
        uint256 toGold = (usdcAmount * allocGold) / ALLOC_DENOMINATOR;
        // Rest stays as USDC buffer

        if (toBTC > 0) _swapUSDCToAsset(address(wbtc), toBTC);
        if (toETH > 0) _swapUSDCToAsset(address(reth), toETH);
        if (toGold > 0) _swapUSDCToAsset(address(paxg), toGold);
    }

    /**
     * @dev Liquidate RWA to USDC for redemptions
     */
    function _liquidateForRedemption(uint256 usdcNeeded) internal {
        // Liquidate proportionally from each asset
        uint256 vaultTotal = vaultValueUSD();
        uint256 usdcBalance = usdc.balanceOf(address(this));
        uint256 rwaValue = vaultTotal - usdcBalance;

        if (rwaValue == 0) revert InsufficientLiquidity();

        // Calculate how much to sell from each
        uint256 btcValue = _getAssetValueUSD(wbtc.balanceOf(address(this)), getBTCPrice(), WBTC_DECIMALS);
        uint256 ethValue = _getAssetValueUSD(reth.balanceOf(address(this)), getETHPrice(), RETH_DECIMALS);
        uint256 goldValue = _getAssetValueUSD(paxg.balanceOf(address(this)), getGoldPrice(), PAXG_DECIMALS);

        if (btcValue > 0) {
            uint256 btcToSell = (wbtc.balanceOf(address(this)) * usdcNeeded) / rwaValue;
            if (btcToSell > 0) _swapAssetToUSDC(address(wbtc), btcToSell);
        }

        if (ethValue > 0) {
            uint256 ethToSell = (reth.balanceOf(address(this)) * usdcNeeded) / rwaValue;
            if (ethToSell > 0) _swapAssetToUSDC(address(reth), ethToSell);
        }

        if (goldValue > 0) {
            uint256 goldToSell = (paxg.balanceOf(address(this)) * usdcNeeded) / rwaValue;
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
            fee: POOL_FEE,
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
            fee: POOL_FEE,
            recipient: address(this),
            deadline: block.timestamp,
            amountIn: assetAmount,
            amountOutMinimum: minOut,
            sqrtPriceLimitX96: 0
        });

        swapRouter.exactInputSingle(params);
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
        } else if (asset == address(reth)) {
            price = getETHPrice();
            assetDecimals = RETH_DECIMALS;
        } else if (asset == address(paxg)) {
            price = getGoldPrice();
            assetDecimals = PAXG_DECIMALS;
        } else {
            revert InvalidPrice();
        }

        uint256 expectedOut;
        if (buyingAsset) {
            // USDC -> Asset
            // amountIn (6 decimals) * 10^assetDecimals / price (8 decimals)
            expectedOut = (amountIn * (10 ** assetDecimals) * (10 ** CHAINLINK_DECIMALS)) / (price * (10 ** USDC_DECIMALS));
        } else {
            // Asset -> USDC
            expectedOut = _getAssetValueUSD(amountIn, price, assetDecimals);
        }

        // Apply slippage
        return (expectedOut * (ALLOC_DENOMINATOR - maxSlippageBps)) / ALLOC_DENOMINATOR;
    }

    // ============ Admin Functions ============

    /**
     * @dev Set marketplace address for task posting
     */
    function setMarketplace(address _marketplace) external onlyOwner {
        if (_marketplace == address(0)) revert ZeroAddress();
        marketplace = _marketplace;
        
        // Approve marketplace to pull ROSE for task creation
        roseToken.approve(_marketplace, type(uint256).max);
        
        emit MarketplaceUpdated(_marketplace);
    }

    /**
     * @dev Spend treasury ROSE (e.g., to post tasks on marketplace)
     * @param _to Recipient address
     * @param _amount Amount of ROSE to send
     * @param _reason Description of spend (for logging)
     */
    function spendRose(address _to, uint256 _amount, string calldata _reason) external onlyOwner {
        if (_to == address(0)) revert ZeroAddress();
        uint256 balance = roseToken.balanceOf(address(this));
        if (balance < _amount) revert InsufficientLiquidity();
        
        roseToken.safeTransfer(_to, _amount);
        
        emit RoseSpent(_to, _amount, _reason);
    }

    /**
     * @dev Update allocation percentages (must sum to 10000)
     */
    function setAllocation(
        uint256 _btc,
        uint256 _eth,
        uint256 _gold,
        uint256 _usdc
    ) external onlyOwner {
        if (_btc + _eth + _gold + _usdc != ALLOC_DENOMINATOR) revert InvalidAllocation();
        
        allocBTC = _btc;
        allocETH = _eth;
        allocGold = _gold;
        allocUSDC = _usdc;

        emit AllocationUpdated(_btc, _eth, _gold, _usdc);
    }

    /**
     * @dev Update max slippage (in basis points)
     */
    function setMaxSlippage(uint256 _maxSlippageBps) external onlyOwner {
        maxSlippageBps = _maxSlippageBps;
    }

    /**
     * @dev Manually rebalance vault to target allocations
     */
    function rebalance() external onlyOwner {
        uint256 vaultTotal = vaultValueUSD();

        uint256 targetBTC = (vaultTotal * allocBTC) / ALLOC_DENOMINATOR;
        uint256 targetETH = (vaultTotal * allocETH) / ALLOC_DENOMINATOR;
        uint256 targetGold = (vaultTotal * allocGold) / ALLOC_DENOMINATOR;
        uint256 targetUSDC = (vaultTotal * allocUSDC) / ALLOC_DENOMINATOR;

        uint256 currentBTC = _getAssetValueUSD(wbtc.balanceOf(address(this)), getBTCPrice(), WBTC_DECIMALS);
        uint256 currentETH = _getAssetValueUSD(reth.balanceOf(address(this)), getETHPrice(), RETH_DECIMALS);
        uint256 currentGold = _getAssetValueUSD(paxg.balanceOf(address(this)), getGoldPrice(), PAXG_DECIMALS);

        // Phase 1: Sell overweight assets to USDC
        if (currentBTC > targetBTC) {
            uint256 diff = currentBTC - targetBTC;
            uint256 btcToSell = (wbtc.balanceOf(address(this)) * diff) / currentBTC;
            if (btcToSell > 0) _swapAssetToUSDC(address(wbtc), btcToSell);
        }
        if (currentETH > targetETH) {
            uint256 diff = currentETH - targetETH;
            uint256 ethToSell = (reth.balanceOf(address(this)) * diff) / currentETH;
            if (ethToSell > 0) _swapAssetToUSDC(address(reth), ethToSell);
        }
        if (currentGold > targetGold) {
            uint256 diff = currentGold - targetGold;
            uint256 goldToSell = (paxg.balanceOf(address(this)) * diff) / currentGold;
            if (goldToSell > 0) _swapAssetToUSDC(address(paxg), goldToSell);
        }

        // Phase 2: Buy underweight assets (only if USDC buffer is sufficient)
        uint256 usdcBalance = usdc.balanceOf(address(this));
        uint256 minBuffer = (vaultTotal * 500) / ALLOC_DENOMINATOR; // 5% minimum buffer

        if (usdcBalance > targetUSDC && usdcBalance > minBuffer) {
            uint256 excess = usdcBalance - targetUSDC;

            // Recalculate current values after sells
            currentBTC = _getAssetValueUSD(wbtc.balanceOf(address(this)), getBTCPrice(), WBTC_DECIMALS);
            currentETH = _getAssetValueUSD(reth.balanceOf(address(this)), getETHPrice(), RETH_DECIMALS);
            currentGold = _getAssetValueUSD(paxg.balanceOf(address(this)), getGoldPrice(), PAXG_DECIMALS);

            uint256 totalUnderweight = 0;
            if (currentBTC < targetBTC) totalUnderweight += targetBTC - currentBTC;
            if (currentETH < targetETH) totalUnderweight += targetETH - currentETH;
            if (currentGold < targetGold) totalUnderweight += targetGold - currentGold;

            if (totalUnderweight > 0) {
                // Cap excess to not go below minimum buffer
                uint256 maxSpend = usdcBalance - minBuffer;
                if (excess > maxSpend) excess = maxSpend;

                if (currentBTC < targetBTC) {
                    uint256 buyAmount = (excess * (targetBTC - currentBTC)) / totalUnderweight;
                    if (buyAmount > 0) _swapUSDCToAsset(address(wbtc), buyAmount);
                }
                if (currentETH < targetETH) {
                    uint256 buyAmount = (excess * (targetETH - currentETH)) / totalUnderweight;
                    if (buyAmount > 0) _swapUSDCToAsset(address(reth), buyAmount);
                }
                if (currentGold < targetGold) {
                    uint256 buyAmount = (excess * (targetGold - currentGold)) / totalUnderweight;
                    if (buyAmount > 0) _swapUSDCToAsset(address(paxg), buyAmount);
                }
            }
        }

        emit Rebalanced(
            _getAssetValueUSD(wbtc.balanceOf(address(this)), getBTCPrice(), WBTC_DECIMALS),
            _getAssetValueUSD(reth.balanceOf(address(this)), getETHPrice(), RETH_DECIMALS),
            _getAssetValueUSD(paxg.balanceOf(address(this)), getGoldPrice(), PAXG_DECIMALS),
            usdc.balanceOf(address(this)),
            roseToken.balanceOf(address(this))
        );
    }

    // ============ View Functions ============

    /**
     * @dev Get current vault breakdown
     */
    function getVaultBreakdown() external view returns (
        uint256 btcValue,
        uint256 ethValue,
        uint256 goldValue,
        uint256 usdcValue,
        uint256 totalValue,
        uint256 treasuryRose,
        uint256 currentRosePrice
    ) {
        btcValue = _getAssetValueUSD(wbtc.balanceOf(address(this)), getBTCPrice(), WBTC_DECIMALS);
        ethValue = _getAssetValueUSD(reth.balanceOf(address(this)), getETHPrice(), RETH_DECIMALS);
        goldValue = _getAssetValueUSD(paxg.balanceOf(address(this)), getGoldPrice(), PAXG_DECIMALS);
        usdcValue = usdc.balanceOf(address(this));
        totalValue = btcValue + ethValue + goldValue + usdcValue;
        treasuryRose = roseToken.balanceOf(address(this));
        currentRosePrice = rosePrice();
    }
}

// ============ Interface for RoseToken mint/burn ============
interface IRoseToken {
    function mint(address to, uint256 amount) external;
    function burn(address from, uint256 amount) external;
    function totalSupply() external view returns (uint256);
}
