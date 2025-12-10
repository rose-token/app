/**
 * Dispute Service
 *
 * Manages dispute data synced from on-chain events.
 * Provides query endpoints for admin UI.
 */

import { query } from '../db/pool';
import {
  DisputeRow,
  DisputeInfo,
  DisputeListResponse,
  DisputeStatsResponse,
  ResolutionType,
} from '../types';

/**
 * Get dispute info for a specific task
 */
export async function getDispute(taskId: number): Promise<DisputeInfo | null> {
  const result = await query<DisputeRow>(
    'SELECT * FROM disputes WHERE task_id = $1',
    [taskId]
  );

  if (result.rowCount === 0) {
    return null;
  }

  return mapDisputeRow(result.rows[0]);
}

/**
 * List disputes with pagination and filters
 */
export async function listDisputes(
  page: number = 1,
  pageSize: number = 20,
  openOnly: boolean = false
): Promise<DisputeListResponse> {
  const offset = (page - 1) * pageSize;

  const whereClause = openOnly ? 'WHERE resolved_at IS NULL' : '';

  // Get total count
  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM disputes ${whereClause}`
  );
  const total = parseInt(countResult.rows[0].count, 10);

  // Get disputes
  const result = await query<DisputeRow>(
    `SELECT * FROM disputes ${whereClause}
     ORDER BY created_at DESC
     LIMIT $1 OFFSET $2`,
    [pageSize, offset]
  );

  return {
    disputes: result.rows.map(mapDisputeRow),
    total,
    page,
    pageSize,
  };
}

/**
 * Get dispute statistics
 */
export async function getDisputeStats(): Promise<DisputeStatsResponse> {
  const statsResult = await query<{
    total: string;
    open: string;
    resolved: string;
    avg_hours: string;
    favor_customer: string;
    favor_worker: string;
    partial: string;
  }>(`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE resolved_at IS NULL) as open,
      COUNT(*) FILTER (WHERE resolved_at IS NOT NULL) as resolved,
      COALESCE(
        AVG(EXTRACT(EPOCH FROM (resolved_at - disputed_at)) / 3600)
        FILTER (WHERE resolved_at IS NOT NULL),
        0
      ) as avg_hours,
      COUNT(*) FILTER (WHERE resolution_type = 0) as favor_customer,
      COUNT(*) FILTER (WHERE resolution_type = 1) as favor_worker,
      COUNT(*) FILTER (WHERE resolution_type = 2) as partial
    FROM disputes
  `);

  const stats = statsResult.rows[0];

  return {
    totalDisputes: parseInt(stats.total, 10),
    openDisputes: parseInt(stats.open, 10),
    resolvedDisputes: parseInt(stats.resolved, 10),
    avgResolutionTimeHours: parseFloat(stats.avg_hours) || 0,
    resolutionBreakdown: {
      favorCustomer: parseInt(stats.favor_customer, 10),
      favorWorker: parseInt(stats.favor_worker, 10),
      partial: parseInt(stats.partial, 10),
    },
  };
}

/**
 * Record a dispute from on-chain event (called by watcher or sync)
 */
export async function recordDispute(
  taskId: number,
  initiator: string,
  reasonHash: string,
  disputedAt: number,
  blockNumber: number,
  txHash: string
): Promise<void> {
  await query(
    `INSERT INTO disputes (task_id, initiator, reason_hash, disputed_at, block_number, tx_hash)
     VALUES ($1, $2, $3, to_timestamp($4), $5, $6)
     ON CONFLICT (task_id) DO UPDATE SET
       initiator = EXCLUDED.initiator,
       reason_hash = EXCLUDED.reason_hash,
       disputed_at = EXCLUDED.disputed_at,
       block_number = EXCLUDED.block_number,
       tx_hash = EXCLUDED.tx_hash`,
    [taskId, initiator.toLowerCase(), reasonHash, disputedAt, blockNumber, txHash]
  );

  console.log(`[Dispute] Recorded dispute for task ${taskId} by ${initiator}`);
}

/**
 * Record dispute resolution from on-chain event
 */
export async function recordResolution(
  taskId: number,
  resolutionType: ResolutionType,
  workerPct: number,
  workerAmount: string,
  customerRefund: string,
  resolvedBy: string,
  blockNumber: number
): Promise<void> {
  await query(
    `UPDATE disputes SET
       resolution_type = $2,
       worker_pct = $3,
       worker_amount = $4,
       customer_refund = $5,
       resolved_at = NOW(),
       resolved_by = $6
     WHERE task_id = $1`,
    [taskId, resolutionType, workerPct, workerAmount, customerRefund, resolvedBy.toLowerCase()]
  );

  console.log(`[Dispute] Recorded resolution for task ${taskId}: ${workerPct}% to worker`);
}

// Helper to map database row to API response
function mapDisputeRow(row: DisputeRow): DisputeInfo {
  const info: DisputeInfo = {
    taskId: row.task_id,
    initiator: row.initiator,
    reasonHash: row.reason_hash,
    disputedAt: row.disputed_at,
    isResolved: row.resolved_at !== null,
  };

  if (row.resolved_at) {
    info.resolution = {
      type: row.resolution_type as ResolutionType,
      workerPct: row.worker_pct!,
      workerAmount: row.worker_amount!,
      customerRefund: row.customer_refund!,
      resolvedAt: row.resolved_at,
      resolvedBy: row.resolved_by!,
    };
  }

  return info;
}
