import { ethers } from 'ethers';
import { config } from '../config';
import {
  getSwapQuote,
  calculateDiversificationSwaps,
  executeDiversificationSwap,
  getAssetTokenAddress,
  getTargetAllocations,
} from './lifi';
import { getWsProvider, onReconnect, removeReconnectCallback } from '../utils/wsProvider';

// Treasury ABI for deposit events and functions
const TREASURY_ABI = [
  'event Deposited(address indexed user, uint256 usdcAmount, uint256 roseMinted)',
  'function assets(bytes32 key) external view returns (address token, address priceFeed, uint8 decimals, uint256 targetBps, bool active)',
  'function getAllAssets() external view returns (bytes32[] memory keys, tuple(address token, address priceFeed, uint8 decimals, uint256 targetBps, bool active)[] memory assetList)',
  'function getAssetBreakdown(bytes32 key) external view returns (address token, uint256 balance, uint256 valueUSD, uint256 targetBps, uint256 actualBps, bool active)',
];

// Types
export interface DiversificationResult {
  depositTx: string;
  usdcAmount: string;
  swaps: {
    assetKey: string;
    usdcAmount: string;
    txHash?: string;
    error?: string;
  }[];
  success: boolean;
}

export interface DepositWatcherStats {
  isRunning: boolean;
  startedAt: Date | null;
  depositsProcessed: number;
  swapsExecuted: number;
  swapsFailed: number;
  totalUsdcDiversified: string;
  lastError: string | null;
  lastEventBlock: number;
}

// State
let treasuryContract: ethers.Contract | null = null;
let wsContract: ethers.Contract | null = null;
let reconnectHandler: (() => void) | null = null;
let isProcessing = false;

const stats: DepositWatcherStats = {
  isRunning: false,
  startedAt: null,
  depositsProcessed: 0,
  swapsExecuted: 0,
  swapsFailed: 0,
  totalUsdcDiversified: '0',
  lastError: null,
  lastEventBlock: 0,
};

// Pending deposits to process (batching for efficiency)
const pendingDeposits: Map<
  string,
  { usdcAmount: bigint; block: number; timestamp: number }
> = new Map();

let debounceTimer: NodeJS.Timeout | null = null;
const DEBOUNCE_MS = config.depositWatcher?.debounceMs ?? 30000; // 30 seconds default

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

/**
 * Get current USD value of each asset in the treasury
 * Used for smart rebalancing to calculate deficits
 */
async function getCurrentAssetBalances(): Promise<Map<string, bigint>> {
  const treasury = getTreasuryContract();
  const balances = new Map<string, bigint>();

  const [keys] = await treasury.getAllAssets();
  for (const keyBytes32 of keys) {
    const key = ethers.decodeBytes32String(keyBytes32);
    if (key === 'ROSE') continue; // Skip ROSE

    const breakdown = await treasury.getAssetBreakdown(keyBytes32);
    balances.set(key, breakdown.valueUSD);
  }

  return balances;
}

/**
 * Process a single deposit by diversifying the USDC via LiFi swaps
 */
