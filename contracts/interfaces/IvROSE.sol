// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title IvROSE
 * @dev Interface for the vROSE governance receipt token with marketplace-only transfers.
 *
 * vROSE is "soulbound" in that users cannot transfer to each other,
 * but transfers to/from the marketplace contract are allowed for real escrow.
 */
interface IvROSE is IERC20 {
    // ============ Events (Transfer and Approval inherited from IERC20) ============
    event GovernanceUpdated(address indexed newGovernance);
    event MarketplaceUpdated(address indexed newMarketplace);

    // ============ Errors ============
    error NotGovernance();
    error NotMarketplace();
    error NotOwner();
    error ZeroAddress();
    error ZeroAmount();
    error InsufficientBalance();
    error OnlyMarketplaceTransfer();
    error OnlyMarketplaceApproval();

    // ============ View Functions (totalSupply, balanceOf, allowance inherited from IERC20) ============

    /**
     * @dev Returns the name of the token
     */
    function name() external view returns (string memory);

    /**
     * @dev Returns the symbol of the token
     */
    function symbol() external view returns (string memory);

    /**
     * @dev Returns the decimals of the token
     */
    function decimals() external view returns (uint8);

    /**
     * @dev Returns the governance contract address
     */
    function governance() external view returns (address);

    /**
     * @dev Returns the marketplace contract address
     */
    function marketplace() external view returns (address);

    // ============ ERC20 Functions (transfer, transferFrom, approve inherited from IERC20) ============
    // Note: vROSE restricts these to marketplace-only transfers

    // ============ Governance Functions ============

    /**
     * @dev Mint vROSE to a user (1:1 with ROSE deposited in governance)
     * @param to The recipient address
     * @param amount The amount to mint
     */
    function mint(address to, uint256 amount) external;

    /**
     * @dev Burn vROSE from a user (when withdrawing ROSE from governance)
     * @param from The address to burn from
     * @param amount The amount to burn
     */
    function burn(address from, uint256 amount) external;

    // ============ Admin Functions ============

    /**
     * @dev Set the governance contract address
     * @param _governance The new governance address
     */
    function setGovernance(address _governance) external;

    /**
     * @dev Set the marketplace contract address
     * @param _marketplace The new marketplace address
     */
    function setMarketplace(address _marketplace) external;
}
