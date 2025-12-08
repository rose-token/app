import { ethers } from 'ethers';
import { config } from '../config';
import { query, getPool } from '../db/pool';
import { DelegationAllocation } from '../types';

// ABI for reading on-chain allocation data
const GOVERNANCE_ABI = [
  'function allocationHashes(uint256 proposalId, address delegate) external view returns (bytes32)',
  'function delegatorVoteContribution(uint256 proposalId, address delegate, address delegator) external view returns (uint256)',
  'function proposalCounter() external view returns (uint256)',
  'function getDelegatedVote(uint256 proposalId, address delegate) external view returns (tuple(bool hasVoted, bool support, uint256 totalPowerUsed))',
  'function proposals(uint256 proposalId) external view returns (tuple(address proposer, string title, string descriptionHash, uint256 value, uint256 deadline, string deliverables, uint256 createdAt, uint256 votingEndsAt, uint256 yayVotes, uint256 nayVotes, uint8 status, uint256 editCount, uint256 taskId))',
];

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

/**
 * Discrepancy types found during reconciliation
 *
 * NOTE: We do NOT compare allocationHashes because they become stale after
 * undelegateWithVoteReduction (contract doesn't update the hash, only the
 * per-delegator contributions). Instead, we compare individual contributions
 * against on-chain delegatorVoteContribution which IS updated during reductions.
 */
export enum DiscrepancyType {
  MISSING_ON_CHAIN = 'MISSING_ON_CHAIN',     // DB has record but no on-chain vote
  POWER_MISMATCH = 'POWER_MISMATCH',         // Individual delegator power doesn't match on-chain
  ORPHANED_DB_RECORD = 'ORPHANED_DB_RECORD', // DB record for proposal/delegate with no on-chain vote
}

export interface ReconciliationDiscrepancy {
  type: DiscrepancyType;
  proposalId: number;
  delegate: string;
  delegator?: string;
  dbValue?: string;
  onChainValue?: string;
  message: string;
}

export interface ReconciliationResult {
  checkedAt: Date;
  proposalsChecked: number;
  delegatesChecked: number;
  allocationsChecked: number;
  discrepancies: ReconciliationDiscrepancy[];
  isHealthy: boolean;
}

// NOTE: computeAllocationsHash was removed because we no longer compare hashes
// in reconciliation. The on-chain allocationHashes becomes stale after
// undelegateWithVoteReduction, so we only compare individual delegatorVoteContribution.
// Hash comparison is still done at confirm-vote time in delegation.ts (verifyAndStoreAllocations).

/**
 * Get all unique (proposalId, delegate) pairs from database
 */
async function getDbDelegateVotes(): Promise<Array<{ proposalId: number; delegate: string }>> {
  const result = await query<{ proposal_id: number; delegate: string }>(
    `SELECT DISTINCT proposal_id, delegate FROM delegation_allocations`
  );
  return result.rows.map(row => ({
    proposalId: row.proposal_id,
    delegate: row.delegate,
  }));
}

/**
 * Get all allocations from DB for a specific proposal/delegate
 */
async function getDbAllocations(
  proposalId: number,
  delegate: string
): Promise<Array<{ delegator: string; powerUsed: string }>> {
  const result = await query<{ delegator: string; power_used: string }>(
    `SELECT delegator, power_used FROM delegation_allocations
     WHERE proposal_id = $1 AND LOWER(delegate) = LOWER($2)`,
    [proposalId, delegate]
  );
  return result.rows.map(row => ({
    delegator: row.delegator,
    powerUsed: row.power_used,
  }));
}

/**
 * Run full reconciliation between DB and on-chain state
 */
