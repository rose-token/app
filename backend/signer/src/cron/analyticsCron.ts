/**
 * Analytics Cron Jobs
 *
 * Scheduled tasks for analytics aggregation:
 * - Daily rollup: Aggregate events into analytics_daily
 * - Treasury snapshot: Capture hourly NAV data (dedupe to daily)
 * - VP refresh: Sync voting power from stakers table
 */

import cron from 'node-cron';
import { ethers } from 'ethers';
import { config } from '../config';
import { query } from '../db/pool';
import { fetchNavSnapshot } from '../services/nav';
import { RoseMarketplaceABI } from '../utils/contracts';

// State tracking
let dailyRollupRunning = false;
let treasurySnapshotRunning = false;
let vpRefreshRunning = false;
let taskValidationRunning = false;

// ============================================================
// Daily Rollup
// ============================================================

/**
 * Aggregate yesterday's events into analytics_daily
 * Runs at midnight UTC
 */
async function executeDailyRollup(): Promise<void> {
  if (dailyRollupRunning) {
    console.log('[AnalyticsCron] Daily rollup already running, skipping...');
    return;
  }

  dailyRollupRunning = true;
  const startTime = Date.now();

  try {
    // Calculate yesterday's date
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const dateStr = yesterday.toISOString().split('T')[0];

    console.log(`[AnalyticsCron] Starting daily rollup for ${dateStr}...`);

    // Aggregate task metrics
    const taskStats = await query<{
      created: string;
      completed: string;
      disputed: string;
      cancelled: string;
      volume: string;
    }>(`
      SELECT
        COUNT(*) FILTER (WHERE DATE(created_at AT TIME ZONE 'UTC') = $1) as created,
        COUNT(*) FILTER (WHERE DATE(completed_at AT TIME ZONE 'UTC') = $1) as completed,
        COUNT(*) FILTER (WHERE DATE(disputed_at AT TIME ZONE 'UTC') = $1) as disputed,
        COUNT(*) FILTER (WHERE DATE(cancelled_at AT TIME ZONE 'UTC') = $1) as cancelled,
        COALESCE(SUM(deposit) FILTER (WHERE DATE(created_at AT TIME ZONE 'UTC') = $1), 0) as volume
      FROM analytics_tasks
    `, [dateStr]);

    // Aggregate proposal metrics
    const proposalStats = await query<{
      created: string;
      finalized: string;
    }>(`
      SELECT
        COUNT(*) FILTER (WHERE DATE(created_at AT TIME ZONE 'UTC') = $1) as created,
        COUNT(*) FILTER (WHERE DATE(finalized_at AT TIME ZONE 'UTC') = $1) as finalized
      FROM analytics_proposals
    `, [dateStr]);

    // Get today's treasury snapshot for deposits/redemptions
    const treasuryStats = await query<{
      deposits_count: string;
      deposits_usdc: string;
      redemptions_count: string;
      redemptions_usdc: string;
    }>(`
      SELECT
        COALESCE(deposits_count, 0) as deposits_count,
        COALESCE(deposits_usdc, 0) as deposits_usdc,
        COALESCE(redemptions_count, 0) as redemptions_count,
        COALESCE(redemptions_usdc, 0) as redemptions_usdc
      FROM analytics_treasury
      WHERE snapshot_date = $1
    `, [dateStr]);

    // Count new and active users
    const userStats = await query<{
      new_users: string;
      active_users: string;
    }>(`
      SELECT
        COUNT(*) FILTER (WHERE DATE(first_seen_at AT TIME ZONE 'UTC') = $1) as new_users,
        COUNT(*) FILTER (WHERE DATE(last_active_at AT TIME ZONE 'UTC') = $1) as active_users
      FROM analytics_users
    `, [dateStr]);

    const tasks = taskStats.rows[0] || { created: '0', completed: '0', disputed: '0', cancelled: '0', volume: '0' };
    const proposals = proposalStats.rows[0] || { created: '0', finalized: '0' };
    const treasury = treasuryStats.rows[0] || { deposits_count: '0', deposits_usdc: '0', redemptions_count: '0', redemptions_usdc: '0' };
    const users = userStats.rows[0] || { new_users: '0', active_users: '0' };

    // Upsert into analytics_daily
    await query(`
      INSERT INTO analytics_daily (
        date,
        tasks_created, tasks_completed, tasks_disputed, tasks_cancelled, task_volume_wei,
        proposals_created, proposals_finalized,
        deposits_count, deposits_usdc, redemptions_count, redemptions_usdc,
        new_users, active_users
      ) VALUES (
        $1,
        $2, $3, $4, $5, $6,
        $7, $8,
        $9, $10, $11, $12,
        $13, $14
      )
      ON CONFLICT (date) DO UPDATE SET
        tasks_created = EXCLUDED.tasks_created,
        tasks_completed = EXCLUDED.tasks_completed,
        tasks_disputed = EXCLUDED.tasks_disputed,
        tasks_cancelled = EXCLUDED.tasks_cancelled,
        task_volume_wei = EXCLUDED.task_volume_wei,
        proposals_created = EXCLUDED.proposals_created,
        proposals_finalized = EXCLUDED.proposals_finalized,
        deposits_count = EXCLUDED.deposits_count,
        deposits_usdc = EXCLUDED.deposits_usdc,
        redemptions_count = EXCLUDED.redemptions_count,
        redemptions_usdc = EXCLUDED.redemptions_usdc,
        new_users = EXCLUDED.new_users,
        active_users = EXCLUDED.active_users,
        updated_at = NOW()
    `, [
      dateStr,
      parseInt(tasks.created), parseInt(tasks.completed), parseInt(tasks.disputed), parseInt(tasks.cancelled), tasks.volume,
      parseInt(proposals.created), parseInt(proposals.finalized),
      parseInt(treasury.deposits_count), treasury.deposits_usdc, parseInt(treasury.redemptions_count), treasury.redemptions_usdc,
      parseInt(users.new_users), parseInt(users.active_users),
    ]);

    console.log(`[AnalyticsCron] Daily rollup completed for ${dateStr} in ${Date.now() - startTime}ms`);
  } catch (error) {
    console.error('[AnalyticsCron] Daily rollup failed:', error);
  } finally {
    dailyRollupRunning = false;
  }
}

