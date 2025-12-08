import cron from 'node-cron';
import { config } from '../config';
import {
  scoreAllUnscoredProposals,
  getScoringStats,
  freeAllPendingVP,
} from '../services/delegateScoring';

// Default schedule: Every hour
const DEFAULT_SCHEDULE = '0 * * * *';

// Failure tracking
let isRunning = false;
let consecutiveFailures = 0;
const MAX_CONSECUTIVE_FAILURES = 3;

// Store last run result
let lastRunResult: {
  proposalsProcessed: number;
  totalDelegatesUpdated: number;
  errors: string[];
  vpFreed: number;
  vpErrors: string[];
  completedAt: Date;
} | null = null;

/**
 * Execute delegate scoring job
 */
async function executeDelegateScoring(): Promise<void> {
  if (isRunning) {
    console.log('[DelegateScoring Cron] Previous execution still running, skipping...');
    return;
  }

  isRunning = true;
  const startTime = Date.now();

  try {
    console.log('[DelegateScoring Cron] Checking for finalized proposals to score...');

    // 1. Score proposals (existing logic)
    const result = await scoreAllUnscoredProposals();

    if (result.proposalsProcessed > 0) {
      console.log(
        `[DelegateScoring Cron] Processed ${result.proposalsProcessed} proposals, ` +
        `updated ${result.totalDelegatesUpdated} delegate scores`
      );
    } else {
      console.log('[DelegateScoring Cron] No unscored proposals found');
    }

    if (result.errors.length > 0) {
      console.warn('[DelegateScoring Cron] Scoring errors:', result.errors.join('; '));
    }

    // 2. Free pending VP for finalized proposals (Phase 2)
    const vpFreeingEnabled = process.env.VP_FREEING_ENABLED !== 'false';
    let vpResult = { proposalsProcessed: 0, totalDelegatesFreed: 0, errors: [] as string[] };

    if (vpFreeingEnabled) {
      console.log('[DelegateScoring Cron] Freeing pending VP for finalized proposals...');
      vpResult = await freeAllPendingVP();

      if (vpResult.totalDelegatesFreed > 0) {
        console.log(
          `[DelegateScoring Cron] Freed VP for ${vpResult.totalDelegatesFreed} delegates ` +
          `across ${vpResult.proposalsProcessed} proposals`
        );
      }

      if (vpResult.errors.length > 0) {
        console.warn('[DelegateScoring Cron] VP freeing errors:', vpResult.errors.slice(0, 5).join('; '));
      }
    }

    lastRunResult = {
      ...result,
      vpFreed: vpResult.totalDelegatesFreed,
      vpErrors: vpResult.errors,
      completedAt: new Date(),
    };

    consecutiveFailures = 0;
    console.log(`[DelegateScoring Cron] Completed in ${Date.now() - startTime}ms`);
  } catch (error) {
    consecutiveFailures++;
    console.error(
      `[DelegateScoring Cron] Error (failure ${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}):`,
      error
    );

    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      console.error('[DelegateScoring Cron] Max consecutive failures reached. Check governance contract configuration.');
    }
  } finally {
    isRunning = false;
  }
}

/**
 * Start the delegate scoring cron job
 */
export function startDelegateScoringCron(): void {
  // Check if governance is configured
  if (!config.contracts.governance) {
    console.log('[DelegateScoring Cron] GOVERNANCE_ADDRESS not configured, skipping delegate scoring cron');
    return;
  }

  // Check if database is configured
  if (!config.database.url) {
    console.log('[DelegateScoring Cron] DATABASE_URL not configured, skipping delegate scoring cron');
    return;
  }

  // Check if delegate scoring is enabled
  if (!config.delegateScoring.enabled) {
    console.log('[DelegateScoring Cron] Delegate scoring disabled, skipping cron');
    return;
  }

  const schedule = process.env.DELEGATE_SCORING_CRON_SCHEDULE || DEFAULT_SCHEDULE;

  console.log(`[DelegateScoring Cron] Starting with schedule: ${schedule}`);

  cron.schedule(schedule, executeDelegateScoring, {
    timezone: 'UTC',
    scheduled: true,
  });

  // Run on startup after a delay (let other services initialize)
  const runOnStartup = process.env.DELEGATE_SCORING_ON_STARTUP !== 'false';
  if (runOnStartup) {
    console.log('[DelegateScoring Cron] Scheduling initial scoring run...');
    setTimeout(() => {
      executeDelegateScoring().catch((err) => {
        console.error('[DelegateScoring Cron] Startup scoring failed:', err);
      });
    }, 45000); // 45 second delay (after reconciliation cron)
  }

  console.log('[DelegateScoring Cron] Delegate scoring scheduled');
}

/**
 * Get the last run result
 */
export function getLastDelegateScoringResult(): typeof lastRunResult {
  return lastRunResult;
}

/**
 * Manually trigger delegate scoring (for API endpoint)
 */
export async function triggerDelegateScoring(): Promise<typeof lastRunResult> {
  if (isRunning) {
    throw new Error('Delegate scoring already in progress');
  }

  await executeDelegateScoring();

  if (!lastRunResult) {
    throw new Error('Delegate scoring completed but no result available');
  }

  return lastRunResult;
}

// Export for testing
export { executeDelegateScoring };
