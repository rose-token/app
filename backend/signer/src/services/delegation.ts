import { ethers } from 'ethers';
import { config } from '../config';
import { DelegationAllocation, ClaimData, ClaimType } from '../types';

// Updated ABI for new VP-centric RoseGovernance
const GOVERNANCE_ABI = [
  // Multi-delegation VP tracking
  'function delegators(address delegate) external view returns (address[])',
  'function delegatedVP(address delegator, address delegate) external view returns (uint256)',
  'function totalDelegatedIn(address delegate) external view returns (uint256)',
  'function totalDelegatedOut(address delegator) external view returns (uint256)',
  'function votingPower(address user) external view returns (uint256)',

  // Delegated vote tracking
  'function delegatedVotes(uint256 proposalId, address delegate) external view returns (tuple(bool hasVoted, bool support, uint256 totalPowerUsed))',
  'function delegatorPowerUsed(uint256 proposalId, address delegate, address delegator) external view returns (uint256)',
  'function allocationHashes(uint256 proposalId, address delegate) external view returns (bytes32)',

  // Direct vote tracking
  'function votes(uint256 proposalId, address voter) external view returns (tuple(bool hasVoted, bool support, uint256 votePower))',

  // Proposal data
  'function proposals(uint256 proposalId) external view returns (tuple(address proposer, string title, string descriptionHash, uint256 value, uint256 deadline, string deliverables, uint256 createdAt, uint256 votingEndsAt, uint256 yayVotes, uint256 nayVotes, uint8 status, uint256 editCount, uint256 taskId))',
  'function proposalCounter() external view returns (uint256)',

  // Reward tracking
  'function voterRewardPool(uint256 proposalId) external view returns (uint256)',
  'function voterRewardTotalVotes(uint256 proposalId) external view returns (uint256)',
  'function voterRewardOutcome(uint256 proposalId) external view returns (bool)',
  'function directVoterRewardClaimed(uint256 proposalId, address voter) external view returns (bool)',
  'function delegatorRewardClaimed(uint256 proposalId, address delegate, address delegator) external view returns (bool)',

  // Events for tracking delegation history
  'event DelegationChanged(address indexed delegator, address indexed delegate, uint256 vpAmount, bool isDelegating)',
  'event DelegatedVoteCast(uint256 indexed proposalId, address indexed delegate, bool support, uint256 votePower)',
];

const wallet = new ethers.Wallet(config.signer.privateKey);

let provider: ethers.JsonRpcProvider | null = null;
let governanceContract: ethers.Contract | null = null;

function getProvider(): ethers.JsonRpcProvider {
  if (!provider) {
    provider = new ethers.JsonRpcProvider(config.rpc.url);
  }
  return provider;
}

function getGovernanceContract(): ethers.Contract {
  if (!governanceContract) {
    if (!config.contracts.governance) {
      throw new Error('GOVERNANCE_ADDRESS not configured');
    }
    governanceContract = new ethers.Contract(
      config.contracts.governance,
      GOVERNANCE_ABI,
      getProvider()
    );
  }
  return governanceContract;
}

export function getSignerAddress(): string {
  return wallet.address;
}

/**
 * Get all delegators and their VP amounts for a delegate
 */
export async function getDelegatorVPAmounts(
  delegate: string
): Promise<Map<string, bigint>> {
  const contract = getGovernanceContract();
  const delegatorList: string[] = await contract.delegators(delegate);

  const vpMap = new Map<string, bigint>();

  await Promise.all(
    delegatorList.map(async (delegator) => {
      const vp = await contract.delegatedVP(delegator, delegate);
      if (BigInt(vp) > 0n) {
        vpMap.set(delegator, BigInt(vp));
      }
    })
  );

  return vpMap;
}

/**
 * Compute per-delegator allocations for a delegated vote
 * Uses the new VP-based multi-delegation model
 */
