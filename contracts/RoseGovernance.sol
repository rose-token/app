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
 * - Reputation-weighted quadratic voting
 * - Single-depth liquid democracy (delegation)
 * - DAO-sourced tasks funded by treasury
 * - Cached delegation with manual refresh
 *
 * Vote Power = sqrt(allocated ROSE) * (reputation / 100)
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

    // ============ User Staking ============
    mapping(address => uint256) public stakedRose;
    mapping(address => uint256) public allocatedRose;
    uint256 public totalStakedRose;

    // ============ Delegation (single-depth, cached) ============
    mapping(address => address) public delegatedTo;
    mapping(address => EnumerableSet.AddressSet) internal _delegators;
    mapping(address => uint256) public cachedVotePower;
    mapping(address => uint256) public totalDelegatedPower;
    mapping(address => uint256) public delegatedAmount;  // Amount user has delegated

    // ============ Reputation Tracking ============
    mapping(address => UserStats) internal _userStats;

    // ============ Task History (for reputation decay) ============
    // TaskRecord struct is inherited from IRoseGovernance
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
    // Track how much delegated power each delegate has used per proposal
    mapping(uint256 => mapping(address => uint256)) public delegatedVoteAllocated;
    // Delegated vote records (direction, total power used)
    mapping(uint256 => mapping(address => DelegatedVoteRecord)) internal _delegatedVotes;
    // Per-delegator power usage (for proportional rewards)
    mapping(uint256 => mapping(address => mapping(address => uint256))) internal _delegatorVotePower;
    // Delegates who voted on each proposal
    mapping(uint256 => address[]) internal _proposalDelegates;

    // ============ Signature Replay Protection ============
    mapping(bytes32 => bool) public usedSignatures;

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
    uint256 public constant TASK_DECAY_PERIOD = 365 days;    // Tasks count for 1 year
    uint256 public constant DISPUTE_DECAY_PERIOD = 1095 days; // Disputes count for 3 years

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

    function delegators(address delegate) external view returns (address[] memory) {
        return _delegators[delegate].values();
    }

    /**
     * @dev Get task history for a user (for frontend display/debugging)
     */
    function getTaskHistory(address user) external view returns (TaskRecord[] memory) {
        return _taskHistory[user];
    }

    /**
     * @dev Get reputation score (0-100) with time-based decay
     * Tasks count for 1 year, disputes count for 3 years
     * Returns default (60) if cold start not complete
     */
    function getReputation(address user) public view returns (uint256) {
        TaskRecord[] memory history = _taskHistory[user];
        uint256 failedProposals = _userStats[user].failedProposals;

        // Calculate cutoff timestamps
        uint256 taskCutoff = block.timestamp > TASK_DECAY_PERIOD
            ? block.timestamp - TASK_DECAY_PERIOD
            : 0;
        uint256 disputeCutoff = block.timestamp > DISPUTE_DECAY_PERIOD
            ? block.timestamp - DISPUTE_DECAY_PERIOD
            : 0;

        // Count recent tasks and disputes
        uint256 recentTaskCount = 0;
        uint256 recentTaskValue = 0;
        uint256 recentDisputes = 0;

        for (uint256 i = 0; i < history.length; i++) {
            TaskRecord memory record = history[i];

            if (record.isDispute) {
                // Disputes count for 3 years
                if (record.timestamp >= disputeCutoff) {
                    recentDisputes++;
                }
            } else {
                // Tasks count for 1 year
                if (record.timestamp >= taskCutoff) {
                    recentTaskCount++;
                    recentTaskValue += record.value;
                }
            }
        }

        // Cold start: return 60% if less than 10 recent tasks
        if (recentTaskCount < COLD_START_TASKS) {
            return DEFAULT_REPUTATION;
        }

        // No recent task value
        if (recentTaskValue == 0) {
            return DEFAULT_REPUTATION;
        }

        // Calculate: ((totalValue - penalties * avgValue) * 100) / totalValue
        // failedProposals count at 0.2x weight
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
     * @dev Check if user can propose
     */
    function canPropose(address user) public view returns (bool) {
        UserStats memory stats = _userStats[user];
        if (stats.tasksCompleted < COLD_START_TASKS) return false;
        return getReputation(user) >= PROPOSER_REP_THRESHOLD;
    }

    /**
     * @dev Check if user can vote
     */
    function canVote(address user) public view returns (bool) {
        return getReputation(user) >= VOTER_REP_THRESHOLD;
    }

    /**
     * @dev Check if user can be a delegate
     */
    function canDelegate(address user) public view returns (bool) {
        UserStats memory stats = _userStats[user];
        if (stats.tasksCompleted < COLD_START_TASKS) return false;
        return getReputation(user) >= DELEGATE_REP_THRESHOLD;
    }

    /**
     * @dev Get quorum progress for a proposal
     */
    function getQuorumProgress(uint256 proposalId) public view returns (uint256 current, uint256 required) {
        Proposal memory p = _proposals[proposalId];
        current = p.totalAllocated;
        required = (totalStakedRose * QUORUM_THRESHOLD) / BASIS_POINTS;
    }

    /**
     * @dev Get vote result percentages
     */
    function getVoteResult(uint256 proposalId) public view returns (uint256 yayPercent, uint256 nayPercent) {
        Proposal memory p = _proposals[proposalId];
        uint256 totalVotes = p.yayVotes + p.nayVotes;
        if (totalVotes == 0) return (0, 0);
        yayPercent = (p.yayVotes * BASIS_POINTS) / totalVotes;
        nayPercent = (p.nayVotes * BASIS_POINTS) / totalVotes;
    }

    /**
     * @dev Get available delegated power for voting on a proposal
     */
    function getAvailableDelegatedPower(address delegate, uint256 proposalId) public view returns (uint256) {
        uint256 total = totalDelegatedPower[delegate];
        uint256 used = delegatedVoteAllocated[proposalId][delegate];
        return total > used ? total - used : 0;
    }

    /**
     * @dev Get delegated vote record for a delegate on a proposal
     */
    function getDelegatedVote(uint256 proposalId, address delegate) external view returns (DelegatedVoteRecord memory) {
        return _delegatedVotes[proposalId][delegate];
    }

    /**
     * @dev Get how much of a delegator's power was used in a delegated vote
     */
    function getDelegatorVotePower(uint256 proposalId, address delegate, address delegator) external view returns (uint256) {
        return _delegatorVotePower[proposalId][delegate][delegator];
    }

    /**
     * @dev Get all delegates who voted on a proposal (for iteration)
     */
    function getProposalDelegates(uint256 proposalId) external view returns (address[] memory) {
        return _proposalDelegates[proposalId];
    }

    // ============ Staking Functions ============

    /**
     * @dev Deposit ROSE to governance, receive vROSE 1:1
     */
    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        roseToken.safeTransferFrom(msg.sender, address(this), amount);
        vRoseToken.mint(msg.sender, amount);

        stakedRose[msg.sender] += amount;
        totalStakedRose += amount;

        emit Deposited(msg.sender, amount);
    }

    /**
     * @dev Withdraw ROSE from governance, burn vROSE
     * Requires: unallocated ROSE + vROSE balance (not in marketplace escrow)
     */
    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        uint256 unallocated = stakedRose[msg.sender] - allocatedRose[msg.sender];
        if (unallocated < amount) revert InsufficientUnallocated();

        // vROSE in marketplace escrow is not in user's balance, so this naturally
        // prevents withdrawing when vROSE is staked in active tasks
        uint256 vRoseBalance = vRoseToken.balanceOf(msg.sender);
        if (vRoseBalance < amount) revert InsufficientVRose();

        vRoseToken.burn(msg.sender, amount);

        stakedRose[msg.sender] -= amount;
        totalStakedRose -= amount;

        roseToken.safeTransfer(msg.sender, amount);

        emit Withdrawn(msg.sender, amount);
    }

    // ============ Delegation Functions ============

    /**
     * @dev Delegate voting power to another user
     */
    function allocateToDelegate(address delegate, uint256 amount) external nonReentrant {
        if (delegate == address(0)) revert ZeroAddress();
        if (delegate == msg.sender) revert CannotDelegateToSelf();
        if (amount == 0) revert ZeroAmount();
        if (!canDelegate(delegate)) revert IneligibleToDelegate();
        // Allow increasing allocation to same delegate, block different delegate
        if (delegatedTo[msg.sender] != address(0) && delegatedTo[msg.sender] != delegate) {
            revert AlreadyDelegating();
        }
        if (delegatedTo[delegate] != address(0)) revert DelegationChainNotAllowed();

        uint256 unallocated = stakedRose[msg.sender] - allocatedRose[msg.sender];
        if (unallocated < amount) revert InsufficientUnallocated();

        // Track if this is an increase to existing delegation
        bool isIncrease = delegatedTo[msg.sender] == delegate;

        // For increases: subtract old power first
        if (isIncrease) {
            totalDelegatedPower[delegate] -= cachedVotePower[msg.sender];
        }

        // Calculate new total amount and vote power
        uint256 newTotalAmount = delegatedAmount[msg.sender] + amount;
        uint256 votePower = getVotePower(newTotalAmount, getReputation(msg.sender));
        cachedVotePower[msg.sender] = votePower;

        // Update delegation state
        delegatedAmount[msg.sender] = newTotalAmount;
        totalDelegatedPower[delegate] += votePower;
        allocatedRose[msg.sender] += amount;

        // Only set delegatedTo and add to delegators set for NEW delegations
        if (!isIncrease) {
            delegatedTo[msg.sender] = delegate;
            _delegators[delegate].add(msg.sender);
        }

        emit DelegatedTo(msg.sender, delegate, newTotalAmount);
    }

    /**
     * @dev Remove delegation
     */
    function unallocateFromDelegate() external nonReentrant {
        address delegate = delegatedTo[msg.sender];
        if (delegate == address(0)) revert NotDelegating();

        uint256 votePower = cachedVotePower[msg.sender];
        uint256 amount = delegatedAmount[msg.sender];

        // Update totals
        totalDelegatedPower[delegate] -= votePower;
        allocatedRose[msg.sender] -= amount;

        // Clear delegation
        cachedVotePower[msg.sender] = 0;
        delegatedTo[msg.sender] = address(0);
        delegatedAmount[msg.sender] = 0;
        _removeDelegator(delegate, msg.sender);

        emit Undelegated(msg.sender, delegate, amount);
    }

    /**
     * @dev Refresh cached vote power for a delegator
     * Callable by anyone (permissionless)
     */
    function refreshDelegation(address user) external {
        address delegate = delegatedTo[user];
        if (delegate == address(0)) return;

        uint256 oldPower = cachedVotePower[user];
        uint256 amount = delegatedAmount[user];
        uint256 newPower = getVotePower(amount, getReputation(user));

        cachedVotePower[user] = newPower;
        totalDelegatedPower[delegate] = totalDelegatedPower[delegate] - oldPower + newPower;

        emit DelegationRefreshed(user, oldPower, newPower);
    }

    // ============ Voting Functions ============

    /**
     * @dev Vote on a proposal by allocating ROSE
     * Can be called multiple times to increase allocation (same direction only)
     */
    function allocateToProposal(uint256 proposalId, uint256 amount, bool support) external nonReentrant {
        Proposal storage p = _proposals[proposalId];
        if (p.status != ProposalStatus.Active) revert ProposalNotActive();
        if (block.timestamp > p.votingEndsAt) revert ProposalNotActive();
        if (p.proposer == msg.sender) revert CannotVoteOnOwnProposal();
        if (!canVote(msg.sender)) revert IneligibleToVote();
        if (amount == 0) revert ZeroAmount();

        uint256 unallocated = stakedRose[msg.sender] - allocatedRose[msg.sender];
        if (unallocated < amount) revert InsufficientUnallocated();

        Vote storage existingVote = _votes[proposalId][msg.sender];

        if (existingVote.hasVoted) {
            // User already voted - allow adding to existing vote (same direction only)
            if (existingVote.support != support) revert CannotChangeVoteDirection();

            // Calculate additional vote power using new total amount
            uint256 newTotalAmount = existingVote.allocatedAmount + amount;
            uint256 oldVotePower = existingVote.votePower;
            uint256 newVotePower = getVotePower(newTotalAmount, getReputation(msg.sender));
            uint256 additionalPower = newVotePower - oldVotePower;

            // Update vote record
            existingVote.votePower = newVotePower;
            existingVote.allocatedAmount = newTotalAmount;

            // Update proposal tallies
            if (support) {
                p.yayVotes += additionalPower;
            } else {
                p.nayVotes += additionalPower;
            }
            p.totalAllocated += amount;
            allocatedRose[msg.sender] += amount;

            emit VoteIncreased(proposalId, msg.sender, amount, newVotePower);
        } else {
            // First vote
            uint256 votePower = getVotePower(amount, getReputation(msg.sender));

            // Record vote
            _votes[proposalId][msg.sender] = Vote({
                hasVoted: true,
                support: support,
                votePower: votePower,
                allocatedAmount: amount
            });
            _proposalVoters[proposalId].push(msg.sender);

            // Update proposal tallies
            if (support) {
                p.yayVotes += votePower;
            } else {
                p.nayVotes += votePower;
            }
            p.totalAllocated += amount;
            allocatedRose[msg.sender] += amount;

            emit VoteCast(proposalId, msg.sender, support, votePower);
        }
    }

    /**
     * @dev Unallocate ROSE from a finished proposal
     */
    function unallocateFromProposal(uint256 proposalId) external nonReentrant {
        Proposal storage p = _proposals[proposalId];
        if (p.status == ProposalStatus.Active && block.timestamp <= p.votingEndsAt) {
            revert ProposalNotEnded();
        }

        Vote storage v = _votes[proposalId][msg.sender];
        if (!v.hasVoted || v.allocatedAmount == 0) revert ZeroAmount();

        uint256 amount = v.allocatedAmount;
        allocatedRose[msg.sender] -= amount;
        v.allocatedAmount = 0;

        emit VoteUnallocated(proposalId, msg.sender, amount);
    }

    /**
     * @dev Delegate casts vote with partial delegated power
     * Can be called multiple times to increase vote (same direction only)
     */
    function castDelegatedVote(uint256 proposalId, uint256 amount, bool support) external nonReentrant {
        Proposal storage p = _proposals[proposalId];
        if (p.status != ProposalStatus.Active) revert ProposalNotActive();
        if (block.timestamp > p.votingEndsAt) revert ProposalNotActive();
        if (p.proposer == msg.sender) revert CannotVoteOnOwnProposal();
        if (amount == 0) revert ZeroAmount();

        // Check available delegated power
        uint256 available = getAvailableDelegatedPower(msg.sender, proposalId);
        if (amount > available) revert InsufficientDelegatedPower();

        DelegatedVoteRecord storage record = _delegatedVotes[proposalId][msg.sender];

        // Check vote direction consistency
        if (record.hasVoted) {
            if (record.support != support) revert CannotChangeVoteDirection();
        }

        // Allocate power from delegators proportionally
        _allocateDelegatorPower(proposalId, amount);

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

        // Update proposal tallies
        if (support) {
            p.yayVotes += amount;
        } else {
            p.nayVotes += amount;
        }
    }

    /**
     * @dev Internal function to allocate delegated power from delegators proportionally
     */
    function _allocateDelegatorPower(uint256 proposalId, uint256 amount) internal {
        address[] memory delegatorList = _delegators[msg.sender].values();
        uint256 totalPower = totalDelegatedPower[msg.sender];
        uint256 remainingToAllocate = amount;

        for (uint256 i = 0; i < delegatorList.length && remainingToAllocate > 0; i++) {
            address delegator = delegatorList[i];
            uint256 delegatorPower = cachedVotePower[delegator];

            // Calculate proportional share
            uint256 proportionalShare = (amount * delegatorPower) / totalPower;

            // Check what's still available from this delegator
            uint256 alreadyUsedFromDelegator = _delegatorVotePower[proposalId][msg.sender][delegator];
            uint256 availableFromDelegator = delegatorPower > alreadyUsedFromDelegator
                ? delegatorPower - alreadyUsedFromDelegator
                : 0;

            uint256 toUse = proportionalShare > availableFromDelegator
                ? availableFromDelegator
                : proportionalShare;
            toUse = toUse > remainingToAllocate ? remainingToAllocate : toUse;

            if (toUse > 0) {
                _delegatorVotePower[proposalId][msg.sender][delegator] += toUse;
                remainingToAllocate -= toUse;
            }
        }

        // Handle any remainder due to rounding - assign to first delegator with capacity
        if (remainingToAllocate > 0) {
            for (uint256 i = 0; i < delegatorList.length && remainingToAllocate > 0; i++) {
                address delegator = delegatorList[i];
                uint256 delegatorPower = cachedVotePower[delegator];
                uint256 used = _delegatorVotePower[proposalId][msg.sender][delegator];
                uint256 availableFromDelegator = delegatorPower > used ? delegatorPower - used : 0;

                if (availableFromDelegator > 0) {
                    uint256 toUse = availableFromDelegator > remainingToAllocate ? remainingToAllocate : availableFromDelegator;
                    _delegatorVotePower[proposalId][msg.sender][delegator] += toUse;
                    remainingToAllocate -= toUse;
                }
            }
        }
    }

    // ============ Proposal Functions ============

    /**
     * @dev Create a new proposal
     */
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

        // Check treasury has enough ROSE
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

    /**
     * @dev Edit a proposal (resets votes, restarts timer)
     */
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

        // Check treasury has enough ROSE
        uint256 treasuryBalance = roseToken.balanceOf(treasury);
        if (value > treasuryBalance) revert ProposalValueExceedsTreasury();

        // Reset votes - unallocate all voters
        _resetProposalVotes(proposalId);

        // Update proposal
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

    /**
     * @dev Cancel a proposal
     */
    function cancelProposal(uint256 proposalId) external {
        Proposal storage p = _proposals[proposalId];
        if (p.proposer != msg.sender) revert OnlyProposerCanCancel();
        if (p.status != ProposalStatus.Active) revert ProposalNotActive();

        _resetProposalVotes(proposalId);
        p.status = ProposalStatus.Cancelled;

        emit ProposalCancelled(proposalId);
    }

    /**
     * @dev Finalize a proposal after voting ends
     * Permissionless - anyone can call
     */
    function finalizeProposal(uint256 proposalId) external {
        Proposal storage p = _proposals[proposalId];
        if (p.status != ProposalStatus.Active) revert ProposalNotActive();
        if (block.timestamp <= p.votingEndsAt) revert ProposalNotEnded();

        // Check quorum
        uint256 requiredQuorum = (totalStakedRose * QUORUM_THRESHOLD) / BASIS_POINTS;
        if (p.totalAllocated < requiredQuorum) {
            // Quorum not met - reset timer for edit
            p.votingEndsAt = block.timestamp + VOTING_PERIOD;
            emit ProposalFinalized(proposalId, ProposalStatus.Active);
            return;
        }

        // Calculate result
        uint256 totalVotes = p.yayVotes + p.nayVotes;
        uint256 yayPercent = totalVotes > 0 ? (p.yayVotes * BASIS_POINTS) / totalVotes : 0;

        if (yayPercent >= PASS_THRESHOLD) {
            p.status = ProposalStatus.Passed;
            emit ProposalFinalized(proposalId, ProposalStatus.Passed);
        } else {
            p.status = ProposalStatus.Failed;
            // Proposer takes reputation hit
            _userStats[p.proposer].failedProposals++;
            // Distribute rewards to Nay voters
            _distributeNayRewards(proposalId);
            emit ProposalFinalized(proposalId, ProposalStatus.Failed);
        }
    }

    /**
     * @dev Execute a passed proposal - creates DAO task
     */
    function executeProposal(uint256 proposalId) external nonReentrant {
        Proposal storage p = _proposals[proposalId];
        if (p.status != ProposalStatus.Passed) revert ProposalNotActive();

        // Create task in marketplace
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

    /**
     * @dev Update user stats when task completes
     * Called by marketplace
     * Records task in history for time-based reputation decay
     */
    function updateUserStats(address user, uint256 taskValue, bool isDispute) external onlyMarketplace {
        // Add to task history for time-based decay
        _taskHistory[user].push(TaskRecord({
            timestamp: block.timestamp,
            value: taskValue,
            isDispute: isDispute
        }));

        // Keep aggregate counters for gas-efficient reads when decay not needed
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

    /**
     * @dev Handle DAO task completion - distribute rewards
     * Called by marketplace
     */
    function onTaskComplete(uint256 taskId) external onlyMarketplace {
        uint256 proposalId = _taskToProposal[taskId];
        if (proposalId == 0) revert TaskNotFromProposal();

        Proposal storage p = _proposals[proposalId];
        uint256 value = p.value;

        // Mint rewards
        uint256 daoReward = (value * DAO_MINT_PERCENT) / BASIS_POINTS;
        uint256 yayReward = (value * YAY_VOTER_REWARD) / BASIS_POINTS;
        uint256 proposerReward = (value * PROPOSER_REWARD) / BASIS_POINTS;

        // Mint to treasury (2%)
        IRoseToken(address(roseToken)).mint(treasury, daoReward);

        // Mint to proposer (1%)
        IRoseToken(address(roseToken)).mint(p.proposer, proposerReward);

        // Distribute to Yay voters (2%)
        _distributeYayRewards(proposalId, yayReward);

        emit RewardsDistributed(proposalId, daoReward + yayReward + proposerReward);
    }

    // ============ Admin Functions ============

    function setPassportSigner(address _signer) external onlyOwner {
        if (_signer == address(0)) revert ZeroAddressSigner();
        passportSigner = _signer;
        emit PassportSignerUpdated(_signer);
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

        // Distribute to direct voters
        address[] memory voters = _proposalVoters[proposalId];
        for (uint256 i = 0; i < voters.length; i++) {
            Vote storage v = _votes[proposalId][voters[i]];
            if (v.hasVoted && v.support) {
                uint256 voterReward = (totalReward * v.votePower) / p.yayVotes;
                IRoseToken(address(roseToken)).mint(voters[i], voterReward);
            }
        }

        // Distribute to delegators whose power was used in Yay delegated votes
        _distributeDelegatorRewards(proposalId, totalReward, p.yayVotes, true);
    }

    function _distributeNayRewards(uint256 proposalId) internal {
        Proposal storage p = _proposals[proposalId];
        if (p.nayVotes == 0) return;

        uint256 totalReward = (p.value * NAY_VOTER_REWARD) / BASIS_POINTS;

        // Distribute to direct voters
        address[] memory voters = _proposalVoters[proposalId];
        for (uint256 i = 0; i < voters.length; i++) {
            Vote storage v = _votes[proposalId][voters[i]];
            if (v.hasVoted && !v.support) {
                uint256 voterReward = (totalReward * v.votePower) / p.nayVotes;
                IRoseToken(address(roseToken)).mint(voters[i], voterReward);
            }
        }

        // Distribute to delegators whose power was used in Nay delegated votes
        _distributeDelegatorRewards(proposalId, totalReward, p.nayVotes, false);
    }

    /**
     * @dev Distribute rewards to delegators based on their used power
     */
    function _distributeDelegatorRewards(
        uint256 proposalId,
        uint256 totalReward,
        uint256 totalVotes,
        bool forYay
    ) internal {
        address[] memory delegates = _proposalDelegates[proposalId];

        for (uint256 i = 0; i < delegates.length; i++) {
            address delegate = delegates[i];
            DelegatedVoteRecord storage record = _delegatedVotes[proposalId][delegate];

            if (record.hasVoted && record.support == forYay) {
                // Distribute to each delegator based on their contribution
                address[] memory delegatorList = _delegators[delegate].values();

                for (uint256 j = 0; j < delegatorList.length; j++) {
                    address delegator = delegatorList[j];
                    uint256 powerUsed = _delegatorVotePower[proposalId][delegate][delegator];

                    if (powerUsed > 0) {
                        uint256 delegatorReward = (totalReward * powerUsed) / totalVotes;
                        IRoseToken(address(roseToken)).mint(delegator, delegatorReward);
                    }
                }
            }
        }
    }

    function _resetProposalVotes(uint256 proposalId) internal {
        address[] memory voters = _proposalVoters[proposalId];
        for (uint256 i = 0; i < voters.length; i++) {
            Vote storage v = _votes[proposalId][voters[i]];
            if (v.allocatedAmount > 0) {
                allocatedRose[voters[i]] -= v.allocatedAmount;
                v.allocatedAmount = 0;
            }
        }
        delete _proposalVoters[proposalId];
    }

    function _removeDelegator(address delegate, address delegator) internal {
        _delegators[delegate].remove(delegator);
    }

    function _getAllocatedToDelegate(address user) internal view returns (uint256) {
        return delegatedAmount[user];
    }

    /**
     * @dev Integer square root using Babylonian method
     */
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
