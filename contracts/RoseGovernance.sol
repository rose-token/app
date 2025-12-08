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
import "./interfaces/IRoseReputation.sol";

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
    IRoseReputation public reputation;

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

    // ============ Proposals ============
    uint256 public proposalCounter;
    mapping(uint256 => Proposal) internal _proposals;
    mapping(uint256 => mapping(address => Vote)) internal _votes;
    mapping(uint256 => address[]) internal _proposalVoters;
    mapping(uint256 => uint256) internal _proposalToTask;
    mapping(uint256 => uint256) internal _taskToProposal;

    // ============ Delegated Voting Tracking ============
    mapping(uint256 => mapping(address => uint256)) public delegatedVoteAllocated;
    mapping(uint256 => mapping(address => DelegatedVoteRecord)) internal _delegatedVotes;
    mapping(uint256 => address[]) internal _proposalDelegates;

    // ============ Signature Replay Protection ============
    mapping(bytes32 => bool) public usedSignatures;

    // ============ Signers ============
    address public delegationSigner;
    mapping(uint256 => mapping(address => bytes32)) public allocationHashes;

    // ============ Phase 1: Liquid Democracy Enhancements ============
    // Nonce per delegate - bumped on delegation changes to invalidate stale signatures
    mapping(address => uint256) public delegationNonce;

    // Global delegated VP budget - tracks total VP used across ALL active proposals
    mapping(address => uint256) public delegatedUsedTotal;

    // Per-delegator contribution tracking for vote reduction on undelegation
    // proposalId => delegate => delegator => vpContribution
    mapping(uint256 => mapping(address => mapping(address => uint256))) public delegatorVoteContribution;

    // Track active proposals for each delegator (for cleanup on undelegation)
    mapping(address => uint256[]) internal _delegatorActiveProposals;

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
    uint256 public constant BASIS_POINTS = 10000;

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
        address _passportSigner,
        address _reputation
    ) {
        if (_roseToken == address(0)) revert ZeroAddress();
        if (_vRoseToken == address(0)) revert ZeroAddress();
        if (_marketplace == address(0)) revert ZeroAddress();
        if (_treasury == address(0)) revert ZeroAddress();
        if (_passportSigner == address(0)) revert ZeroAddressSigner();
        if (_reputation == address(0)) revert ZeroAddress();

        roseToken = IERC20(_roseToken);
        vRoseToken = IvROSE(_vRoseToken);
        marketplace = _marketplace;
        treasury = _treasury;
        passportSigner = _passportSigner;
        reputation = IRoseReputation(_reputation);
        owner = msg.sender;
    }

    // ============ View Functions ============

    function proposals(uint256 proposalId) external view returns (Proposal memory) {
        return _proposals[proposalId];
    }

    function votes(uint256 proposalId, address voter) external view returns (Vote memory) {
        return _votes[proposalId][voter];
    }

    function delegators(address delegateAddr) external view returns (address[] memory) {
        return _delegators[delegateAddr].values();
    }

    /**
     * @dev Calculate vote power: sqrt(amount) * (rep / 100)
     */
    function getVotePower(uint256 amount, uint256 rep) public pure returns (uint256) {
        if (amount == 0 || rep == 0) return 0;
        uint256 sqrtAmount = _sqrt(amount);
        return (sqrtAmount * rep) / 100;
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

    function canReceiveDelegation(address user) public view returns (bool) {
        return totalDelegatedOut[user] == 0;
    }

    function canDelegateOut(address user) public view returns (bool) {
        return totalDelegatedIn[user] == 0;
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

    /**
     * @dev Get globally available delegated VP (not used on ANY active proposal)
     * Used for checking if delegate has VP budget available
     */
    function getGlobalAvailableDelegatedPower(address delegateAddr) public view returns (uint256) {
        uint256 total = totalDelegatedIn[delegateAddr];
        uint256 usedGlobal = delegatedUsedTotal[delegateAddr];
        return total > usedGlobal ? total - usedGlobal : 0;
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
     * VP is calculated using backend-attested reputation (^0.6 formula)
     * @param amount Amount of ROSE to deposit
     * @param attestedRep Backend-computed reputation score (0-100)
     * @param repExpiry Attestation expiry timestamp
     * @param repSignature Backend signature for reputation attestation
     */
    function deposit(
        uint256 amount,
        uint256 attestedRep,
        uint256 repExpiry,
        bytes calldata repSignature
    ) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (!reputation.validateReputationSignature(msg.sender, attestedRep, repExpiry, repSignature)) {
            revert InvalidSignature();
        }

        roseToken.safeTransferFrom(msg.sender, address(this), amount);
        vRoseToken.mint(msg.sender, amount);

        // Calculate VP using attested reputation
        uint256 newTotalStaked = stakedRose[msg.sender] + amount;
        uint256 newVP = getVotePower(newTotalStaked, attestedRep);
        uint256 oldVP = votingPower[msg.sender];
        uint256 vpIncrease = newVP - oldVP;

        // Update state
        stakedRose[msg.sender] = newTotalStaked;
        votingPower[msg.sender] = newVP;
        totalStakedRose += amount;
        totalVotingPower += vpIncrease;

        emit VotingPowerChanged(msg.sender, newTotalStaked, newVP, attestedRep);
        emit TotalVPUpdated(totalVotingPower);
        emit Deposited(msg.sender, amount);
    }

    /**
     * @dev Withdraw ROSE from governance, burn vROSE
     * Requires sufficient available VP (not delegated, not on proposals)
     * @param amount Amount of ROSE to withdraw
     * @param attestedRep Backend-computed reputation score (0-100)
     * @param repExpiry Attestation expiry timestamp
     * @param repSignature Backend signature for reputation attestation
     */
    function withdraw(
        uint256 amount,
        uint256 attestedRep,
        uint256 repExpiry,
        bytes calldata repSignature
    ) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (!reputation.validateReputationSignature(msg.sender, attestedRep, repExpiry, repSignature)) {
            revert InvalidSignature();
        }
        if (stakedRose[msg.sender] < amount) revert InsufficientStake();

        // Calculate available VP
        uint256 currentVP = votingPower[msg.sender];
        uint256 lockedVP = totalDelegatedOut[msg.sender] + proposalVPLocked[msg.sender];
        uint256 availableVP = currentVP > lockedVP ? currentVP - lockedVP : 0;

        // Calculate VP being withdrawn using attested reputation
        uint256 newTotalStaked = stakedRose[msg.sender] - amount;
        uint256 newVP = getVotePower(newTotalStaked, attestedRep);
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

        emit VotingPowerChanged(msg.sender, newTotalStaked, newVP, attestedRep);
        emit TotalVPUpdated(totalVotingPower);
        emit Withdrawn(msg.sender, amount);
    }

    // ============ Multi-Delegation Functions ============

    /**
     * @dev Delegate VP to another user (supports multi-delegation)
     * @param delegateAddr Address to delegate to
     * @param vpAmount Amount of VP to delegate
     * @param attestedRep Backend-computed reputation score for sender (0-100)
     * @param repExpiry Attestation expiry timestamp
     * @param repSignature Backend signature for reputation attestation
     */
    function delegate(
        address delegateAddr,
        uint256 vpAmount,
        uint256 attestedRep,
        uint256 repExpiry,
        bytes calldata repSignature
    ) external nonReentrant {
        if (delegateAddr == address(0)) revert ZeroAddress();
        if (delegateAddr == msg.sender) revert CannotDelegateToSelf();
        if (vpAmount == 0) revert ZeroAmount();
        if (!reputation.validateReputationSignature(msg.sender, attestedRep, repExpiry, repSignature)) {
            revert InvalidSignature();
        }
        // Check sender eligibility using attested reputation
        if (attestedRep < reputation.VOTER_REP_THRESHOLD()) revert IneligibleToVote();
        // Check delegate eligibility using on-chain reputation (delegate not calling)
        if (!reputation.canDelegate(delegateAddr)) revert IneligibleToDelegate();

        // Prevent delegation chains - max depth 1
        if (totalDelegatedIn[msg.sender] > 0) revert DelegationChainNotAllowed();
        if (totalDelegatedOut[delegateAddr] > 0) revert DelegationChainNotAllowed();

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

        // Bump nonce to invalidate any pending signatures
        delegationNonce[delegateAddr]++;
        emit DelegationNonceIncremented(delegateAddr, delegationNonce[delegateAddr]);

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

        // Bump nonce to invalidate any pending signatures
        delegationNonce[delegateAddr]++;
        emit DelegationNonceIncremented(delegateAddr, delegationNonce[delegateAddr]);

        emit DelegationChanged(msg.sender, delegateAddr, vpAmount, false);
    }

    /**
     * @dev Phase 1: Undelegate with vote reduction on active proposals
     * Reduces votes proportionally when delegator removes delegation
     * @param delegateAddr Address to undelegate from
     * @param vpAmount Amount of VP to undelegate
     * @param reductions Array of vote reductions for active proposals
     * @param expiry Signature expiration
     * @param signature Backend signer signature
     */
    function undelegateWithVoteReduction(
        address delegateAddr,
        uint256 vpAmount,
        VoteReduction[] calldata reductions,
        uint256 expiry,
        bytes calldata signature
    ) external nonReentrant {
        if (delegationSigner == address(0)) revert ZeroAddressDelegationSigner();
        if (block.timestamp > expiry) revert SignatureExpired();
        if (vpAmount == 0) revert ZeroAmount();
        if (delegatedVP[msg.sender][delegateAddr] < vpAmount) revert InsufficientDelegated();

        // Verify backend signature for vote reductions
        bytes32 messageHash = keccak256(abi.encodePacked(
            "undelegateWithReduction",
            msg.sender,
            delegateAddr,
            vpAmount,
            keccak256(abi.encode(reductions)),
            expiry
        ));
        bytes32 ethSignedHash = messageHash.toEthSignedMessageHash();

        if (usedSignatures[ethSignedHash]) revert SignatureAlreadyUsed();
        usedSignatures[ethSignedHash] = true;

        address recovered = ethSignedHash.recover(signature);
        if (recovered != delegationSigner) revert InvalidDelegationSignature();

        // Apply vote reductions for active proposals
        for (uint256 i = 0; i < reductions.length; i++) {
            VoteReduction calldata r = reductions[i];
            Proposal storage p = _proposals[r.proposalId];

            // Only reduce votes for active proposals
            if (p.status != ProposalStatus.Active) continue;

            // Verify the reduction is for this delegate and delegator has contribution
            uint256 contribution = delegatorVoteContribution[r.proposalId][r.delegate][msg.sender];
            if (contribution == 0) continue;

            // Calculate proportional reduction based on VP being undelegated
            uint256 currentDelegatedVP = delegatedVP[msg.sender][delegateAddr];
            uint256 reductionAmount = (contribution * vpAmount) / currentDelegatedVP;
            if (reductionAmount > contribution) reductionAmount = contribution;
            if (reductionAmount > r.vpToRemove) reductionAmount = r.vpToRemove;

            // Reduce proposal votes
            if (r.support) {
                if (p.yayVotes >= reductionAmount) {
                    p.yayVotes -= reductionAmount;
                }
            } else {
                if (p.nayVotes >= reductionAmount) {
                    p.nayVotes -= reductionAmount;
                }
            }

            // Update tracking
            if (delegatedVoteAllocated[r.proposalId][r.delegate] >= reductionAmount) {
                delegatedVoteAllocated[r.proposalId][r.delegate] -= reductionAmount;
            }

            DelegatedVoteRecord storage record = _delegatedVotes[r.proposalId][r.delegate];
            if (record.totalPowerUsed >= reductionAmount) {
                record.totalPowerUsed -= reductionAmount;
            }

            // Reduce global VP budget
            if (delegatedUsedTotal[r.delegate] >= reductionAmount) {
                delegatedUsedTotal[r.delegate] -= reductionAmount;
            }

            // Clear delegator's contribution for this proposal
            delegatorVoteContribution[r.proposalId][r.delegate][msg.sender] -= reductionAmount;

            emit VoteReduced(r.proposalId, r.delegate, msg.sender, reductionAmount);
        }

        // Standard undelegate logic
        delegatedVP[msg.sender][delegateAddr] -= vpAmount;
        totalDelegatedOut[msg.sender] -= vpAmount;
        totalDelegatedIn[delegateAddr] -= vpAmount;

        // Remove from targets if fully undelegated
        if (delegatedVP[msg.sender][delegateAddr] == 0) {
            _removeDelegationTarget(msg.sender, delegateAddr);
            _delegators[delegateAddr].remove(msg.sender);
        }

        // Bump nonce to invalidate any pending signatures
        delegationNonce[delegateAddr]++;
        emit DelegationNonceIncremented(delegateAddr, delegationNonce[delegateAddr]);

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
     * @dev Vote on a proposal with VP (requires passport + reputation signatures)
     * VP is locked to ONE proposal at a time
     * @param proposalId Proposal to vote on
     * @param vpAmount VP to allocate
     * @param support True for Yay, false for Nay
     * @param expiry Passport signature expiration
     * @param signature Passport signer signature
     * @param attestedRep Backend-computed reputation score (0-100)
     * @param repExpiry Reputation attestation expiry
     * @param repSignature Reputation attestation signature
     */
    function vote(
        uint256 proposalId,
        uint256 vpAmount,
        bool support,
        uint256 expiry,
        bytes calldata signature,
        uint256 attestedRep,
        uint256 repExpiry,
        bytes calldata repSignature
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

        // Verify reputation attestation
        if (!reputation.validateReputationSignature(msg.sender, attestedRep, repExpiry, repSignature)) {
            revert InvalidSignature();
        }

        // Proposal validations
        Proposal storage p = _proposals[proposalId];
        if (p.status != ProposalStatus.Active) revert ProposalNotActive();
        if (block.timestamp > p.votingEndsAt) revert ProposalNotActive();
        if (p.proposer == msg.sender) revert CannotVoteOnOwnProposal();
        // Check eligibility using attested reputation
        if (attestedRep < reputation.VOTER_REP_THRESHOLD()) revert IneligibleToVote();
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
     * @dev Phase 1: Free delegated VP after proposal ends
     * Releases global VP budget for the delegate
     * Can only be called once per proposal (guards against double-free)
     * @param proposalId Proposal to free VP from
     */
    function freeDelegatedVP(uint256 proposalId) external nonReentrant {
        Proposal storage p = _proposals[proposalId];
        if (p.status == ProposalStatus.Active && block.timestamp <= p.votingEndsAt) {
            revert ProposalStillActive();
        }

        uint256 used = delegatedVoteAllocated[proposalId][msg.sender];
        if (used > 0) {
            // Clear the per-proposal allocation FIRST to prevent double-free
            delegatedVoteAllocated[proposalId][msg.sender] = 0;

            // Release from global budget
            if (delegatedUsedTotal[msg.sender] >= used) {
                delegatedUsedTotal[msg.sender] -= used;
            } else {
                delegatedUsedTotal[msg.sender] = 0;
            }

            emit DelegatedVPFreed(proposalId, msg.sender, used);
        }
    }

    /**
     * @dev Phase 2: Free delegated VP for a delegate after proposal ends (backend-triggered)
     * Can be called by anyone with valid signature from delegationSigner
     * Uses relayer pattern - signature proves authorization
     * @param proposalId Proposal to free VP from
     * @param delegateAddr Delegate whose VP to free
     * @param expiry Signature expiration
     * @param signature Backend signer signature
     */
    function freeDelegatedVPFor(
        uint256 proposalId,
        address delegateAddr,
        uint256 expiry,
        bytes calldata signature
    ) external nonReentrant {
        if (delegationSigner == address(0)) revert ZeroAddressDelegationSigner();
        if (block.timestamp > expiry) revert SignatureExpired();

        // Verify backend signature
        bytes32 messageHash = keccak256(abi.encodePacked(
            "freeDelegatedVPFor",
            proposalId,
            delegateAddr,
            expiry
        ));
        bytes32 ethSignedHash = messageHash.toEthSignedMessageHash();

        if (usedSignatures[ethSignedHash]) revert SignatureAlreadyUsed();
        usedSignatures[ethSignedHash] = true;

        address recovered = ethSignedHash.recover(signature);
        if (recovered != delegationSigner) revert InvalidDelegationSignature();

        // Proposal must be ended (same check as freeDelegatedVP)
        Proposal storage p = _proposals[proposalId];
        if (p.status == ProposalStatus.Active && block.timestamp <= p.votingEndsAt) {
            revert ProposalStillActive();
        }

        uint256 used = delegatedVoteAllocated[proposalId][delegateAddr];
        if (used > 0) {
            // Clear the per-proposal allocation FIRST to prevent double-free
            delegatedVoteAllocated[proposalId][delegateAddr] = 0;

            // Release from global budget
            if (delegatedUsedTotal[delegateAddr] >= used) {
                delegatedUsedTotal[delegateAddr] -= used;
            } else {
                delegatedUsedTotal[delegateAddr] = 0;
            }

            emit DelegatedVPFreed(proposalId, delegateAddr, used);
        }
    }

    /**
     * @dev Delegate casts vote with received VP (backend-signed)
     * Phase 1: Now includes nonce validation, global VP budget, and on-chain allocation storage
     * @param proposalId Proposal to vote on
     * @param amount VP amount to use
     * @param support True for Yay, false for Nay
     * @param allocationsHash Hash of per-delegator allocations
     * @param allocations Array of per-delegator allocations (stored on-chain)
     * @param nonce Current delegation nonce (must match)
     * @param expiry Signature expiration
     * @param signature Backend signer signature
     */
    function castDelegatedVote(
        uint256 proposalId,
        uint256 amount,
        bool support,
        bytes32 allocationsHash,
        DelegatorAllocation[] calldata allocations,
        uint256 nonce,
        uint256 expiry,
        bytes calldata signature
    ) external nonReentrant {
        if (delegationSigner == address(0)) revert ZeroAddressDelegationSigner();
        if (block.timestamp > expiry) revert SignatureExpired();

        // Phase 1: Verify nonce matches current state (prevents stale signatures)
        if (nonce != delegationNonce[msg.sender]) revert StaleSignature();

        // Phase 1: Include nonce in signature verification
        bytes32 messageHash = keccak256(abi.encodePacked(
            "delegatedVote",
            msg.sender,
            proposalId,
            amount,
            support,
            allocationsHash,
            nonce,
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

        // Phase 1: Check GLOBAL delegated VP budget (not just per-proposal)
        uint256 globalAvailable = getGlobalAvailableDelegatedPower(msg.sender);
        if (amount > globalAvailable) revert InsufficientGlobalDelegatedPower();

        // Also check per-proposal availability (for incremental votes)
        uint256 available = getAvailableDelegatedPower(msg.sender, proposalId);
        if (amount > available) revert InsufficientDelegatedPower();

        DelegatedVoteRecord storage record = _delegatedVotes[proposalId][msg.sender];

        if (record.hasVoted) {
            if (record.support != support) revert CannotChangeVoteDirection();
        }

        // Phase 1: Verify allocations match the hash
        bytes32 computedHash = _computeAllocationsHash(proposalId, msg.sender, allocations);
        if (computedHash != allocationsHash) revert AllocationHashMismatch();

        // Phase 1: Store per-delegator contributions on-chain
        for (uint256 i = 0; i < allocations.length; i++) {
            address delegator = allocations[i].delegator;
            uint256 power = allocations[i].powerUsed;

            // Track first contribution from this delegator to this proposal
            if (delegatorVoteContribution[proposalId][msg.sender][delegator] == 0) {
                _delegatorActiveProposals[delegator].push(proposalId);
            }

            delegatorVoteContribution[proposalId][msg.sender][delegator] += power;
            emit DelegatorAllocationStored(proposalId, msg.sender, delegator, power);
        }

        // Store allocation hash for reward verification
        allocationHashes[proposalId][msg.sender] = allocationsHash;

        // Update tracking
        delegatedVoteAllocated[proposalId][msg.sender] += amount;

        // Phase 1: Update global VP budget
        delegatedUsedTotal[msg.sender] += amount;

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

    /**
     * @dev Create a governance proposal (requires passport + reputation signatures)
     * @param title Proposal title
     * @param descriptionHash IPFS hash of full description
     * @param value ROSE value requested from treasury
     * @param deadline Task deadline timestamp
     * @param deliverables Expected deliverables
     * @param expiry Passport signature expiration
     * @param signature Passport signer signature
     * @param attestedRep Backend-computed reputation score (0-100)
     * @param repExpiry Reputation attestation expiry
     * @param repSignature Reputation attestation signature
     */
    function propose(
        string calldata title,
        string calldata descriptionHash,
        uint256 value,
        uint256 deadline,
        string calldata deliverables,
        uint256 expiry,
        bytes calldata signature,
        uint256 attestedRep,
        uint256 repExpiry,
        bytes calldata repSignature
    ) external requiresPassport("propose", expiry, signature) returns (uint256) {
        // Verify reputation attestation
        if (!reputation.validateReputationSignature(msg.sender, attestedRep, repExpiry, repSignature)) {
            revert InvalidSignature();
        }
        // Check eligibility: need cold start tasks + attested reputation >= 90%
        UserStats memory stats = reputation.userStats(msg.sender);
        if (stats.tasksCompleted < reputation.COLD_START_TASKS()) revert IneligibleToPropose();
        if (attestedRep < reputation.PROPOSER_REP_THRESHOLD()) revert IneligibleToPropose();

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
            reputation.recordFailedProposal(p.proposer);
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

    /**
     * @dev Claim voter rewards (direct votes + delegated votes)
     * @param claims Array of claim data for each proposal/vote type
     * @param expiry Delegation signature expiration
     * @param signature Delegation signer signature
     * @param attestedRep Backend-computed reputation score (0-100)
     * @param repExpiry Reputation attestation expiry
     * @param repSignature Reputation attestation signature
     */
    function claimVoterRewards(
        ClaimData[] calldata claims,
        uint256 expiry,
        bytes calldata signature,
        uint256 attestedRep,
        uint256 repExpiry,
        bytes calldata repSignature
    ) external nonReentrant {
        if (claims.length == 0) revert EmptyClaims();
        if (block.timestamp > expiry) revert SignatureExpired();
        if (delegationSigner == address(0)) revert ZeroAddressDelegationSigner();

        // Verify reputation attestation
        if (!reputation.validateReputationSignature(msg.sender, attestedRep, repExpiry, repSignature)) {
            revert InvalidSignature();
        }

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
            // Recalculate VP using attested reputation
            uint256 newVP = getVotePower(stakedRose[msg.sender], attestedRep);
            uint256 oldVP = votingPower[msg.sender];
            votingPower[msg.sender] = newVP;
            totalVotingPower = totalVotingPower - oldVP + newVP;

            emit VotingPowerChanged(msg.sender, stakedRose[msg.sender], newVP, attestedRep);
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

    function setReputation(address _reputation) external onlyOwner {
        if (_reputation == address(0)) revert ZeroAddress();
        reputation = IRoseReputation(_reputation);
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

    /**
     * @dev Phase 1: Compute hash of allocations for on-chain verification
     * Must match the backend's computeAllocationsHash() algorithm
     */
    function _computeAllocationsHash(
        uint256 proposalId,
        address delegate,
        DelegatorAllocation[] calldata allocations
    ) internal pure returns (bytes32) {
        // Sort is expected to be done by caller (backend)
        // Encode: (proposalId, delegate, [(delegator, powerUsed), ...])
        return keccak256(abi.encode(
            proposalId,
            delegate,
            allocations
        ));
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
