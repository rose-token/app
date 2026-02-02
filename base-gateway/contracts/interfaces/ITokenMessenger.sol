// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/**
 * @title ITokenMessenger
 * @notice Interface for Circle's CCTP TokenMessenger contract.
 * @dev Used to burn USDC on the source chain and mint on the destination chain.
 *      Reference: https://developers.circle.com/stablecoins/cctp-getting-started
 */
interface ITokenMessenger {
    /**
     * @notice Deposits and burns tokens from sender to be minted on destination domain.
     * @param amount Amount of tokens to burn (in smallest unit, e.g. 6 decimals for USDC).
     * @param destinationDomain CCTP domain of the destination chain.
     * @param mintRecipient Address to receive minted tokens on destination (bytes32-encoded).
     * @param burnToken Address of the token to burn on the source chain.
     * @return nonce Unique nonce reserved by the message.
     */
    function depositForBurn(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken
    ) external returns (uint64 nonce);

    /**
     * @notice Deposits and burns tokens, with an explicit caller on the destination.
     * @param amount Amount of tokens to burn.
     * @param destinationDomain CCTP domain of the destination chain.
     * @param mintRecipient Address to receive minted tokens on destination (bytes32-encoded).
     * @param burnToken Address of the token to burn on the source chain.
     * @param destinationCaller Authorised caller of receiveMessage() on destination (bytes32).
     * @return nonce Unique nonce reserved by the message.
     */
    function depositForBurnWithCaller(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller
    ) external returns (uint64 nonce);
}
