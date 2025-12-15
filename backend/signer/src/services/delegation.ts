import { ethers } from 'ethers';
import { config } from '../config';
import { DelegationAllocation, ClaimData, ClaimType, VoteReduction } from '../types';
import { getWsProvider } from '../utils/wsProvider';
import { RoseGovernanceABI } from '../utils/contracts';
import { query } from '../db/pool';

const wallet = new ethers.Wallet(config.signer.privateKey);

let governanceContract: ethers.Contract | null = null;

function getProvider(): ethers.Provider {
  return getWsProvider();
}

function getGovernanceContract(): ethers.Contract {
  if (!governanceContract) {
    if (!config.contracts.governance) {
      throw new Error('GOVERNANCE_ADDRESS not configured');
    }
    governanceContract = new ethers.Contract(
      config.contracts.governance,
      RoseGovernanceABI,
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
 * Get all delegates a user has active delegations to.
 * Queries the delegations database table (off-chain EIP-712 delegations).
 * Returns unique delegate addresses where delegation is active (not revoked, not expired).
 */
export async function getUserDelegates(user: string): Promise<string[]> {
  try {
    const result = await query(`
      SELECT DISTINCT delegate
      FROM delegations
      WHERE LOWER(delegator) = LOWER($1)
        AND revoked_at IS NULL
        AND expiry > NOW()
    `, [user]);

    return result.rows.map((row) => row.delegate as string);
  } catch (error) {
    console.error('Error querying user delegates from database:', error);
    return [];
  }
}

/**
 * Get all proposals a delegate has voted on using DelegatedVoteCast events
 *
 * NOTE: The current RoseGovernance contract uses off-chain delegation only
 * (EIP-712 signatures stored in database). There is no on-chain DelegatedVoteCast
 * event. This function returns an empty array since on-chain delegated voting
 * is not implemented in the current contract version.
 */
export async function getDelegateVotedProposals(
  _delegate: string
): Promise<Array<{ proposalId: number; support: boolean }>> {
  // The current governance contract has no DelegatedVoteCast event.
  // Delegations are handled off-chain via EIP-712 signatures stored in DB.
  // Return empty array since there's no on-chain delegated vote tracking.
  return [];
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
 *
 * NOTE: The current RoseGovernance contract uses off-chain delegation only.
 * There is no on-chain delegatorVoteContribution tracking. Returns 0.
 */
export async function getDelegatorContribution(
  _proposalId: number,
  _delegate: string,
  _delegator: string
): Promise<bigint> {
  // The current governance contract has no on-chain delegator vote contribution tracking.
  // Delegations are handled off-chain via EIP-712 signatures stored in DB.
  return 0n;
}

/**
 * Phase 2: Get all delegates with pending VP for a finalized proposal
 *
 * NOTE: The current RoseGovernance contract uses off-chain delegation only.
 * There is no on-chain DelegatedVoteCast event or delegatedVoteAllocated tracking.
 * Returns empty array.
 */
export async function getDelegatesWithPendingVP(_proposalId: number): Promise<string[]> {
  // The current governance contract has no DelegatedVoteCast event or
  // delegatedVoteAllocated tracking. Delegations are handled off-chain.
  return [];
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
