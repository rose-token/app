// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "./RoseToken.sol";
import "./StakeholderRegistry.sol";

/**
 * @title TokenStaking
 * @dev Implements token staking with ranked choice voting for stakeholder selection
 * and slashing mechanisms for bad behavior
 */
contract TokenStaking {
    RoseToken public roseToken;
    StakeholderRegistry public stakeholderRegistry;
    
    uint256 public constant MIN_STAKE_AMOUNT = 1000 ether; // 1000 ROSE tokens
    uint256 public constant VOTING_PERIOD = 7 days;
    uint256 public constant STAKE_LOCK_PERIOD = 14 days;
    
    struct StakeInfo {
        uint256 amount;
        uint256 lockEndTime;
        bool isSlashed;
    }
    
    struct RankedChoiceVote {
        address[] preferences; // Ordered list of stakeholder preferences
        uint256 weight;        // Voting weight based on staked tokens
        uint256 timestamp;
    }
    
    struct StakeholderElection {
        uint256 startTime;
        uint256 endTime;
        address[] candidates;
        mapping(address => RankedChoiceVote) votes;
        address[] voters;
        address winner;
        bool isFinalized;
        string ipfsDataHash; // IPFS CID for election data
    }
    
    mapping(address => StakeInfo) public stakedTokens;
    mapping(uint256 => StakeholderElection) public elections;
    uint256 public electionCounter;
    
    // Access control
    address public owner;
    address public daoTreasury;
    mapping(address => bool) public authorizedContracts;
    
    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner can call this function");
        _;
    }
    
    modifier onlyAuthorized() {
        require(authorizedContracts[msg.sender] || msg.sender == owner, "Not authorized");
        _;
    }
    
    // Events
    event TokensStaked(address indexed user, uint256 amount, uint256 lockEndTime);
    event TokensUnstaked(address indexed user, uint256 amount);
    event TokensSlashed(address indexed user, uint256 amount, string reason);
    event ElectionStarted(uint256 electionId, uint256 startTime, uint256 endTime);
    event VoteCast(uint256 electionId, address indexed voter, address[] preferences);
    event ElectionFinalized(uint256 electionId, address winner);
    event BidEvaluationStarted(uint256 electionId, uint256 taskId, address[] bidders);
    event BidEvaluationFinalized(uint256 electionId, uint256 taskId, address selectedBidder);
    
    constructor(RoseToken _roseToken, StakeholderRegistry _stakeholderRegistry, address _daoTreasury) {
        roseToken = _roseToken;
        stakeholderRegistry = _stakeholderRegistry;
        daoTreasury = _daoTreasury;
        owner = msg.sender;
    }
    
    /**
     * @dev Check if user is a valid stakeholder based on staked tokens
     */
    function isValidStakeholder(address user) external view returns (bool) {
        return stakedTokens[user].amount >= MIN_STAKE_AMOUNT && 
               !stakedTokens[user].isSlashed &&
               block.timestamp < stakedTokens[user].lockEndTime;
    }
    
    /**
     * @dev Stake tokens to become eligible as stakeholder
     */
    function stakeTokens(uint256 amount) external {
        require(amount >= MIN_STAKE_AMOUNT, "Amount below minimum stake");
        require(roseToken.transferFrom(msg.sender, address(this), amount), "Token transfer failed");
        
        stakedTokens[msg.sender].amount += amount;
        stakedTokens[msg.sender].lockEndTime = block.timestamp + STAKE_LOCK_PERIOD;
        
        emit TokensStaked(msg.sender, amount, stakedTokens[msg.sender].lockEndTime);
    }
    
    /**
     * @dev Unstake tokens after lock period
     */
    function unstakeTokens(uint256 amount) external {
        require(block.timestamp >= stakedTokens[msg.sender].lockEndTime, "Tokens still locked");
        require(stakedTokens[msg.sender].amount >= amount, "Insufficient staked tokens");
        require(!stakedTokens[msg.sender].isSlashed, "Cannot unstake slashed tokens");
        
        stakedTokens[msg.sender].amount -= amount;
        require(roseToken.transfer(msg.sender, amount), "Token transfer failed");
        
        emit TokensUnstaked(msg.sender, amount);
    }
    
    /**
     * @dev Start a new stakeholder election with ranked choice voting
     */
    function startStakeholderElection(
        address[] calldata candidates,
        string calldata ipfsDataHash
    ) external onlyAuthorized returns (uint256) {
        require(candidates.length >= 2, "Need at least 2 candidates");
        
        electionCounter++;
        StakeholderElection storage election = elections[electionCounter];
        election.startTime = block.timestamp;
        election.endTime = block.timestamp + VOTING_PERIOD;
        election.candidates = candidates;
        election.ipfsDataHash = ipfsDataHash;
        
        emit ElectionStarted(electionCounter, election.startTime, election.endTime);
        return electionCounter;
    }

    /**
     * @dev Start a bid evaluation election for marketplace task
     * @param taskId The marketplace task ID being evaluated
     * @param bidders Array of worker addresses who placed bids
     * @param ipfsDataHash IPFS hash containing bid evaluation data
     * @return electionId The ID of the created election
     */
    function startBidEvaluationElection(
        uint256 taskId,
        address[] calldata bidders,
        string calldata ipfsDataHash
    ) external onlyAuthorized returns (uint256) {
        require(bidders.length >= 2, "Need at least 2 bidders to evaluate");
        
        electionCounter++;
        StakeholderElection storage election = elections[electionCounter];
        election.startTime = block.timestamp;
        election.endTime = block.timestamp + VOTING_PERIOD;
        election.candidates = bidders;
        election.ipfsDataHash = ipfsDataHash;
        
        emit ElectionStarted(electionCounter, election.startTime, election.endTime);
        emit BidEvaluationStarted(electionCounter, taskId, bidders);
        return electionCounter;
    }
    
    /**
     * @dev Cast a ranked choice vote in an election
     */
    function castRankedChoiceVote(
        uint256 electionId,
        address[] calldata preferences
    ) external {
        require(this.isValidStakeholder(msg.sender), "Must be valid stakeholder to vote");
        StakeholderElection storage election = elections[electionId];
        require(block.timestamp >= election.startTime && block.timestamp <= election.endTime, "Voting period invalid");
        require(!election.isFinalized, "Election already finalized");
        
        // Validate preferences are valid candidates
        for (uint i = 0; i < preferences.length; i++) {
            bool isValidCandidate = false;
            for (uint j = 0; j < election.candidates.length; j++) {
                if (preferences[i] == election.candidates[j]) {
                    isValidCandidate = true;
                    break;
                }
            }
            require(isValidCandidate, "Invalid candidate in preferences");
        }
        
        uint256 weight = stakedTokens[msg.sender].amount;
        
        // Check if this is a new voter
        if (election.votes[msg.sender].timestamp == 0) {
            election.voters.push(msg.sender);
        }
        
        election.votes[msg.sender] = RankedChoiceVote({
            preferences: preferences,
            weight: weight,
            timestamp: block.timestamp
        });
        
        emit VoteCast(electionId, msg.sender, preferences);
    }
    
    /**
     * @dev Finalize election using instant runoff voting algorithm
     */
    function finalizeElection(uint256 electionId) external {
        StakeholderElection storage election = elections[electionId];
        require(block.timestamp > election.endTime, "Voting period not ended");
        require(!election.isFinalized, "Election already finalized");
        
        if (election.voters.length == 0) {
            election.isFinalized = true;
            return;
        }
        
        address winner = _runInstantRunoffVoting(electionId);
        election.winner = winner;
        election.isFinalized = true;
        
        emit ElectionFinalized(electionId, winner);
    }

    /**
     * @dev Finalize bid evaluation election and notify marketplace
     * @param electionId The election ID to finalize
     * @param taskId The marketplace task ID this election was for
     */
    function finalizeBidEvaluationElection(uint256 electionId, uint256 taskId) external {
        StakeholderElection storage election = elections[electionId];
        require(block.timestamp > election.endTime, "Voting period not ended");
        require(!election.isFinalized, "Election already finalized");
        
        if (election.voters.length == 0) {
            election.isFinalized = true;
            return;
        }
        
        address selectedBidder = _runInstantRunoffVoting(electionId);
        election.winner = selectedBidder;
        election.isFinalized = true;
        
        emit ElectionFinalized(electionId, selectedBidder);
        emit BidEvaluationFinalized(electionId, taskId, selectedBidder);
    }
    
    /**
     * @dev Implement instant runoff voting algorithm
     */
    function _runInstantRunoffVoting(uint256 electionId) internal view returns (address) {
        StakeholderElection storage election = elections[electionId];
        address[] memory remainingCandidates = election.candidates;
        
        while (remainingCandidates.length > 1) {
            // Count first preference votes for remaining candidates using arrays
            uint256[] memory candidateVotes = new uint256[](remainingCandidates.length);
            uint256 totalVotes = 0;
            
            for (uint i = 0; i < election.voters.length; i++) {
                address voter = election.voters[i];
                address[] memory preferences = election.votes[voter].preferences;
                uint256 weight = election.votes[voter].weight;
                
                // Find first preference among remaining candidates
                for (uint j = 0; j < preferences.length; j++) {
                    int256 candidateIndex = _findCandidateIndex(preferences[j], remainingCandidates);
                    if (candidateIndex >= 0) {
                        candidateVotes[uint256(candidateIndex)] += weight;
                        totalVotes += weight;
                        break;
                    }
                }
            }
            
            // Check if any candidate has majority
            for (uint i = 0; i < remainingCandidates.length; i++) {
                if (candidateVotes[i] > totalVotes / 2) {
                    return remainingCandidates[i];
                }
            }
            
            // Eliminate candidate with fewest votes
            address eliminatedCandidate = _findCandidateWithFewestVotesFromArray(remainingCandidates, candidateVotes);
            remainingCandidates = _removeFromArray(remainingCandidates, eliminatedCandidate);
        }
        
        return remainingCandidates.length > 0 ? remainingCandidates[0] : address(0);
    }
    
    /**
     * @dev Helper function to check if address is in array
     */
    function _isInArray(address target, address[] memory array) internal pure returns (bool) {
        for (uint i = 0; i < array.length; i++) {
            if (array[i] == target) {
                return true;
            }
        }
        return false;
    }
    
    /**
     * @dev Helper function to find candidate index in array
     */
    function _findCandidateIndex(address target, address[] memory candidates) internal pure returns (int256) {
        for (uint i = 0; i < candidates.length; i++) {
            if (candidates[i] == target) {
                return int256(i);
            }
        }
        return -1;
    }
    
    /**
     * @dev Helper function to find candidate with fewest votes from vote array
     */
    function _findCandidateWithFewestVotesFromArray(
        address[] memory candidates,
        uint256[] memory votes
    ) internal pure returns (address) {
        address fewestVotesCandidate = candidates[0];
        uint256 fewestVotes = votes[0];
        
        for (uint i = 1; i < candidates.length; i++) {
            if (votes[i] < fewestVotes) {
                fewestVotes = votes[i];
                fewestVotesCandidate = candidates[i];
            }
        }
        
        return fewestVotesCandidate;
    }
    
    /**
     * @dev Helper function to remove address from array
     */
    function _removeFromArray(address[] memory array, address target) internal pure returns (address[] memory) {
        address[] memory newArray = new address[](array.length - 1);
        uint newIndex = 0;
        
        for (uint i = 0; i < array.length; i++) {
            if (array[i] != target) {
                newArray[newIndex] = array[i];
                newIndex++;
            }
        }
        
        return newArray;
    }
    
    /**
     * @dev Slash tokens for bad behavior
     */
    function slashStakeholder(
        address stakeholder,
        uint256 slashAmount,
        string calldata reason
    ) external onlyAuthorized {
        require(stakedTokens[stakeholder].amount >= slashAmount, "Insufficient staked tokens");
        
        stakedTokens[stakeholder].amount -= slashAmount;
        stakedTokens[stakeholder].isSlashed = true;
        
        // Transfer slashed tokens to DAO treasury
        require(roseToken.transfer(daoTreasury, slashAmount), "Slash transfer failed");
        
        emit TokensSlashed(stakeholder, slashAmount, reason);
    }
    
    /**
     * @dev Rehabilitate slashed stakeholder
     */
    function rehabilitateStakeholder(address stakeholder) external onlyAuthorized {
        stakedTokens[stakeholder].isSlashed = false;
    }
    
    /**
     * @dev Authorize contract to call staking functions
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
     * @dev Get election details
     */
    function getElection(uint256 electionId) external view returns (
        uint256 startTime,
        uint256 endTime,
        address[] memory candidates,
        address winner,
        bool isFinalized,
        string memory ipfsDataHash
    ) {
        StakeholderElection storage election = elections[electionId];
        return (
            election.startTime,
            election.endTime,
            election.candidates,
            election.winner,
            election.isFinalized,
            election.ipfsDataHash
        );
    }
    
    /**
     * @dev Get voter's preferences for an election
     */
    function getVoterPreferences(uint256 electionId, address voter) external view returns (address[] memory) {
        return elections[electionId].votes[voter].preferences;
    }
    
    /**
     * @dev Get staked amount for user
     */
    function getStakedAmount(address user) external view returns (uint256) {
        return stakedTokens[user].amount;
    }

    /**
     * @dev Get candidate count for an election
     */
    function getCandidateCount(uint256 electionId) external view returns (uint256) {
        return elections[electionId].candidates.length;
    }

    /**
     * @dev Get candidate information including vote count
     */
    function getCandidate(uint256 electionId, uint256 index) external view returns (
        address candidate,
        uint256 voteCount,
        bool eliminated
    ) {
        require(index < elections[electionId].candidates.length, "Invalid candidate index");
        
        StakeholderElection storage election = elections[electionId];
        address candidateAddr = election.candidates[index];
        
        // Calculate current vote count for this candidate
        uint256 votes = 0;
        for (uint i = 0; i < election.voters.length; i++) {
            address voter = election.voters[i];
            address[] memory preferences = election.votes[voter].preferences;
            uint256 weight = election.votes[voter].weight;
            
            // Count first preference votes for this candidate
            if (preferences.length > 0 && preferences[0] == candidateAddr) {
                votes += weight;
            }
        }
        
        // Mark as eliminated if election is finalized and candidate didn't win
        bool isEliminated = false;
        if (election.isFinalized && election.winner != candidateAddr) {
            isEliminated = true;
        }
        
        return (candidateAddr, votes, isEliminated);
    }

    /**
     * @dev Get vote information for a voter (enhanced version of getVoterPreferences)
     */
    function getVote(uint256 electionId, address voter) external view returns (
        address[] memory preferences,
        uint256 weight,
        uint256 timestamp
    ) {
        RankedChoiceVote storage vote = elections[electionId].votes[voter];
        return (vote.preferences, vote.weight, vote.timestamp);
    }

    /**
     * @dev Get election results
     */
    function getElectionResults(uint256 electionId) external view returns (
        address winner,
        uint256 totalRounds
    ) {
        StakeholderElection storage election = elections[electionId];
        require(election.isFinalized, "Election not finalized");
        
        // Return 1 round since we don't track intermediate rounds
        return (election.winner, 1);
    }
}
