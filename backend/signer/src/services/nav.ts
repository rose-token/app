import { ethers } from 'ethers';
import { config } from '../config';
import { query } from '../db/pool';
import { getWsProvider } from '../utils/wsProvider';

// Treasury contract ABI (read functions for NAV tracking)
// Updated to match dynamic asset registry contract
const TREASURY_ABI = [
  // Vault breakdown - core metrics
  'function getVaultBreakdown() external view returns (uint256 totalHardAssets, uint256 currentRosePrice, uint256 circulatingRose, bool rebalanceNeeded)',
  // Per-asset breakdown
  'function getAssetBreakdown(bytes32 key) external view returns (address token, uint256 balance, uint256 valueUSD, uint256 targetBps, uint256 actualBps, bool active)',
  // Asset price (Chainlink oracle)
  'function getAssetPrice(bytes32 key) external view returns (uint256)',
];

// Types
export interface VaultBreakdown {
  btcValueUsd: string;
  goldValueUsd: string;
  usdcValueUsd: string;
  roseValueUsd: string;
  totalHardAssets: string;
  rosePriceUsd: string;
  circulatingRose: string;
  rebalanceNeeded: boolean;
}

export interface AllocationStatus {
  targetBtc: number;
  targetGold: number;
  targetUsdc: number;
  targetRose: number;
  actualBtc: number;
  actualGold: number;
  actualUsdc: number;
  actualRose: number;
}

export interface NavSnapshot {
  breakdown: VaultBreakdown;
  allocation: AllocationStatus;
  btcChainlinkPrice: string;
  goldChainlinkPrice: string;
  blockNumber: number;
}

export interface RebalanceEvent {
  txHash: string;
  blockNumber: number;
  logIndex: number;
  btcValueUsd: string;
  goldValueUsd: string;
  usdcValueUsd: string;
  roseValueUsd: string;
  totalHardAssets: string;
  rebalancedAt: Date;
}

export interface NavHistoryOptions {
  limit?: number;
  offset?: number;
  startDate?: Date;
  endDate?: Date;
  interval?: 'raw' | 'daily' | 'weekly';
}

export interface NavHistoryResult {
  snapshots: NavSnapshotRow[];
  total: number;
}

export interface NavSnapshotRow {
  id: number;
  recorded_at: Date;
  rose_price_usd: string;
  total_hard_assets_usd: string;
  circulating_rose: string;
  btc_value_usd?: string;
  gold_value_usd?: string;
  usdc_value_usd?: string;
  rose_value_usd?: string;
  actual_btc_bps: number;
  actual_gold_bps: number;
  actual_usdc_bps: number;
  actual_rose_bps: number;
  rebalance_needed: boolean;
  block_number?: number;
}

export interface RebalanceHistoryResult {
  events: RebalanceEventRow[];
  total: number;
}

export interface RebalanceEventRow {
  id: number;
  tx_hash: string;
  block_number: number;
  log_index: number;
  btc_value_usd: string;
  gold_value_usd: string;
  usdc_value_usd: string;
  rose_value_usd: string;
  total_hard_assets_usd: string;
  rebalanced_at: Date;
  created_at: Date;
}

export interface NavStats {
  current: NavSnapshotRow | null;
  change7d: number | null;
  change30d: number | null;
  allTimeHigh: { price: string; date: Date } | null;
  allTimeLow: { price: string; date: Date } | null;
}

// Provider and contract instances
function getProvider(): ethers.Provider {
  return getWsProvider();
}

function getTreasuryContract(): ethers.Contract | null {
  if (!config.contracts.treasury) {
    console.warn('[NAV] Treasury contract address not configured');
    return null;
  }
  return new ethers.Contract(config.contracts.treasury, TREASURY_ABI, getProvider());
}

// Asset keys as bytes32
const BTC_KEY = ethers.encodeBytes32String('BTC');
const GOLD_KEY = ethers.encodeBytes32String('GOLD');
const STABLE_KEY = ethers.encodeBytes32String('STABLE');
const ROSE_KEY = ethers.encodeBytes32String('ROSE');

/**
 * Fetch current NAV snapshot from treasury contract
 * Uses dynamic asset registry to get per-asset breakdowns
 */
