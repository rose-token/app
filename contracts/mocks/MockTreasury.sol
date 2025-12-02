// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MockTreasury
 * @dev Mock treasury for testing governance proposals
 */
contract MockTreasury {
    uint256 public balance;

    function setBalance(uint256 _balance) external {
        balance = _balance;
    }

    function treasuryBalance() external view returns (uint256) {
        return balance;
    }
}
