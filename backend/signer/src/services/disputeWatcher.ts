/**
 * Dispute Watcher Service
 *
 * Listens for TaskDisputed and DisputeResolved events from RoseMarketplace contract.
 * Syncs dispute data to the database for admin panel queries.
 */

import { ethers } from 'ethers';
import { config } from '../config';
import { recordDispute, recordResolution } from './dispute';
import { ResolutionType } from '../types';
import { getWsProvider, onReconnect, removeReconnectCallback } from '../utils/wsProvider';
import { RoseMarketplaceABI } from '../utils/contracts';

// Types
export interface DisputeWatcherStats {
  isRunning: boolean;
  startedAt: Date | null;
  disputesRecorded: number;
  resolutionsRecorded: number;
  lastEventBlock: number;
  lastError: string | null;
}

// State
let marketplaceContract: ethers.Contract | null = null;
let wsContract: ethers.Contract | null = null;
let reconnectHandler: (() => void) | null = null;

const stats: DisputeWatcherStats = {
  isRunning: false,
  startedAt: null,
  disputesRecorded: 0,
  resolutionsRecorded: 0,
  lastEventBlock: 0,
  lastError: null,
};

function getProvider(): ethers.Provider {
  return getWsProvider();
}

function getMarketplaceContract(): ethers.Contract {
  if (!marketplaceContract) {
    if (!config.contracts.marketplace) {
      throw new Error('MARKETPLACE_ADDRESS not configured');
    }
    marketplaceContract = new ethers.Contract(
      config.contracts.marketplace,
      RoseMarketplaceABI,
      getProvider()
    );
  }
  return marketplaceContract;
}

/**
 * Handle a TaskDisputed event.
 * Records the dispute to the database for admin panel queries.
 */
