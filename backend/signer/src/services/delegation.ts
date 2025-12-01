import { ethers } from 'ethers';
import { config } from '../config';
import { DelegationAllocation, ClaimData, ClaimType } from '../types';

// Minimal ABI for reading delegation data from RoseGovernance
const GOVERNANCE_ABI = [
  'function delegators(address delegate) external view returns (address[])',
  'function cachedVotePower(address user) external view returns (uint256)',
  'function totalDelegatedPower(address delegate) external view returns (uint256)',
  'function delegatedVoteAllocated(uint256 proposalId, address delegate) external view returns (uint256)',
  'function getDelegatorVotePower(uint256 proposalId, address delegate, address delegator) external view returns (uint256)',
  'function proposals(uint256 proposalId) external view returns (tuple(address proposer, string title, string descriptionHash, uint256 value, uint256 deadline, string deliverables, uint256 createdAt, uint256 votingEndsAt, uint256 yayVotes, uint256 nayVotes, uint256 totalAllocated, uint8 status, uint256 editCount, uint256 taskId))',
  // Claim-related functions
  'function voterRewardPool(uint256 proposalId) external view returns (uint256)',
  'function voterRewardTotalVotes(uint256 proposalId) external view returns (uint256)',
  'function voterRewardOutcome(uint256 proposalId) external view returns (bool)',
  'function directVoterRewardClaimed(uint256 proposalId, address voter) external view returns (bool)',
  'function delegatorRewardClaimed(uint256 proposalId, address delegate, address delegator) external view returns (bool)',
  'function votes(uint256 proposalId, address voter) external view returns (tuple(bool hasVoted, bool support, uint256 votePower, uint256 allocatedAmount))',
  'function proposalCounter() external view returns (uint256)',
  'function delegatedTo(address user) external view returns (address)',
  'function getDelegatedVote(uint256 proposalId, address delegate) external view returns (tuple(bool hasVoted, bool support, uint256 totalPowerUsed))',
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
 * Compute per-delegator allocations for a delegated vote
 * Mirrors the logic in _allocateDelegatorPower() but off-chain
 */
export async function computeAllocations(
  delegate: string,
  proposalId: number,
  amount: bigint
): Promise<{ allocations: DelegationAllocation[]; allocationsHash: string }> {
  const contract = getGovernanceContract();

  // Get list of delegators
  const delegatorList: string[] = await contract.delegators(delegate);

  if (delegatorList.length === 0) {
    throw new Error('No delegators found for this delegate');
  }

  // Get total delegated power
  const totalPower: bigint = await contract.totalDelegatedPower(delegate);

  if (totalPower === 0n) {
    throw new Error('No delegated power available');
  }

  // Get already used power for this proposal
  const alreadyUsed: bigint = await contract.delegatedVoteAllocated(proposalId, delegate);
  const availablePower = totalPower - alreadyUsed;

  if (amount > availablePower) {
    throw new Error(`Insufficient delegated power. Available: ${availablePower}, Requested: ${amount}`);
  }

  // Get cached vote power for each delegator and already used power
  const delegatorPowers: Map<string, bigint> = new Map();
  const delegatorUsed: Map<string, bigint> = new Map();

  await Promise.all(
    delegatorList.map(async (delegator) => {
      const [power, used] = await Promise.all([
        contract.cachedVotePower(delegator),
        contract.getDelegatorVotePower(proposalId, delegate, delegator),
      ]);
      delegatorPowers.set(delegator, power);
      delegatorUsed.set(delegator, used);
    })
  );

  // Compute proportional allocations (same logic as contract)
  const allocations: DelegationAllocation[] = [];
  let remainingToAllocate = amount;

  // First pass: proportional allocation
  for (const delegator of delegatorList) {
    if (remainingToAllocate === 0n) break;

    const delegatorPower = delegatorPowers.get(delegator) || 0n;
    const alreadyUsedFromDelegator = delegatorUsed.get(delegator) || 0n;

    // Calculate proportional share
    const proportionalShare = (amount * delegatorPower) / totalPower;

    // Check what's still available from this delegator
    const availableFromDelegator = delegatorPower > alreadyUsedFromDelegator
      ? delegatorPower - alreadyUsedFromDelegator
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
    for (const delegator of delegatorList) {
      if (remainingToAllocate === 0n) break;

      const delegatorPower = delegatorPowers.get(delegator) || 0n;

      // Get total used (initial + what we allocated in first pass)
      const initialUsed = delegatorUsed.get(delegator) || 0n;
      const allocatedInFirstPass = allocations.find(a => a.delegator === delegator);
      const used = initialUsed + BigInt(allocatedInFirstPass?.powerUsed || '0');

      const availableFromDelegator = delegatorPower > used ? delegatorPower - used : 0n;

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
 * keccak256(abi.encodePacked(delegate, proposalId, amount, support, allocationsHash, expiry))
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
    ['address', 'uint256', 'uint256', 'bool', 'bytes32', 'uint256'],
    [delegate, proposalId, amount, support, allocationsHash, expiry]
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
    return proposal.status === 0 && now <= Number(proposal.votingEndsAt);
  } catch {
    return false;
  }
}

/**
 * Get available delegated power for a delegate on a proposal
 */
export async function getAvailableDelegatedPower(
  delegate: string,
  proposalId: number
): Promise<bigint> {
  const contract = getGovernanceContract();

  const [totalRaw, usedRaw] = await Promise.all([
    contract.totalDelegatedPower(delegate),
    contract.delegatedVoteAllocated(proposalId, delegate),
  ]);

  const total = BigInt(totalRaw);
  const used = BigInt(usedRaw);

  return total > used ? total - used : 0n;
}

// ============ Claim Functions ============

/**
 * Get all claimable rewards for a user (both direct votes and delegated)
 */
export async function getClaimableRewards(user: string): Promise<ClaimData[]> {
  const contract = getGovernanceContract();
  const claims: ClaimData[] = [];

  // Get proposal count
  const proposalCount = await contract.proposalCounter();

  // Check each proposal for claimable rewards
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

    // Check delegated votes (if user delegated to someone who voted)
    const delegatedTo = await contract.delegatedTo(user);
    if (delegatedTo !== ethers.ZeroAddress) {
      const delegateVote = await contract.getDelegatedVote(i, delegatedTo);
      if (delegateVote.hasVoted && delegateVote.support === outcome) {
        // Check if user's portion is claimed
        const claimed = await contract.delegatorRewardClaimed(i, delegatedTo, user);
        if (!claimed) {
          // Get user's power used for this proposal
          const powerUsed = await contract.getDelegatorVotePower(i, delegatedTo, user);
          if (BigInt(powerUsed) > 0n) {
            claims.push({
              proposalId: i,
              claimType: ClaimType.Delegator,
              delegate: delegatedTo,
              votePower: powerUsed.toString(),
            });
          }
        }
      }
    }
  }

  return claims;
}

/**
 * Sign claim approval matching contract's verification format:
 * keccak256(abi.encodePacked("claimVoterRewards", msg.sender, abi.encode(claims), expiry))
 */
export async function signClaimApproval(
  user: string,
  claims: ClaimData[],
  expiry: number
): Promise<string> {
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();

  // Encode claims as tuple array matching Solidity struct
  // ClaimData struct: (uint256 proposalId, ClaimType claimType, address delegate, uint256 votePower)
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
