// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MockMarketplace
 * @dev Mock marketplace for testing governance DAO task creation and completion
 */
contract MockMarketplace {
    uint256 private _taskIdCounter;
    address public governance;

    event DAOTaskCreated(uint256 indexed taskId, address indexed proposer, uint256 value);
    event TaskCompleted(uint256 indexed taskId);

    function setGovernance(address _governance) external {
        governance = _governance;
    }

    function createDAOTask(
        address proposer,
        string calldata /* title */,
        uint256 value,
        string calldata /* descriptionHash */,
        uint256 /* proposalId */
    ) external returns (uint256) {
        require(msg.sender == governance, "Only governance");
        _taskIdCounter++;
        emit DAOTaskCreated(_taskIdCounter, proposer, value);
        return _taskIdCounter;
    }

    function completeTask(uint256 taskId) external {
        // This simulates the marketplace calling governance.onTaskComplete
        (bool success,) = governance.call(
            abi.encodeWithSignature("onTaskComplete(uint256)", taskId)
        );
        require(success, "onTaskComplete failed");
        emit TaskCompleted(taskId);
    }

    // Helper for tests to update user stats via governance
    function updateUserStats(address user, uint256 taskValue, bool isDispute) external {
        (bool success,) = governance.call(
            abi.encodeWithSignature("updateUserStats(address,uint256,bool)", user, taskValue, isDispute)
        );
        require(success, "updateUserStats failed");
    }
}