// ============================================================
// Treasury Snapshot
// ============================================================

/**
 * Capture hourly NAV snapshot, upsert by date
 * Runs every hour
 */
async function executeTreasurySnapshot(): Promise<void> {
  if (treasurySnapshotRunning) {
    console.log('[AnalyticsCron] Treasury snapshot already running, skipping...');
    return;
  }

  treasurySnapshotRunning = true;
  const startTime = Date.now();

  try {
    console.log('[AnalyticsCron] Starting treasury snapshot...');

    // Fetch current NAV data from chain
    const snapshot = await fetchNavSnapshot();
    const today = new Date().toISOString().split('T')[0];

    // Calculate allocation basis points
    const totalHardAssets = parseFloat(snapshot.breakdown.totalHardAssets);
    const btcUsd = parseFloat(snapshot.breakdown.btcValueUsd);
    const goldUsd = parseFloat(snapshot.breakdown.goldValueUsd);
    const usdcUsd = parseFloat(snapshot.breakdown.usdcValueUsd);
    const roseUsd = parseFloat(snapshot.breakdown.roseValueUsd);
    const totalAssets = btcUsd + goldUsd + usdcUsd + roseUsd;

    const btcBps = totalAssets > 0 ? Math.round((btcUsd / totalAssets) * 10000) : 0;
    const goldBps = totalAssets > 0 ? Math.round((goldUsd / totalAssets) * 10000) : 0;
    const usdcBps = totalAssets > 0 ? Math.round((usdcUsd / totalAssets) * 10000) : 0;
    const roseBps = totalAssets > 0 ? Math.round((roseUsd / totalAssets) * 10000) : 0;

    // Upsert treasury snapshot (preserving deposit/redemption counts)
    await query(`
      INSERT INTO analytics_treasury (
        snapshot_date,
        rose_price_usd, total_hard_assets_usd, circulating_rose,
        btc_bps, gold_bps, usdc_bps, rose_bps,
        snapshot_block
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9
      )
      ON CONFLICT (snapshot_date) DO UPDATE SET
        rose_price_usd = EXCLUDED.rose_price_usd,
        total_hard_assets_usd = EXCLUDED.total_hard_assets_usd,
        circulating_rose = EXCLUDED.circulating_rose,
        btc_bps = EXCLUDED.btc_bps,
        gold_bps = EXCLUDED.gold_bps,
        usdc_bps = EXCLUDED.usdc_bps,
        rose_bps = EXCLUDED.rose_bps,
        snapshot_block = EXCLUDED.snapshot_block,
        updated_at = NOW()
    `, [
      today,
      snapshot.breakdown.rosePriceUsd,
      snapshot.breakdown.totalHardAssets,
      snapshot.breakdown.circulatingRose,
      btcBps, goldBps, usdcBps, roseBps,
      snapshot.blockNumber,
    ]);

    console.log(`[AnalyticsCron] Treasury snapshot updated for ${today} (price: $${snapshot.breakdown.rosePriceUsd}) in ${Date.now() - startTime}ms`);
  } catch (error) {
    console.error('[AnalyticsCron] Treasury snapshot failed:', error);
  } finally {
    treasurySnapshotRunning = false;
  }
}

// ============================================================
// VP Refresh
// ============================================================

