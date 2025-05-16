// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

contract RoseReputation {
    // Role enum for the three participant types
    enum Role { Customer, Stakeholder, Worker }
    
    // Reputation data structure for tracking experience and levels
    struct Reputation {
        uint256 experience;
        uint256 level;
    }
    
    // Mapping of address => role => reputation
    mapping(address => mapping(Role => Reputation)) public reputations;
    
    // Experience gain constants
    uint256 public constant CUSTOMER_TASK_CREATION_EXP = 10;
    uint256 public constant CUSTOMER_TASK_COMPLETION_EXP = 20;
    uint256 public constant STAKEHOLDER_STAKE_EXP = 15;
    uint256 public constant STAKEHOLDER_TASK_COMPLETION_EXP = 20;
    uint256 public constant WORKER_CLAIM_EXP = 15;
    uint256 public constant WORKER_TASK_COMPLETION_EXP = 30;
    
    // Leveling curve constants
    uint256 public constant BASE_EXP = 100;
    uint256 public constant MULTIPLIER = 180; // 1.8 × 100 for integer math
    uint256 public constant MULTIPLIER_DECIMALS = 100;
    uint256 public constant MAX_LEVEL = 10;
    
    // Events
    event ExperienceGained(address indexed user, Role role, uint256 amount, uint256 newTotal);
    event LevelUp(address indexed user, Role role, uint256 newLevel);
    
    /**
     * @dev Calculate the experience needed for a given level
     * @param _level The level to calculate exp for
     * @return The experience needed to reach that level
     */
    function expForLevel(uint256 _level) public pure returns (uint256) {
        if (_level == 0) return 0;
        if (_level == 1) return BASE_EXP;
        
        uint256 exp = BASE_EXP;
        for (uint256 i = 1; i < _level; i++) {
            exp = (exp * MULTIPLIER) / MULTIPLIER_DECIMALS;
        }
        return exp;
    }
    
    /**
     * @dev Calculate the level for a given amount of experience
     * @param _exp The experience points
     * @return The level corresponding to the experience
     */
    function calculateLevel(uint256 _exp) public pure returns (uint256) {
        if (_exp < BASE_EXP) return 0;
        
        uint256 level = 1;
        uint256 expNeeded = BASE_EXP;
        
        while (level < MAX_LEVEL && _exp >= expNeeded) {
            level++;
            if (level == MAX_LEVEL) break;
            expNeeded = (expNeeded * MULTIPLIER) / MULTIPLIER_DECIMALS;
        }
        
        return level;
    }
    
    /**
     * @dev Award experience to a user for a specific role
     * @param _user The user's address
     * @param _role The role (Customer, Stakeholder, Worker)
     * @param _amount The amount of experience to award
     */
    function awardExperience(address _user, Role _role, uint256 _amount) public {
        require(_user != address(0), "Cannot award experience to zero address");
        
        Reputation storage rep = reputations[_user][_role];
        uint256 oldLevel = rep.level;
        
        rep.experience += _amount;
        rep.level = calculateLevel(rep.experience);
        
        emit ExperienceGained(_user, _role, _amount, rep.experience);
        
        if (rep.level > oldLevel) {
            emit LevelUp(_user, _role, rep.level);
        }
    }
    
    /**
     * @dev Get the level of a user for a specific role
     * @param _user The user's address
     * @param _role The role (Customer, Stakeholder, Worker)
     * @return The user's level for that role
     */
    function getLevel(address _user, Role _role) public view returns (uint256) {
        return reputations[_user][_role].level;
    }
    
    /**
     * @dev Get the experience of a user for a specific role
     * @param _user The user's address
     * @param _role The role (Customer, Stakeholder, Worker)
     * @return The user's experience for that role
     */
    function getExperience(address _user, Role _role) public view returns (uint256) {
        return reputations[_user][_role].experience;
    }
    
    /**
     * @dev Calculate the bonus percentage based on combined levels
     * @param _customer The customer's address
     * @param _stakeholder The stakeholder's address
     * @param _worker The worker's address
     * @return The bonus percentage to apply to minting rewards
     */
    function calculateMintingBonus(
        address _customer, 
        address _stakeholder, 
        address _worker
    ) public view returns (uint256) {
        uint256 customerLevel = getLevel(_customer, Role.Customer);
        uint256 stakeholderLevel = getLevel(_stakeholder, Role.Stakeholder);
        uint256 workerLevel = getLevel(_worker, Role.Worker);
        
        // Calculate combined level bonus (5% per level, max 50% at combined level 10)
        uint256 combinedLevel = customerLevel + stakeholderLevel + workerLevel;
        if (combinedLevel > 10) combinedLevel = 10; // Cap at level 10
        
        // 5% bonus per level (5 * combinedLevel)
        return 5 * combinedLevel;
    }
}
