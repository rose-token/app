import { ethers } from 'ethers';
import { config } from '../config';
import { query } from '../db/pool';

// Governance contract ABI - only functions that actually exist in the contract
// NOTE: VP tracking functions (votingPower, totalVotingPower, delegation, etc.) don't exist
// on-chain. VP is computed off-chain and stored in the 'stakers' and 'delegations' DB tables.
const GOVERNANCE_ABI = [
  'function stakedRose(address user) external view returns (uint256)',
  'function totalStakedRose() external view returns (uint256)',
  'function getVotePower(uint256 amount, uint256 reputation) external pure returns (uint256)',
];

// Reputation contract ABI (split from RoseGovernance)
const REPUTATION_ABI = [
  'function getReputation(address user) external view returns (uint256)',
  'function getReputationSimple(address user) external view returns (uint256)',
  'function userStats(address user) external view returns (uint256 tasksCompleted, uint256 totalTaskValue, uint256 disputes, uint256 failedProposals, uint256 lastTaskTimestamp)',
  'function canPropose(address user) external view returns (bool)',
  'function canVote(address user) external view returns (bool)',
  'function canDelegate(address user) external view returns (bool)',
  // Bucket storage for reputation formula
  'function monthlySuccessValue(address user, uint256 bucket) external view returns (uint256)',
  'function monthlyDisputeValue(address user, uint256 bucket) external view returns (uint256)',
  'function BUCKET_DURATION() external view returns (uint256)',
  'function DECAY_BUCKETS() external view returns (uint256)',
];

// Types for governance data
export interface VPData {
  stakedRose: string;
  votingPower: string;
  availableVP: string;
  delegatedOut: string;
  proposalVPLocked: string;
  activeProposal: number;
}

export interface DelegationInfo {
  delegate: string;
  vpAmount: string;
}

export interface ReceivedDelegationInfo {
  delegator: string;
  vpAmount: string;
}

export interface UserStatsData {
  tasksCompleted: number;
  totalTaskValue: string;
  disputes: number;
  failedProposals: number;
  lastTaskTimestamp: number;
}

export interface BucketData {
  bucket: number;
  successValue: bigint;
  disputeValue: bigint;
}

export interface ReputationAttestation {
  address: string;
  reputation: number;
  expiry: number;
  signature: string;
}

// Constants for new reputation formula
const BUCKET_DURATION = 30 * 24 * 60 * 60; // 30 days in seconds
const DECAY_BUCKETS = 36; // 3 years
const COLD_START_TASKS = 10;
const DEFAULT_REPUTATION = 60;
const FAILED_PROPOSAL_PENALTY = 5; // points per failed proposal

// Create provider and contract instances
const provider = new ethers.JsonRpcProvider(config.rpc.url);

function getGovernanceContract(): ethers.Contract | null {
  if (!config.contracts.governance) {
    console.warn('Governance contract address not configured');
    return null;
  }
  return new ethers.Contract(config.contracts.governance, GOVERNANCE_ABI, provider);
}

function getReputationContract(): ethers.Contract | null {
  if (!config.contracts.reputation) {
    console.warn('Reputation contract address not configured');
    return null;
  }
  return new ethers.Contract(config.contracts.reputation, REPUTATION_ABI, provider);
}

/**
 * Get user's VP breakdown from database tables
 * (VP is computed off-chain, not stored in contract)
 */
export async function getUserVP(address: string): Promise<VPData> {
  try {
    const normalizedAddress = address.toLowerCase();

    // Get staker data from stakers table
    const stakerResult = await query(
      'SELECT staked_rose, voting_power FROM stakers WHERE address = $1',
      [normalizedAddress]
    );

    // Get total VP delegated out by this user
    const delegatedOutResult = await query(
      `SELECT COALESCE(SUM(vp_amount), 0) as total
       FROM delegations
       WHERE delegator = $1
         AND revoked_at IS NULL
         AND expiry > NOW()`,
      [normalizedAddress]
    );

    // Get VP locked in active proposals (from vp_allocations table)
    const allocationsResult = await query(
      `SELECT COALESCE(SUM(vp_amount), 0) as total, COUNT(*) as count
       FROM vp_allocations
       WHERE user_address = $1
         AND deadline > NOW()`,
      [normalizedAddress]
    );

    const stakedRose = stakerResult.rows.length > 0 ? BigInt(stakerResult.rows[0].staked_rose) : 0n;
    const votingPower = stakerResult.rows.length > 0 ? BigInt(stakerResult.rows[0].voting_power) : 0n;
    const delegatedOut = BigInt(delegatedOutResult.rows[0].total);
    const proposalVPLocked = BigInt(allocationsResult.rows[0].total);
    const activeProposal = parseInt(allocationsResult.rows[0].count);

    const availableVP = votingPower - delegatedOut - proposalVPLocked;

    return {
      stakedRose: stakedRose.toString(),
      votingPower: votingPower.toString(),
      availableVP: (availableVP > 0n ? availableVP : 0n).toString(),
      delegatedOut: delegatedOut.toString(),
      proposalVPLocked: proposalVPLocked.toString(),
      activeProposal,
    };
  } catch (error) {
    console.error('Error fetching user VP:', error);
    throw error;
  }
}

