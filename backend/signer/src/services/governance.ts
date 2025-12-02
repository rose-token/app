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
  'function getVotePower(uint256 amount, uint256 reputation) external pure returns (uint256)',
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

// Export for use in routes
export default {
  getUserVP,
  getTotalSystemVP,
  getUserDelegations,
  getReceivedDelegations,
  getTotalReceivedVP,
  getReputation,
  calculateVotePower,
};