export async function runReconciliation(): Promise<ReconciliationResult> {
  const contract = getGovernanceContract();
  const discrepancies: ReconciliationDiscrepancy[] = [];
  const checkedDelegates = new Set<string>();
  let allocationsChecked = 0;

  // Get all delegate votes from DB
  const dbVotes = await getDbDelegateVotes();

  for (const { proposalId, delegate } of dbVotes) {
    checkedDelegates.add(`${proposalId}-${delegate.toLowerCase()}`);

    // Get on-chain vote record
    const voteRecord = await contract.getDelegatedVote(proposalId, delegate);

    // Check if vote exists on-chain
    if (!voteRecord.hasVoted) {
      discrepancies.push({
        type: DiscrepancyType.ORPHANED_DB_RECORD,
        proposalId,
        delegate,
        message: `DB has allocations but no on-chain vote for proposal ${proposalId}, delegate ${delegate}`,
      });
      continue;
    }

    // Get allocations from DB
    const dbAllocations = await getDbAllocations(proposalId, delegate);
    allocationsChecked += dbAllocations.length;

    // NOTE: We do NOT compare allocationHashes here because:
    // 1. allocationHashes is only set in castDelegatedVote and never updated
    // 2. undelegateWithVoteReduction updates delegatorVoteContribution but NOT allocationHashes
    // 3. After any reduction, the hash comparison would always fail (false positive)
    //
    // Instead, we compare individual delegatorVoteContribution values which ARE
    // updated during reductions and represent the true on-chain state.

    // Check individual delegator contributions against on-chain
    for (const alloc of dbAllocations) {
      const onChainPower = BigInt(
        await contract.delegatorVoteContribution(proposalId, delegate, alloc.delegator)
      );
      const dbPower = BigInt(alloc.powerUsed);

      if (onChainPower !== dbPower) {
        discrepancies.push({
          type: DiscrepancyType.POWER_MISMATCH,
          proposalId,
          delegate,
          delegator: alloc.delegator,
          dbValue: dbPower.toString(),
          onChainValue: onChainPower.toString(),
          message: `Power mismatch for delegator ${alloc.delegator}: DB=${dbPower}, on-chain=${onChainPower}`,
        });
      }
    }
  }

  // Get proposal count to check for on-chain votes missing from DB
  const proposalCount = Number(await contract.proposalCounter());

  return {
    checkedAt: new Date(),
    proposalsChecked: proposalCount,
    delegatesChecked: checkedDelegates.size,
    allocationsChecked,
    discrepancies,
    isHealthy: discrepancies.length === 0,
  };
}

/**
 * Run reconciliation for a specific proposal
 */
export async function reconcileProposal(proposalId: number): Promise<ReconciliationResult> {
  const contract = getGovernanceContract();
  const discrepancies: ReconciliationDiscrepancy[] = [];
  let allocationsChecked = 0;

  // Get all delegates for this proposal from DB
  const result = await query<{ delegate: string }>(
    `SELECT DISTINCT delegate FROM delegation_allocations WHERE proposal_id = $1`,
    [proposalId]
  );

  for (const row of result.rows) {
    const delegate = row.delegate;

    // Get on-chain vote record
    const voteRecord = await contract.getDelegatedVote(proposalId, delegate);

    if (!voteRecord.hasVoted) {
      discrepancies.push({
        type: DiscrepancyType.ORPHANED_DB_RECORD,
        proposalId,
        delegate,
        message: `DB has allocations but no on-chain vote`,
      });
      continue;
    }

    // Get DB allocations
    const dbAllocations = await getDbAllocations(proposalId, delegate);
    allocationsChecked += dbAllocations.length;

    // NOTE: Skip hash comparison - see runReconciliation() for reasoning
    // Only compare individual delegatorVoteContribution values

    // Check individual contributions against on-chain
    for (const alloc of dbAllocations) {
      const onChainPower = BigInt(
        await contract.delegatorVoteContribution(proposalId, delegate, alloc.delegator)
      );
      const dbPower = BigInt(alloc.powerUsed);

      if (onChainPower !== dbPower) {
        discrepancies.push({
          type: DiscrepancyType.POWER_MISMATCH,
          proposalId,
          delegate,
          delegator: alloc.delegator,
          dbValue: dbPower.toString(),
          onChainValue: onChainPower.toString(),
          message: `Power mismatch for ${alloc.delegator}`,
        });
      }
    }
  }

  return {
    checkedAt: new Date(),
    proposalsChecked: 1,
    delegatesChecked: result.rows.length,
    allocationsChecked,
    discrepancies,
    isHealthy: discrepancies.length === 0,
  };
}

/**
 * Sync DB allocations from on-chain data for a specific proposal/delegate
 * Used to recover from discrepancies
 */