export async function computeAllocations(
  delegate: string,
  proposalId: number,
  amount: bigint
): Promise<{ allocations: DelegationAllocation[]; allocationsHash: string }> {
  const contract = getGovernanceContract();

  // Get all delegators and their VP amounts
  const delegatorVPs = await getDelegatorVPAmounts(delegate);

  if (delegatorVPs.size === 0) {
    throw new Error('No delegators found for this delegate');
  }

  // Get total received VP
  const totalReceivedVP: bigint = BigInt(await contract.totalDelegatedIn(delegate));

  if (totalReceivedVP === 0n) {
    throw new Error('No delegated VP available');
  }

  // Get already used VP for this proposal
  const existingVote = await contract.delegatedVotes(proposalId, delegate);
  const alreadyUsed: bigint = BigInt(existingVote.totalPowerUsed || 0);
  const availableVP = totalReceivedVP - alreadyUsed;

  if (amount > availableVP) {
    throw new Error(`Insufficient delegated VP. Available: ${availableVP}, Requested: ${amount}`);
  }

  // Get already used VP from each delegator for this proposal
  const delegatorUsed: Map<string, bigint> = new Map();
  await Promise.all(
    Array.from(delegatorVPs.keys()).map(async (delegator) => {
      const used = await contract.delegatorPowerUsed(proposalId, delegate, delegator);
      delegatorUsed.set(delegator, BigInt(used));
    })
  );

  // Compute proportional allocations
  const allocations: DelegationAllocation[] = [];
  let remainingToAllocate = amount;

  // First pass: proportional allocation
  for (const [delegator, delegatorVP] of delegatorVPs) {
    if (remainingToAllocate === 0n) break;

    const alreadyUsedFromDelegator = delegatorUsed.get(delegator) || 0n;

    // Calculate proportional share based on delegator's VP contribution
    const proportionalShare = (amount * delegatorVP) / totalReceivedVP;

    // Check what's still available from this delegator
    const availableFromDelegator = delegatorVP > alreadyUsedFromDelegator
      ? delegatorVP - alreadyUsedFromDelegator
      : 0n;

    let toUse = proportionalShare > availableFromDelegator
      ? availableFromDelegator
      : proportionalShare;
    toUse = toUse > remainingToAllocate ? remainingToAllocate : toUse;

    if (toUse > 0n) {
      allocations.push({
        delegator,
        powerUsed: toUse.toString(),
      });
      remainingToAllocate -= toUse;
    }
  }

  // Second pass: handle remainder due to rounding
  if (remainingToAllocate > 0n) {
    for (const [delegator, delegatorVP] of delegatorVPs) {
      if (remainingToAllocate === 0n) break;

      // Get total used (initial + what we allocated in first pass)
      const initialUsed = delegatorUsed.get(delegator) || 0n;
      const allocatedInFirstPass = allocations.find(a => a.delegator === delegator);
      const used = initialUsed + BigInt(allocatedInFirstPass?.powerUsed || '0');

      const availableFromDelegator = delegatorVP > used ? delegatorVP - used : 0n;

      if (availableFromDelegator > 0n) {
        const toUse = availableFromDelegator > remainingToAllocate
          ? remainingToAllocate
          : availableFromDelegator;

        // Update existing allocation or add new one
        if (allocatedInFirstPass) {
          allocatedInFirstPass.powerUsed = (BigInt(allocatedInFirstPass.powerUsed) + toUse).toString();
        } else {
          allocations.push({
            delegator,
            powerUsed: toUse.toString(),
          });
        }
        remainingToAllocate -= toUse;
      }
    }
  }

  // Create hash of allocations for on-chain verification
  // Sort allocations by delegator address for deterministic hashing
  const sortedAllocations = [...allocations].sort((a, b) =>
    a.delegator.toLowerCase().localeCompare(b.delegator.toLowerCase())
  );

  // Encode allocations: (proposalId, delegate, [(delegator, powerUsed), ...])
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();
  const allocationsHash = ethers.keccak256(
    abiCoder.encode(
      ['uint256', 'address', 'tuple(address,uint256)[]'],
      [
        proposalId,
        delegate,
        sortedAllocations.map(a => [a.delegator, BigInt(a.powerUsed)]),
      ]
    )
  );

  return { allocations, allocationsHash };
}

/**
 * Sign delegated vote approval
 * Message format matches contract's verification:
 * keccak256(abi.encodePacked("delegatedVote", delegate, proposalId, amount, support, allocationsHash, expiry))
 */