export async function fetchNavSnapshot(): Promise<NavSnapshot> {
  const treasury = getTreasuryContract();
  if (!treasury) {
    throw new Error('Treasury contract not configured');
  }

  // Parallel contract calls for efficiency
  const [
    vaultBreakdown,
    btcBreakdown,
    goldBreakdown,
    usdcBreakdown,
    roseBreakdown,
    btcPrice,
    goldPrice,
    blockNumber
  ] = await Promise.all([
    treasury.getVaultBreakdown(),
    treasury.getAssetBreakdown(BTC_KEY),
    treasury.getAssetBreakdown(GOLD_KEY),
    treasury.getAssetBreakdown(STABLE_KEY),
    treasury.getAssetBreakdown(ROSE_KEY),
    treasury.getAssetPrice(BTC_KEY),
    treasury.getAssetPrice(GOLD_KEY),
    getProvider().getBlockNumber(),
  ]);

  // getAssetBreakdown returns: (token, balance, valueUSD, targetBps, actualBps, active)
  // valueUSD is in 6 decimals, targetBps and actualBps are basis points

  return {
    breakdown: {
      btcValueUsd: ethers.formatUnits(btcBreakdown.valueUSD, 6),
      goldValueUsd: ethers.formatUnits(goldBreakdown.valueUSD, 6),
      usdcValueUsd: ethers.formatUnits(usdcBreakdown.valueUSD, 6),
      roseValueUsd: ethers.formatUnits(roseBreakdown.valueUSD, 6),
      totalHardAssets: ethers.formatUnits(vaultBreakdown.totalHardAssets, 6),
      rosePriceUsd: ethers.formatUnits(vaultBreakdown.currentRosePrice, 6),
      circulatingRose: ethers.formatUnits(vaultBreakdown.circulatingRose, 18),
      rebalanceNeeded: vaultBreakdown.rebalanceNeeded,
    },
    allocation: {
      targetBtc: Number(btcBreakdown.targetBps),
      targetGold: Number(goldBreakdown.targetBps),
      targetUsdc: Number(usdcBreakdown.targetBps),
      targetRose: Number(roseBreakdown.targetBps),
      actualBtc: Number(btcBreakdown.actualBps),
      actualGold: Number(goldBreakdown.actualBps),
      actualUsdc: Number(usdcBreakdown.actualBps),
      actualRose: Number(roseBreakdown.actualBps),
    },
    btcChainlinkPrice: ethers.formatUnits(btcPrice, 8),
    goldChainlinkPrice: ethers.formatUnits(goldPrice, 8),
    blockNumber,
  };
}

/**
 * Store NAV snapshot in database
 */
export async function storeNavSnapshot(snapshot: NavSnapshot): Promise<number> {
  const sql = `
    INSERT INTO nav_snapshots (
      btc_value_usd, gold_value_usd, usdc_value_usd, rose_value_usd,
      total_hard_assets_usd, rose_price_usd, circulating_rose,
      target_btc_bps, target_gold_bps, target_usdc_bps, target_rose_bps,
      actual_btc_bps, actual_gold_bps, actual_usdc_bps, actual_rose_bps,
      btc_chainlink_price, gold_chainlink_price,
      rebalance_needed, block_number
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
    RETURNING id
  `;

  const values = [
    snapshot.breakdown.btcValueUsd,
    snapshot.breakdown.goldValueUsd,
    snapshot.breakdown.usdcValueUsd,
    snapshot.breakdown.roseValueUsd,
    snapshot.breakdown.totalHardAssets,
    snapshot.breakdown.rosePriceUsd,
    snapshot.breakdown.circulatingRose,
    snapshot.allocation.targetBtc,
    snapshot.allocation.targetGold,
    snapshot.allocation.targetUsdc,
    snapshot.allocation.targetRose,
    snapshot.allocation.actualBtc,
    snapshot.allocation.actualGold,
    snapshot.allocation.actualUsdc,
    snapshot.allocation.actualRose,
    snapshot.btcChainlinkPrice,
    snapshot.goldChainlinkPrice,
    snapshot.breakdown.rebalanceNeeded,
    snapshot.blockNumber,
  ];

  const result = await query<{ id: number }>(sql, values);
  return result.rows[0].id;
}

/**
 * Query historical NAV snapshots with pagination and filtering
 */