/**
 * Get total system VP from stakers database table
 * (VP is computed off-chain, not stored in contract)
 */
export async function getTotalSystemVP(): Promise<string> {
  try {
    const result = await query(
      'SELECT COALESCE(SUM(voting_power), 0) as total FROM stakers WHERE staked_rose > 0'
    );
    return result.rows[0].total;
  } catch (error) {
    console.error('Error fetching total VP:', error);
    throw error;
  }
}

/**
 * Get user's delegations from database table
 * (Delegations are stored off-chain)
 */
export async function getUserDelegations(address: string): Promise<DelegationInfo[]> {
  try {
    const result = await query(
      `SELECT delegate, vp_amount
       FROM delegations
       WHERE delegator = $1
         AND revoked_at IS NULL
         AND expiry > NOW()
       ORDER BY created_at DESC`,
      [address.toLowerCase()]
    );

    return result.rows.map((row) => ({
      delegate: row.delegate,
      vpAmount: row.vp_amount,
    }));
  } catch (error) {
    console.error('Error fetching user delegations:', error);
    throw error;
  }
}

/**
 * Get VP delegated TO a delegate from database table
 * (Delegations are stored off-chain)
 */
export async function getReceivedDelegations(delegateAddr: string): Promise<ReceivedDelegationInfo[]> {
  try {
    const result = await query(
      `SELECT delegator, vp_amount
       FROM delegations
       WHERE delegate = $1
         AND revoked_at IS NULL
         AND expiry > NOW()
         AND vp_amount > 0
       ORDER BY vp_amount DESC`,
      [delegateAddr.toLowerCase()]
    );

    return result.rows.map((row) => ({
      delegator: row.delegator,
      vpAmount: row.vp_amount,
    }));
  } catch (error) {
    console.error('Error fetching received delegations:', error);
    throw error;
  }
}

/**
 * Get total received VP for a delegate from database table
 * (Delegations are stored off-chain)
 */
export async function getTotalReceivedVP(delegateAddr: string): Promise<string> {
  try {
    const result = await query(
      `SELECT COALESCE(SUM(vp_amount), 0) as total
       FROM delegations
       WHERE delegate = $1
         AND revoked_at IS NULL
         AND expiry > NOW()`,
      [delegateAddr.toLowerCase()]
    );
    return result.rows[0].total;
  } catch (error) {
    console.error('Error fetching total received VP:', error);
    throw error;
  }
}

/**
 * Get user's reputation score (from RoseReputation contract)
 */
export async function getReputation(address: string): Promise<number> {
  const reputation = getReputationContract();
  if (!reputation) {
    return 60; // Default reputation
  }

  try {
    const rep = await reputation.getReputation(address);
    return Number(rep);
  } catch (error) {
    console.error('Error fetching reputation:', error);
    throw error;
  }
}

/**
 * Calculate VP from amount and reputation (mirrors contract logic)
 */
export function calculateVotePower(amount: bigint, reputation: number): bigint {
  if (amount === 0n || reputation === 0) return 0n;
  const sqrtAmount = sqrt(amount);
  return (sqrtAmount * BigInt(reputation)) / 100n;
}

/**
 * Integer square root using Babylonian method
 */
function sqrt(x: bigint): bigint {
  if (x === 0n) return 0n;
  let z = (x + 1n) / 2n;
  let y = x;
  while (z < y) {
    y = z;
    z = (x / z + z) / 2n;
  }
  return y;
}

/**
 * Get user stats from contract (from RoseReputation contract)
 */
export async function getUserStats(address: string): Promise<UserStatsData> {
  const reputation = getReputationContract();
  if (!reputation) {
    return {
      tasksCompleted: 0,
      totalTaskValue: '0',
      disputes: 0,
      failedProposals: 0,
      lastTaskTimestamp: 0,
    };
  }

  try {
    const stats = await reputation.userStats(address);
    return {
      tasksCompleted: Number(stats.tasksCompleted),
      totalTaskValue: stats.totalTaskValue.toString(),
      disputes: Number(stats.disputes),
      failedProposals: Number(stats.failedProposals),
      lastTaskTimestamp: Number(stats.lastTaskTimestamp),
    };
  } catch (error) {
    console.error('Error fetching user stats:', error);
    throw error;
  }
}

/**
 * Fetch monthly bucket data for last 36 months (3 years)
 * (from RoseReputation contract)
 */
