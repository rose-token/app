// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MockV3Aggregator
 * @dev Mock Chainlink AggregatorV3Interface for testing
 */
contract MockV3Aggregator {
    uint8 public decimals;
    int256 public latestAnswer;
    uint256 public latestTimestamp;
    uint80 public latestRound;

    constructor(uint8 _decimals, int256 _initialAnswer) {
        decimals = _decimals;
        latestAnswer = _initialAnswer;
        latestTimestamp = block.timestamp;
        latestRound = 1;
    }

    function updateAnswer(int256 _answer) external {
        latestAnswer = _answer;
        latestTimestamp = block.timestamp;
        latestRound++;
    }

    function updateTimestamp(uint256 _timestamp) external {
        latestTimestamp = _timestamp;
    }

    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        return (
            latestRound,
            latestAnswer,
            block.timestamp,  // Always fresh for testnet use
            block.timestamp,  // Always fresh for testnet use
            latestRound
        );
    }

    function getRoundData(uint80 _roundId)
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        return (
            _roundId,
            latestAnswer,
            latestTimestamp,
            latestTimestamp,
            _roundId
        );
    }

    function description() external pure returns (string memory) {
        return "Mock Price Feed";
    }

    function version() external pure returns (uint256) {
        return 1;
    }
}
