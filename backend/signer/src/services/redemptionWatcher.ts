import { ethers } from 'ethers';
import { config } from '../config';
import { getAssetBreakdowns } from './treasury';
import { getSwapQuote, executeDiversificationSwap, getAssetTokenAddress } from './lifi';
import { getWsProvider, onReconnect, removeReconnectCallback } from '../utils/wsProvider';

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
let treasuryContract: ethers.Contract | null = null;
let wsContract: ethers.Contract | null = null;
let reconnectHandler: (() => void) | null = null;
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

function getProvider(): ethers.Provider {
  return getWsProvider();
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
 * Setup event listeners using WebSocket provider
 */
function setupEventListeners(): void {
  // Clean up previous listeners if any
  if (wsContract) {
    wsContract.removeAllListeners('RedemptionRequested');
    wsContract.removeAllListeners('RedemptionFulfilled');
  }

  // Create new contract instance with WebSocket provider for event listening
  wsContract = new ethers.Contract(
    config.contracts.treasury!,
    TREASURY_ABI,
    getWsProvider()
  );

  // Listen for RedemptionRequested events
  wsContract.on('RedemptionRequested', (requestId, user, roseAmount, usdcOwed, event) => {
    handleRedemptionRequestedEvent(requestId, user, roseAmount, usdcOwed, event);
  });

  // Also listen for RedemptionFulfilled to track completed redemptions
  wsContract.on('RedemptionFulfilled', (requestId, user, usdcAmount, event) => {
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

  console.log('[RedemptionWatcher] Event listeners setup on WebSocket provider');
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
    // Setup event listeners using WebSocket provider
    setupEventListeners();

    // Register reconnect handler to re-setup listeners on WebSocket reconnection
    reconnectHandler = () => {
      console.log('[RedemptionWatcher] Reconnecting event listeners...');
      setupEventListeners();
    };
    onReconnect(reconnectHandler);

    stats.isRunning = true;
    stats.startedAt = new Date();

    console.log('[RedemptionWatcher] Listening for RedemptionRequested events...');

    // Catch up on recent events if configured (use HTTP provider for queryFilter)
    const lookbackBlocks = config.redemptionWatcher?.startupBlockLookback ?? 0;
    if (lookbackBlocks > 0) {
      console.log(`[RedemptionWatcher] Catching up on last ${lookbackBlocks} blocks...`);
      const treasury = getTreasuryContract(); // HTTP provider for queryFilter
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
  // Remove reconnect callback
  if (reconnectHandler) {
    removeReconnectCallback(reconnectHandler);
    reconnectHandler = null;
  }
  // Clean up WebSocket contract listeners
  if (wsContract) {
    wsContract.removeAllListeners('RedemptionRequested');
    wsContract.removeAllListeners('RedemptionFulfilled');
    wsContract = null;
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

// Rounding buffer: 0.1% (10 bps) to cover integer division losses in swaps
const ROUNDING_BUFFER_BPS = 10n;

/**
 * Calculate which assets to liquidate to cover a USDC shortfall
 * Strategy: Sell assets that are furthest above their target allocation first
 *
 * Includes:
 * 1. Rounding buffer (0.1%) to cover integer division losses in swaps
 * 2. Additional amount to maintain USDC at its target allocation (20%) after redemption
 *
 * @param shortfall - Amount of USDC needed (6 decimals)
 * @param totalUsdcNeeded - Total USDC needed for all pending redemptions (6 decimals)
 * @returns Array of liquidation swap instructions
 */
async function calculateLiquidationSwaps(
  shortfall: bigint,
  totalUsdcNeeded: bigint
): Promise<LiquidationSwap[]> {
  const swaps: LiquidationSwap[] = [];

  // Get current asset breakdowns from treasury
  const assets = await getAssetBreakdowns();

  // Find STABLE asset to get target allocation
  const stableAsset = assets.find((a) => a.keyBytes32 === STABLE_KEY);
  const stableTargetBps = stableAsset?.targetBps ?? 2000; // Default 20%

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

  // Calculate total hard assets (excluding ROSE)
  const totalHardAssets = assets
    .filter((a) => a.active && a.keyBytes32 !== ROSE_KEY)
    .reduce((sum, a) => sum + a.valueUSD, 0n);

  // Calculate what USDC balance should be after redemption to maintain target allocation
  // After redemption: newTotalHardAssets = totalHardAssets - redemptionAmount
  // Target USDC = newTotalHardAssets * targetBps / 10000
  const postRedemptionHardAssets = totalHardAssets > totalUsdcNeeded
    ? totalHardAssets - totalUsdcNeeded
    : 0n;
  const targetUsdcAfterRedemption = (postRedemptionHardAssets * BigInt(stableTargetBps)) / 10000n;

  // Current USDC balance
  const currentUsdcBalance = stableAsset?.valueUSD ?? 0n;

  // Calculate how much extra to liquidate to maintain USDC buffer after redemption
  // After paying out totalUsdcNeeded, we want at least targetUsdcAfterRedemption remaining
  // Required USDC = totalUsdcNeeded + targetUsdcAfterRedemption
  // Extra needed = Required - currentBalance (if positive)
  const requiredUsdc = totalUsdcNeeded + targetUsdcAfterRedemption;
  const bufferDeficit = requiredUsdc > currentUsdcBalance
    ? requiredUsdc - currentUsdcBalance
    : 0n;

  // Use the larger of: simple shortfall or buffer-adjusted shortfall
  let adjustedShortfall = shortfall > bufferDeficit ? shortfall : bufferDeficit;

  // Add rounding buffer (0.1%) to cover integer division losses in swaps
  adjustedShortfall = adjustedShortfall + (adjustedShortfall * ROUNDING_BUFFER_BPS) / 10000n;

  console.log(
    `[RedemptionWatcher] Shortfall calculation: ` +
    `base=${ethers.formatUnits(shortfall, 6)}, ` +
    `withBuffer=${ethers.formatUnits(bufferDeficit, 6)}, ` +
    `withRounding=${ethers.formatUnits(adjustedShortfall, 6)} USDC`
  );
  console.log(
    `[RedemptionWatcher] Target USDC after redemption: ${ethers.formatUnits(targetUsdcAfterRedemption, 6)} ` +
    `(${stableTargetBps} bps of ${ethers.formatUnits(postRedemptionHardAssets, 6)} hard assets)`
  );

  // Sort by USD value descending for waterfall liquidation
  sellableAssets.sort((a, b) => (b.valueUSD > a.valueUSD ? 1 : b.valueUSD < a.valueUSD ? -1 : 0));

  console.log(
    `[RedemptionWatcher] Sellable assets sorted by value:`,
    sellableAssets.map((a) => `${a.key}: $${ethers.formatUnits(a.valueUSD, 6)}`)
  );

  let remainingShortfall = adjustedShortfall;

  // Track how much USD to sell from each asset
  const assetSwapAmounts = new Map<string, bigint>(
    sellableAssets.map((a) => [a.key, 0n])
  );

  // Track remaining USD value for each asset
  const assetValues = new Map<string, bigint>(
    sellableAssets.map((a) => [a.key, a.valueUSD])
  );

  // Helper to get max value from array
  const maxBigInt = (values: bigint[]): bigint => {
    if (values.length === 0) return 0n;
    return values.reduce((max, val) => (val > max ? val : max), values[0]);
  };

  // Waterfall algorithm: equalize from highest to lowest
  while (remainingShortfall > 0n) {
    // Find the highest value
    const maxValue = maxBigInt(Array.from(assetValues.values()));
    if (maxValue <= 0n) break; // All depleted

    // Collect all assets at max value
    const topAssets = sellableAssets.filter((a) => assetValues.get(a.key) === maxValue);

    if (topAssets.length === sellableAssets.length) {
      // All assets are equal - split remaining shortfall equally
      const perAssetAmount = remainingShortfall / BigInt(topAssets.length);
      const remainder = remainingShortfall % BigInt(topAssets.length);

      for (let i = 0; i < topAssets.length; i++) {
        const asset = topAssets[i];
        const currentValue = assetValues.get(asset.key)!;

        // This asset gets equal share (+ remainder for first asset to avoid dust)
        let sellAmount = perAssetAmount;
        if (i === 0) sellAmount += remainder;

        // Cap at available value
        if (sellAmount > currentValue) sellAmount = currentValue;

        if (sellAmount > 0n) {
          assetSwapAmounts.set(asset.key, assetSwapAmounts.get(asset.key)! + sellAmount);
          assetValues.set(asset.key, currentValue - sellAmount);
          remainingShortfall -= sellAmount;
        }
      }
      break; // Done - all assets were equal
    } else {
      // Find next lower value (the "equalization target")
      const lowerValues = Array.from(assetValues.values()).filter((v) => v < maxValue);
      const nextValue = lowerValues.length > 0 ? maxBigInt(lowerValues) : 0n;

      // Calculate total USD needed to bring all top assets down to nextValue
      const dropPerAsset = maxValue - nextValue;
      const totalDrop = dropPerAsset * BigInt(topAssets.length);

      if (totalDrop <= remainingShortfall) {
        // Can fully equalize - bring all top assets to nextValue
        for (const asset of topAssets) {
          assetSwapAmounts.set(asset.key, assetSwapAmounts.get(asset.key)! + dropPerAsset);
          assetValues.set(asset.key, nextValue);
          remainingShortfall -= dropPerAsset;
        }
        // Continue to next round
      } else {
        // Can only partially equalize - split remaining among top assets
        const perAssetAmount = remainingShortfall / BigInt(topAssets.length);
        const remainder = remainingShortfall % BigInt(topAssets.length);

        for (let i = 0; i < topAssets.length; i++) {
          const asset = topAssets[i];
          const currentValue = assetValues.get(asset.key)!;

          let sellAmount = perAssetAmount;
          if (i === 0) sellAmount += remainder;

          assetSwapAmounts.set(asset.key, assetSwapAmounts.get(asset.key)! + sellAmount);
          assetValues.set(asset.key, currentValue - sellAmount);
          remainingShortfall -= sellAmount;
        }
        break; // Shortfall exhausted
      }
    }
  }

  // Convert USD swap amounts to token amounts and build swap instructions
  for (const asset of sellableAssets) {
    const usdcToGet = assetSwapAmounts.get(asset.key)!;

    if (usdcToGet <= 0n) continue;

    // Convert USD amount to token amount: tokenAmount = balance * (usdcToGet / valueUSD)
    // Use ceiling division to ensure we always sell enough: ceil(a*b/c) = (a*b + c - 1) / c
    const amountToSell = ((asset.balance * usdcToGet) + asset.valueUSD - 1n) / asset.valueUSD;

    swaps.push({
      assetKey: asset.key,
      assetKeyBytes32: asset.keyBytes32,
      tokenAddress: asset.token,
      amountToSell,
      estimatedUsdcOut: usdcToGet,
    });

    console.log(
      `[RedemptionWatcher] Waterfall: Selling ${ethers.formatUnits(amountToSell, 18)} ${asset.key} ` +
        `for ~${ethers.formatUnits(usdcToGet, 6)} USDC`
    );
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
        const liquidationSwaps = await calculateLiquidationSwaps(shortfall, totalUsdcNeeded);

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
