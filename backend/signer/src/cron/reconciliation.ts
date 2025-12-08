import cron from 'node-cron';
import { config } from '../config';
import {
  runReconciliation,
  ReconciliationResult,
  DiscrepancyType,
  syncAllocationsFromChain,
} from '../services/reconciliation';

// Default schedule: Every 6 hours
const DEFAULT_SCHEDULE = '0 */6 * * *';

// Failure tracking
let isRunning = false;
let consecutiveFailures = 0;
const MAX_CONSECUTIVE_FAILURES = 3;

// Store last reconciliation result
let lastResult: ReconciliationResult | null = null;

/**
 * Execute reconciliation job
 */
async function executeReconciliation(): Promise<void> {
  if (isRunning) {
    console.log('[Reconciliation Cron] Previous execution still running, skipping...');
    return;
  }

  isRunning = true;
  const startTime = Date.now();

  try {
    console.log('[Reconciliation Cron] Starting reconciliation check...');

    const result = await runReconciliation();
    lastResult = result;

    console.log(`[Reconciliation Cron] Checked ${result.delegatesChecked} delegate votes`);
    console.log(`[Reconciliation Cron] Checked ${result.allocationsChecked} allocations`);

    if (result.isHealthy) {
      console.log('[Reconciliation Cron] All allocations verified - DB matches on-chain');
    } else {
      console.warn(`[Reconciliation Cron] Found ${result.discrepancies.length} discrepancies:`);

      // Group discrepancies by type
      const byType = new Map<DiscrepancyType, number>();
      for (const d of result.discrepancies) {
        byType.set(d.type, (byType.get(d.type) || 0) + 1);
      }

      for (const [type, count] of byType) {
        console.warn(`  - ${type}: ${count}`);
      }

      // Log first few discrepancies for debugging
      for (const d of result.discrepancies.slice(0, 5)) {
        console.warn(`  [${d.type}] ${d.message}`);
      }

      // Auto-fix discrepancies by syncing from chain (handles POWER_MISMATCH + ORPHANED_DB_RECORD)
      const votesToSync = new Map<string, Set<DiscrepancyType>>();
      for (const d of result.discrepancies) {
        if (d.type === DiscrepancyType.POWER_MISMATCH || d.type === DiscrepancyType.ORPHANED_DB_RECORD) {
          const key = `${d.proposalId}:${d.delegate}`;
          const types = votesToSync.get(key) || new Set<DiscrepancyType>();
          types.add(d.type);
          votesToSync.set(key, types);
        }
      }

      if (votesToSync.size > 0) {
        console.log(`[Reconciliation Cron] Auto-syncing ${votesToSync.size} discrepant votes from chain...`);

        for (const [key, types] of votesToSync.entries()) {
          const [proposalIdStr, delegate] = key.split(':');
          const proposalId = parseInt(proposalIdStr);

          try {
            const syncResult = await syncAllocationsFromChain(proposalId, delegate);
            if (syncResult.synced > 0) {
              console.log(`[Reconciliation Cron] Synced proposal ${proposalId}, delegate ${delegate} (${Array.from(types).join(', ')}): ${syncResult.synced} records`);
            }
            if (syncResult.errors.length > 0) {
              console.warn(`[Reconciliation Cron] Sync errors for proposal ${proposalId}, delegate ${delegate}: ${syncResult.errors.join(', ')}`);
            }
          } catch (err) {
            console.error(`[Reconciliation Cron] Failed to sync proposal ${proposalId}, delegate ${delegate}:`, err);
          }
        }
      }
    }

    consecutiveFailures = 0;
    console.log(`[Reconciliation Cron] Completed in ${Date.now() - startTime}ms`);
  } catch (error) {
    consecutiveFailures++;
    console.error(
      `[Reconciliation Cron] Error (failure ${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}):`,
      error
    );

    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      console.error('[Reconciliation Cron] Max consecutive failures reached. Check governance contract configuration.');
    }
  } finally {
    isRunning = false;
  }
}

/**
 * Start the reconciliation cron job
 */
export function startReconciliationCron(): void {
  // Check if governance is configured
  if (!config.contracts.governance) {
    console.log('[Reconciliation Cron] GOVERNANCE_ADDRESS not configured, skipping reconciliation cron');
    return;
  }

  // Check if database is configured
  if (!config.database.url) {
    console.log('[Reconciliation Cron] DATABASE_URL not configured, skipping reconciliation cron');
    return;
  }

  const schedule = process.env.RECONCILIATION_CRON_SCHEDULE || DEFAULT_SCHEDULE;

  console.log(`[Reconciliation Cron] Starting with schedule: ${schedule}`);

  cron.schedule(schedule, executeReconciliation, {
    timezone: 'UTC',
    scheduled: true,
  });

  // Run on startup after a delay (let other services initialize)
  const runOnStartup = process.env.RECONCILIATION_ON_STARTUP !== 'false';
  if (runOnStartup) {
    console.log('[Reconciliation Cron] Scheduling initial reconciliation...');
    setTimeout(() => {
      executeReconciliation().catch((err) => {
        console.error('[Reconciliation Cron] Startup reconciliation failed:', err);
      });
    }, 30000); // 30 second delay to let everything initialize
  }

  console.log('[Reconciliation Cron] Delegation allocations reconciliation scheduled');
}

/**
 * Get the last reconciliation result
 */
export function getLastReconciliationResult(): ReconciliationResult | null {
  return lastResult;
}

/**
 * Manually trigger reconciliation (for API endpoint)
 */
export async function triggerReconciliation(): Promise<ReconciliationResult> {
  if (isRunning) {
    throw new Error('Reconciliation already in progress');
  }

  await executeReconciliation();

  if (!lastResult) {
    throw new Error('Reconciliation completed but no result available');
  }

  return lastResult;
}

// Export for testing
export { executeReconciliation };
