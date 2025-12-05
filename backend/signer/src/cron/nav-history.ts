import cron from 'node-cron';
import { config } from '../config';
import { fetchNavSnapshot, storeNavSnapshot } from '../services/nav';

// Default schedule: Daily at midnight UTC
const DEFAULT_SCHEDULE = '0 0 * * *';

// Failure tracking
let isRunning = false;
let consecutiveFailures = 0;
const MAX_CONSECUTIVE_FAILURES = 5;

/**
 * Execute NAV snapshot and event sync
 */
async function executeNavSnapshot(): Promise<void> {
  if (isRunning) {
    console.log('[NAV Cron] Previous execution still running, skipping...');
    return;
  }

  isRunning = true;
  const startTime = Date.now();

  try {
    console.log('[NAV Cron] Starting NAV snapshot...');

    // Fetch and store snapshot
    const snapshot = await fetchNavSnapshot();
    const snapshotId = await storeNavSnapshot(snapshot);

    console.log(`[NAV Cron] Stored snapshot #${snapshotId} at block ${snapshot.blockNumber}`);
    console.log(`[NAV Cron] ROSE price: $${snapshot.breakdown.rosePriceUsd}`);
    console.log(`[NAV Cron] Total hard assets: $${snapshot.breakdown.totalHardAssets}`);

    consecutiveFailures = 0;
    console.log(`[NAV Cron] Completed in ${Date.now() - startTime}ms`);
  } catch (error) {
    consecutiveFailures++;
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Handle stale oracle gracefully (not counted as hard failure)
    if (errorMessage.includes('StaleOracle') || errorMessage.includes('stale')) {
      console.warn('[NAV Cron] Oracle data stale, skipping snapshot');
      consecutiveFailures--; // Don't count stale oracle as failure
      return;
    }

    console.error(`[NAV Cron] Error (failure ${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}):`, error);

    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      console.error('[NAV Cron] Max consecutive failures reached. Consider manual intervention.');
    }
  } finally {
    isRunning = false;
  }
}

/**
 * Start the NAV history cron job
 */
export function startNavHistoryCron(): void {
  // Check if treasury is configured
  if (!config.contracts.treasury) {
    console.log('[NAV Cron] TREASURY_ADDRESS not configured, skipping NAV history cron');
    return;
  }

  // Check if database is configured
  if (!config.database.url) {
    console.log('[NAV Cron] DATABASE_URL not configured, skipping NAV history cron');
    return;
  }

  const schedule = config.nav?.cronSchedule || DEFAULT_SCHEDULE;

  console.log(`[NAV Cron] Starting with schedule: ${schedule}`);

  cron.schedule(schedule, executeNavSnapshot, {
    timezone: 'UTC',
    scheduled: true,
  });

  // Run immediately on startup to capture current state (unless disabled)
  const runOnStartup = config.nav?.snapshotOnStartup !== false;
  if (runOnStartup) {
    console.log('[NAV Cron] Running initial snapshot on startup...');
    // Delay slightly to allow database connection to stabilize
    setTimeout(() => {
      executeNavSnapshot().catch((err) => {
        console.error('[NAV Cron] Startup snapshot failed:', err);
      });
    }, 5000);
  }

  console.log('[NAV Cron] NAV history tracking scheduled (daily at midnight UTC)');
}

// Export for manual triggering (useful for testing)
export { executeNavSnapshot };