/**
 * Sync voting power from stakers table to analytics_users
 * Runs every 15 minutes
 */
async function executeVPRefresh(): Promise<void> {
  if (vpRefreshRunning) {
    console.log('[AnalyticsCron] VP refresh already running, skipping...');
    return;
  }

  vpRefreshRunning = true;
  const startTime = Date.now();

  try {
    console.log('[AnalyticsCron] Starting VP refresh...');

    // Sync voting power from stakers table
    const result = await query(`
      UPDATE analytics_users au
      SET
        staked_rose = s.staked_rose,
        voting_power = s.voting_power
      FROM stakers s
      WHERE au.address = s.address
        AND (au.staked_rose != s.staked_rose OR au.voting_power != s.voting_power)
    `);

    const rowsUpdated = result.rowCount || 0;
    console.log(`[AnalyticsCron] VP refresh completed: ${rowsUpdated} users updated in ${Date.now() - startTime}ms`);
  } catch (error) {
    console.error('[AnalyticsCron] VP refresh failed:', error);
  } finally {
    vpRefreshRunning = false;
  }
}

// ============================================================
// Task Validation (Periodic Drift Correction)
// ============================================================

// Status enum from contract (matches RoseMarketplace.TaskStatus)
// Contract: enum TaskStatus { Open, StakeholderRequired, InProgress, Completed, Closed, ApprovedPendingPayment, Disputed }
const CONTRACT_STATUS_MAP: Record<number, string> = {
  0: 'Staked',    // Open
  1: 'Created',   // StakeholderRequired
  2: 'Claimed',   // InProgress
  3: 'Completed', // Completed
  4: 'Closed',    // Closed
  5: 'Approved',  // ApprovedPendingPayment
  6: 'Disputed',  // Disputed
};

/**
 * Validate active tasks against on-chain state
 * Re-syncs any drifted fields (title, stakeholder, worker, status, etc.)
 * Runs every 15 minutes by default
 */
async function executeTaskValidation(): Promise<void> {
  if (taskValidationRunning) {
    console.log('[AnalyticsCron] Task validation already running, skipping...');
    return;
  }

  if (!config.contracts.marketplace) {
    console.log('[AnalyticsCron] MARKETPLACE_ADDRESS not configured, skipping task validation');
    return;
  }

  taskValidationRunning = true;
  const startTime = Date.now();

  try {
    console.log('[AnalyticsCron] Starting task validation...');

    const provider = new ethers.JsonRpcProvider(config.rpc.url);
    const marketplace = new ethers.Contract(
      config.contracts.marketplace,
      RoseMarketplaceABI,
      provider
    );

    const batchSize = config.taskValidation?.batchSize || 50;

    // Query active tasks from DB (exclude Closed, Cancelled, Disputed)
    const activeStatuses = ['Created', 'Staked', 'Claimed', 'Completed', 'Approved'];
    const tasksResult = await query<{
      task_id: number;
      title: string | null;
      customer: string;
      worker: string | null;
      stakeholder: string | null;
      status: string;
      winning_bid: string;
      stakeholder_deposit: string;
    }>(`
      SELECT task_id, title, customer, worker, stakeholder, status, winning_bid, stakeholder_deposit
      FROM analytics_tasks
      WHERE status = ANY($1)
      ORDER BY task_id ASC
      LIMIT $2
    `, [activeStatuses, batchSize]);

    let updatedCount = 0;
    let checkedCount = 0;

    for (const dbTask of tasksResult.rows) {
      checkedCount++;

      try {
        // Fetch full task struct from contract
        const taskData = await marketplace.tasks(dbTask.task_id);

        const [
          customer, worker, stakeholder, deposit, stakeholderDeposit,
          title, detailedDescriptionHash, prUrl, status, customerApproval,
          stakeholderApproval, source, proposalId, isAuction, winningBid
        ] = taskData;

        // Compare and find drifted fields
        const driftedFields: string[] = [];
        const updates: string[] = [];
        const values: unknown[] = [];
        let paramIndex = 1;

        // Compare title
        const chainTitle = title || '';
        const dbTitle = dbTask.title || '';
        if (chainTitle !== dbTitle) {
          driftedFields.push('title');
          updates.push(`title = $${paramIndex++}`);
          values.push(chainTitle);
        }

        // Compare customer (should never change, but check)
        const chainCustomer = customer.toLowerCase();
        if (chainCustomer !== dbTask.customer.toLowerCase()) {
          driftedFields.push('customer');
          updates.push(`customer = $${paramIndex++}`);
          values.push(chainCustomer);
        }

        // Compare worker
        const chainWorker = worker === ethers.ZeroAddress ? null : worker.toLowerCase();
        const dbWorker = dbTask.worker?.toLowerCase() || null;
        if (chainWorker !== dbWorker) {
          driftedFields.push('worker');
          updates.push(`worker = $${paramIndex++}`);
          values.push(chainWorker);
        }

        // Compare stakeholder
        const chainStakeholder = stakeholder === ethers.ZeroAddress ? null : stakeholder.toLowerCase();
        const dbStakeholder = dbTask.stakeholder?.toLowerCase() || null;
        if (chainStakeholder !== dbStakeholder) {
          driftedFields.push('stakeholder');
          updates.push(`stakeholder = $${paramIndex++}`);
          values.push(chainStakeholder);
        }

        // Compare status
        const chainStatus = CONTRACT_STATUS_MAP[Number(status)] || 'Unknown';
        if (chainStatus !== dbTask.status) {
          driftedFields.push('status');
          updates.push(`status = $${paramIndex++}`);
          values.push(chainStatus);
        }

        // Compare winning_bid
        const chainWinningBid = winningBid.toString();
        if (chainWinningBid !== dbTask.winning_bid) {
          driftedFields.push('winning_bid');
          updates.push(`winning_bid = $${paramIndex++}`);
          values.push(chainWinningBid);
        }

        // Compare stakeholder_deposit
        const chainStakeholderDeposit = stakeholderDeposit.toString();
        if (chainStakeholderDeposit !== dbTask.stakeholder_deposit) {
          driftedFields.push('stakeholder_deposit');
          updates.push(`stakeholder_deposit = $${paramIndex++}`);
          values.push(chainStakeholderDeposit);
        }

        // If any drift detected, update the row
        if (updates.length > 0) {
          values.push(dbTask.task_id);
          await query(`
            UPDATE analytics_tasks SET
              ${updates.join(', ')}
            WHERE task_id = $${paramIndex}
          `, values);

          console.log(`[AnalyticsCron] Task ${dbTask.task_id} corrected: ${driftedFields.join(', ')}`);
          updatedCount++;
        }
      } catch (taskError) {
        console.error(`[AnalyticsCron] Error validating task ${dbTask.task_id}:`, taskError);
      }
    }

    console.log(`[AnalyticsCron] Task validation completed: ${updatedCount}/${checkedCount} tasks corrected in ${Date.now() - startTime}ms`);
  } catch (error) {
    console.error('[AnalyticsCron] Task validation failed:', error);
  } finally {
    taskValidationRunning = false;
  }
}

