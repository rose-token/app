import { ethers } from 'ethers';
import { config } from '../config';

// Treasury ABI for redemption events and functions
const TREASURY_ABI = [
  'event RedemptionRequested(uint256 indexed requestId, address indexed user, uint256 roseAmount, uint256 usdcOwed)',
  'event RedemptionFulfilled(uint256 indexed requestId, address indexed user, uint256 usdcAmount)',
  'function redemptionRequests(uint256 requestId) external view returns (address user, uint256 roseAmount, uint256 usdcOwed, uint256 requestedAt, bool fulfilled)',
  'function getRedemptionRequest(uint256 requestId) external view returns (address user, uint256 roseAmount, uint256 usdcOwed, uint256 requestedAt, bool fulfilled)',
  'function totalPendingUsdcOwed() external view returns (uint256)',
  'function fulfillRedemption(uint256 requestId) external',
  'function fulfillMultipleRedemptions(uint256[] calldata requestIds) external',
];

// Types
export interface RedemptionRequest {
  requestId: bigint;
  user: string;
  roseAmount: bigint;
  usdcOwed: bigint;
  requestedAt: number;
  block: number;
  timestamp: number;
}

export interface RedemptionWatcherStats {
  isRunning: boolean;
  startedAt: Date | null;
  redemptionsQueued: number;
  redemptionsFulfilled: number;
  fulfillmentsFailed: number;
  totalUsdcOwed: string;
  lastError: string | null;
  lastEventBlock: number;
}

// State
let provider: ethers.JsonRpcProvider | null = null;
let treasuryContract: ethers.Contract | null = null;
let wallet: ethers.Wallet | null = null;
let isProcessing = false;

const stats: RedemptionWatcherStats = {
  isRunning: false,
  startedAt: null,
  redemptionsQueued: 0,
  redemptionsFulfilled: 0,
  fulfillmentsFailed: 0,
  totalUsdcOwed: '0',
  lastError: null,
  lastEventBlock: 0,
};

// Pending redemptions to process (batching for efficiency)
const pendingRedemptions: Map<bigint, RedemptionRequest> = new Map();

let debounceTimer: NodeJS.Timeout | null = null;
const DEBOUNCE_MS = config.redemptionWatcher?.debounceMs ?? 15000; // 15 seconds default (faster than deposits)

function getProvider(): ethers.JsonRpcProvider {
  if (!provider) {
    provider = new ethers.JsonRpcProvider(config.rpc.url);
  }
  return provider;
}

function getTreasuryContract(): ethers.Contract {
  if (!treasuryContract) {
    if (!config.contracts.treasury) {
      throw new Error('TREASURY_ADDRESS not configured');
    }
    treasuryContract = new ethers.Contract(
      config.contracts.treasury,
      TREASURY_ABI,
      getProvider()
    );
  }
  return treasuryContract;
}

function getWallet(): ethers.Wallet {
  if (!wallet) {
    const privateKey = config.signer.privateKey;
    if (!privateKey) {
      throw new Error('SIGNER_PRIVATE_KEY not configured');
    }
    wallet = new ethers.Wallet(privateKey, getProvider());
  }
  return wallet;
}

/**
 * Handle a RedemptionRequested event
 */
function handleRedemptionRequestedEvent(
  requestId: bigint,
  user: string,
  roseAmount: bigint,
  usdcOwed: bigint,
  event: ethers.Log
): void {
  console.log(
    `[RedemptionWatcher] Redemption requested: ID=${requestId}, ` +
      `${ethers.formatUnits(roseAmount, 18)} ROSE for ${ethers.formatUnits(usdcOwed, 6)} USDC from ${user}`
  );

  // Add to pending redemptions
  pendingRedemptions.set(requestId, {
    requestId,
    user,
    roseAmount,
    usdcOwed,
    requestedAt: Date.now(),
    block: event.blockNumber,
    timestamp: Date.now(),
  });

  stats.redemptionsQueued++;

  // Update total USDC owed
  let totalOwed = 0n;
  for (const [, req] of pendingRedemptions) {
    totalOwed += req.usdcOwed;
  }
  stats.totalUsdcOwed = ethers.formatUnits(totalOwed, 6);

  // Debounce processing (Phase 5 will add processPendingRedemptions)
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    // Phase 5 will implement processPendingRedemptions()
    console.log(
      `[RedemptionWatcher] Debounce elapsed. ${pendingRedemptions.size} redemptions pending. ` +
        `Processing will be implemented in Phase 5.`
    );
  }, DEBOUNCE_MS);
}

/**
 * Start the redemption watcher
 */