export async function signDelegatedVote(
  delegate: string,
  proposalId: number,
  amount: bigint,
  support: boolean,
  allocationsHash: string,
  expiry: number
): Promise<string> {
  const messageHash = ethers.solidityPackedKeccak256(
    ['string', 'address', 'uint256', 'uint256', 'bool', 'bytes32', 'uint256'],
    ['delegatedVote', delegate, proposalId, amount, support, allocationsHash, expiry]
  );

  // Sign the hash (ethers adds "\x19Ethereum Signed Message:\n32" prefix)
  const signature = await wallet.signMessage(ethers.getBytes(messageHash));

  return signature;
}

/**
 * Check if proposal is active and voting is open
 */
export async function isProposalActive(proposalId: number): Promise<boolean> {
  const contract = getGovernanceContract();

  try {
    const proposal = await contract.proposals(proposalId);
    const now = Math.floor(Date.now() / 1000);

    // status 0 = Active
    return Number(proposal.status) === 0 && now <= Number(proposal.votingEndsAt);
  } catch {
    return false;
  }
}

/**
 * Get available delegated VP for a delegate on a proposal
 */
export async function getAvailableDelegatedPower(
  delegate: string,
  proposalId: number
): Promise<bigint> {
  const contract = getGovernanceContract();

  const [totalReceivedRaw, existingVote] = await Promise.all([
    contract.totalDelegatedIn(delegate),
    contract.delegatedVotes(proposalId, delegate),
  ]);

  const total = BigInt(totalReceivedRaw);
  const used = BigInt(existingVote.totalPowerUsed || 0);

  return total > used ? total - used : 0n;
}

/**
 * Get the delegated vote record for a proposal
 */
export async function getDelegatedVote(
  proposalId: number,
  delegate: string
): Promise<{ hasVoted: boolean; support: boolean; totalPowerUsed: bigint }> {
  const contract = getGovernanceContract();
  const vote = await contract.delegatedVotes(proposalId, delegate);

  return {
    hasVoted: vote.hasVoted,
    support: vote.support,
    totalPowerUsed: BigInt(vote.totalPowerUsed || 0),
  };
}

// ============ Claim Functions ============

/**
 * Get all delegates a user has ever delegated to by querying DelegationChanged events
 * Returns unique delegates where user delegated (isDelegating = true)
 */
export async function getUserDelegates(user: string): Promise<string[]> {
  const contract = getGovernanceContract();

  // Query DelegationChanged events where user is the delegator
  // Filter topic: DelegationChanged(delegator indexed, delegate indexed, vpAmount, isDelegating)
  const filter = contract.filters.DelegationChanged(user);

  try {
    // Query events from a reasonable block range (last 90 days ~= 2M blocks on Arbitrum)
    const currentBlock = await getProvider().getBlockNumber();
    const fromBlock = Math.max(0, currentBlock - 2_000_000);

    const events = await contract.queryFilter(filter, fromBlock, currentBlock);

    // Track delegates and their current status
    const delegateStatus = new Map<string, boolean>();

    for (const event of events) {
      if ('args' in event && event.args) {
        const delegate = event.args.delegate as string;
        const isDelegating = event.args.isDelegating as boolean;
        delegateStatus.set(delegate.toLowerCase(), isDelegating);
      }
    }

    // Return only delegates where user still has active delegation
    // (most recent event was isDelegating = true)
    const activeDelegates: string[] = [];
    for (const [delegate, isActive] of delegateStatus) {
      if (isActive) {
        activeDelegates.push(delegate);
      }
    }

    return activeDelegates;
  } catch (error) {
    console.error('Error querying delegation events:', error);
    return [];
  }
}

/**
 * Get all proposals a delegate has voted on using DelegatedVoteCast events
 */