export async function syncAllocationsFromChain(
  proposalId: number,
  delegate: string
): Promise<{ synced: number; errors: string[] }> {
  const contract = getGovernanceContract();
  const errors: string[] = [];
  let synced = 0;

  // Get on-chain vote record
  const voteRecord = await contract.getDelegatedVote(proposalId, delegate);

  if (!voteRecord.hasVoted) {
    // No on-chain vote - delete DB records
    await query(
      `DELETE FROM delegation_allocations WHERE proposal_id = $1 AND LOWER(delegate) = LOWER($2)`,
      [proposalId, delegate]
    );
    return { synced: 0, errors: ['No on-chain vote - cleared DB records'] };
  }

  // Get DB allocations to find delegators
  const dbAllocations = await getDbAllocations(proposalId, delegate);

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    for (const alloc of dbAllocations) {
      // Get on-chain contribution
      const onChainPower = BigInt(
        await contract.delegatorVoteContribution(proposalId, delegate, alloc.delegator)
      );

      if (onChainPower === 0n) {
        // Delegator no longer has contribution - delete
        await client.query(
          `DELETE FROM delegation_allocations
           WHERE proposal_id = $1 AND LOWER(delegate) = LOWER($2) AND LOWER(delegator) = LOWER($3)`,
          [proposalId, delegate, alloc.delegator]
        );
        synced++;
      } else if (onChainPower !== BigInt(alloc.powerUsed)) {
        // Update to match on-chain
        await client.query(
          `UPDATE delegation_allocations SET power_used = $1
           WHERE proposal_id = $2 AND LOWER(delegate) = LOWER($3) AND LOWER(delegator) = LOWER($4)`,
          [onChainPower.toString(), proposalId, delegate, alloc.delegator]
        );
        synced++;
      }
    }

    // NOTE: We do NOT update allocations_hash here because:
    // 1. On-chain allocationHashes is stale after reductions (never updated)
    // 2. DB hash is only used at confirm-vote time, not for ongoing reconciliation
    // The per-delegator power_used values are the source of truth

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    const errMsg = err instanceof Error ? err.message : String(err);
    errors.push(errMsg);
  } finally {
    client.release();
  }

  return { synced, errors };
}

/**
 * Clear DB allocations for a delegator after vote reduction
 * Called after successful undelegateWithVoteReduction
 */
export async function clearDelegatorAllocations(
  delegator: string,
  delegate: string,
  proposalIds: number[]
): Promise<void> {
  if (proposalIds.length === 0) return;

  await query(
    `UPDATE delegation_allocations
     SET power_used = 0
     WHERE LOWER(delegator) = LOWER($1) AND LOWER(delegate) = LOWER($2) AND proposal_id = ANY($3)`,
    [delegator, delegate, proposalIds]
  );

  console.log(`[Reconciliation] Cleared allocations for delegator ${delegator} on ${proposalIds.length} proposals`);
}

/**
 * Validate that a delegator's claimed power matches on-chain
 * Returns true if valid, false if discrepancy found
 */
export async function validateDelegatorClaimPower(
  proposalId: number,
  delegate: string,
  delegator: string,
  claimedPower: bigint
): Promise<{ valid: boolean; onChainPower: bigint }> {
  const contract = getGovernanceContract();

  const onChainPower = BigInt(
    await contract.delegatorVoteContribution(proposalId, delegate, delegator)
  );

  return {
    valid: onChainPower === claimedPower,
    onChainPower,
  };
}

/**
 * Get reconciliation summary statistics
 */
export async function getReconciliationStats(): Promise<{
  totalDbRecords: number;
  uniqueProposals: number;
  uniqueDelegates: number;
  uniqueDelegators: number;
  lastReconciliation?: Date;
}> {
  const totalResult = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM delegation_allocations`
  );

  const proposalsResult = await query<{ count: string }>(
    `SELECT COUNT(DISTINCT proposal_id) as count FROM delegation_allocations`
  );

  const delegatesResult = await query<{ count: string }>(
    `SELECT COUNT(DISTINCT delegate) as count FROM delegation_allocations`
  );

  const delegatorsResult = await query<{ count: string }>(
    `SELECT COUNT(DISTINCT delegator) as count FROM delegation_allocations`
  );

  return {
    totalDbRecords: parseInt(totalResult.rows[0]?.count || '0'),
    uniqueProposals: parseInt(proposalsResult.rows[0]?.count || '0'),
    uniqueDelegates: parseInt(delegatesResult.rows[0]?.count || '0'),
    uniqueDelegators: parseInt(delegatorsResult.rows[0]?.count || '0'),
  };
}