async function handleTaskDisputed(
  taskId: bigint,
  initiator: string,
  reasonHash: string,
  timestamp: bigint,
  event: ethers.Log | ethers.ContractEventPayload
): Promise<void> {
  const taskIdNum = Number(taskId);
  const timestampNum = Number(timestamp);

  console.log(
    `[DisputeWatcher] TaskDisputed: taskId=${taskIdNum}, initiator=${initiator}, reasonHash=${reasonHash.slice(0, 20)}...`
  );

  // Extract log from ContractEventPayload (.on() listener) or use directly (queryFilter)
  const log = 'log' in event ? event.log : event;

  stats.lastEventBlock = log.blockNumber;

  try {
    await recordDispute(
      taskIdNum,
      initiator,
      reasonHash,
      timestampNum,
      log.blockNumber,
      log.transactionHash
    );
    stats.disputesRecorded++;
    console.log(`[DisputeWatcher] Recorded dispute for task ${taskIdNum}`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    stats.lastError = errorMsg;
    console.error(`[DisputeWatcher] Failed to record dispute for task ${taskIdNum}:`, error);
  }
}

/**
 * Handle a DisputeResolved event.
 * Updates the dispute record with resolution data.
 */
async function handleDisputeResolved(
  taskId: bigint,
  resolution: number,
  workerPct: bigint,
  workerAmount: bigint,
  customerRefund: bigint,
  event: ethers.Log | ethers.ContractEventPayload
): Promise<void> {
  const taskIdNum = Number(taskId);
  const workerPctNum = Number(workerPct);

  console.log(
    `[DisputeWatcher] DisputeResolved: taskId=${taskIdNum}, resolution=${resolution}, workerPct=${workerPctNum}%`
  );

  // Extract log from ContractEventPayload (.on() listener) or use directly (queryFilter)
  const log = 'log' in event ? event.log : event;

  stats.lastEventBlock = log.blockNumber;

  try {
    // Get the transaction to find who resolved it (msg.sender)
    const tx = await getProvider().getTransaction(log.transactionHash);
    const resolvedBy = tx?.from || '';

    await recordResolution(
      taskIdNum,
      resolution as ResolutionType,
      workerPctNum,
      workerAmount.toString(),
      customerRefund.toString(),
      resolvedBy,
      log.blockNumber
    );
    stats.resolutionsRecorded++;
    console.log(`[DisputeWatcher] Recorded resolution for task ${taskIdNum}`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    stats.lastError = errorMsg;
    console.error(`[DisputeWatcher] Failed to record resolution for task ${taskIdNum}:`, error);
  }
}

/**
 * Setup event listeners using WebSocket provider
 */
function setupEventListeners(): void {
  // Clean up previous listeners if any
  if (wsContract) {
    wsContract.removeAllListeners('TaskDisputed');
    wsContract.removeAllListeners('DisputeResolved');
  }

  // Create new contract instance with WebSocket provider for event listening
  wsContract = new ethers.Contract(
    config.contracts.marketplace!,
    RoseMarketplaceABI,
    getWsProvider()
  );

  // Listen for TaskDisputed events
  wsContract.on('TaskDisputed', (taskId, initiator, reasonHash, timestamp, event) => {
    handleTaskDisputed(taskId, initiator, reasonHash, timestamp, event).catch((err) => {
      console.error('[DisputeWatcher] Error in TaskDisputed handler:', err);
      stats.lastError = err instanceof Error ? err.message : String(err);
    });
  });

  // Listen for DisputeResolved events
  wsContract.on('DisputeResolved', (taskId, resolution, workerPct, workerAmount, customerRefund, event) => {
    handleDisputeResolved(taskId, resolution, workerPct, workerAmount, customerRefund, event).catch((err) => {
      console.error('[DisputeWatcher] Error in DisputeResolved handler:', err);
      stats.lastError = err instanceof Error ? err.message : String(err);
    });
  });

  console.log('[DisputeWatcher] Event listeners setup on WebSocket provider');
}

/**
 * Start the dispute watcher.
 * Listens for TaskDisputed and DisputeResolved events from the Marketplace contract.
 */
export async function startDisputeWatcher(): Promise<void> {
  // Check configuration
  if (!config.contracts.marketplace) {
    console.log('[DisputeWatcher] MARKETPLACE_ADDRESS not configured, skipping');
    return;
  }

  if (!config.database.url) {
    console.log('[DisputeWatcher] DATABASE_URL not configured, skipping');
    return;
  }

  if (config.disputeWatcher?.enabled === false) {
    console.log('[DisputeWatcher] Disabled via DISPUTE_WATCHER_ENABLED=false');
    return;
  }

  console.log('[DisputeWatcher] Starting dispute watcher...');
  console.log(`[DisputeWatcher] Marketplace: ${config.contracts.marketplace}`);

  try {
    // Setup event listeners using WebSocket provider
    setupEventListeners();

    // Register reconnect handler to re-setup listeners on WebSocket reconnection
    reconnectHandler = () => {
      console.log('[DisputeWatcher] Reconnecting event listeners...');
      setupEventListeners();
    };
    onReconnect(reconnectHandler);

    stats.isRunning = true;
    stats.startedAt = new Date();

    console.log('[DisputeWatcher] Listening for TaskDisputed and DisputeResolved events...');

    // Catch up on recent events if configured (use HTTP provider for queryFilter)
    const lookbackBlocks = config.disputeWatcher?.startupBlockLookback ?? 10000;
    if (lookbackBlocks > 0) {
      console.log(`[DisputeWatcher] Catching up on last ${lookbackBlocks} blocks...`);
      const marketplace = getMarketplaceContract(); // HTTP provider for queryFilter
      const currentBlock = await getProvider().getBlockNumber();
      const fromBlock = Math.max(0, currentBlock - lookbackBlocks);

      // Query TaskDisputed events
      const disputedFilter = marketplace.filters.TaskDisputed();
      const disputedEvents = await marketplace.queryFilter(disputedFilter, fromBlock, currentBlock);
      console.log(`[DisputeWatcher] Found ${disputedEvents.length} recent TaskDisputed events`);

      for (const event of disputedEvents) {
        if ('args' in event && event.args) {
          const args = event.args as unknown as {
            taskId: bigint;
            initiator: string;
            reasonHash: string;
            timestamp: bigint;
          };
          await handleTaskDisputed(args.taskId, args.initiator, args.reasonHash, args.timestamp, event as ethers.Log);
        }
      }

      // Query DisputeResolved events
      const resolvedFilter = marketplace.filters.DisputeResolved();
      const resolvedEvents = await marketplace.queryFilter(resolvedFilter, fromBlock, currentBlock);
      console.log(`[DisputeWatcher] Found ${resolvedEvents.length} recent DisputeResolved events`);

      for (const event of resolvedEvents) {
        if ('args' in event && event.args) {
          const args = event.args as unknown as {
            taskId: bigint;
            resolution: number;
            workerPct: bigint;
            workerAmount: bigint;
            customerRefund: bigint;
          };
          await handleDisputeResolved(
            args.taskId,
            args.resolution,
            args.workerPct,
            args.workerAmount,
            args.customerRefund,
            event as ethers.Log
          );
        }
      }

      console.log('[DisputeWatcher] Catch-up complete');
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    stats.lastError = errorMsg;
    console.error('[DisputeWatcher] Failed to start:', error);
    throw error;
  }
}

/**
 * Stop the dispute watcher.
 */
export function stopDisputeWatcher(): void {
  // Remove reconnect callback
  if (reconnectHandler) {
    removeReconnectCallback(reconnectHandler);
    reconnectHandler = null;
  }
  // Clean up WebSocket contract listeners
  if (wsContract) {
    wsContract.removeAllListeners('TaskDisputed');
    wsContract.removeAllListeners('DisputeResolved');
    wsContract = null;
  }
  stats.isRunning = false;
  console.log('[DisputeWatcher] Stopped');
}

/**
 * Get dispute watcher stats.
 */
export function getDisputeWatcherStats(): DisputeWatcherStats {
  return { ...stats };
}
