/**
 * Camelot LP Fee Collection Cron Job
 *
 * Schedules automatic fee collection from Camelot LP positions.
 * Default: Daily at 06:00 UTC
 *
 * Fees are collected and sent directly to the Treasury contract,
 * increasing NAV and improving ROSE backing.
 */

import cron from 'node-cron';
import { config } from '../config';
import {
  collectAllFees,
  getAllPositions,
  isCamelotLPConfigured,
} from '../services/camelotLP';

// Failure tracking
let isRunning = false;
let consecutiveFailures = 0;
const MAX_CONSECUTIVE_FAILURES = 5;

/**
 * Execute fee collection from all configured positions
 */
async function execute(): Promise<void> {
  if (isRunning) {
    console.log('[CamelotLP Cron] Previous collection still running, skipping');
    return;
  }

  isRunning = true;
  const startTime = Date.now();
  console.log(`[CamelotLP Cron] Starting at ${new Date().toISOString()}`);

  try {
    const result = await collectAllFees();

    if (result.collected.length > 0) {
      console.log('[CamelotLP Cron] Fees collected:');
      for (const c of result.collected) {
        console.log(
          `  Position ${c.tokenId}: ${c.amount0Formatted} ${c.token0Symbol} + ${c.amount1Formatted} ${c.token1Symbol} -> ${c.recipient}`
        );
      }
    }

    if (result.skipped.length > 0) {
      console.log(`[CamelotLP Cron] Skipped ${result.skipped.length} positions (no pending fees)`);
    }

    if (result.errors.length > 0) {
      console.error('[CamelotLP Cron] Errors occurred:');
      for (const e of result.errors) {
        console.error(`  Position ${e.tokenId}: ${e.error}`);
      }
      consecutiveFailures++;

      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        console.error('[CamelotLP Cron] Max consecutive failures reached. Consider manual intervention.');
      }
    } else {
      consecutiveFailures = 0;
    }

    console.log(`[CamelotLP Cron] Completed in ${Date.now() - startTime}ms`);
  } catch (error) {
    consecutiveFailures++;
    const errorMessage = error instanceof Error ? error.message : String(error);

    console.error(
      `[CamelotLP Cron] Error (failure ${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}):`,
      errorMessage
    );

    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      console.error('[CamelotLP Cron] Max consecutive failures reached. Consider manual intervention.');
    }
  } finally {
    isRunning = false;
  }
}

/**
 * Start the Camelot LP fee collection cron job
 */
export function startCamelotLPCron(): void {
  // Check if feature is enabled
  if (!config.camelotLP.enabled) {
    console.log('[CamelotLP Cron] Disabled via CAMELOT_LP_ENABLED=false');
    return;
  }

  // Check if positions are configured
  if (config.camelotLP.positionIds.length === 0) {
    console.log('[CamelotLP Cron] No positions configured (CAMELOT_LP_POSITION_IDS)');
    return;
  }

  // Check if treasury address is configured
  if (!config.contracts.treasury) {
    console.log('[CamelotLP Cron] No treasury address configured (TREASURY_ADDRESS)');
    return;
  }

  const schedule = config.camelotLP.cronSchedule;

  console.log(`[CamelotLP Cron] Starting with schedule: ${schedule}`);
  console.log(`[CamelotLP Cron] Position Manager: ${config.camelotLP.positionManager}`);
  console.log(`[CamelotLP Cron] Positions: ${config.camelotLP.positionIds.join(', ')}`);
  console.log(`[CamelotLP Cron] Treasury: ${config.contracts.treasury}`);

  cron.schedule(schedule, execute, {
    timezone: 'UTC',
    scheduled: true,
  });

  // Startup check - verify positions are accessible
  setTimeout(async () => {
    console.log('[CamelotLP Cron] Startup check...');
    try {
      const positions = await getAllPositions();
      for (const p of positions) {
        const fees0 = p.pendingFees0 !== '0' ? p.pendingFees0 : '-';
        const fees1 = p.pendingFees1 !== '0' ? p.pendingFees1 : '-';
        console.log(
          `  Position ${p.tokenId}: ${p.token0Symbol}/${p.token1Symbol}, liquidity: ${p.liquidity}, pending: ${fees0}/${fees1}`
        );
      }
      console.log('[CamelotLP Cron] Startup check complete');
    } catch (err) {
      console.error('[CamelotLP Cron] Startup check failed:', err);
    }
  }, 5000);

  console.log('[CamelotLP Cron] Fee collection scheduled');
}

// Export for manual triggering via API
export { execute as executeNow };
