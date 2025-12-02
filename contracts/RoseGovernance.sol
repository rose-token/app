// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "./interfaces/IvROSE.sol";
import "./interfaces/IRoseGovernance.sol";

/**
 * @title RoseGovernance
 * @dev Decentralized governance for the Rose Token worker cooperative.
 *
 * Features:
 * - ROSE staking with vROSE receipt tokens
 * - VP (Voting Power) calculated at deposit time: sqrt(ROSE) * (reputation / 100)
 * - Multi-delegation: users can split VP across multiple delegates
 * - VP locked to ONE proposal at a time
 * - All O(n) calculations moved to backend
 *
 * Vote Power = sqrt(staked ROSE) * (reputation / 100)
 */
contract RoseGovernance is IRoseGovernance, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;
    using EnumerableSet for EnumerableSet.AddressSet;

    // ============ Token References ============
    IERC20 public immutable roseToken;
    IvROSE public immutable vRoseToken;
    address public marketplace;
    address public treasury;
    address public passportSigner;
    address public owner;

    // ============ Core VP Tracking ============
    mapping(address => uint256) public stakedRose;          // ROSE deposited
    mapping(address => uint256) public votingPower;         // VP calculated at deposit time
    uint256 public totalStakedRose;                         // Total ROSE staked
    uint256 public totalVotingPower;                        // Total system VP

    // ============ Multi-Delegation ============
    // delegator => delegate => VP amount
    mapping(address => mapping(address => uint256)) public delegatedVP;
    mapping(address => uint256) public totalDelegatedOut;   // Total VP user delegated out
    mapping(address => uint256) public totalDelegatedIn;    // Total VP delegate received
    mapping(address => address[]) internal _delegationTargets; // List of user's delegates
    mapping(address => EnumerableSet.AddressSet) internal _delegators; // Who delegates to this user

    // ============ Proposal Allocation (VP locked to ONE proposal) ============
    mapping(address => uint256) public allocatedToProposal; // Which proposal (0 = none)
    mapping(address => uint256) public proposalVPLocked;    // VP locked to that proposal

    // ============ Reputation Tracking ============
    mapping(address => UserStats) internal _userStats;
    mapping(address => TaskRecord[]) internal _taskHistory;

    // ============ Proposals ============
    uint256 public proposalCounter;
    mapping(uint256 => Proposal) internal _proposals;
    mapping(uint256 => mapping(address => Vote)) internal _votes;
    mapping(uint256 => address[]) internal _proposalVoters;
    mapping(uint256 => uint256) internal _proposalToTask;
    mapping(uint256 => uint256) internal _taskToProposal;

    // ============ Pending Rewards ============
    mapping(address => uint256) public pendingRewards;

    // ============ Delegated Voting Tracking ============
    mapping(uint256 => mapping(address => uint256)) public delegatedVoteAllocated;
    mapping(uint256 => mapping(address => DelegatedVoteRecord)) internal _delegatedVotes;
    mapping(uint256 => address[]) internal _proposalDelegates;

    // ============ Signature Replay Protection ============
    mapping(bytes32 => bool) public usedSignatures;

    // ============ Signers ============
    address public delegationSigner;
    mapping(uint256 => mapping(address => bytes32)) public allocationHashes;

    // ============ Voter Reward Pools ============
    mapping(uint256 => uint256) public voterRewardPool;
    mapping(uint256 => uint256) public voterRewardTotalVotes;
    mapping(uint256 => bool) public voterRewardOutcome;

    // ============ Claim Tracking ============
    mapping(uint256 => mapping(address => bool)) public directVoterRewardClaimed;
    mapping(uint256 => mapping(address => mapping(address => bool))) public delegatorRewardClaimed;

    // ============ Constants ============
    uint256 public constant VOTING_PERIOD = 2 weeks;
    uint256 public constant QUORUM_THRESHOLD = 3300;      // 33% in basis points
    uint256 public constant PASS_THRESHOLD = 5833;        // 7/12 = 58.33%
    uint256 public constant MAX_EDIT_CYCLES = 4;
    uint256 public constant COLD_START_TASKS = 10;
    uint256 public constant PROPOSER_REP_THRESHOLD = 90;
    uint256 public constant VOTER_REP_THRESHOLD = 70;
    uint256 public constant DELEGATE_REP_THRESHOLD = 90;
    uint256 public constant DEFAULT_REPUTATION = 60;
    uint256 public constant BASIS_POINTS = 10000;
    uint256 public constant TASK_DECAY_PERIOD = 365 days;
    uint256 public constant DISPUTE_DECAY_PERIOD = 1095 days;

    // Reward percentages (basis points)
    uint256 public constant DAO_MINT_PERCENT = 200;       // 2%
    uint256 public constant YAY_VOTER_REWARD = 200;       // 2%
    uint256 public constant NAY_VOTER_REWARD = 200;       // 2%
    uint256 public constant PROPOSER_REWARD = 100;        // 1%

    // ============ Modifiers ============

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyMarketplace() {
        if (msg.sender != marketplace) revert NotMarketplace();
        _;
    }

    modifier requiresPassport(string memory action, uint256 expiry, bytes memory signature) {
        if (block.timestamp > expiry) revert SignatureExpired();

        bytes32 messageHash = keccak256(abi.encodePacked(msg.sender, action, expiry));
        bytes32 ethSignedHash = messageHash.toEthSignedMessageHash();

        if (usedSignatures[ethSignedHash]) revert SignatureAlreadyUsed();
        usedSignatures[ethSignedHash] = true;

        address recovered = ethSignedHash.recover(signature);
        if (recovered != passportSigner) revert InvalidSignature();

        _;
    }

    // ============ Constructor ============

    constructor(
        address _roseToken,
        address _vRoseToken,
        address _marketplace,
        address _treasury,
        address _passportSigner
    ) {
        if (_roseToken == address(0)) revert ZeroAddress();
        if (_vRoseToken == address(0)) revert ZeroAddress();
        if (_marketplace == address(0)) revert ZeroAddress();
        if (_treasury == address(0)) revert ZeroAddress();
        if (_passportSigner == address(0)) revert ZeroAddressSigner();

        roseToken = IERC20(_roseToken);
        vRoseToken = IvROSE(_vRoseToken);
        marketplace = _marketplace;
        treasury = _treasury;
        passportSigner = _passportSigner;
        owner = msg.sender;
    }

    // ============ View Functions ============

    function userStats(address user) external view returns (UserStats memory) {
        return _userStats[user];
    }

    function proposals(uint256 proposalId) external view returns (Proposal memory) {
        return _proposals[proposalId];
    }

    function votes(uint256 proposalId, address voter) external view returns (Vote memory) {
        return _votes[proposalId][voter];
    }

    function delegators(address delegateAddr) external view returns (address[] memory) {
        return _delegators[delegateAddr].values();
    }

    function getTaskHistory(address user) external view returns (TaskRecord[] memory) {
        return _taskHistory[user];
    }

    /**
     * @dev Get reputation score (0-100) with time-based decay
     */
    function getReputation(address user) public view returns (uint256) {
        TaskRecord[] memory history = _taskHistory[user];
        uint256 failedProposals = _userStats[user].failedProposals;

        uint256 taskCutoff = block.timestamp > TASK_DECAY_PERIOD
            ? block.timestamp - TASK_DECAY_PERIOD
            : 0;
        uint256 disputeCutoff = block.timestamp > DISPUTE_DECAY_PERIOD
            ? block.timestamp - DISPUTE_DECAY_PERIOD
            : 0;

        uint256 recentTaskCount = 0;
        uint256 recentTaskValue = 0;
        uint256 recentDisputes = 0;

        for (uint256 i = 0; i < history.length; i++) {
            TaskRecord memory record = history[i];

            if (record.isDispute) {
                if (record.timestamp >= disputeCutoff) {
                    recentDisputes++;
                }
            } else {
                if (record.timestamp >= taskCutoff) {
                    recentTaskCount++;
                    recentTaskValue += record.value;
                }
            }
        }

        if (recentTaskCount < COLD_START_TASKS) {
            return DEFAULT_REPUTATION;
        }

        if (recentTaskValue == 0) {
            return DEFAULT_REPUTATION;
        }

        uint256 penalties = recentDisputes + (failedProposals / 5);
        if (penalties >= recentTaskCount) {
            return 0;
        }

        uint256 effectiveValue = recentTaskValue - (penalties * recentTaskValue / recentTaskCount);
        return (effectiveValue * 100) / recentTaskValue;
    }

    /**
     * @dev Calculate vote power: sqrt(amount) * (reputation / 100)
     */
    function getVotePower(uint256 amount, uint256 reputation) public pure returns (uint256) {
        if (amount == 0 || reputation == 0) return 0;
        uint256 sqrtAmount = _sqrt(amount);
        return (sqrtAmount * reputation) / 100;
    }

    /**
     * @dev Get available VP (not delegated, not on proposals)
     */
    function getAvailableVP(address user) public view returns (uint256) {
        uint256 currentVP = votingPower[user];
        uint256 lockedVP = totalDelegatedOut[user] + proposalVPLocked[user];
        return currentVP > lockedVP ? currentVP - lockedVP : 0;
    }

    /**
     * @dev Get user's delegation targets and amounts
     */
    function getUserDelegations(address user) external view returns (
        address[] memory delegates,
        uint256[] memory amounts
    ) {
        delegates = _delegationTargets[user];
        amounts = new uint256[](delegates.length);
        for (uint256 i = 0; i < delegates.length; i++) {
            amounts[i] = delegatedVP[user][delegates[i]];
        }
    }

    function canPropose(address user) public view returns (bool) {
        UserStats memory stats = _userStats[user];
        if (stats.tasksCompleted < COLD_START_TASKS) return false;
        return getReputation(user) >= PROPOSER_REP_THRESHOLD;
    }

    function canVote(address user) public view returns (bool) {
        return getReputation(user) >= VOTER_REP_THRESHOLD;
    }

    function canDelegate(address user) public view returns (bool) {
        UserStats memory stats = _userStats[user];
        if (stats.tasksCompleted < COLD_START_TASKS) return false;
        return getReputation(user) >= DELEGATE_REP_THRESHOLD;
    }

    function getQuorumProgress(uint256 proposalId) public view returns (uint256 current, uint256 required) {
        Proposal memory p = _proposals[proposalId];
        current = p.yayVotes + p.nayVotes;
        required = (totalVotingPower * QUORUM_THRESHOLD) / BASIS_POINTS;
    }

    function getVoteResult(uint256 proposalId) public view returns (uint256 yayPercent, uint256 nayPercent) {
        Proposal memory p = _proposals[proposalId];
        uint256 totalVotes = p.yayVotes + p.nayVotes;
        if (totalVotes == 0) return (0, 0);
        yayPercent = (p.yayVotes * BASIS_POINTS) / totalVotes;
        nayPercent = (p.nayVotes * BASIS_POINTS) / totalVotes;
    }

    function getAvailableDelegatedPower(address delegateAddr, uint256 proposalId) public view returns (uint256) {
        uint256 total = totalDelegatedIn[delegateAddr];
        uint256 used = delegatedVoteAllocated[proposalId][delegateAddr];
        return total > used ? total - used : 0;
    }

    function getDelegatedVote(uint256 proposalId, address delegateAddr) external view returns (DelegatedVoteRecord memory) {
        return _delegatedVotes[proposalId][delegateAddr];
    }

    function getProposalDelegates(uint256 proposalId) external view returns (address[] memory) {
        return _proposalDelegates[proposalId];
    }

    // ============ Staking Functions ============

    /**
     * @dev Deposit ROSE to governance, receive vROSE 1:1
     * VP is calculated at deposit time using current reputation
     */
    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        roseToken.safeTransferFrom(msg.sender, address(this), amount);
        vRoseToken.mint(msg.sender, amount);

        // Calculate VP at deposit time
        uint256 rep = getReputation(msg.sender);
        uint256 newTotalStaked = stakedRose[msg.sender] + amount;
        uint256 newVP = getVotePower(newTotalStaked, rep);
        uint256 oldVP = votingPower[msg.sender];
        uint256 vpIncrease = newVP - oldVP;

        // Update state
        stakedRose[msg.sender] = newTotalStaked;
        votingPower[msg.sender] = newVP;
        totalStakedRose += amount;
        totalVotingPower += vpIncrease;

        emit VotingPowerChanged(msg.sender, newTotalStaked, newVP, rep);
        emit TotalVPUpdated(totalVotingPower);
        emit Deposited(msg.sender, amount);
    }

    /**
     * @dev Withdraw ROSE from governance, burn vROSE
     * Requires sufficient available VP (not delegated, not on proposals)
     */
    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (stakedRose[msg.sender] < amount) revert InsufficientStake();

        // Calculate available VP
        uint256 currentVP = votingPower[msg.sender];
        uint256 lockedVP = totalDelegatedOut[msg.sender] + proposalVPLocked[msg.sender];
        uint256 availableVP = currentVP > lockedVP ? currentVP - lockedVP : 0;

        // Calculate VP being withdrawn
        uint256 newTotalStaked = stakedRose[msg.sender] - amount;
        uint256 rep = getReputation(msg.sender);
        uint256 newVP = getVotePower(newTotalStaked, rep);
        uint256 vpDecrease = currentVP - newVP;

        if (availableVP < vpDecrease) revert VPLocked();

        // Check vROSE balance
        uint256 vRoseBalance = vRoseToken.balanceOf(msg.sender);
        if (vRoseBalance < amount) revert InsufficientVRose();

        vRoseToken.burn(msg.sender, amount);

        // Update state
        stakedRose[msg.sender] = newTotalStaked;
        votingPower[msg.sender] = newVP;
        totalStakedRose -= amount;
        totalVotingPower -= vpDecrease;

        roseToken.safeTransfer(msg.sender, amount);

        emit VotingPowerChanged(msg.sender, newTotalStaked, newVP, rep);
        emit TotalVPUpdated(totalVotingPower);
        emit Withdrawn(msg.sender, amount);
    }

    // ============ Multi-Delegation Functions ============

    /**
     * @dev Delegate VP to another user (supports multi-delegation)
     * @param delegateAddr Address to delegate to
     * @param vpAmount Amount of VP to delegate
     */
    function delegate(address delegateAddr, uint256 vpAmount) external nonReentrant {
        if (delegateAddr == address(0)) revert ZeroAddress();
        if (delegateAddr == msg.sender) revert CannotDelegateToSelf();
        if (vpAmount == 0) revert ZeroAmount();
        if (!canVote(msg.sender)) revert IneligibleToVote();
        if (!canDelegate(delegateAddr)) revert IneligibleToDelegate();

        // Check available VP
        uint256 availableVP = getAvailableVP(msg.sender);
        if (availableVP < vpAmount) revert InsufficientAvailableVP();

        // Track new delegation target
        if (delegatedVP[msg.sender][delegateAddr] == 0) {
            _delegationTargets[msg.sender].push(delegateAddr);
            _delegators[delegateAddr].add(msg.sender);
        }

        // Update delegation
        delegatedVP[msg.sender][delegateAddr] += vpAmount;
        totalDelegatedOut[msg.sender] += vpAmount;
        totalDelegatedIn[delegateAddr] += vpAmount;

        emit DelegationChanged(msg.sender, delegateAddr, vpAmount, true);
    }

    /**
     * @dev Remove delegation from a specific delegate (partial undelegate supported)
     * @param delegateAddr Address to undelegate from
     * @param vpAmount Amount of VP to undelegate
     */
    function undelegate(address delegateAddr, uint256 vpAmount) external nonReentrant {
        if (vpAmount == 0) revert ZeroAmount();
        if (delegatedVP[msg.sender][delegateAddr] < vpAmount) revert InsufficientDelegated();

        delegatedVP[msg.sender][delegateAddr] -= vpAmount;
        totalDelegatedOut[msg.sender] -= vpAmount;
        totalDelegatedIn[delegateAddr] -= vpAmount;

        // Remove from targets if fully undelegated
        if (delegatedVP[msg.sender][delegateAddr] == 0) {
            _removeDelegationTarget(msg.sender, delegateAddr);
            _delegators[delegateAddr].remove(msg.sender);
        }

        emit DelegationChanged(msg.sender, delegateAddr, vpAmount, false);
    }

    /**
     * @dev Refresh VP when reputation changes (backend-triggered)
     * @param user Address to refresh VP for
     * @param newRep New reputation value
     * @param expiry Signature expiration
     * @param signature Backend signer signature
     */
    function refreshVP(
        address user,
        uint256 newRep,
        uint256 expiry,
        bytes calldata signature
    ) external {
        if (delegationSigner == address(0)) revert ZeroAddressDelegationSigner();
        if (block.timestamp > expiry) revert SignatureExpired();

        bytes32 messageHash = keccak256(abi.encodePacked(
            "refreshVP",
            user,
            newRep,
            expiry
        ));
        bytes32 ethSignedHash = messageHash.toEthSignedMessageHash();

        if (usedSignatures[ethSignedHash]) revert SignatureAlreadyUsed();
        usedSignatures[ethSignedHash] = true;

        address recovered = ethSignedHash.recover(signature);
        if (recovered != delegationSigner) revert InvalidDelegationSignature();

        uint256 staked = stakedRose[user];
        uint256 oldVP = votingPower[user];
        uint256 newVP = getVotePower(staked, newRep);

        votingPower[user] = newVP;

        if (newVP >= oldVP) {
            totalVotingPower += (newVP - oldVP);
        } else {
            totalVotingPower -= (oldVP - newVP);
        }

        emit VotingPowerChanged(user, staked, newVP, newRep);
        emit TotalVPUpdated(totalVotingPower);
    }

    // ============ Voting Functions ============

    /**
     * @dev Vote on a proposal with VP (requires passport signature)
     * VP is locked to ONE proposal at a time
     * @param proposalId Proposal to vote on
     * @param vpAmount VP to allocate
     * @param support True for Yay, false for Nay
     * @param expiry Signature expiration
     * @param signature Passport signer signature
     */
    function vote(
        uint256 proposalId,
        uint256 vpAmount,
        bool support,
        uint256 expiry,
        bytes calldata signature
    ) external nonReentrant {
        // Verify passport signature
        if (block.timestamp > expiry) revert SignatureExpired();

        bytes32 messageHash = keccak256(abi.encodePacked(
            "vote",
            msg.sender,
            proposalId,
            vpAmount,
            support,
            expiry
        ));
        bytes32 ethSignedHash = messageHash.toEthSignedMessageHash();

        if (usedSignatures[ethSignedHash]) revert SignatureAlreadyUsed();
        usedSignatures[ethSignedHash] = true;

        address recovered = ethSignedHash.recover(signature);
        if (recovered != passportSigner) revert InvalidSignature();

        // Proposal validations
        Proposal storage p = _proposals[proposalId];
        if (p.status != ProposalStatus.Active) revert ProposalNotActive();
        if (block.timestamp > p.votingEndsAt) revert ProposalNotActive();
        if (p.proposer == msg.sender) revert CannotVoteOnOwnProposal();
        if (!canVote(msg.sender)) revert IneligibleToVote();
        if (vpAmount == 0) revert ZeroAmount();

        // Check VP not locked to another proposal
        uint256 existingProposal = allocatedToProposal[msg.sender];
        if (existingProposal != 0 && existingProposal != proposalId) {
            revert VPLockedToAnotherProposal();
        }

        // Check available VP
        uint256 availableVP = getAvailableVP(msg.sender);
        if (availableVP < vpAmount) revert InsufficientAvailableVP();

        Vote storage v = _votes[proposalId][msg.sender];
        if (v.hasVoted) {
            if (v.support != support) revert CannotChangeVoteDirection();
        }

        // Lock VP to proposal
        allocatedToProposal[msg.sender] = proposalId;
        proposalVPLocked[msg.sender] += vpAmount;

        // Record vote
        if (!v.hasVoted) {
            v.hasVoted = true;
            v.support = support;
            _proposalVoters[proposalId].push(msg.sender);
            emit VoteCast(proposalId, msg.sender, support, vpAmount);
        } else {
            emit VoteIncreased(proposalId, msg.sender, vpAmount, v.votePower + vpAmount);
        }
        v.votePower += vpAmount;

        // Update proposal
        if (support) {
            p.yayVotes += vpAmount;
        } else {
            p.nayVotes += vpAmount;
        }

        emit VPAllocatedToProposal(proposalId, msg.sender, vpAmount, support, false);
    }

    /**
     * @dev Free VP after proposal resolves
     * @param proposalId Proposal to free VP from
     */
    function freeVP(uint256 proposalId) external nonReentrant {
        Proposal storage p = _proposals[proposalId];
        if (p.status == ProposalStatus.Active && block.timestamp <= p.votingEndsAt) {
            revert ProposalNotEnded();
        }

        Vote storage v = _votes[proposalId][msg.sender];
        if (v.votePower > 0 && allocatedToProposal[msg.sender] == proposalId) {
            uint256 vpToFree = v.votePower;
            proposalVPLocked[msg.sender] -= vpToFree;
            allocatedToProposal[msg.sender] = 0;

            emit VPFreedFromProposal(proposalId, msg.sender, vpToFree);
        }
    }

    /**
     * @dev Delegate casts vote with received VP (backend-signed)
     * @param proposalId Proposal to vote on
     * @param amount VP amount to use
     * @param support True for Yay, false for Nay
     * @param allocationsHash Hash of per-delegator allocations
     * @param expiry Signature expiration
     * @param signature Backend signer signature
     */
    function castDelegatedVote(
        uint256 proposalId,
        uint256 amount,
        bool support,
        bytes32 allocationsHash,
        uint256 expiry,
        bytes calldata signature
    ) external nonReentrant {
        if (delegationSigner == address(0)) revert ZeroAddressDelegationSigner();
        if (block.timestamp > expiry) revert SignatureExpired();

        bytes32 messageHash = keccak256(abi.encodePacked(
            "delegatedVote",
            msg.sender,
            proposalId,
            amount,
            support,
            allocationsHash,
            expiry
        ));
        bytes32 ethSignedHash = messageHash.toEthSignedMessageHash();

        if (usedSignatures[ethSignedHash]) revert SignatureAlreadyUsed();
        usedSignatures[ethSignedHash] = true;

        address recovered = ethSignedHash.recover(signature);
        if (recovered != delegationSigner) revert InvalidDelegationSignature();

        // Proposal validations
        Proposal storage p = _proposals[proposalId];
        if (p.status != ProposalStatus.Active) revert ProposalNotActive();
        if (block.timestamp > p.votingEndsAt) revert ProposalNotActive();
        if (p.proposer == msg.sender) revert CannotVoteOnOwnProposal();
        if (amount == 0) revert ZeroAmount();

        // Check delegate has enough received VP
        uint256 available = getAvailableDelegatedPower(msg.sender, proposalId);
        if (amount > available) revert InsufficientDelegatedPower();

        DelegatedVoteRecord storage record = _delegatedVotes[proposalId][msg.sender];

        if (record.hasVoted) {
            if (record.support != support) revert CannotChangeVoteDirection();
        }

        // Store allocation hash for reward verification
        allocationHashes[proposalId][msg.sender] = allocationsHash;

        // Update tracking
        delegatedVoteAllocated[proposalId][msg.sender] += amount;

        if (!record.hasVoted) {
            record.hasVoted = true;
            record.support = support;
            _proposalDelegates[proposalId].push(msg.sender);
            emit DelegatedVoteCast(proposalId, msg.sender, support, amount);
        } else {
            emit DelegatedVoteIncreased(proposalId, msg.sender, amount, record.totalPowerUsed + amount);
        }

        record.totalPowerUsed += amount;

        // Update proposal
        if (support) {
            p.yayVotes += amount;
        } else {
            p.nayVotes += amount;
        }

        emit VPAllocatedToProposal(proposalId, msg.sender, amount, support, true);
    }

    // ============ Proposal Functions ============

    function propose(
        string calldata title,
        string calldata descriptionHash,
        uint256 value,
        uint256 deadline,
        string calldata deliverables,
        uint256 expiry,
        bytes calldata signature
    ) external requiresPassport("propose", expiry, signature) returns (uint256) {
        if (!canPropose(msg.sender)) revert IneligibleToPropose();
        if (bytes(title).length == 0) revert ZeroAmount();
        if (value == 0) revert ZeroAmount();

        uint256 treasuryBalance = roseToken.balanceOf(treasury);
        if (value > treasuryBalance) revert ProposalValueExceedsTreasury();

        proposalCounter++;
        uint256 proposalId = proposalCounter;

        _proposals[proposalId] = Proposal({
            proposer: msg.sender,
            title: title,
            descriptionHash: descriptionHash,
            value: value,
            deadline: deadline,
            deliverables: deliverables,
            createdAt: block.timestamp,
            votingEndsAt: block.timestamp + VOTING_PERIOD,
            yayVotes: 0,
            nayVotes: 0,
            totalAllocated: 0,
            status: ProposalStatus.Active,
            editCount: 0,
            taskId: 0
        });

        emit ProposalCreated(proposalId, msg.sender, value);
        return proposalId;
    }

    function editProposal(
        uint256 proposalId,
        string calldata title,
        string calldata descriptionHash,
        uint256 value,
        uint256 deadline,
        string calldata deliverables
    ) external {
        Proposal storage p = _proposals[proposalId];
        if (p.proposer != msg.sender) revert OnlyProposerCanEdit();
        if (p.status != ProposalStatus.Active && p.status != ProposalStatus.Failed) {
            revert ProposalNotActive();
        }
        if (p.editCount >= MAX_EDIT_CYCLES) revert MaxEditCyclesReached();

        uint256 treasuryBalance = roseToken.balanceOf(treasury);
        if (value > treasuryBalance) revert ProposalValueExceedsTreasury();

        _resetProposalVotes(proposalId);

        p.title = title;
        p.descriptionHash = descriptionHash;
        p.value = value;
        p.deadline = deadline;
        p.deliverables = deliverables;
        p.votingEndsAt = block.timestamp + VOTING_PERIOD;
        p.yayVotes = 0;
        p.nayVotes = 0;
        p.totalAllocated = 0;
        p.status = ProposalStatus.Active;
        p.editCount++;

        emit ProposalEdited(proposalId, p.editCount);
    }

    function cancelProposal(uint256 proposalId) external {
        Proposal storage p = _proposals[proposalId];
        if (p.proposer != msg.sender) revert OnlyProposerCanCancel();
        if (p.status != ProposalStatus.Active) revert ProposalNotActive();

        _resetProposalVotes(proposalId);
        p.status = ProposalStatus.Cancelled;

        emit ProposalCancelled(proposalId);
    }

    function finalizeProposal(uint256 proposalId) external {
        Proposal storage p = _proposals[proposalId];
        if (p.status != ProposalStatus.Active) revert ProposalNotActive();
        if (block.timestamp <= p.votingEndsAt) revert ProposalNotEnded();

        // Check quorum based on total VP
        uint256 totalVotes = p.yayVotes + p.nayVotes;
        uint256 requiredQuorum = (totalVotingPower * QUORUM_THRESHOLD) / BASIS_POINTS;
        if (totalVotes < requiredQuorum) {
            p.votingEndsAt = block.timestamp + VOTING_PERIOD;
            emit ProposalFinalized(proposalId, ProposalStatus.Active);
            return;
        }

        uint256 yayPercent = totalVotes > 0 ? (p.yayVotes * BASIS_POINTS) / totalVotes : 0;

        if (yayPercent >= PASS_THRESHOLD) {
            p.status = ProposalStatus.Passed;
            emit ProposalFinalized(proposalId, ProposalStatus.Passed);
        } else {
            p.status = ProposalStatus.Failed;
            _userStats[p.proposer].failedProposals++;
            _distributeNayRewards(proposalId);
            emit ProposalFinalized(proposalId, ProposalStatus.Failed);
        }
    }

    function executeProposal(uint256 proposalId) external nonReentrant {
        Proposal storage p = _proposals[proposalId];
        if (p.status != ProposalStatus.Passed) revert ProposalNotActive();

        uint256 taskId = IRoseMarketplace(marketplace).createDAOTask(
            p.proposer,
            p.title,
            p.value,
            p.descriptionHash,
            proposalId
        );

        p.taskId = taskId;
        p.status = ProposalStatus.Executed;
        _proposalToTask[proposalId] = taskId;
        _taskToProposal[taskId] = proposalId;

        emit ProposalExecuted(proposalId, taskId);
    }

    // ============ Marketplace Integration ============

    function updateUserStats(address user, uint256 taskValue, bool isDispute) external onlyMarketplace {
        _taskHistory[user].push(TaskRecord({
            timestamp: block.timestamp,
            value: taskValue,
            isDispute: isDispute
        }));

        UserStats storage stats = _userStats[user];
        if (isDispute) {
            stats.disputes++;
        } else {
            stats.tasksCompleted++;
            stats.totalTaskValue += taskValue;
        }
        stats.lastTaskTimestamp = block.timestamp;

        emit UserStatsUpdated(user, stats.tasksCompleted, stats.totalTaskValue);
    }

    function onTaskComplete(uint256 taskId) external onlyMarketplace {
        uint256 proposalId = _taskToProposal[taskId];
        if (proposalId == 0) revert TaskNotFromProposal();

        Proposal storage p = _proposals[proposalId];
        uint256 value = p.value;

        uint256 daoReward = (value * DAO_MINT_PERCENT) / BASIS_POINTS;
        uint256 yayReward = (value * YAY_VOTER_REWARD) / BASIS_POINTS;
        uint256 proposerReward = (value * PROPOSER_REWARD) / BASIS_POINTS;

        IRoseToken(address(roseToken)).mint(treasury, daoReward);
        IRoseToken(address(roseToken)).mint(p.proposer, proposerReward);
        _distributeYayRewards(proposalId, yayReward);

        emit RewardsDistributed(proposalId, daoReward + yayReward + proposerReward);
    }

    // ============ Claim Functions ============

    function claimVoterRewards(
        ClaimData[] calldata claims,
        uint256 expiry,
        bytes calldata signature
    ) external nonReentrant {
        if (claims.length == 0) revert EmptyClaims();
        if (block.timestamp > expiry) revert SignatureExpired();
        if (delegationSigner == address(0)) revert ZeroAddressDelegationSigner();

        bytes32 messageHash = keccak256(abi.encodePacked(
            "claimVoterRewards",
            msg.sender,
            abi.encode(claims),
            expiry
        ));
        bytes32 ethSignedHash = messageHash.toEthSignedMessageHash();

        if (usedSignatures[ethSignedHash]) revert SignatureAlreadyUsed();
        usedSignatures[ethSignedHash] = true;

        address recovered = ethSignedHash.recover(signature);
        if (recovered != delegationSigner) revert InvalidDelegationSignature();

        uint256 totalReward = 0;
        for (uint256 i = 0; i < claims.length; i++) {
            ClaimData calldata c = claims[i];

            if (voterRewardPool[c.proposalId] == 0) continue;

            uint256 reward;
            if (c.claimType == ClaimType.DirectVoter) {
                if (directVoterRewardClaimed[c.proposalId][msg.sender]) continue;

                reward = (voterRewardPool[c.proposalId] * c.votePower)
                        / voterRewardTotalVotes[c.proposalId];

                directVoterRewardClaimed[c.proposalId][msg.sender] = true;
                emit DirectVoterRewardClaimed(c.proposalId, msg.sender, reward);
            } else {
                if (delegatorRewardClaimed[c.proposalId][c.delegate][msg.sender]) continue;

                reward = (voterRewardPool[c.proposalId] * c.votePower)
                        / voterRewardTotalVotes[c.proposalId];

                delegatorRewardClaimed[c.proposalId][c.delegate][msg.sender] = true;
                emit DelegatorRewardClaimed(c.proposalId, c.delegate, msg.sender, reward);
            }

            totalReward += reward;
        }

        if (totalReward > 0) {
            stakedRose[msg.sender] += totalReward;
            // Recalculate VP with new staked amount
            uint256 rep = getReputation(msg.sender);
            uint256 newVP = getVotePower(stakedRose[msg.sender], rep);
            uint256 oldVP = votingPower[msg.sender];
            votingPower[msg.sender] = newVP;
            totalVotingPower = totalVotingPower - oldVP + newVP;

            emit VotingPowerChanged(msg.sender, stakedRose[msg.sender], newVP, rep);
            emit TotalVPUpdated(totalVotingPower);
            emit TotalRewardsClaimed(msg.sender, totalReward);
        }
    }

    // ============ Admin Functions ============

    function setPassportSigner(address _signer) external onlyOwner {
        if (_signer == address(0)) revert ZeroAddressSigner();
        passportSigner = _signer;
        emit PassportSignerUpdated(_signer);
    }

    function setDelegationSigner(address _signer) external onlyOwner {
        if (_signer == address(0)) revert ZeroAddressDelegationSigner();
        delegationSigner = _signer;
        emit DelegationSignerUpdated(_signer);
    }

    function setMarketplace(address _marketplace) external onlyOwner {
        if (_marketplace == address(0)) revert ZeroAddress();
        marketplace = _marketplace;
    }

    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert ZeroAddress();
        treasury = _treasury;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        owner = newOwner;
    }

    // ============ Internal Functions ============

    function _distributeYayRewards(uint256 proposalId, uint256 totalReward) internal {
        Proposal storage p = _proposals[proposalId];
        if (p.yayVotes == 0) return;

        IRoseToken(address(roseToken)).mint(address(this), totalReward);

        voterRewardPool[proposalId] = totalReward;
        voterRewardTotalVotes[proposalId] = p.yayVotes;
        voterRewardOutcome[proposalId] = true;

        emit VoterRewardPoolCreated(proposalId, totalReward, p.yayVotes, true);
    }

    function _distributeNayRewards(uint256 proposalId) internal {
        Proposal storage p = _proposals[proposalId];
        if (p.nayVotes == 0) return;

        uint256 totalReward = (p.value * NAY_VOTER_REWARD) / BASIS_POINTS;

        IRoseToken(address(roseToken)).mint(address(this), totalReward);

        voterRewardPool[proposalId] = totalReward;
        voterRewardTotalVotes[proposalId] = p.nayVotes;
        voterRewardOutcome[proposalId] = false;

        emit VoterRewardPoolCreated(proposalId, totalReward, p.nayVotes, false);
    }

    function _resetProposalVotes(uint256 proposalId) internal {
        address[] memory voters = _proposalVoters[proposalId];
        for (uint256 i = 0; i < voters.length; i++) {
            Vote storage v = _votes[proposalId][voters[i]];
            if (v.votePower > 0) {
                // Free VP for voters
                if (allocatedToProposal[voters[i]] == proposalId) {
                    proposalVPLocked[voters[i]] -= v.votePower;
                    allocatedToProposal[voters[i]] = 0;
                }
                v.votePower = 0;
            }
        }
        delete _proposalVoters[proposalId];
    }

    function _removeDelegationTarget(address delegator, address delegateAddr) internal {
        address[] storage targets = _delegationTargets[delegator];
        for (uint256 i = 0; i < targets.length; i++) {
            if (targets[i] == delegateAddr) {
                targets[i] = targets[targets.length - 1];
                targets.pop();
                break;
            }
        }
    }

    function _sqrt(uint256 x) internal pure returns (uint256) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        uint256 y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
        return y;
    }
}

// ============ Interface for RoseToken mint ============
interface IRoseToken {
    function mint(address to, uint256 amount) external;
    function burn(address from, uint256 amount) external;
}

// ============ Interface for RoseMarketplace ============
interface IRoseMarketplace {
    function createDAOTask(
        address proposer,
        string calldata title,
        uint256 value,
        string calldata descriptionHash,
        uint256 proposalId
    ) external returns (uint256);
}