async function processDiversification(
  usdcAmount: bigint,
  depositTx: string
): Promise<DiversificationResult> {
  console.log(
    `[DepositWatcher] Processing diversification for ${ethers.formatUnits(usdcAmount, 6)} USDC`
  );

  const result: DiversificationResult = {
    depositTx,
    usdcAmount: ethers.formatUnits(usdcAmount, 6),
    swaps: [],
    success: true,
  };

  try {
    // Get target allocations from contract
    const allocations = await getTargetAllocations();
    console.log(`[DepositWatcher] Target allocations:`, Object.fromEntries(allocations));

    // Get current asset values for smart rebalancing
    const currentBalances = await getCurrentAssetBalances();
    console.log(`[DepositWatcher] Current balances (USD):`, Object.fromEntries(
      Array.from(currentBalances.entries()).map(([k, v]) => [k, ethers.formatUnits(v, 6)])
    ));

    // Calculate which swaps to make with smart rebalancing
    const swapInstructions = calculateDiversificationSwaps(usdcAmount, allocations, currentBalances);
    console.log(`[DepositWatcher] Planned swaps:`, swapInstructions);

    if (swapInstructions.length === 0) {
      console.log('[DepositWatcher] No swaps needed');
      return result;
    }

    // Get USDC token address
    const usdcAddress = await getAssetTokenAddress('STABLE');
    const treasuryAddress = config.contracts.treasury!;

    // Execute each swap
    for (const swap of swapInstructions) {
      const swapResult = {
        assetKey: swap.assetKey,
        usdcAmount: ethers.formatUnits(swap.usdcAmount, 6),
        txHash: undefined as string | undefined,
        error: undefined as string | undefined,
      };

      try {
        // Get target token address
        const targetTokenAddress = await getAssetTokenAddress(swap.assetKey);

        // Get LiFi quote
        const quote = await getSwapQuote(
          usdcAddress,
          targetTokenAddress,
          swap.usdcAmount,
          treasuryAddress,
          config.depositWatcher?.slippageBps ?? 100 // 1% default
        );

        console.log(
          `[DepositWatcher] Quote for ${swap.assetKey}: ` +
            `${ethers.formatUnits(swap.usdcAmount, 6)} USDC -> ${quote.estimatedAmountOut} (min: ${quote.minAmountOut})`
        );

        // Execute swap (only if enabled)
        if (config.depositWatcher?.executeSwaps !== false) {
          const txHash = await executeDiversificationSwap(
            'STABLE',
            swap.assetKey,
            swap.usdcAmount,
            quote.minAmountOut,
            quote.lifiData
          );
          swapResult.txHash = txHash;
          stats.swapsExecuted++;
          console.log(`[DepositWatcher] Swap executed: ${txHash}`);
        } else {
          console.log(`[DepositWatcher] DRY RUN - Would execute swap for ${swap.assetKey}`);
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        swapResult.error = errorMsg;
        result.success = false;
        stats.swapsFailed++;
        stats.lastError = errorMsg;
        console.error(`[DepositWatcher] Swap failed for ${swap.assetKey}:`, error);
      }

      result.swaps.push(swapResult);
    }

    // Update stats
    if (result.success) {
      const current = BigInt(stats.totalUsdcDiversified.replace(/[^\d]/g, '') || '0');
      stats.totalUsdcDiversified = (current + usdcAmount).toString();
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    result.success = false;
    stats.lastError = errorMsg;
    console.error(`[DepositWatcher] Diversification failed:`, error);
  }

  return result;
}

/**
 * Process all pending deposits
 */
async function processPendingDeposits(): Promise<void> {
  if (isProcessing) {
    console.log('[DepositWatcher] Already processing, skipping...');
    return;
  }

  if (pendingDeposits.size === 0) {
    console.log('[DepositWatcher] No pending deposits');
    return;
  }

  isProcessing = true;
  console.log(`[DepositWatcher] Processing ${pendingDeposits.size} pending deposits`);

  try {
    // Sum up all pending deposits
    let totalUsdc = 0n;
    let latestBlock = 0;

    for (const [tx, deposit] of pendingDeposits) {
      totalUsdc += deposit.usdcAmount;
      latestBlock = Math.max(latestBlock, deposit.block);
    }

    // Get first tx for tracking
    const firstTx = pendingDeposits.keys().next().value as string;

    // Clear pending before processing
    pendingDeposits.clear();

    // Process combined deposit
    const result = await processDiversification(totalUsdc, firstTx);

    stats.depositsProcessed += 1;
    stats.lastEventBlock = latestBlock;

    console.log(
      `[DepositWatcher] Diversification result: ${result.success ? 'SUCCESS' : 'FAILED'}, ` +
        `${result.swaps.length} swaps`
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    stats.lastError = errorMsg;
    console.error('[DepositWatcher] Error processing deposits:', error);
  } finally {
    isProcessing = false;
  }
}

/**
 * Handle a Deposited event
 */
function handleDepositedEvent(
  user: string,
  usdcAmount: bigint,
  roseMinted: bigint,
  event: ethers.Log
): void {
  console.log(
    `[DepositWatcher] Deposit detected: ${ethers.formatUnits(usdcAmount, 6)} USDC from ${user}`
  );

  // Add to pending deposits
  pendingDeposits.set(event.transactionHash, {
    usdcAmount,
    block: event.blockNumber,
    timestamp: Date.now(),
  });

  // pendingDeposits count is tracked via the Map, not stats

  // Debounce processing
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    processPendingDeposits().catch((err) => {
      console.error('[DepositWatcher] Error in debounced processing:', err);
    });
  }, DEBOUNCE_MS);
}

/**
 * Setup event listeners using WebSocket provider
 */
function setupEventListeners(): void {
  // Clean up previous listeners if any
  if (wsContract) {
    wsContract.removeAllListeners('Deposited');
  }

  // Create new contract instance with WebSocket provider for event listening
  wsContract = new ethers.Contract(
    config.contracts.treasury!,
    TREASURY_ABI,
    getWsProvider()
  );

  // Listen for Deposited events
  wsContract.on('Deposited', (user, usdcAmount, roseMinted, event) => {
    handleDepositedEvent(user, usdcAmount, roseMinted, event);
  });

  console.log('[DepositWatcher] Event listeners setup on WebSocket provider');
}

/**
 * Start the deposit watcher
 */
export async function startDepositWatcher(): Promise<void> {
  // Check configuration
  if (!config.contracts.treasury) {
    console.log('[DepositWatcher] TREASURY_ADDRESS not configured, skipping');
    return;
  }

  if (config.depositWatcher?.enabled === false) {
    console.log('[DepositWatcher] Disabled via config');
    return;
  }

  console.log('[DepositWatcher] Starting deposit watcher...');
  console.log(`[DepositWatcher] Treasury: ${config.contracts.treasury}`);
  console.log(`[DepositWatcher] Debounce: ${DEBOUNCE_MS}ms`);
  console.log(
    `[DepositWatcher] Execute swaps: ${config.depositWatcher?.executeSwaps !== false}`
  );

  try {
    // Setup event listeners using WebSocket provider
    setupEventListeners();

    // Register reconnect handler to re-setup listeners on WebSocket reconnection
    reconnectHandler = () => {
      console.log('[DepositWatcher] Reconnecting event listeners...');
      setupEventListeners();
    };
    onReconnect(reconnectHandler);

    stats.isRunning = true;
    stats.startedAt = new Date();

    console.log('[DepositWatcher] Listening for Deposited events...');

    // Catch up on recent events if configured (use HTTP provider for queryFilter)
    const lookbackBlocks = config.depositWatcher?.startupBlockLookback ?? 0;
    if (lookbackBlocks > 0) {
      console.log(`[DepositWatcher] Catching up on last ${lookbackBlocks} blocks...`);
      const treasury = getTreasuryContract(); // HTTP provider for queryFilter
      const currentBlock = await getProvider().getBlockNumber();
      const fromBlock = Math.max(0, currentBlock - lookbackBlocks);

      const filter = treasury.filters.Deposited();
      const events = await treasury.queryFilter(filter, fromBlock, currentBlock);

      console.log(`[DepositWatcher] Found ${events.length} recent deposits`);

      for (const event of events) {
        // Type guard: EventLog has 'args' property, Log doesn't
        if ('args' in event && event.args) {
          const args = event.args as unknown as {
            user: string;
            usdcAmount: bigint;
            roseMinted: bigint;
          };
          handleDepositedEvent(
            args.user,
            args.usdcAmount,
            args.roseMinted,
            event as ethers.Log
          );
        }
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    stats.lastError = errorMsg;
    console.error('[DepositWatcher] Failed to start:', error);
    throw error;
  }
}

/**
 * Stop the deposit watcher
 */
export function stopDepositWatcher(): void {
  // Remove reconnect callback
  if (reconnectHandler) {
    removeReconnectCallback(reconnectHandler);
    reconnectHandler = null;
  }
  // Clean up WebSocket contract listeners
  if (wsContract) {
    wsContract.removeAllListeners('Deposited');
    wsContract = null;
  }
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  stats.isRunning = false;
  console.log('[DepositWatcher] Stopped');
}

/**
 * Get deposit watcher stats
 */
export function getDepositWatcherStats(): DepositWatcherStats & { pendingDeposits: number } {
  return {
    ...stats,
    pendingDeposits: pendingDeposits.size,
  };
}

/**
 * Manually trigger processing of pending deposits
 */
export async function forceProcessPending(): Promise<void> {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  await processPendingDeposits();
}

/**
 * Get pending deposit transactions
 */
export function getPendingDeposits(): string[] {
  return Array.from(pendingDeposits.keys());
}
