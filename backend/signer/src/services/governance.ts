import { ethers } from 'ethers';
import { config } from '../config';

// Governance contract ABI (read functions for VP tracking)
const GOVERNANCE_ABI = [
  'function stakedRose(address user) external view returns (uint256)',
  'function votingPower(address user) external view returns (uint256)',
  'function totalStakedRose() external view returns (uint256)',
  'function totalVotingPower() external view returns (uint256)',
  'function delegatedVP(address delegator, address delegate) external view returns (uint256)',
  'function totalDelegatedOut(address user) external view returns (uint256)',
  'function totalDelegatedIn(address delegate) external view returns (uint256)',
  'function allocatedToProposal(address user) external view returns (uint256)',
  'function proposalVPLocked(address user) external view returns (uint256)',
  'function getAvailableVP(address user) external view returns (uint256)',
  'function getUserDelegations(address user) external view returns (address[] delegates, uint256[] amounts)',
  'function delegators(address delegate) external view returns (address[])',
  'function getReputation(address user) external view returns (uint256)',
  'function getReputationSimple(address user) external view returns (uint256)',
  'function getVotePower(uint256 amount, uint256 reputation) external pure returns (uint256)',
  'function userStats(address user) external view returns (uint256 tasksCompleted, uint256 totalTaskValue, uint256 disputes, uint256 failedProposals, uint256 lastTaskTimestamp)',
  // New bucket storage for reputation formula
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

// Create provider and contract instance
const provider = new ethers.JsonRpcProvider(config.rpc.url);

function getGovernanceContract(): ethers.Contract | null {
  if (!config.contracts.governance) {
    console.warn('Governance contract address not configured');
    return null;
  }
  return new ethers.Contract(config.contracts.governance, GOVERNANCE_ABI, provider);
}

/**
 * Get user's VP breakdown from contract
 */
export async function getUserVP(address: string): Promise<VPData> {
  const governance = getGovernanceContract();
  if (!governance) {
    return {
      stakedRose: '0',
      votingPower: '0',
      availableVP: '0',
      delegatedOut: '0',
      proposalVPLocked: '0',
      activeProposal: 0,
    };
  }

  try {
    const [stakedRose, votingPower, delegatedOut, proposalVPLocked, activeProposal] =
      await Promise.all([
        governance.stakedRose(address),
        governance.votingPower(address),
        governance.totalDelegatedOut(address),
        governance.proposalVPLocked(address),
        governance.allocatedToProposal(address),
      ]);

    const availableVP = votingPower - delegatedOut - proposalVPLocked;

    return {
      stakedRose: stakedRose.toString(),
      votingPower: votingPower.toString(),
      availableVP: (availableVP > 0n ? availableVP : 0n).toString(),
      delegatedOut: delegatedOut.toString(),
      proposalVPLocked: proposalVPLocked.toString(),
      activeProposal: Number(activeProposal),
    };
  } catch (error) {
    console.error('Error fetching user VP:', error);
    throw error;
  }
}

/**
 * Get total system VP
 */
export async function getTotalSystemVP(): Promise<string> {
  const governance = getGovernanceContract();
  if (!governance) {
    return '0';
  }

  try {
    const totalVP = await governance.totalVotingPower();
    return totalVP.toString();
  } catch (error) {
    console.error('Error fetching total VP:', error);
    throw error;
  }
}

/**
 * Get user's delegations (multi-delegation)
 */
export async function getUserDelegations(address: string): Promise<DelegationInfo[]> {
  const governance = getGovernanceContract();
  if (!governance) {
    return [];
  }

  try {
    const [delegates, amounts] = await governance.getUserDelegations(address);
    return delegates.map((d: string, i: number) => ({
      delegate: d,
      vpAmount: amounts[i].toString(),
    }));
  } catch (error) {
    console.error('Error fetching user delegations:', error);
    throw error;
  }
}

/**
 * Get VP delegated TO a delegate (received delegations)
 */
export async function getReceivedDelegations(delegateAddr: string): Promise<ReceivedDelegationInfo[]> {
  const governance = getGovernanceContract();
  if (!governance) {
    return [];
  }

  try {
    // Get list of delegators for this delegate
    const delegatorList: string[] = await governance.delegators(delegateAddr);

    // Get VP amounts for each delegator
    const delegations: ReceivedDelegationInfo[] = [];
    for (const delegator of delegatorList) {
      const vpAmount = await governance.delegatedVP(delegator, delegateAddr);
      if (vpAmount > 0n) {
        delegations.push({
          delegator,
          vpAmount: vpAmount.toString(),
        });
      }
    }

    return delegations;
  } catch (error) {
    console.error('Error fetching received delegations:', error);
    throw error;
  }
}

/**
 * Get total received VP for a delegate
 */
export async function getTotalReceivedVP(delegateAddr: string): Promise<string> {
  const governance = getGovernanceContract();
  if (!governance) {
    return '0';
  }

  try {
    const totalReceived = await governance.totalDelegatedIn(delegateAddr);
    return totalReceived.toString();
  } catch (error) {
    console.error('Error fetching total received VP:', error);
    throw error;
  }
}

/**
 * Get user's reputation score
 */
export async function getReputation(address: string): Promise<number> {
  const governance = getGovernanceContract();
  if (!governance) {
    return 60; // Default reputation
  }

  try {
    const rep = await governance.getReputation(address);
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
 * Get user stats from contract
 */
export async function getUserStats(address: string): Promise<UserStatsData> {
  const governance = getGovernanceContract();
  if (!governance) {
    return {
      tasksCompleted: 0,
      totalTaskValue: '0',
      disputes: 0,
      failedProposals: 0,
      lastTaskTimestamp: 0,
    };
  }

  try {
    const stats = await governance.userStats(address);
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
 */
export async function fetchUserBuckets(address: string): Promise<BucketData[]> {
  const governance = getGovernanceContract();
  if (!governance) {
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
          governance.monthlySuccessValue(address, bucket),
          governance.monthlyDisputeValue(address, bucket),
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
  getSignedReputation,
};
