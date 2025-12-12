import { ethers } from 'ethers';
import { config } from '../config';
import { DelegationAllocation, ClaimData, ClaimType, VoteReduction } from '../types';

// Updated ABI for new VP-centric RoseGovernance
const GOVERNANCE_ABI = [
  // Multi-delegation VP tracking
  'function delegators(address delegate) external view returns (address[])',
  'function delegatedVP(address delegator, address delegate) external view returns (uint256)',
  'function totalDelegatedIn(address delegate) external view returns (uint256)',
  'function totalDelegatedOut(address delegator) external view returns (uint256)',
  'function votingPower(address user) external view returns (uint256)',

  // Phase 1: Delegation nonce
  'function delegationNonce(address delegate) external view returns (uint256)',
  'function delegatedUsedTotal(address delegate) external view returns (uint256)',
  'function delegatorVoteContribution(uint256 proposalId, address delegate, address delegator) external view returns (uint256)',
  'function getGlobalAvailableDelegatedPower(address delegate) external view returns (uint256)',

  // Delegated vote tracking
  'function getDelegatedVote(uint256 proposalId, address delegate) external view returns (tuple(bool hasVoted, bool support, uint256 totalPowerUsed))',
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
 * Phase 1: Get current delegation nonce for a delegate
 * Nonce is bumped whenever delegation state changes
 */
export async function getDelegationNonce(delegate: string): Promise<bigint> {
  const contract = getGovernanceContract();
  const nonce = await contract.delegationNonce(delegate);
  return BigInt(nonce);
}

/**
 * Phase 1: Get global available delegated power
 */
export async function getGlobalAvailableDelegatedPower(delegate: string): Promise<bigint> {
  const contract = getGovernanceContract();
  const available = await contract.getGlobalAvailableDelegatedPower(delegate);
  return BigInt(available);
}

/**
 * Get per-delegator power used for a proposal from database cache
 * Returns 0 if no record found (first vote on this proposal)
 *
 * NOTE: delegation_allocations table was removed in Governance V2 migration.
 * Per-delegator tracking is now handled via on-chain events only.
 */
async function getDelegatorPowerUsedFromDB(
  _proposalId: number,
  _delegate: string,
  _delegator: string
): Promise<bigint> {
  // delegation_allocations table was removed in Governance V2 migration
  // Per-delegator tracking is now handled via on-chain events only
  return 0n;
}

/**
 * Store per-delegator allocations in database after signing a vote
 * Used for incremental votes and reward claims
 *
 * NOTE: delegation_allocations table was removed in Governance V2 migration.
 * Allocations are now tracked via on-chain events only.
 */
export async function storeAllocations(
  proposalId: number,
  _delegate: string,
  allocations: DelegationAllocation[],
  _support: boolean,
  _allocationsHash: string
): Promise<void> {
  // delegation_allocations table was removed in Governance V2 migration
  // Allocations are now tracked via on-chain events only
  console.log(`[Delegation] storeAllocations is no-op (Governance V2) - ${allocations.length} allocations for proposal ${proposalId}`);
}

/**
 * Compute allocations hash - must match the algorithm in computeAllocations()
 * Used to verify frontend-provided allocations against on-chain hash
 */
function computeAllocationsHash(
  proposalId: number,
  delegate: string,
  allocations: DelegationAllocation[]
): string {
  // Sort by delegator for deterministic hash (same as computeAllocations)
  const sorted = [...allocations].sort((a, b) =>
    a.delegator.toLowerCase().localeCompare(b.delegator.toLowerCase())
  );

  const abiCoder = ethers.AbiCoder.defaultAbiCoder();
  return ethers.keccak256(
    abiCoder.encode(
      ['uint256', 'address', 'tuple(address,uint256)[]'],
      [
        proposalId,
        delegate,
        sorted.map(a => [a.delegator, BigInt(a.powerUsed)]),
      ]
    )
  );
}

/**
 * Verify delegated vote exists on-chain, verify allocations hash matches, then store
 * Called by frontend after tx confirmation - uses ORIGINAL allocations from signature time
 * This prevents state drift issues where delegations change between signing and confirming
 *
 * SECURITY: The support value is derived from on-chain voteRecord, NOT from client input,
 * to prevent malicious delegates from spoofing the vote direction in the database.
 */
export async function verifyAndStoreAllocations(
  proposalId: number,
  delegate: string,
  allocations: DelegationAllocation[]
): Promise<{ success: boolean; error?: string }> {
  const contract = getGovernanceContract();

  try {
    // 1. Verify vote exists on-chain and get the authoritative support value
    const voteRecord = await contract.getDelegatedVote(proposalId, delegate);
    if (!voteRecord.hasVoted) {
      return { success: false, error: 'Vote not found on-chain' };
    }

    // Use on-chain support value - NEVER trust client-provided support
    const onChainSupport: boolean = voteRecord.support;

    // 2. Compute hash of provided allocations
    const computedHash = computeAllocationsHash(proposalId, delegate, allocations);

    // 3. Get hash stored on-chain and verify it matches
    const onChainHash = await contract.allocationHashes(proposalId, delegate);
    if (computedHash !== onChainHash) {
      console.warn(`Allocations hash mismatch: computed=${computedHash}, onChain=${onChainHash}`);
      return { success: false, error: 'Allocations hash mismatch - data may have been tampered' };
    }

    // 4. Store the original allocations with on-chain support value
    if (allocations.length > 0) {
      await storeAllocations(proposalId, delegate, allocations, onChainSupport, computedHash);
      console.log(`Verified and stored ${allocations.length} allocations for proposal ${proposalId} (support=${onChainSupport})`);
    }

    return { success: true };
  } catch (error) {
    console.error('verifyAndStoreAllocations error:', error);
    return { success: false, error: 'Failed to verify vote on-chain' };
  }
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
  const existingVote = await contract.getDelegatedVote(proposalId, delegate);
  const alreadyUsed: bigint = BigInt(existingVote.totalPowerUsed || 0);
  const availableVP = totalReceivedVP - alreadyUsed;

  if (amount > availableVP) {
    throw new Error(`Insufficient delegated VP. Available: ${availableVP}, Requested: ${amount}`);
  }

  // Get already used VP from each delegator for this proposal (from database cache)
  const delegatorUsed: Map<string, bigint> = new Map();
  await Promise.all(
    Array.from(delegatorVPs.keys()).map(async (delegator) => {
      const used = await getDelegatorPowerUsedFromDB(proposalId, delegate, delegator);
      delegatorUsed.set(delegator, used);
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
 * Phase 1: Now includes nonce in signature for stale signature protection
 * Message format matches contract's verification:
 * keccak256(abi.encodePacked("delegatedVote", delegate, proposalId, amount, support, allocationsHash, nonce, expiry))
 */
export async function signDelegatedVote(
  delegate: string,
  proposalId: number,
  amount: bigint,
  support: boolean,
  allocationsHash: string,
  nonce: bigint,
  expiry: number
): Promise<string> {
  const messageHash = ethers.solidityPackedKeccak256(
    ['string', 'address', 'uint256', 'uint256', 'bool', 'bytes32', 'uint256', 'uint256'],
    ['delegatedVote', delegate, proposalId, amount, support, allocationsHash, nonce, expiry]
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
    contract.getDelegatedVote(proposalId, delegate),
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
  const vote = await contract.getDelegatedVote(proposalId, delegate);

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
 * Phase 2: Validates delegated claim power against on-chain data
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

      // Phase 2: Use ON-CHAIN data as source of truth for vote power
      // This ensures claims are valid even if DB is out of sync
      const onChainPower = BigInt(
        await contract.delegatorVoteContribution(proposalId, delegate, user)
      );

      // Also get DB value for comparison/logging
      const dbPower = await getDelegatorPowerUsedFromDB(proposalId, delegate, user);

      // Log discrepancy if found (but use on-chain value)
      if (dbPower !== onChainPower && dbPower !== 0n) {
        console.warn(
          `[Claims] Power discrepancy for ${user} on proposal ${proposalId} via ${delegate}: ` +
          `DB=${dbPower}, on-chain=${onChainPower}`
        );
      }

      // Skip if no on-chain contribution
      if (onChainPower === 0n) continue;

      // Check if user already claimed this delegated reward
      const claimed = await contract.delegatorRewardClaimed(proposalId, delegate, user);
      if (claimed) continue;

      // Add delegated vote claim using on-chain power
      claims.push({
        proposalId,
        claimType: ClaimType.Delegator,
        delegate,
        votePower: onChainPower.toString(),
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

// ============ Phase 1: Vote Reduction Functions ============

/**
 * Phase 1: Get all active proposals
 */
export async function getActiveProposals(): Promise<number[]> {
  const contract = getGovernanceContract();
  const proposalCount = await contract.proposalCounter();

  const activeProposals: number[] = [];
  for (let i = 1; i <= Number(proposalCount); i++) {
    const proposal = await contract.proposals(i);
    const now = Math.floor(Date.now() / 1000);
    // status 0 = Active
    if (Number(proposal.status) === 0 && now <= Number(proposal.votingEndsAt)) {
      activeProposals.push(i);
    }
  }

  return activeProposals;
}

/**
 * Phase 1: Compute vote reductions for undelegation
 * Calculates how much VP should be removed from each active proposal
 */
export async function computeVoteReductions(
  delegator: string,
  delegate: string,
  vpAmount: bigint
): Promise<VoteReduction[]> {
  const contract = getGovernanceContract();
  const reductions: VoteReduction[] = [];

  // Get current delegated VP (before undelegation)
  const currentDelegatedVP = BigInt(await contract.delegatedVP(delegator, delegate));
  if (currentDelegatedVP === 0n) {
    return reductions;
  }

  // Get all active proposals
  const activeProposals = await getActiveProposals();

  for (const proposalId of activeProposals) {
    // Check if delegate voted on this proposal
    const voteRecord = await contract.getDelegatedVote(proposalId, delegate);
    if (!voteRecord.hasVoted) continue;

    // Get delegator's contribution to this proposal via this delegate
    const contribution = BigInt(
      await contract.delegatorVoteContribution(proposalId, delegate, delegator)
    );
    if (contribution === 0n) continue;

    // Calculate proportional reduction based on VP being undelegated
    let reductionAmount = (contribution * vpAmount) / currentDelegatedVP;
    if (reductionAmount > contribution) {
      reductionAmount = contribution;
    }

    if (reductionAmount > 0n) {
      reductions.push({
        proposalId,
        delegate,
        vpToRemove: reductionAmount.toString(),
        support: voteRecord.support,
      });
    }
  }

  return reductions;
}

/**
 * Phase 1: Sign undelegate with vote reduction approval
 * Message format matches contract's verification
 */
export async function signUndelegateWithReduction(
  delegator: string,
  delegate: string,
  vpAmount: bigint,
  reductions: VoteReduction[],
  expiry: number
): Promise<string> {
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();

  // Encode reductions as tuple array matching Solidity struct
  const encodedReductions = abiCoder.encode(
    ['tuple(uint256,address,uint256,bool)[]'],
    [reductions.map(r => [r.proposalId, r.delegate, BigInt(r.vpToRemove), r.support])]
  );

  const messageHash = ethers.solidityPackedKeccak256(
    ['string', 'address', 'address', 'uint256', 'bytes32', 'uint256'],
    [
      'undelegateWithReduction',
      delegator,
      delegate,
      vpAmount,
      ethers.keccak256(encodedReductions),
      expiry,
    ]
  );

  return await wallet.signMessage(ethers.getBytes(messageHash));
}

/**
 * Phase 1: Get delegator's contribution to a specific proposal via delegate
 */
export async function getDelegatorContribution(
  proposalId: number,
  delegate: string,
  delegator: string
): Promise<bigint> {
  const contract = getGovernanceContract();
  const contribution = await contract.delegatorVoteContribution(proposalId, delegate, delegator);
  return BigInt(contribution);
}

/**
 * Phase 2: Get all delegates with pending VP for a finalized proposal
 */
export async function getDelegatesWithPendingVP(proposalId: number): Promise<string[]> {
  const contract = getGovernanceContract();
  const delegatesWithPendingVP: string[] = [];

  // Get all delegates who voted on this proposal via events
  const filter = contract.filters.DelegatedVoteCast(proposalId);
  const currentBlock = await getProvider().getBlockNumber();
  const deploymentBlock = parseInt(process.env.GOVERNANCE_DEPLOYMENT_BLOCK || '0') || 0;

  try {
    const events = await contract.queryFilter(filter, deploymentBlock, currentBlock);

    for (const event of events) {
      if ('args' in event && event.args) {
        const delegate = (event.args.delegate as string).toLowerCase();
        // Check if they still have allocated VP (not already freed)
        const allocated = BigInt(await contract.delegatedVoteAllocated(proposalId, delegate));
        if (allocated > 0n && !delegatesWithPendingVP.includes(delegate)) {
          delegatesWithPendingVP.push(delegate);
        }
      }
    }
  } catch (error) {
    console.error(`Error querying delegates for proposal ${proposalId}:`, error);
  }

  return delegatesWithPendingVP;
}

/**
 * Phase 2: Sign freeDelegatedVPFor approval for backend-triggered VP freeing
 */
export async function signFreeDelegatedVPFor(
  proposalId: number,
  delegate: string,
  expiry: number
): Promise<string> {
  const messageHash = ethers.solidityPackedKeccak256(
    ['string', 'uint256', 'address', 'uint256'],
    ['freeDelegatedVPFor', proposalId, delegate, expiry]
  );

  return await wallet.signMessage(ethers.getBytes(messageHash));
}
