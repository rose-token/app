// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IvROSE
 * @dev Interface for the vROSE governance receipt token with marketplace-only transfers.
 *
 * vROSE is "soulbound" in that users cannot transfer to each other,
 * but transfers to/from the marketplace contract are allowed for real escrow.
 */
interface IvROSE {
    // ============ Events ============
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
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

    // ============ View Functions ============

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
     * @dev Returns the total supply of vROSE
     */
    function totalSupply() external view returns (uint256);

    /**
     * @dev Returns the balance of vROSE for a user
     * @param account The user address
     */
    function balanceOf(address account) external view returns (uint256);

    /**
     * @dev Returns the allowance for a spender (only marketplace can be approved)
     * @param owner The token owner
     * @param spender The spender address
     */
    function allowance(address owner, address spender) external view returns (uint256);

    /**
     * @dev Returns the governance contract address
     */
    function governance() external view returns (address);

    /**
     * @dev Returns the marketplace contract address
     */
    function marketplace() external view returns (address);

    // ============ ERC20-like Functions (Marketplace-Only) ============

    /**
     * @dev Transfer vROSE to marketplace only
     * Reverts with OnlyMarketplaceTransfer if recipient is not marketplace
     * @param to The recipient (must be marketplace)
     * @param amount The amount to transfer
     */
    function transfer(address to, uint256 amount) external returns (bool);

    /**
     * @dev Transfer vROSE from one address to another (marketplace must be sender or recipient)
     * @param from The sender address
     * @param to The recipient address
     * @param amount The amount to transfer
     */
    function transferFrom(address from, address to, uint256 amount) external returns (bool);

    /**
     * @dev Approve marketplace to spend vROSE
     * Reverts with OnlyMarketplaceApproval if spender is not marketplace
     * @param spender The spender (must be marketplace)
     * @param amount The amount to approve
     */
    function approve(address spender, uint256 amount) external returns (bool);

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