export async function fetchUserBuckets(address: string): Promise<BucketData[]> {
  const reputation = getReputationContract();
  if (!reputation) {
    return [];
  }

  try {
    const currentBucket = Math.floor(Date.now() / 1000 / BUCKET_DURATION);
    const buckets: BucketData[] = [];

    // Fetch all 36 buckets in parallel
    const promises: Promise<[bigint, bigint]>[] = [];
    for (let i = 0; i < DECAY_BUCKETS; i++) {
      const bucket = currentBucket - i;
      promises.push(
        Promise.all([
          reputation.monthlySuccessValue(address, bucket),
          reputation.monthlyDisputeValue(address, bucket),
        ])
      );
    }

    const results = await Promise.all(promises);

    for (let i = 0; i < DECAY_BUCKETS; i++) {
      const bucket = currentBucket - i;
      const [successValue, disputeValue] = results[i];
      // Only include non-empty buckets
      if (successValue > 0n || disputeValue > 0n) {
        buckets.push({
          bucket,
          successValue,
          disputeValue,
        });
      }
    }

    return buckets;
  } catch (error) {
    console.error('Error fetching user buckets:', error);
    throw error;
  }
}

/**
 * Calculate reputation using new formula: (successPoints - disputePoints) / successPoints * 100
 * Where successPoints = Σ(taskValue^0.6) and disputePoints = Σ(taskValue^0.6 × 2)
 */
export function calculateReputationNew(
  buckets: BucketData[],
  failedProposals: number,
  tasksCompleted: number
): number {
  // Cold start check
  if (tasksCompleted < COLD_START_TASKS) {
    return DEFAULT_REPUTATION;
  }

  let successPoints = 0;
  let disputePoints = 0;

  // Sum points from buckets with ^0.6 scaling
  for (const bucket of buckets) {
    // Convert from wei (18 decimals) to ROSE for calculation
    const successValue = Number(bucket.successValue) / 1e18;
    const disputeValue = Number(bucket.disputeValue) / 1e18;

    if (successValue > 0) {
      successPoints += Math.pow(successValue, 0.6);
    }
    if (disputeValue > 0) {
      // 2x penalty for disputes
      disputePoints += Math.pow(disputeValue, 0.6) * 2;
    }
  }

  // Add failed proposals penalty
  disputePoints += failedProposals * FAILED_PROPOSAL_PENALTY;

  // Edge cases
  if (successPoints === 0) {
    return DEFAULT_REPUTATION;
  }
  if (disputePoints >= successPoints) {
    return 0;
  }

  // Calculate reputation: (successPoints - disputePoints) / successPoints * 100
  return Math.floor(((successPoints - disputePoints) / successPoints) * 100);
}

/**
 * Get reputation using new formula (combines fetching and calculation)
 */
export async function getReputationNew(address: string): Promise<number> {
  const [buckets, stats] = await Promise.all([
    fetchUserBuckets(address),
    getUserStats(address),
  ]);

  return calculateReputationNew(buckets, stats.failedProposals, stats.tasksCompleted);
}

/**
 * Sign reputation attestation for on-chain validation
 */
export async function signReputationAttestation(
  address: string,
  reputation: number
): Promise<ReputationAttestation> {
  const wallet = new ethers.Wallet(config.signer.privateKey);
  const expiry = Math.floor(Date.now() / 1000) + config.signatureTtl;

  const messageHash = ethers.solidityPackedKeccak256(
    ['string', 'address', 'uint256', 'uint256'],
    ['reputation', address, reputation, expiry]
  );

  const signature = await wallet.signMessage(ethers.getBytes(messageHash));

  return {
    address,
    reputation,
    expiry,
    signature,
  };
}

/**
 * Sign VP refresh attestation for refreshVP() contract call
 * Uses "refreshVP" prefix to match contract's message format
 */
export async function signVPRefreshAttestation(
  address: string,
  reputation: number
): Promise<ReputationAttestation> {
  const wallet = new ethers.Wallet(config.signer.privateKey);
  const expiry = Math.floor(Date.now() / 1000) + config.signatureTtl;

  const messageHash = ethers.solidityPackedKeccak256(
    ['string', 'address', 'uint256', 'uint256'],
    ['refreshVP', address, reputation, expiry]
  );

  const signature = await wallet.signMessage(ethers.getBytes(messageHash));

  return {
    address,
    reputation,
    expiry,
    signature,
  };
}

/**
 * Get signed reputation attestation (fetches buckets, calculates, and signs)
 */
export async function getSignedReputation(address: string): Promise<ReputationAttestation> {
  const reputation = await getReputationNew(address);
  return signReputationAttestation(address, reputation);
}

// Export for use in routes
export default {
  getUserVP,
  getTotalSystemVP,
  getUserDelegations,
  getReceivedDelegations,
  getTotalReceivedVP,
  getReputation,
  getReputationNew,
  calculateVotePower,
  getUserStats,
  fetchUserBuckets,
  calculateReputationNew,
  signReputationAttestation,
  signVPRefreshAttestation,
  getSignedReputation,
};