// ============================================================
// Public API
// ============================================================

/**
 * Start all analytics cron jobs
 */
export function startAnalyticsCron(): void {
  if (config.analyticsCron?.enabled === false) {
    console.log('[AnalyticsCron] Disabled via ANALYTICS_CRON_ENABLED=false');
    return;
  }

  if (!config.database.url) {
    console.log('[AnalyticsCron] DATABASE_URL not configured, skipping');
    return;
  }

  // Daily rollup at midnight UTC
  const dailySchedule = config.analyticsCron?.dailyRollupSchedule || '0 0 * * *';
  cron.schedule(dailySchedule, executeDailyRollup, { timezone: 'UTC' });
  console.log(`[AnalyticsCron] Daily rollup scheduled: ${dailySchedule}`);

  // Treasury snapshot hourly
  const treasurySchedule = config.analyticsCron?.treasurySnapshotSchedule || '0 * * * *';
  if (config.contracts.treasury) {
    cron.schedule(treasurySchedule, executeTreasurySnapshot, { timezone: 'UTC' });
    console.log(`[AnalyticsCron] Treasury snapshot scheduled: ${treasurySchedule}`);
  }

  // VP refresh every 15 minutes
  const vpSchedule = config.analyticsCron?.vpRefreshSchedule || '*/15 * * * *';
  cron.schedule(vpSchedule, executeVPRefresh, { timezone: 'UTC' });
  console.log(`[AnalyticsCron] VP refresh scheduled: ${vpSchedule}`);

  // Task validation every 15 minutes (drift correction)
  if (config.taskValidation?.enabled !== false && config.contracts.marketplace) {
    const taskValidationSchedule = config.taskValidation?.schedule || '*/15 * * * *';
    cron.schedule(taskValidationSchedule, executeTaskValidation, { timezone: 'UTC' });
    console.log(`[AnalyticsCron] Task validation scheduled: ${taskValidationSchedule}`);
  }

  // Run initial treasury snapshot on startup (after 10s delay)
  if (config.contracts.treasury) {
    setTimeout(() => {
      executeTreasurySnapshot().catch(err => {
        console.error('[AnalyticsCron] Initial treasury snapshot failed:', err);
      });
    }, 10000);
  }

  console.log('[AnalyticsCron] Analytics cron jobs started');
}

// Export individual functions for manual triggering
export { executeDailyRollup, executeTreasurySnapshot, executeVPRefresh, executeTaskValidation };