export async function getDelegateVotedProposals(
  delegate: string
): Promise<Array<{ proposalId: number; support: boolean }>> {
  const contract = getGovernanceContract();

  // Query DelegatedVoteCast events where this address is the delegate
  const filter = contract.filters.DelegatedVoteCast(null, delegate);

  try {
    const currentBlock = await getProvider().getBlockNumber();
    const fromBlock = Math.max(0, currentBlock - 2_000_000);

    const events = await contract.queryFilter(filter, fromBlock, currentBlock);

    const votedProposals: Array<{ proposalId: number; support: boolean }> = [];

    for (const event of events) {
      if ('args' in event && event.args) {
        votedProposals.push({
          proposalId: Number(event.args.proposalId),
          support: event.args.support as boolean,
        });
      }
    }

    return votedProposals;
  } catch (error) {
    console.error('Error querying delegate vote events:', error);
    return [];
  }
}

/**
 * Get all claimable rewards for a user (both direct votes and delegated)
 */
export async function getClaimableRewards(user: string): Promise<ClaimData[]> {
  const contract = getGovernanceContract();
  const claims: ClaimData[] = [];

  // Get proposal count
  const proposalCount = await contract.proposalCounter();

  // Check each proposal for direct vote claimable rewards
  for (let i = 1; i <= Number(proposalCount); i++) {
    const pool = await contract.voterRewardPool(i);
    if (BigInt(pool) === 0n) continue; // No reward pool

    const outcome = await contract.voterRewardOutcome(i);

    // Check direct vote
    const vote = await contract.votes(i, user);
    if (vote.hasVoted && BigInt(vote.votePower) > 0n) {
      // Check if vote was on winning side
      const votedYay = vote.support;
      if (votedYay === outcome) {
        // Check if already claimed
        const claimed = await contract.directVoterRewardClaimed(i, user);
        if (!claimed) {
          claims.push({
            proposalId: i,
            claimType: ClaimType.DirectVoter,
            delegate: ethers.ZeroAddress,
            votePower: vote.votePower.toString(),
          });
        }
      }
    }
  }

  // Check delegated vote rewards
  // Get all delegates user has delegated to via event querying
  const userDelegates = await getUserDelegates(user);

  for (const delegate of userDelegates) {
    // Get all proposals this delegate voted on
    const votedProposals = await getDelegateVotedProposals(delegate);

    for (const { proposalId, support } of votedProposals) {
      // Check if this proposal has a reward pool
      const pool = await contract.voterRewardPool(proposalId);
      if (BigInt(pool) === 0n) continue;

      const outcome = await contract.voterRewardOutcome(proposalId);

      // Check if delegate's vote was on winning side
      if (support !== outcome) continue;

      // Check if user's VP was used for this delegate's vote on this proposal
      const userPowerUsed = await contract.delegatorPowerUsed(proposalId, delegate, user);
      if (BigInt(userPowerUsed) === 0n) continue;

      // Check if user already claimed this delegated reward
      const claimed = await contract.delegatorRewardClaimed(proposalId, delegate, user);
      if (claimed) continue;

      // Add delegated vote claim
      claims.push({
        proposalId,
        claimType: ClaimType.Delegator,
        delegate,
        votePower: userPowerUsed.toString(),
      });
    }
  }

  return claims;
}

/**
 * Sign claim approval matching contract's verification format
 */
export async function signClaimApproval(
  user: string,
  claims: ClaimData[],
  expiry: number
): Promise<string> {
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();

  // Encode claims as tuple array matching Solidity struct
  const encodedClaims = abiCoder.encode(
    ['tuple(uint256,uint8,address,uint256)[]'],
    [claims.map(c => [c.proposalId, c.claimType, c.delegate, BigInt(c.votePower)])]
  );

  const messageHash = ethers.solidityPackedKeccak256(
    ['string', 'address', 'bytes', 'uint256'],
    ['claimVoterRewards', user, encodedClaims, expiry]
  );

  return await wallet.signMessage(ethers.getBytes(messageHash));
}

/**
 * Calculate estimated reward amount for a claim
 */
export async function calculateRewardAmount(claim: ClaimData): Promise<bigint> {
  const contract = getGovernanceContract();
  const pool = await contract.voterRewardPool(claim.proposalId);
  const totalVotes = await contract.voterRewardTotalVotes(claim.proposalId);

  if (BigInt(totalVotes) === 0n) return 0n;
  return (BigInt(pool) * BigInt(claim.votePower)) / BigInt(totalVotes);
}
