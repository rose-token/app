import { ethers } from 'ethers';
import { config } from '../config';
import { query } from '../db/pool';
import { fetchNavSnapshot, storeNavSnapshot } from './nav';
import {
  getSwapQuote,
  getAssetTokenAddress,
  executeDiversificationSwap,
} from './lifi';

// Extended Treasury ABI for Phase 4 rebalance
const TREASURY_ABI = [
  'function forceRebalance() external',
  'function getVaultBreakdown() external view returns (uint256 totalHardAssets, uint256 currentRosePrice, uint256 circulatingRose, bool rebalanceNeeded)',
  'function needsRebalance() public view returns (bool)',
  'function getAllAssets() external view returns (bytes32[] memory keys, tuple(address token, address priceFeed, uint8 decimals, uint256 targetBps, bool active)[] memory assetList)',
  'function getAssetBreakdown(bytes32 key) external view returns (address token, uint256 balance, uint256 valueUSD, uint256 targetBps, uint256 actualBps, bool active)',
  'function lastRebalanceTime() external view returns (uint256)',
  'function timeUntilRebalance() external view returns (uint256)',
  'function executeSwap(bytes32 fromAsset, bytes32 toAsset, uint256 amountIn, uint256 minAmountOut, bytes calldata lifiData) external',
  'event Rebalanced(uint256 totalHardAssets)',
];

// ROSE key constant (same as contract)
const ROSE_KEY = ethers.encodeBytes32String('ROSE');
const STABLE_KEY = ethers.encodeBytes32String('STABLE');

// Asset breakdown type
interface AssetBreakdown {
  key: string;
  keyBytes32: string;
  token: string;
  balance: bigint;
  valueUSD: bigint; // 6 decimals
  targetBps: number;
  actualBps: number;
  active: boolean;
}

// Swap instruction type
interface SwapInstruction {
  fromAsset: string;
  toAsset: string;
  fromKey: string;
  toKey: string;
  amountIn: bigint;
  estimatedOut: bigint;
}

// Rebalance result type
export interface RebalanceResult {
  txHash: string;
  swapsExecuted: number;
  swapDetails: {
    fromAsset: string;
    toAsset: string;
    amountIn: string;
    amountOut: string;
    txHash: string;
  }[];
  totalHardAssets: string;
  rebalanceNeeded: boolean;
}

/**
 * Get provider and treasury contract
 */
function getProvider(): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(config.rpc.url);
}

function getWallet(): ethers.Wallet {
  return new ethers.Wallet(config.signer.privateKey, getProvider());
}

function getTreasuryContract(signerOrProvider?: ethers.Signer | ethers.Provider): ethers.Contract {
  if (!config.contracts.treasury) {
    throw new Error('TREASURY_ADDRESS not configured');
  }
  return new ethers.Contract(
    config.contracts.treasury,
    TREASURY_ABI,
    signerOrProvider || getProvider()
  );
}

/**
 * Get all asset breakdowns from the contract
 */
export async function getAssetBreakdowns(): Promise<AssetBreakdown[]> {
  const treasury = getTreasuryContract();
  const [keys] = await treasury.getAllAssets();

  const breakdowns: AssetBreakdown[] = [];

  for (const keyBytes32 of keys) {
    const key = ethers.decodeBytes32String(keyBytes32);
    const breakdown = await treasury.getAssetBreakdown(keyBytes32);

    breakdowns.push({
      key,
      keyBytes32,
      token: breakdown.token,
      balance: breakdown.balance,
      valueUSD: breakdown.valueUSD,
      targetBps: Number(breakdown.targetBps),
      actualBps: Number(breakdown.actualBps),
      active: breakdown.active,
    });
  }

  return breakdowns;
}

/**
 * Get vault status
 */
export async function getVaultStatus(): Promise<{
  totalHardAssets: string;
  rosePrice: string;
  circulatingSupply: string;
  needsRebalance: boolean;
  timeUntilRebalance: number;
  assets: AssetBreakdown[];
}> {
  const treasury = getTreasuryContract();

  const [breakdown, timeUntil, assets] = await Promise.all([
    treasury.getVaultBreakdown(),
    treasury.timeUntilRebalance(),
    getAssetBreakdowns(),
  ]);

  return {
    totalHardAssets: ethers.formatUnits(breakdown.totalHardAssets, 6),
    rosePrice: ethers.formatUnits(breakdown.currentRosePrice, 6),
    circulatingSupply: ethers.formatUnits(breakdown.circulatingRose, 18),
    needsRebalance: breakdown.rebalanceNeeded,
    timeUntilRebalance: Number(timeUntil),
    assets,
  };
}

/**
 * Calculate which swaps are needed to rebalance the vault
 * Strategy: Sell over-allocated assets for USDC, then buy under-allocated assets with USDC
 * This ensures all swaps go through USDC as an intermediate (most liquid path)
 *
 * ROSE is now included in rebalancing:
 * - Over-allocated ROSE: Sell ROSE -> USDC (funds other purchases)
 * - Under-allocated ROSE: Buy ROSE with USDC (market buyback via LiFi)
 */
