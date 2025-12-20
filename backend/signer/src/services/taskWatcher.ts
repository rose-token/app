/**
 * Task Watcher Service
 *
 * Listens for TaskReadyForPayment events from RoseMarketplace contract.
 * When a task is approved by both customer and stakeholder, automatically
 * approves and merges the associated GitHub PR (if GitHub integration is enabled).
 */

import { ethers } from 'ethers';
import { PinataSDK } from 'pinata';
import { config } from '../config';
import { approveAndMergePR, isGitHubConfigured, parsePrUrl } from './github';
import { getWsProvider, onReconnect, removeReconnectCallback } from '../utils/wsProvider';
import { RoseMarketplaceABI } from '../utils/contracts';

// Lazy-initialized Pinata SDK instance (shared pattern with backup.ts)
let pinataInstance: PinataSDK | null = null;

/**
 * Get or create Pinata SDK instance for private IPFS file access.
 */
function getPinata(): PinataSDK | null {
  if (!pinataInstance) {
    const jwt = config.backup.pinataJwt;
    if (!jwt) {
      console.warn('[TaskWatcher] PINATA_JWT not configured, IPFS metadata fetch will fail');
      return null;
    }
    const gateway = config.backup.pinataGateway || 'https://coffee-glad-felidae-720.mypinata.cloud';
    pinataInstance = new PinataSDK({
      pinataJwt: jwt,
      pinataGateway: new URL(gateway).hostname,
    });
  }
  return pinataInstance;
}

// Types
export interface TaskWatcherStats {
  isRunning: boolean;
  startedAt: Date | null;
  eventsProcessed: number;
  mergesAttempted: number;
  mergesSucceeded: number;
  mergesFailed: number;
  lastError: string | null;
  lastEventBlock: number;
}

interface TaskData {
  customer: string;
  worker: string;
  prUrl: string;
  detailedDescriptionHash: string;
  status: number;
  source: number;  // 0 = Customer, 1 = DAO
}

interface IpfsMetadata {
  title?: string;
  description?: string;
  githubIntegration?: boolean;
  prUrl?: string;
  uploadedAt?: string;
  version?: string;
}

// State
let marketplaceContract: ethers.Contract | null = null;
let wsContract: ethers.Contract | null = null;
let reconnectHandler: (() => void) | null = null;
let isProcessing = false;

