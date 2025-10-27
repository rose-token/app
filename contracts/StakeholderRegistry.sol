// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "./RoseToken.sol";
import "./RoseReputation.sol";

/**
 * @title StakeholderRegistry
 * @dev Manages verified stakeholders with role separation and cooling periods
 * to prevent bad actors from playing multiple roles in the marketplace
 */
contract StakeholderRegistry {
    RoseToken public roseToken;
    RoseReputation public roseReputation;
    
    // 2-week cooling period as specified in requirements
    uint256 public constant ROLE_CHANGE_COOLING_PERIOD = 14 days;

    // Minimum token holding requirement for stakeholder eligibility
    // Set to 0 for MVP/testing - can be increased later via updateMinimumTokenRequirement()
    uint256 public minimumTokenRequirement = 0; // No minimum for MVP
    
    enum UserRole { None, Customer, Worker, Stakeholder }
    
    struct UserRegistration {
        UserRole currentRole;
        uint256 lastRoleChangeTime;
        bool isBlacklisted;
        uint256 registrationTime;
    }
    
    // Address => registration details
    mapping(address => UserRegistration) public userRegistrations;
    
    // Role-specific whitelists
    mapping(UserRole => mapping(address => bool)) public roleWhitelists;
    
    // Events
    event UserRegistered(address indexed user, UserRole role);
    event RoleChanged(address indexed user, UserRole oldRole, UserRole newRole);
    event UserBlacklisted(address indexed user, string reason);
    event UserRemovedFromBlacklist(address indexed user);
    event MinimumTokenRequirementUpdated(uint256 newRequirement);
    
    // Access control
    address public owner;
    mapping(address => bool) public authorizedContracts;
    
    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner can call this function");
        _;
    }
    
    modifier onlyAuthorized() {
        require(authorizedContracts[msg.sender] || msg.sender == owner, "Not authorized");
        _;
    }
    
    modifier onlyEligibleStakeholder() {
        require(isEligibleStakeholder(msg.sender), "Not eligible to be stakeholder");
        _;
    }
    
    constructor(RoseToken _roseToken, RoseReputation _roseReputation) {
        roseToken = _roseToken;
        roseReputation = _roseReputation;
        owner = msg.sender;
    }
    
    /**
     * @dev Register a user for a specific role with cooling period checks
     */
    function registerForRole(UserRole _role) external {
        require(_role != UserRole.None, "Cannot register for None role");
        require(!userRegistrations[msg.sender].isBlacklisted, "User is blacklisted");
        
        UserRegistration storage registration = userRegistrations[msg.sender];
        
        // Check cooling period if changing roles
        if (registration.currentRole != UserRole.None && registration.currentRole != _role) {
            require(
                block.timestamp >= registration.lastRoleChangeTime + ROLE_CHANGE_COOLING_PERIOD,
                "Must wait cooling period before changing roles"
            );
        }
        
        // Additional checks for stakeholder role
        if (_role == UserRole.Stakeholder) {
            require(
                roseToken.balanceOf(msg.sender) >= minimumTokenRequirement,
                "Insufficient tokens for stakeholder role"
            );
        }
        
        UserRole oldRole = registration.currentRole;
        registration.currentRole = _role;
        registration.lastRoleChangeTime = block.timestamp;
        
        if (registration.registrationTime == 0) {
            registration.registrationTime = block.timestamp;
            emit UserRegistered(msg.sender, _role);
        } else {
            emit RoleChanged(msg.sender, oldRole, _role);
        }
        
        roleWhitelists[_role][msg.sender] = true;
        if (oldRole != UserRole.None) {
            roleWhitelists[oldRole][msg.sender] = false;
        }
    }
    
    /**
     * @dev Check if address is eligible to be a stakeholder
     */
    function isEligibleStakeholder(address _user) public view returns (bool) {
        UserRegistration memory registration = userRegistrations[_user];
        
        // Must not be blacklisted
        if (registration.isBlacklisted) return false;
        
        // Must have sufficient tokens
        if (roseToken.balanceOf(_user) < minimumTokenRequirement) return false;
        
        // Must be registered as stakeholder or in cooling period
        if (registration.currentRole != UserRole.Stakeholder) {
            // Allow if no current role or cooling period has passed
            if (registration.currentRole != UserRole.None) {
                if (block.timestamp < registration.lastRoleChangeTime + ROLE_CHANGE_COOLING_PERIOD) {
                    return false;
                }
            }
        }
        
        return true;
    }
    
    /**
     * @dev Check for role conflicts before allowing role assignment
     */
    function checkRoleConflict(address _user, address _customer, address _worker) external view returns (bool) {
        // User cannot be customer and stakeholder
        if (_user == _customer) return true;
        
        // User cannot be worker and stakeholder  
        if (_user == _worker) return true;
        
        return false;
    }
    
    /**
     * @dev Blacklist a user (only owner)
     */
    function blacklistUser(address _user, string calldata _reason) external onlyOwner {
        userRegistrations[_user].isBlacklisted = true;
        emit UserBlacklisted(_user, _reason);
    }
    
    /**
     * @dev Remove user from blacklist (only owner)
     */
    function removeFromBlacklist(address _user) external onlyOwner {
        userRegistrations[_user].isBlacklisted = false;
        emit UserRemovedFromBlacklist(_user);
    }
    
    /**
     * @dev Update minimum token requirement (only owner)
     */
    function updateMinimumTokenRequirement(uint256 _newRequirement) external onlyOwner {
        minimumTokenRequirement = _newRequirement;
        emit MinimumTokenRequirementUpdated(_newRequirement);
    }
    
    /**
     * @dev Authorize contract to call registry functions
     */
    function authorizeContract(address _contract) external onlyOwner {
        authorizedContracts[_contract] = true;
    }
    
    /**
     * @dev Remove contract authorization
     */
    function removeContractAuthorization(address _contract) external onlyOwner {
        authorizedContracts[_contract] = false;
    }
    
    /**
     * @dev Get user's current role
     */
    function getUserRole(address _user) external view returns (UserRole) {
        return userRegistrations[_user].currentRole;
    }
    
    /**
     * @dev Get time remaining in cooling period
     */
    function getCoolingPeriodRemaining(address _user) external view returns (uint256) {
        UserRegistration memory registration = userRegistrations[_user];
        if (registration.lastRoleChangeTime == 0) return 0;
        
        uint256 cooldownEnd = registration.lastRoleChangeTime + ROLE_CHANGE_COOLING_PERIOD;
        if (block.timestamp >= cooldownEnd) return 0;
        
        return cooldownEnd - block.timestamp;
    }
    
    /**
     * @dev Check if user is blacklisted
     */
    function isBlacklisted(address _user) external view returns (bool) {
        return userRegistrations[_user].isBlacklisted;
    }
}