export function calculateRebalanceSwaps(assets: AssetBreakdown[]): SwapInstruction[] {
  const swaps: SwapInstruction[] = [];

  // Include ALL active assets (including ROSE)
  const allAssets = assets.filter((a) => a.active);

  if (allAssets.length === 0) return swaps;

  // Calculate total value (hard assets + ROSE)
  const totalValue = allAssets.reduce((sum, a) => sum + a.valueUSD, 0n);
  if (totalValue === 0n) return swaps;

  // Categorize assets by drift (no rescaling needed - using actual targets)
  const overAllocated: { asset: AssetBreakdown; excessUSD: bigint }[] = [];
  const underAllocated: { asset: AssetBreakdown; deficitUSD: bigint }[] = [];

  for (const asset of allAssets) {
    // Use actual target (no rescaling)
    const targetValueUSD = (totalValue * BigInt(asset.targetBps)) / 10000n;
    const currentValueUSD = asset.valueUSD;

    // Calculate drift (5% threshold = 500 bps)
    const diff = currentValueUSD > targetValueUSD
      ? currentValueUSD - targetValueUSD
      : targetValueUSD - currentValueUSD;
    const driftBps = Number((diff * 10000n) / (targetValueUSD || 1n));

    if (driftBps <= 500) continue; // Within threshold, no action needed

    if (currentValueUSD > targetValueUSD) {
      overAllocated.push({
        asset,
        excessUSD: currentValueUSD - targetValueUSD,
      });
    } else {
      underAllocated.push({
        asset,
        deficitUSD: targetValueUSD - currentValueUSD,
      });
    }
  }

  // Phase 1: Sell over-allocated assets to USDC (including ROSE)
  for (const { asset, excessUSD } of overAllocated) {
    if (asset.keyBytes32 === STABLE_KEY) continue; // Can't sell USDC for USDC

    // Calculate amount of tokens to sell based on excess USD value
    // This is an approximation - actual amount depends on price
    // For now, we use the proportion: amount = balance * (excess / currentValue)
    if (asset.valueUSD === 0n) continue; // Avoid division by zero
    const amountToSell = (asset.balance * excessUSD) / asset.valueUSD;

    if (amountToSell > 0n) {
      swaps.push({
        fromAsset: asset.key,
        toAsset: 'STABLE',
        fromKey: asset.keyBytes32,
        toKey: STABLE_KEY,
        amountIn: amountToSell,
        estimatedOut: excessUSD, // In USDC terms (6 decimals)
      });
    }
  }

  // Phase 2: Buy under-allocated assets with USDC (including ROSE buyback)
  // Find the STABLE asset to get available USDC
  const stableAsset = allAssets.find((a) => a.keyBytes32 === STABLE_KEY);
  if (!stableAsset) return swaps;

  // Calculate how much USDC will be available after selling over-allocated assets
  let availableUSDC = stableAsset.valueUSD;
  for (const swap of swaps) {
    if (swap.toKey === STABLE_KEY) {
      availableUSDC += swap.estimatedOut;
    }
  }

  for (const { asset, deficitUSD } of underAllocated) {
    if (asset.keyBytes32 === STABLE_KEY) continue; // Can't buy USDC with USDC

    // Cap at available USDC
    const usdcToSpend = deficitUSD > availableUSDC ? availableUSDC : deficitUSD;
    if (usdcToSpend <= 0n) continue;

    swaps.push({
      fromAsset: 'STABLE',
      toAsset: asset.key,
      fromKey: STABLE_KEY,
      toKey: asset.keyBytes32,
      amountIn: usdcToSpend,
      estimatedOut: 0n, // Will be determined by LiFi quote
    });

    availableUSDC -= usdcToSpend;
    if (availableUSDC <= 0n) break;
  }

  return swaps;
}

/**
 * Execute a multi-swap rebalance
 * 1. Get current asset breakdowns
 * 2. Calculate needed swaps
 * 3. For each swap: get LiFi quote and execute
 * 4. Call forceRebalance() to update timestamp
 */
