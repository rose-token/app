// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title MockUniswapV3Router
 * @dev Mock Uniswap V3 SwapRouter for testing
 */
contract MockUniswapV3Router {
    using SafeERC20 for IERC20;

    // Exchange rates: tokenIn => tokenOut => rate (scaled by 1e18)
    // rate = how much tokenOut you get per 1e18 tokenIn (before decimal adjustment)
    mapping(address => mapping(address => uint256)) public exchangeRates;

    // Token decimals for conversion
    mapping(address => uint8) public tokenDecimals;

    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    event Swap(
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        address recipient
    );

    constructor() {}

    function setExchangeRate(
        address tokenIn,
        address tokenOut,
        uint256 rate
    ) external {
        exchangeRates[tokenIn][tokenOut] = rate;
    }

    function setTokenDecimals(address token, uint8 decimals) external {
        tokenDecimals[token] = decimals;
    }

    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        payable
        returns (uint256 amountOut)
    {
        require(block.timestamp <= params.deadline, "Transaction too old");

        // Transfer tokenIn from sender
        IERC20(params.tokenIn).safeTransferFrom(
            msg.sender,
            address(this),
            params.amountIn
        );

        // Calculate amountOut based on exchange rate
        uint256 rate = exchangeRates[params.tokenIn][params.tokenOut];
        if (rate == 0) {
            // Default: 1:1 rate adjusted for decimals
            uint8 decimalsIn = tokenDecimals[params.tokenIn];
            uint8 decimalsOut = tokenDecimals[params.tokenOut];
            if (decimalsIn == 0) decimalsIn = 18;
            if (decimalsOut == 0) decimalsOut = 18;

            if (decimalsOut >= decimalsIn) {
                amountOut = params.amountIn * (10 ** (decimalsOut - decimalsIn));
            } else {
                amountOut = params.amountIn / (10 ** (decimalsIn - decimalsOut));
            }
        } else {
            // Use configured rate
            amountOut = (params.amountIn * rate) / 1e18;
        }

        require(amountOut >= params.amountOutMinimum, "Too little received");

        // Transfer tokenOut to recipient
        IERC20(params.tokenOut).safeTransfer(params.recipient, amountOut);

        emit Swap(
            params.tokenIn,
            params.tokenOut,
            params.amountIn,
            amountOut,
            params.recipient
        );

        return amountOut;
    }

    // Allow receiving ETH for WETH unwrapping scenarios
    receive() external payable {}
}