const stats: TaskWatcherStats = {
  isRunning: false,
  startedAt: null,
  eventsProcessed: 0,
  mergesAttempted: 0,
  mergesSucceeded: 0,
  mergesFailed: 0,
  lastError: null,
  lastEventBlock: 0,
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
 * Fetch task data from the on-chain contract.
 */
async function getTaskData(taskId: number): Promise<TaskData | null> {
  try {
    const contract = getMarketplaceContract();
    const task = await contract.tasks(taskId);

    // Check if task exists (customer is zero for non-existent tasks)
    if (task.customer === ethers.ZeroAddress) {
      return null;
    }

    return {
      customer: task.customer,
      worker: task.worker,
      prUrl: task.prUrl,
      detailedDescriptionHash: task.detailedDescriptionHash,
      status: Number(task.status),
      source: Number(task.source),  // 0 = Customer, 1 = DAO
    };
  } catch (error) {
    console.error(`[TaskWatcher] Failed to fetch task ${taskId}:`, error);
    return null;
  }
}

/**
 * Fetch IPFS metadata to check if GitHub integration is enabled.
 * Uses Pinata SDK for authenticated access to private files.
 */
async function fetchIpfsMetadata(ipfsHash: string): Promise<IpfsMetadata | null> {
  if (!ipfsHash || ipfsHash.length === 0) {
    return null;
  }

  const pinata = getPinata();
  if (!pinata) {
    return null;
  }

  try {
    const response = await pinata.gateways.private.get(ipfsHash);
    return response.data as IpfsMetadata;
  } catch (error) {
    console.warn(`[TaskWatcher] Failed to fetch IPFS metadata ${ipfsHash}:`, error);
    return null;
  }
}

/**
 * Determine if GitHub integration should be used for this task.
 * Checks IPFS metadata for githubIntegration flag.
 * Falls back to checking if prUrl is a valid GitHub PR URL.
 */
async function shouldProcessGitHub(taskId: number, prUrl: string, ipfsHash: string): Promise<boolean> {
  // First, check if prUrl is a valid GitHub PR URL
  const parsed = parsePrUrl(prUrl);
  if (!parsed) {
    console.log(`[TaskWatcher] Task ${taskId}: prUrl is not a GitHub PR URL, skipping`);
    return false;
  }

  // Try to fetch IPFS metadata to check githubIntegration flag
  const metadata = await fetchIpfsMetadata(ipfsHash);

  if (metadata) {
    // If metadata exists and has explicit githubIntegration flag, use it
    if (typeof metadata.githubIntegration === 'boolean') {
      if (!metadata.githubIntegration) {
        console.log(`[TaskWatcher] Task ${taskId}: GitHub integration disabled in metadata, skipping`);
      }
      return metadata.githubIntegration;
    }
  }

  // Default: if prUrl is a valid GitHub PR URL, process it
  // This handles legacy tasks created before the toggle was added
  console.log(`[TaskWatcher] Task ${taskId}: No explicit githubIntegration flag, proceeding based on valid prUrl`);
  return true;
}

/**
 * Handle a TaskReadyForPayment event.
 * Fetches task data and triggers GitHub PR merge if appropriate.
 */
async function handleTaskReadyForPayment(
  taskId: bigint,
  worker: string,
  amount: bigint,
  event: ethers.Log
): Promise<void> {
  const taskIdNum = Number(taskId);
  console.log(
    `[TaskWatcher] TaskReadyForPayment: taskId=${taskIdNum}, worker=${worker}, amount=${ethers.formatEther(amount)} ROSE`
  );

  stats.eventsProcessed++;
  stats.lastEventBlock = event.blockNumber;

  // Prevent concurrent processing of the same event
  if (isProcessing) {
    console.log(`[TaskWatcher] Already processing, queueing task ${taskIdNum}`);
    // Note: In production, you might want a proper queue here
    return;
  }

  isProcessing = true;

  try {
    // Check if GitHub is configured
    if (!isGitHubConfigured()) {
      console.log(`[TaskWatcher] GitHub not configured, skipping task ${taskIdNum}`);
      return;
    }

    // Fetch task data
    const task = await getTaskData(taskIdNum);
    if (!task) {
      console.warn(`[TaskWatcher] Task ${taskIdNum} not found on-chain`);
      return;
    }

    // Check if we should process this task for GitHub integration
    const shouldProcess = await shouldProcessGitHub(taskIdNum, task.prUrl, task.detailedDescriptionHash);
    if (!shouldProcess) {
      return;
    }

    // Attempt to approve and merge the PR
    console.log(`[TaskWatcher] Processing GitHub merge for task ${taskIdNum}, PR: ${task.prUrl}`);
    stats.mergesAttempted++;

    // For DAO tasks, verify PR is to allowed repo before merging
    if (task.source === 1) {
      // Security: Block DAO task merges from dev environment
      if (!config.isProduction) {
        stats.mergesFailed++;
        stats.lastError = 'DAO task PR merges blocked on non-production environment';
        console.error(`[TaskWatcher] DAO task ${taskIdNum} blocked: not production environment`);
        return;
      }

      const pr = parsePrUrl(task.prUrl);
      const { owner, repo } = config.github.daoTaskRepo;
      if (!pr || pr.owner !== owner || pr.repo !== repo) {
        stats.mergesFailed++;
        stats.lastError = `DAO task PR not to ${owner}/${repo}`;
        console.error(`[TaskWatcher] DAO task ${taskIdNum} PR not to ${owner}/${repo}, skipping merge`);
        return;
      }
    }

    // For DAO tasks, skip customer auth (we verified repo above)
    // For customer tasks, pass customer address for authorization check
    const customerForAuth = task.source === 1 ? undefined : task.customer;
    const result = await approveAndMergePR(task.prUrl, taskIdNum, customerForAuth);

    if (result.success) {
      stats.mergesSucceeded++;
      console.log(`[TaskWatcher] Successfully merged PR for task ${taskIdNum}`);
    } else {
      stats.mergesFailed++;
      stats.lastError = result.error || 'Unknown error';
      console.error(`[TaskWatcher] Failed to merge PR for task ${taskIdNum}: ${result.error}`);
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    stats.lastError = errorMsg;
    stats.mergesFailed++;
    console.error(`[TaskWatcher] Error processing task ${taskIdNum}:`, error);
  } finally {
    isProcessing = false;
  }
}

/**
 * Setup event listeners using WebSocket provider
 */
function setupEventListeners(): void {
  // Clean up previous listeners if any
  if (wsContract) {
    wsContract.removeAllListeners('TaskReadyForPayment');
  }

  // Create new contract instance with WebSocket provider for event listening
  wsContract = new ethers.Contract(
    config.contracts.marketplace!,
    RoseMarketplaceABI,
    getWsProvider()
  );

  // Listen for TaskReadyForPayment events
  wsContract.on('TaskReadyForPayment', (taskId, worker, amount, event) => {
    handleTaskReadyForPayment(taskId, worker, amount, event).catch((err) => {
      console.error('[TaskWatcher] Error in event handler:', err);
      stats.lastError = err instanceof Error ? err.message : String(err);
    });
  });

  console.log('[TaskWatcher] Event listeners setup on WebSocket provider');
}

/**
 * Start the task watcher.
 * Listens for TaskReadyForPayment events from the Marketplace contract.
 */
export async function startTaskWatcher(): Promise<void> {
  // Check configuration
  if (!config.contracts.marketplace) {
    console.log('[TaskWatcher] MARKETPLACE_ADDRESS not configured, skipping');
    return;
  }

  if (config.taskWatcher?.enabled === false) {
    console.log('[TaskWatcher] Disabled via TASK_WATCHER_ENABLED=false');
    return;
  }

  if (!config.github.enabled) {
    console.log('[TaskWatcher] GitHub bot disabled, skipping task watcher');
    return;
  }

  console.log('[TaskWatcher] Starting task watcher...');
  console.log(`[TaskWatcher] Marketplace: ${config.contracts.marketplace}`);
  console.log(`[TaskWatcher] GitHub configured: ${isGitHubConfigured()}`);

  try {
    // Setup event listeners using WebSocket provider
    setupEventListeners();

    // Register reconnect handler to re-setup listeners on WebSocket reconnection
    reconnectHandler = () => {
      console.log('[TaskWatcher] Reconnecting event listeners...');
      setupEventListeners();
    };
    onReconnect(reconnectHandler);

    stats.isRunning = true;
    stats.startedAt = new Date();

    console.log('[TaskWatcher] Listening for TaskReadyForPayment events...');

    // Catch up on recent events if configured (use HTTP provider for queryFilter)
    const lookbackBlocks = config.github?.startupBlockLookback ?? 0;
    if (lookbackBlocks > 0) {
      console.log(`[TaskWatcher] Catching up on last ${lookbackBlocks} blocks...`);
      const marketplace = getMarketplaceContract(); // HTTP provider for queryFilter
      const currentBlock = await getProvider().getBlockNumber();
      const fromBlock = Math.max(0, currentBlock - lookbackBlocks);

      const filter = marketplace.filters.TaskReadyForPayment();
      const events = await marketplace.queryFilter(filter, fromBlock, currentBlock);

      console.log(`[TaskWatcher] Found ${events.length} recent TaskReadyForPayment events`);

      for (const event of events) {
        // Type guard: EventLog has 'args' property
        if ('args' in event && event.args) {
          const args = event.args as unknown as {
            taskId: bigint;
            worker: string;
            amount: bigint;
          };
          await handleTaskReadyForPayment(args.taskId, args.worker, args.amount, event as ethers.Log);
        }
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    stats.lastError = errorMsg;
    console.error('[TaskWatcher] Failed to start:', error);
    throw error;
  }
}

/**
 * Stop the task watcher.
 */
export function stopTaskWatcher(): void {
  // Remove reconnect callback
  if (reconnectHandler) {
    removeReconnectCallback(reconnectHandler);
    reconnectHandler = null;
  }
  // Clean up WebSocket contract listeners
  if (wsContract) {
    wsContract.removeAllListeners('TaskReadyForPayment');
    wsContract = null;
  }
  stats.isRunning = false;
  console.log('[TaskWatcher] Stopped');
}

/**
 * Get task watcher stats.
 */
export function getTaskWatcherStats(): TaskWatcherStats {
  return { ...stats };
}

/**
 * Manually trigger processing for a specific task.
 * Useful for retrying failed merges or testing.
 */
export async function processTaskManually(taskId: number): Promise<{
  success: boolean;
  error?: string;
}> {
  if (!isGitHubConfigured()) {
    return { success: false, error: 'GitHub not configured' };
  }

  const task = await getTaskData(taskId);
  if (!task) {
    return { success: false, error: 'Task not found' };
  }

  const shouldProcess = await shouldProcessGitHub(taskId, task.prUrl, task.detailedDescriptionHash);
  if (!shouldProcess) {
    return { success: false, error: 'GitHub integration not enabled for this task' };
  }

  stats.mergesAttempted++;

  // For DAO tasks, verify PR is to allowed repo before merging
  if (task.source === 1) {
    // Security: Block DAO task merges from dev environment
    if (!config.isProduction) {
      stats.mergesFailed++;
      return { success: false, error: 'DAO task PR merges blocked on non-production environment' };
    }

    const pr = parsePrUrl(task.prUrl);
    const { owner, repo } = config.github.daoTaskRepo;
    if (!pr || pr.owner !== owner || pr.repo !== repo) {
      stats.mergesFailed++;
      return { success: false, error: `DAO task PR must be to ${owner}/${repo}` };
    }
  }

  // For DAO tasks, skip customer auth (we verified repo above)
  // For customer tasks, pass customer address for authorization check
  const customerForAuth = task.source === 1 ? undefined : task.customer;
  const result = await approveAndMergePR(task.prUrl, taskId, customerForAuth);

  if (result.success) {
    stats.mergesSucceeded++;
  } else {
    stats.mergesFailed++;
    stats.lastError = result.error || 'Unknown error';
  }

  return result;
}