export async function executeRebalance(): Promise<RebalanceResult> {
  if (!config.contracts.treasury) {
    throw new Error('TREASURY_ADDRESS not configured');
  }

  const wallet = getWallet();
  const treasury = getTreasuryContract(wallet);

  console.log(`[Treasury] Starting rebalance...`);
  console.log(`[Treasury] Treasury address: ${config.contracts.treasury}`);
  console.log(`[Treasury] Signer address: ${wallet.address}`);

  // Step 1: Get current asset breakdowns
  const assets = await getAssetBreakdowns();
  console.log(`[Treasury] Found ${assets.length} assets`);

  // Step 2: Check if rebalance is needed
  const breakdown = await treasury.getVaultBreakdown();
  if (!breakdown.rebalanceNeeded) {
    console.log(`[Treasury] No rebalance needed, vault is balanced`);
    // Still call forceRebalance to update timestamp (per monthly schedule)
    const tx = await treasury.forceRebalance();
    const receipt = await tx.wait();
    return {
      txHash: receipt.hash,
      swapsExecuted: 0,
      swapDetails: [],
      totalHardAssets: ethers.formatUnits(breakdown.totalHardAssets, 6),
      rebalanceNeeded: false,
    };
  }

  // Step 3: Calculate needed swaps
  const swaps = calculateRebalanceSwaps(assets);
  console.log(`[Treasury] Calculated ${swaps.length} swaps needed`);

  const swapDetails: RebalanceResult['swapDetails'] = [];

  // Step 4: Execute each swap via LiFi
  for (const swap of swaps) {
    console.log(
      `[Treasury] Swap: ${swap.fromAsset} -> ${swap.toAsset}, amount: ${swap.amountIn.toString()}`
    );

    try {
      // Get token addresses
      const fromToken = await getAssetTokenAddress(swap.fromAsset);
      const toToken = await getAssetTokenAddress(swap.toAsset);

      // Get LiFi quote
      const quote = await getSwapQuote(
        fromToken,
        toToken,
        swap.amountIn,
        config.contracts.treasury,
        config.depositWatcher?.slippageBps ?? 100
      );

      console.log(
        `[Treasury] Quote received: min out = ${quote.minAmountOut.toString()}`
      );

      // Execute swap via contract's executeSwap function
      const txHash = await executeDiversificationSwap(
        swap.fromAsset,
        swap.toAsset,
        swap.amountIn,
        quote.minAmountOut,
        quote.lifiData
      );

      swapDetails.push({
        fromAsset: swap.fromAsset,
        toAsset: swap.toAsset,
        amountIn: swap.amountIn.toString(),
        amountOut: quote.estimatedAmountOut.toString(),
        txHash,
      });

      console.log(`[Treasury] Swap executed: ${txHash}`);
    } catch (error) {
      console.error(`[Treasury] Swap failed:`, error);
      // Continue with other swaps - don't fail the entire rebalance
    }
  }

  // Step 5: Call forceRebalance to update timestamp and emit event
  console.log(`[Treasury] Finalizing rebalance...`);
  const tx = await treasury.forceRebalance();
  const receipt = await tx.wait();
  console.log(`[Treasury] Rebalance finalized. TX: ${receipt.hash}`);

  // Get updated breakdown for result
  const finalBreakdown = await treasury.getVaultBreakdown();

  // Record in database if configured
  if (config.database.url) {
    try {
      await query(
        `
        INSERT INTO rebalance_events (
          tx_hash, block_number, log_index,
          btc_value_usd, gold_value_usd, usdc_value_usd, rose_value_usd,
          total_hard_assets_usd, rebalanced_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
        ON CONFLICT (tx_hash) DO NOTHING
      `,
        [
          receipt.hash,
          receipt.blockNumber,
          0,
          '0', // Will be updated by getAssetBreakdowns if needed
          '0',
          '0',
          '0',
          ethers.formatUnits(finalBreakdown.totalHardAssets, 6),
        ]
      );
      console.log(`[Treasury] Rebalance event recorded in database`);

      // Capture NAV snapshot
      const snapshot = await fetchNavSnapshot();
      const snapshotId = await storeNavSnapshot(snapshot);
      console.log(
        `[Treasury] NAV snapshot #${snapshotId} recorded at block ${snapshot.blockNumber}`
      );
    } catch (dbError) {
      console.error(`[Treasury] Failed to record rebalance in database:`, dbError);
    }
  }

  return {
    txHash: receipt.hash,
    swapsExecuted: swapDetails.length,
    swapDetails,
    totalHardAssets: ethers.formatUnits(finalBreakdown.totalHardAssets, 6),
    rebalanceNeeded: finalBreakdown.rebalanceNeeded,
  };
}

/**
 * Check if rebalance is needed (view-only)
 */
export async function checkRebalanceNeeded(): Promise<{
  needed: boolean;
  assets: AssetBreakdown[];
  swapsPlanned: SwapInstruction[];
}> {
  const assets = await getAssetBreakdowns();
  const swapsPlanned = calculateRebalanceSwaps(assets);

  return {
    needed: swapsPlanned.length > 0,
    assets,
    swapsPlanned,
  };
}

/**
 * Get last rebalance info
 */
export async function getLastRebalanceInfo(): Promise<{
  lastRebalanceTime: Date | null;
  timeUntilNext: number;
  canRebalance: boolean;
}> {
  const treasury = getTreasuryContract();
  const [lastTime, timeUntil, breakdown] = await Promise.all([
    treasury.lastRebalanceTime(),
    treasury.timeUntilRebalance(),
    treasury.getVaultBreakdown(),
  ]);

  const lastTimestamp = Number(lastTime);
  return {
    lastRebalanceTime: lastTimestamp > 0 ? new Date(lastTimestamp * 1000) : null,
    timeUntilNext: Number(timeUntil),
    canRebalance: Number(timeUntil) === 0 && breakdown.rebalanceNeeded,
  };
}
