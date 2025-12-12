/**
 * Slow Track Watcher Service
 *
 * Watches for Slow Track voting events and syncs allocations to the database.
 * - VoteCastSlow: Record new vote allocations
 * - VoteUpdated: Update existing allocation amounts
 * - ProposalFinalized: Cleanup allocations when proposals end
 */

import { ethers } from 'ethers';
import { config } from '../config';
import {
  recordAllocation,
  cleanupProposalAllocations,
  getProposalDeadline,
} from './allocations';

// Governance contract ABI - events and views needed for watcher
const GOVERNANCE_ABI = [
  // Events
  // Note: We only listen to VoteCastSlow (has full data including support)
  // VoteUpdated is also emitted on updates but VoteCastSlow is sufficient
  'event VoteCastSlow(uint256 indexed proposalId, address indexed voter, bool support, uint256 vpAmount, uint256 nonce)',
  'event ProposalFinalized(uint256 indexed proposalId, uint8 status)',

  // Views
  'function proposals(uint256 proposalId) external view returns (tuple(address proposer, uint8 track, uint256 snapshotBlock, bytes32 vpMerkleRoot, uint256 votingStartsAt, uint256 votingEndsAt, uint256 forVotes, uint256 againstVotes, uint256 treasuryAmount, uint8 status, string title, string descriptionHash, uint256 deadline, string deliverables, uint256 editCount, uint256 taskId))',
];

// Track enum from contract
enum Track {
  Fast = 0,
  Slow = 1,
}

// Types
export interface SlowTrackWatcherStats {
  isRunning: boolean;
  startedAt: Date | null;
  votesProcessed: number;
  cleanupProcessed: number;
  lastError: string | null;
  lastEventBlock: number;
}

// State
let provider: ethers.JsonRpcProvider | null = null;
let governanceContract: ethers.Contract | null = null;

const stats: SlowTrackWatcherStats = {
  isRunning: false,
  startedAt: null,
  votesProcessed: 0,
  cleanupProcessed: 0,
  lastError: null,
  lastEventBlock: 0,
};

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

// ============================================================
// Event Handlers
// ============================================================

/**
 * Handle VoteCastSlow event.
 * Records the allocation to the database.
 */
