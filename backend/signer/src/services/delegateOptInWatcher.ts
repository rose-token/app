/**
 * Delegate Opt-In Watcher Service
 *
 * Listens for DelegateOptInChanged events from RoseGovernance contract.
 * When a user opts in (optedIn=true), ensures they exist in stakers table.
 * This fixes the bug where delegates don't show in the list after opting in
 * if their stake wasn't caught by the stakerIndexer.
 */

import { ethers } from 'ethers';
import { config } from '../config';
import { getWsProvider, onReconnect, removeReconnectCallback } from '../utils/wsProvider';
import { RoseGovernanceABI } from '../utils/contracts';
import { ensureStakerExists } from './stakerIndexer';

// Types
export interface DelegateOptInWatcherStats {
  isRunning: boolean;
  startedAt: Date | null;
  optInsProcessed: number;
  optOutsProcessed: number;
  stakersAdded: number;
  lastEventBlock: number;
  lastError: string | null;
}

// State
let governanceContract: ethers.Contract | null = null;
let wsContract: ethers.Contract | null = null;
let reconnectHandler: (() => void) | null = null;

const stats: DelegateOptInWatcherStats = {
  isRunning: false,
  startedAt: null,
  optInsProcessed: 0,
  optOutsProcessed: 0,
  stakersAdded: 0,
  lastEventBlock: 0,
  lastError: null,
};

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

/**
 * Handle a DelegateOptInChanged event.
 * When optedIn=true, ensure user is in stakers table.
 */
async function handleDelegateOptInChanged(
  delegate: string,
  optedIn: boolean,
  event: ethers.Log | ethers.ContractEventPayload
): Promise<void> {
  // Extract log from ContractEventPayload (.on() listener) or use directly (queryFilter)
  const log = 'log' in event ? event.log : event;
  stats.lastEventBlock = log.blockNumber;

  if (optedIn) {
    stats.optInsProcessed++;
    console.log(`[DelegateOptInWatcher] Opt-in: ${delegate} at block ${log.blockNumber}`);

    try {
      const wasAdded = await ensureStakerExists(delegate);
      if (wasAdded) {
        stats.stakersAdded++;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      stats.lastError = errorMsg;
      console.error(`[DelegateOptInWatcher] Failed to ensure staker exists for ${delegate}:`, error);
    }
  } else {
    stats.optOutsProcessed++;
    console.log(`[DelegateOptInWatcher] Opt-out: ${delegate} at block ${log.blockNumber}`);
    // No action needed on opt-out - staker record remains for VP tracking
  }
}

/**
 * Setup event listeners using WebSocket provider
 */
function setupEventListeners(): void {
  // Clean up previous listeners if any
  if (wsContract) {
    wsContract.removeAllListeners('DelegateOptInChanged');
  }

  // Create new contract instance with WebSocket provider for event listening
  wsContract = new ethers.Contract(
    config.contracts.governance!,
    RoseGovernanceABI,
    getWsProvider()
  );

  // Listen for DelegateOptInChanged events
  wsContract.on('DelegateOptInChanged', (delegate: string, optedIn: boolean, event: ethers.ContractEventPayload) => {
    handleDelegateOptInChanged(delegate, optedIn, event).catch((err) => {
      console.error('[DelegateOptInWatcher] Error in handler:', err);
      stats.lastError = err instanceof Error ? err.message : String(err);
    });
  });

  console.log('[DelegateOptInWatcher] Event listeners setup on WebSocket provider');
}

/**
 * Start the delegate opt-in watcher.
 * Listens for DelegateOptInChanged events from the Governance contract.
 */
export async function startDelegateOptInWatcher(): Promise<void> {
  // Check configuration
  if (!config.contracts.governance) {
    console.log('[DelegateOptInWatcher] GOVERNANCE_ADDRESS not configured, skipping');
    return;
  }

  if (!config.database.url) {
    console.log('[DelegateOptInWatcher] DATABASE_URL not configured, skipping');
    return;
  }

  if (config.delegateOptInWatcher?.enabled === false) {
    console.log('[DelegateOptInWatcher] Disabled via DELEGATE_OPTIN_WATCHER_ENABLED=false');
    return;
  }

  console.log('[DelegateOptInWatcher] Starting delegate opt-in watcher...');
  console.log(`[DelegateOptInWatcher] Governance: ${config.contracts.governance}`);

  try {
    // Setup event listeners using WebSocket provider
    setupEventListeners();

    // Register reconnect handler to re-setup listeners on WebSocket reconnection
    reconnectHandler = () => {
      console.log('[DelegateOptInWatcher] Reconnecting event listeners...');
      setupEventListeners();
    };
    onReconnect(reconnectHandler);

    stats.isRunning = true;
    stats.startedAt = new Date();

    console.log('[DelegateOptInWatcher] Listening for DelegateOptInChanged events...');

    // Catch up on recent events if configured (use HTTP provider for queryFilter)
    const lookbackBlocks = config.delegateOptInWatcher?.startupBlockLookback ?? 10000;
    if (lookbackBlocks > 0) {
      console.log(`[DelegateOptInWatcher] Catching up on last ${lookbackBlocks} blocks...`);
      const governance = getGovernanceContract();
      const currentBlock = await getProvider().getBlockNumber();
      const fromBlock = Math.max(0, currentBlock - lookbackBlocks);

      // Query DelegateOptInChanged events
      const filter = governance.filters.DelegateOptInChanged();
      const events = await governance.queryFilter(filter, fromBlock, currentBlock);
      console.log(`[DelegateOptInWatcher] Found ${events.length} recent DelegateOptInChanged events`);

      for (const event of events) {
        if ('args' in event && event.args) {
          const args = event.args as unknown as { delegate: string; optedIn: boolean };
          await handleDelegateOptInChanged(args.delegate, args.optedIn, event as ethers.Log);
        }
      }

      console.log('[DelegateOptInWatcher] Catch-up complete');
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    stats.lastError = errorMsg;
    console.error('[DelegateOptInWatcher] Failed to start:', error);
    throw error;
  }
}

/**
 * Stop the delegate opt-in watcher.
 */
export function stopDelegateOptInWatcher(): void {
  // Remove reconnect callback
  if (reconnectHandler) {
    removeReconnectCallback(reconnectHandler);
    reconnectHandler = null;
  }
  // Clean up WebSocket contract listeners
  if (wsContract) {
    wsContract.removeAllListeners('DelegateOptInChanged');
    wsContract = null;
  }
  stats.isRunning = false;
  console.log('[DelegateOptInWatcher] Stopped');
}

/**
 * Get delegate opt-in watcher stats.
 */
export function getDelegateOptInWatcherStats(): DelegateOptInWatcherStats {
  return { ...stats };
}
