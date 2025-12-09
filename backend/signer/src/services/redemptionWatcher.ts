import { ethers } from 'ethers';
import { config } from '../config';
import { getAssetBreakdowns } from './treasury';
import { getSwapQuote, executeDiversificationSwap, getAssetTokenAddress } from './lifi';

// Treasury ABI for redemption events and functions
const TREASURY_ABI = [
  'event RedemptionRequested(uint256 indexed requestId, address indexed user, uint256 roseAmount, uint256 usdcOwed)',
  'event RedemptionFulfilled(uint256 indexed requestId, address indexed user, uint256 usdcAmount)',
  'function redemptionRequests(uint256 requestId) external view returns (address user, uint256 roseAmount, uint256 usdcOwed, uint256 requestedAt, bool fulfilled)',
  'function getRedemptionRequest(uint256 requestId) external view returns (address user, uint256 roseAmount, uint256 usdcOwed, uint256 requestedAt, bool fulfilled)',
  'function totalPendingUsdcOwed() external view returns (uint256)',
  'function fulfillRedemption(uint256 requestId) external',
  'function fulfillMultipleRedemptions(uint256[] calldata requestIds) external',
  'function assets(bytes32 key) external view returns (address token, address priceFeed, uint8 decimals, uint256 targetBps, bool active)',
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

// Liquidation swap instruction
interface LiquidationSwap {
  assetKey: string;
  assetKeyBytes32: string;
  tokenAddress: string;
  amountToSell: bigint;
  estimatedUsdcOut: bigint;
}

// Asset key constants (same as contract)
const STABLE_KEY = ethers.encodeBytes32String('STABLE');
const ROSE_KEY = ethers.encodeBytes32String('ROSE');

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

  // Debounce processing
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    processPendingRedemptions().catch((err) => {
      console.error('[RedemptionWatcher] Error in debounced processing:', err);
    });
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

/**
 * Calculate which assets to liquidate to cover a USDC shortfall
 * Strategy: Sell assets that are furthest above their target allocation first
 * @param shortfall - Amount of USDC needed (6 decimals)
 * @returns Array of liquidation swap instructions
 */
async function calculateLiquidationSwaps(shortfall: bigint): Promise<LiquidationSwap[]> {
  const swaps: LiquidationSwap[] = [];

  // Get current asset breakdowns from treasury
  const assets = await getAssetBreakdowns();

  // Filter to sellable assets: active, not STABLE/ROSE, has balance
  const sellableAssets = assets.filter(
    (a) =>
      a.active &&
      a.keyBytes32 !== STABLE_KEY &&
      a.keyBytes32 !== ROSE_KEY &&
      a.balance > 0n
  );

  if (sellableAssets.length === 0) {
    console.log('[RedemptionWatcher] No sellable assets available for liquidation');
    return swaps;
  }

  // Sort by: furthest above target allocation first (actualBps - targetBps descending)
  sellableAssets.sort((a, b) => {
    const driftA = a.actualBps - a.targetBps;
    const driftB = b.actualBps - b.targetBps;
    return driftB - driftA; // Highest positive drift first
  });

  console.log(
    `[RedemptionWatcher] Sellable assets sorted by over-allocation:`,
    sellableAssets.map((a) => `${a.key}: ${a.actualBps - a.targetBps} bps over target`)
  );

  let remainingShortfall = shortfall;

  for (const asset of sellableAssets) {
    if (remainingShortfall <= 0n) break;

    // Calculate how much of this asset to sell
    // We want to sell enough to cover the shortfall (in USD terms)
    // amountToSell = min(balance, balance * (shortfall / valueUSD))
    let usdcToGet = remainingShortfall;
    if (usdcToGet > asset.valueUSD) {
      usdcToGet = asset.valueUSD; // Can't sell more than we have
    }

    // Calculate token amount to sell: amount = balance * (usdcToGet / valueUSD)
    const amountToSell = (asset.balance * usdcToGet) / asset.valueUSD;

    if (amountToSell > 0n) {
      swaps.push({
        assetKey: asset.key,
        assetKeyBytes32: asset.keyBytes32,
        tokenAddress: asset.token,
        amountToSell,
        estimatedUsdcOut: usdcToGet,
      });

      remainingShortfall -= usdcToGet;

      console.log(
        `[RedemptionWatcher] Planning to sell ${ethers.formatUnits(amountToSell, 18)} ${asset.key} ` +
          `for ~${ethers.formatUnits(usdcToGet, 6)} USDC`
      );
    }
  }

  if (remainingShortfall > 0n) {
    console.warn(
      `[RedemptionWatcher] Insufficient assets to cover full shortfall. ` +
        `Remaining: ${ethers.formatUnits(remainingShortfall, 6)} USDC`
    );
  }

  return swaps;
}

/**
 * Get USDC balance of the treasury
 */
async function getTreasuryUsdcBalance(): Promise<bigint> {
  const treasury = getTreasuryContract();

  // Get STABLE asset to find USDC address
  const stableKey = STABLE_KEY;
  const stableAsset = await treasury.assets(stableKey);

  if (!stableAsset.token || stableAsset.token === ethers.ZeroAddress) {
    throw new Error('STABLE asset not configured in treasury');
  }

  // Get USDC balance
  const usdcAbi = ['function balanceOf(address) view returns (uint256)'];
  const usdc = new ethers.Contract(stableAsset.token, usdcAbi, getProvider());
  return await usdc.balanceOf(config.contracts.treasury);
}

/**
 * Process all pending redemptions
 * 1. Check USDC balance
 * 2. If shortfall, execute liquidation swaps
 * 3. Fulfill redemptions in FIFO order
 */
async function processPendingRedemptions(): Promise<void> {
  if (isProcessing) {
    console.log('[RedemptionWatcher] Already processing, skipping...');
    return;
  }

  if (pendingRedemptions.size === 0) {
    console.log('[RedemptionWatcher] No pending redemptions');
    return;
  }

  isProcessing = true;
  console.log(`[RedemptionWatcher] Processing ${pendingRedemptions.size} pending redemptions`);

  try {
    // Step 1: Calculate total USDC needed
    let totalUsdcNeeded = 0n;
    for (const [, request] of pendingRedemptions) {
      totalUsdcNeeded += request.usdcOwed;
    }
    console.log(`[RedemptionWatcher] Total USDC needed: ${ethers.formatUnits(totalUsdcNeeded, 6)}`);

    // Step 2: Get current USDC balance
    const usdcBalance = await getTreasuryUsdcBalance();
    console.log(`[RedemptionWatcher] Treasury USDC balance: ${ethers.formatUnits(usdcBalance, 6)}`);

    // Step 3: If shortfall, execute liquidation swaps
    if (usdcBalance < totalUsdcNeeded) {
      const shortfall = totalUsdcNeeded - usdcBalance;
      console.log(`[RedemptionWatcher] USDC shortfall: ${ethers.formatUnits(shortfall, 6)}`);

      if (config.redemptionWatcher?.executeSwaps !== false) {
        const liquidationSwaps = await calculateLiquidationSwaps(shortfall);

        // Get STABLE token address for swaps
        const stableTokenAddress = await getAssetTokenAddress('STABLE');

        for (const swap of liquidationSwaps) {
          try {
            // Get LiFi quote with higher slippage for liquidation (1.5% default)
            const slippageBps = config.redemptionWatcher?.slippageBps ?? 150;

            const quote = await getSwapQuote(
              swap.tokenAddress,
              stableTokenAddress,
              swap.amountToSell,
              config.contracts.treasury!,
              slippageBps
            );

            console.log(
              `[RedemptionWatcher] Liquidation quote for ${swap.assetKey}: ` +
                `${ethers.formatUnits(swap.amountToSell, 18)} -> ${ethers.formatUnits(quote.estimatedAmountOut, 6)} USDC`
            );

            // Execute swap
            const txHash = await executeDiversificationSwap(
              swap.assetKey,
              'STABLE',
              swap.amountToSell,
              quote.minAmountOut,
              quote.lifiData
            );

            console.log(`[RedemptionWatcher] Liquidation swap executed: ${txHash}`);
          } catch (swapError) {
            const errorMsg = swapError instanceof Error ? swapError.message : String(swapError);
            console.error(`[RedemptionWatcher] Liquidation swap failed for ${swap.assetKey}:`, errorMsg);
            stats.lastError = errorMsg;
            // Continue with other swaps
          }
        }
      } else {
        console.log('[RedemptionWatcher] DRY RUN - Would execute liquidation swaps');
      }
    }

    // Step 4: Get updated USDC balance after swaps
    const updatedUsdcBalance = await getTreasuryUsdcBalance();
    console.log(`[RedemptionWatcher] Updated USDC balance: ${ethers.formatUnits(updatedUsdcBalance, 6)}`);

    // Step 5: Sort pending redemptions by ID (FIFO)
    const sortedRequests = Array.from(pendingRedemptions.entries()).sort(
      ([idA], [idB]) => (idA < idB ? -1 : idA > idB ? 1 : 0)
    );

    // Step 6: Fulfill redemptions that can be fulfilled
    const requestsToFulfill: bigint[] = [];
    let availableUsdc = updatedUsdcBalance;

    for (const [requestId, request] of sortedRequests) {
      if (availableUsdc >= request.usdcOwed) {
        requestsToFulfill.push(requestId);
        availableUsdc -= request.usdcOwed;
      } else {
        console.log(
          `[RedemptionWatcher] Insufficient USDC for request ${requestId}: ` +
            `need ${ethers.formatUnits(request.usdcOwed, 6)}, have ${ethers.formatUnits(availableUsdc, 6)}`
        );
        break; // FIFO order - can't skip
      }
    }

    if (requestsToFulfill.length === 0) {
      console.log('[RedemptionWatcher] No redemptions can be fulfilled with available USDC');
      return;
    }

    console.log(`[RedemptionWatcher] Fulfilling ${requestsToFulfill.length} redemptions`);

    if (config.redemptionWatcher?.executeSwaps !== false) {
      const wallet = getWallet();
      const treasury = new ethers.Contract(
        config.contracts.treasury!,
        [
          'function fulfillRedemption(uint256 requestId) external',
          'function fulfillMultipleRedemptions(uint256[] calldata requestIds) external',
        ],
        wallet
      );

      try {
        let tx;
        if (requestsToFulfill.length === 1) {
          console.log(`[RedemptionWatcher] Calling fulfillRedemption(${requestsToFulfill[0]})`);
          tx = await treasury.fulfillRedemption(requestsToFulfill[0]);
        } else {
          console.log(`[RedemptionWatcher] Calling fulfillMultipleRedemptions([${requestsToFulfill.join(', ')}])`);
          tx = await treasury.fulfillMultipleRedemptions(requestsToFulfill);
        }

        const receipt = await tx.wait();
        console.log(`[RedemptionWatcher] Fulfillment tx confirmed: ${receipt.hash}`);

        // Step 7: Update stats and clear fulfilled from pending
        for (const requestId of requestsToFulfill) {
          pendingRedemptions.delete(requestId);
          stats.redemptionsFulfilled++;
        }

        // Update total USDC owed
        let totalOwed = 0n;
        for (const [, req] of pendingRedemptions) {
          totalOwed += req.usdcOwed;
        }
        stats.totalUsdcOwed = ethers.formatUnits(totalOwed, 6);

        console.log(
          `[RedemptionWatcher] ${requestsToFulfill.length} redemptions fulfilled. ` +
            `${pendingRedemptions.size} remaining.`
        );
      } catch (fulfillError) {
        const errorMsg = fulfillError instanceof Error ? fulfillError.message : String(fulfillError);
        stats.lastError = errorMsg;
        stats.fulfillmentsFailed += requestsToFulfill.length;
        console.error('[RedemptionWatcher] Fulfillment failed:', fulfillError);
      }
    } else {
      console.log(
        `[RedemptionWatcher] DRY RUN - Would fulfill ${requestsToFulfill.length} redemptions: ` +
          `[${requestsToFulfill.join(', ')}]`
      );
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    stats.lastError = errorMsg;
    console.error('[RedemptionWatcher] Error processing redemptions:', error);
  } finally {
    isProcessing = false;
  }
}

/**
 * Manually trigger processing of pending redemptions
 */
export async function forceProcessPending(): Promise<void> {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  await processPendingRedemptions();
}

// Export internal functions for testing/debugging
export { calculateLiquidationSwaps, processPendingRedemptions, getTreasuryUsdcBalance };