async function handleVoteCastSlow(
  proposalId: bigint,
  voter: string,
  support: boolean,
  vpAmount: bigint,
  nonce: bigint,
  event: ethers.Log | ethers.ContractEventPayload
): Promise<void> {
  const id = Number(proposalId);
  console.log(
    `[SlowTrackWatcher] VoteCastSlow: proposal=${id}, voter=${voter.slice(0, 10)}..., support=${support}, amount=${vpAmount}, nonce=${nonce}`
  );

  // Extract log from ContractEventPayload (.on() listener) or use directly (queryFilter)
  const log = 'log' in event ? event.log : event;
  stats.lastEventBlock = Math.max(stats.lastEventBlock, log.blockNumber);

  try {
    // Get proposal deadline for allocation tracking
    const deadline = await getProposalDeadline(id);

    // Record allocation
    await recordAllocation(voter, id, vpAmount, support, deadline);

    stats.votesProcessed++;
    console.log(`[SlowTrackWatcher] Recorded allocation for vote on proposal ${id}`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    stats.lastError = errorMsg;
    console.error(`[SlowTrackWatcher] Failed to record allocation for proposal ${id}:`, error);
  }
}

/**
 * Handle ProposalFinalized event.
 * Cleans up all allocations for the proposal.
 */
async function handleProposalFinalized(
  proposalId: bigint,
  status: number,
  event: ethers.Log | ethers.ContractEventPayload
): Promise<void> {
  const id = Number(proposalId);
  console.log(`[SlowTrackWatcher] ProposalFinalized: proposal=${id}, status=${status}`);

  // Extract log from ContractEventPayload (.on() listener) or use directly (queryFilter)
  const log = 'log' in event ? event.log : event;
  stats.lastEventBlock = Math.max(stats.lastEventBlock, log.blockNumber);

  try {
    // Clean up all allocations for this proposal
    const deletedCount = await cleanupProposalAllocations(id);

    stats.cleanupProcessed += deletedCount;
    console.log(`[SlowTrackWatcher] Cleaned up ${deletedCount} allocations for finalized proposal ${id}`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    stats.lastError = errorMsg;
    console.error(`[SlowTrackWatcher] Failed to cleanup allocations for proposal ${id}:`, error);
  }
}

// ============================================================
// Startup Catch-up
// ============================================================

/**
 * Catch up on recent events that may have been missed.
 * Processes events from the last N blocks on startup.
 */
async function catchUpRecentEvents(): Promise<void> {
  console.log('[SlowTrackWatcher] Catching up on recent events...');

  const governance = getGovernanceContract();
  const currentBlock = await getProvider().getBlockNumber();
  const lookbackBlocks = config.slowTrackWatcher?.startupBlockLookback ?? 10000;
  const fromBlock = Math.max(0, currentBlock - lookbackBlocks);

  console.log(`[SlowTrackWatcher] Scanning blocks ${fromBlock} to ${currentBlock}`);

  // Process VoteCastSlow events
  try {
    const voteFilter = governance.filters.VoteCastSlow();
    const voteEvents = await governance.queryFilter(voteFilter, fromBlock, currentBlock);

    console.log(`[SlowTrackWatcher] Found ${voteEvents.length} VoteCastSlow events`);

    for (const event of voteEvents) {
      if (!('args' in event) || !event.args) continue;

      const args = event.args as unknown as {
        proposalId: bigint;
        voter: string;
        support: boolean;
        vpAmount: bigint;
        nonce: bigint;
      };

      await handleVoteCastSlow(
        args.proposalId,
        args.voter,
        args.support,
        args.vpAmount,
        args.nonce,
        event
      );
    }
  } catch (error) {
    console.error('[SlowTrackWatcher] Error catching up VoteCastSlow events:', error);
  }

  // Process ProposalFinalized events (to cleanup stale allocations)
  try {
    const finalizedFilter = governance.filters.ProposalFinalized();
    const finalizedEvents = await governance.queryFilter(finalizedFilter, fromBlock, currentBlock);

    console.log(`[SlowTrackWatcher] Found ${finalizedEvents.length} ProposalFinalized events`);

    for (const event of finalizedEvents) {
      if (!('args' in event) || !event.args) continue;

      const args = event.args as unknown as {
        proposalId: bigint;
        status: number;
      };

      await handleProposalFinalized(args.proposalId, args.status, event);
    }
  } catch (error) {
    console.error('[SlowTrackWatcher] Error catching up ProposalFinalized events:', error);
  }

  console.log('[SlowTrackWatcher] Catch-up complete');
}

// ============================================================
// Watcher Lifecycle
// ============================================================

/**
 * Start the Slow Track watcher.
 * Listens for VoteCastSlow and ProposalFinalized events.
 */
export async function startSlowTrackWatcher(): Promise<void> {
  // Check configuration
  if (!config.contracts.governance) {
    console.log('[SlowTrackWatcher] GOVERNANCE_ADDRESS not configured, skipping');
    return;
  }

  if (config.slowTrackWatcher?.enabled === false) {
    console.log('[SlowTrackWatcher] Disabled via config');
    return;
  }

  console.log('[SlowTrackWatcher] Starting Slow Track watcher...');
  console.log(`[SlowTrackWatcher] Governance: ${config.contracts.governance}`);

  try {
    const governance = getGovernanceContract();

    // Listen for new votes (VoteCastSlow covers both new votes and updates)
    // Note: VoteUpdated event is also emitted on updates but VoteCastSlow has all data we need
    governance.on('VoteCastSlow', (proposalId, voter, support, vpAmount, nonce, event) => {
      handleVoteCastSlow(proposalId, voter, support, vpAmount, nonce, event).catch((err) => {
        console.error('[SlowTrackWatcher] Error in VoteCastSlow handler:', err);
      });
    });

    // Listen for proposal finalization (cleanup)
    governance.on('ProposalFinalized', (proposalId, status, event) => {
      handleProposalFinalized(proposalId, status, event).catch((err) => {
        console.error('[SlowTrackWatcher] Error in ProposalFinalized handler:', err);
      });
    });

    stats.isRunning = true;
    stats.startedAt = new Date();

    console.log('[SlowTrackWatcher] Listening for Slow Track events...');

    // Catch up on recent events
    await catchUpRecentEvents();

    console.log('[SlowTrackWatcher] Startup complete');
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    stats.lastError = errorMsg;
    console.error('[SlowTrackWatcher] Failed to start:', error);
    throw error;
  }
}

/**
 * Stop the Slow Track watcher.
 */
export function stopSlowTrackWatcher(): void {
  if (governanceContract) {
    governanceContract.removeAllListeners('VoteCastSlow');
    governanceContract.removeAllListeners('ProposalFinalized');
  }

  stats.isRunning = false;
  console.log('[SlowTrackWatcher] Stopped');
}

/**
 * Get watcher stats for monitoring.
 */
export function getSlowTrackWatcherStats(): SlowTrackWatcherStats {
  return { ...stats };
}