export async function getNavHistory(options: NavHistoryOptions = {}): Promise<NavHistoryResult> {
  const { limit = 100, offset = 0, startDate, endDate, interval = 'raw' } = options;

  // Build WHERE clause
  const conditions: string[] = [];
  const params: (string | number | Date)[] = [];
  let paramIndex = 1;

  if (startDate) {
    conditions.push(`recorded_at >= $${paramIndex++}`);
    params.push(startDate);
  }
  if (endDate) {
    conditions.push(`recorded_at <= $${paramIndex++}`);
    params.push(endDate);
  }
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  let dataQuery: string;
  let countQuery: string;

  if (interval === 'daily') {
    // Aggregate to daily (first snapshot of each day)
    dataQuery = `
      SELECT DISTINCT ON (DATE(recorded_at))
        id, recorded_at, rose_price_usd, total_hard_assets_usd,
        circulating_rose, actual_btc_bps, actual_gold_bps,
        actual_usdc_bps, actual_rose_bps, rebalance_needed
      FROM nav_snapshots
      ${whereClause}
      ORDER BY DATE(recorded_at) DESC, recorded_at ASC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;
    countQuery = `
      SELECT COUNT(DISTINCT DATE(recorded_at)) as total
      FROM nav_snapshots ${whereClause}
    `;
  } else if (interval === 'weekly') {
    // Aggregate to weekly
    dataQuery = `
      SELECT DISTINCT ON (DATE_TRUNC('week', recorded_at))
        id, recorded_at, rose_price_usd, total_hard_assets_usd,
        circulating_rose, actual_btc_bps, actual_gold_bps,
        actual_usdc_bps, actual_rose_bps, rebalance_needed
      FROM nav_snapshots
      ${whereClause}
      ORDER BY DATE_TRUNC('week', recorded_at) DESC, recorded_at ASC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;
    countQuery = `
      SELECT COUNT(DISTINCT DATE_TRUNC('week', recorded_at)) as total
      FROM nav_snapshots ${whereClause}
    `;
  } else {
    // Raw snapshots
    dataQuery = `
      SELECT id, recorded_at, rose_price_usd, total_hard_assets_usd,
        circulating_rose, btc_value_usd, gold_value_usd, usdc_value_usd,
        rose_value_usd, actual_btc_bps, actual_gold_bps, actual_usdc_bps,
        actual_rose_bps, rebalance_needed, block_number
      FROM nav_snapshots
      ${whereClause}
      ORDER BY recorded_at DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;
    countQuery = `SELECT COUNT(*) as total FROM nav_snapshots ${whereClause}`;
  }

  const queryParams = [...params, limit, offset];
  const countParams = params;

  const [dataResult, countResult] = await Promise.all([
    query<NavSnapshotRow>(dataQuery, queryParams),
    query<{ total: string }>(countQuery, countParams),
  ]);

  return {
    snapshots: dataResult.rows,
    total: parseInt(countResult.rows[0]?.total || '0'),
  };
}

/**
 * Query rebalance event history
 */
export async function getRebalanceHistory(options: { limit?: number; offset?: number } = {}): Promise<RebalanceHistoryResult> {
  const { limit = 50, offset = 0 } = options;

  const [dataResult, countResult] = await Promise.all([
    query<RebalanceEventRow>(
      `
      SELECT * FROM rebalance_events
      ORDER BY rebalanced_at DESC
      LIMIT $1 OFFSET $2
    `,
      [limit, offset]
    ),
    query<{ total: string }>(`SELECT COUNT(*) as total FROM rebalance_events`),
  ]);

  return {
    events: dataResult.rows,
    total: parseInt(countResult.rows[0]?.total || '0'),
  };
}

/**
 * Get NAV statistics (current, changes, extremes)
 */
export async function getNavStats(): Promise<NavStats> {
  const [currentResult, stats7dResult, stats30dResult, extremesResult] = await Promise.all([
    query<NavSnapshotRow>(`
      SELECT rose_price_usd, total_hard_assets_usd, circulating_rose, recorded_at
      FROM nav_snapshots ORDER BY recorded_at DESC LIMIT 1
    `),
    query<{ rose_price_usd: string }>(`
      SELECT rose_price_usd FROM nav_snapshots
      WHERE recorded_at <= NOW() - INTERVAL '7 days'
      ORDER BY recorded_at DESC LIMIT 1
    `),
    query<{ rose_price_usd: string }>(`
      SELECT rose_price_usd FROM nav_snapshots
      WHERE recorded_at <= NOW() - INTERVAL '30 days'
      ORDER BY recorded_at DESC LIMIT 1
    `),
    query<{
      ath_price: string;
      ath_date: Date;
      atl_price: string;
      atl_date: Date;
    }>(`
      SELECT
        (SELECT rose_price_usd FROM nav_snapshots ORDER BY rose_price_usd DESC LIMIT 1) as ath_price,
        (SELECT recorded_at FROM nav_snapshots ORDER BY rose_price_usd DESC LIMIT 1) as ath_date,
        (SELECT rose_price_usd FROM nav_snapshots ORDER BY rose_price_usd ASC LIMIT 1) as atl_price,
        (SELECT recorded_at FROM nav_snapshots ORDER BY rose_price_usd ASC LIMIT 1) as atl_date
    `),
  ]);

  const current = currentResult.rows[0] || null;
  const currentPrice = current?.rose_price_usd;
  const price7d = stats7dResult.rows[0]?.rose_price_usd;
  const price30d = stats30dResult.rows[0]?.rose_price_usd;
  const extremes = extremesResult.rows[0];

  return {
    current,
    change7d:
      currentPrice && price7d ? ((parseFloat(currentPrice) - parseFloat(price7d)) / parseFloat(price7d)) * 100 : null,
    change30d:
      currentPrice && price30d
        ? ((parseFloat(currentPrice) - parseFloat(price30d)) / parseFloat(price30d)) * 100
        : null,
    allTimeHigh: extremes?.ath_price
      ? {
          price: extremes.ath_price,
          date: extremes.ath_date,
        }
      : null,
    allTimeLow: extremes?.atl_price
      ? {
          price: extremes.atl_price,
          date: extremes.atl_date,
        }
      : null,
  };
}

export default {
  fetchNavSnapshot,
  storeNavSnapshot,
  getNavHistory,
  getRebalanceHistory,
  getNavStats,
};
