/**
 * Task Watcher Service
 *
 * Listens for TaskReadyForPayment events from RoseMarketplace contract.
 * When a task is approved by both customer and stakeholder, automatically
 * approves and merges the associated GitHub PR (if GitHub integration is enabled).
 */

import { ethers } from 'ethers';
import axios from 'axios';
import { config } from '../config';
import { approveAndMergePR, isGitHubConfigured, parsePrUrl } from './github';

// Marketplace ABI - includes all 18 fields in Task struct
const MARKETPLACE_ABI = [
  'event TaskReadyForPayment(uint256 taskId, address indexed worker, uint256 amount)',
  `function tasks(uint256) external view returns (
    address customer,
    address worker,
    address stakeholder,
    uint256 deposit,
    uint256 stakeholderDeposit,
    string title,
    string detailedDescriptionHash,
    string prUrl,
    uint8 status,
    bool customerApproval,
    bool stakeholderApproval,
    uint8 source,
    uint256 proposalId,
    bool isAuction,
    uint256 winningBid,
    address disputeInitiator,
    uint256 disputedAt,
    string disputeReasonHash
  )`,
];

// IPFS Gateway for fetching task metadata (uses dedicated Pinata gateway for private files)
const IPFS_GATEWAY = process.env.PINATA_GATEWAY
  ? `${process.env.PINATA_GATEWAY}/ipfs/`
  : 'https://coffee-glad-felidae-720.mypinata.cloud/ipfs/';

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
let provider: ethers.JsonRpcProvider | null = null;
let marketplaceContract: ethers.Contract | null = null;
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

function getProvider(): ethers.JsonRpcProvider {
  if (!provider) {
    provider = new ethers.JsonRpcProvider(config.rpc.url);
  }
  return provider;
}

function getMarketplaceContract(): ethers.Contract {
  if (!marketplaceContract) {
    if (!config.contracts.marketplace) {
      throw new Error('MARKETPLACE_ADDRESS not configured');
    }
    marketplaceContract = new ethers.Contract(
      config.contracts.marketplace,
      MARKETPLACE_ABI,
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
    };
  } catch (error) {
    console.error(`[TaskWatcher] Failed to fetch task ${taskId}:`, error);
    return null;
  }
}

/**
 * Fetch IPFS metadata to check if GitHub integration is enabled.
 */
async function fetchIpfsMetadata(ipfsHash: string): Promise<IpfsMetadata | null> {
  if (!ipfsHash || ipfsHash.length === 0) {
    return null;
  }

  try {
    const response = await axios.get(`${IPFS_GATEWAY}${ipfsHash}`, {
      timeout: 10000,
    });
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

    const result = await approveAndMergePR(task.prUrl, taskIdNum);

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
    const marketplace = getMarketplaceContract();

    // Listen for TaskReadyForPayment events
    marketplace.on('TaskReadyForPayment', (taskId, worker, amount, event) => {
      handleTaskReadyForPayment(taskId, worker, amount, event).catch((err) => {
        console.error('[TaskWatcher] Error in event handler:', err);
        stats.lastError = err instanceof Error ? err.message : String(err);
      });
    });

    stats.isRunning = true;
    stats.startedAt = new Date();

    console.log('[TaskWatcher] Listening for TaskReadyForPayment events...');

    // Catch up on recent events if configured
    const lookbackBlocks = config.github?.startupBlockLookback ?? 0;
    if (lookbackBlocks > 0) {
      console.log(`[TaskWatcher] Catching up on last ${lookbackBlocks} blocks...`);
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
  if (marketplaceContract) {
    marketplaceContract.removeAllListeners('TaskReadyForPayment');
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
  const result = await approveAndMergePR(task.prUrl, taskId);

  if (result.success) {
    stats.mergesSucceeded++;
  } else {
    stats.mergesFailed++;
    stats.lastError = result.error || 'Unknown error';
  }

  return result;
}