export async function startRedemptionWatcher(): Promise<void> {
  // Check configuration
  if (!config.contracts.treasury) {
    console.log('[RedemptionWatcher] TREASURY_ADDRESS not configured, skipping');
    return;
  }

  if (config.redemptionWatcher?.enabled === false) {
    console.log('[RedemptionWatcher] Disabled via config');
    return;
  }

  console.log('[RedemptionWatcher] Starting redemption watcher...');
  console.log(`[RedemptionWatcher] Treasury: ${config.contracts.treasury}`);
  console.log(`[RedemptionWatcher] Debounce: ${DEBOUNCE_MS}ms`);
  console.log(
    `[RedemptionWatcher] Execute fulfillments: ${config.redemptionWatcher?.executeSwaps !== false}`
  );

  try {
    const treasury = getTreasuryContract();

    // Listen for RedemptionRequested events
    treasury.on('RedemptionRequested', (requestId, user, roseAmount, usdcOwed, event) => {
      handleRedemptionRequestedEvent(requestId, user, roseAmount, usdcOwed, event);
    });

    // Also listen for RedemptionFulfilled to track completed redemptions
    treasury.on('RedemptionFulfilled', (requestId, user, usdcAmount, event) => {
      console.log(
        `[RedemptionWatcher] Redemption fulfilled: ID=${requestId}, ` +
          `${ethers.formatUnits(usdcAmount, 6)} USDC to ${user}`
      );

      // Remove from pending if we were tracking it
      if (pendingRedemptions.has(requestId)) {
        pendingRedemptions.delete(requestId);
        stats.redemptionsFulfilled++;

        // Update total USDC owed
        let totalOwed = 0n;
        for (const [, req] of pendingRedemptions) {
          totalOwed += req.usdcOwed;
        }
        stats.totalUsdcOwed = ethers.formatUnits(totalOwed, 6);
      }

      stats.lastEventBlock = event.blockNumber;
    });

    stats.isRunning = true;
    stats.startedAt = new Date();

    console.log('[RedemptionWatcher] Listening for RedemptionRequested events...');

    // Catch up on recent events if configured
    const lookbackBlocks = config.redemptionWatcher?.startupBlockLookback ?? 0;
    if (lookbackBlocks > 0) {
      console.log(`[RedemptionWatcher] Catching up on last ${lookbackBlocks} blocks...`);
      const currentBlock = await getProvider().getBlockNumber();
      const fromBlock = Math.max(0, currentBlock - lookbackBlocks);

      const filter = treasury.filters.RedemptionRequested();
      const events = await treasury.queryFilter(filter, fromBlock, currentBlock);

      console.log(`[RedemptionWatcher] Found ${events.length} recent redemption requests`);

      for (const event of events) {
        // Type guard: EventLog has 'args' property
        if ('args' in event && event.args) {
          const args = event.args as unknown as {
            requestId: bigint;
            user: string;
            roseAmount: bigint;
            usdcOwed: bigint;
          };

          // Check if already fulfilled before adding to pending
          try {
            const [, , , , fulfilled] = await treasury.getRedemptionRequest(args.requestId);
            if (!fulfilled) {
              handleRedemptionRequestedEvent(
                args.requestId,
                args.user,
                args.roseAmount,
                args.usdcOwed,
                event as ethers.Log
              );
            } else {
              console.log(
                `[RedemptionWatcher] Skipping fulfilled request ID=${args.requestId}`
              );
            }
          } catch (error) {
            console.error(
              `[RedemptionWatcher] Error checking request ${args.requestId}:`,
              error
            );
          }
        }
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    stats.lastError = errorMsg;
    console.error('[RedemptionWatcher] Failed to start:', error);
    throw error;
  }
}

/**
 * Stop the redemption watcher
 */
export function stopRedemptionWatcher(): void {
  if (treasuryContract) {
    treasuryContract.removeAllListeners('RedemptionRequested');
    treasuryContract.removeAllListeners('RedemptionFulfilled');
  }
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  stats.isRunning = false;
  console.log('[RedemptionWatcher] Stopped');
}

/**
 * Get redemption watcher stats
 */
export function getRedemptionWatcherStats(): RedemptionWatcherStats & {
  pendingRedemptions: number;
} {
  return {
    ...stats,
    pendingRedemptions: pendingRedemptions.size,
  };
}

/**
 * Get pending redemption request IDs
 */
export function getPendingRedemptionIds(): bigint[] {
  return Array.from(pendingRedemptions.keys());
}

/**
 * Get pending redemption details
 */
export function getPendingRedemptions(): RedemptionRequest[] {
  return Array.from(pendingRedemptions.values());
}

// Export for Phase 5 to use
export { getProvider, getTreasuryContract, getWallet, pendingRedemptions, isProcessing, stats };
