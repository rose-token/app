import cron from 'node-cron';
import { config } from '../config';
import { executeRebalance } from '../services/treasury';

// Quarterly: Jan 1, Apr 1, Jul 1, Oct 1 at 00:00 UTC
// Cron format: minute hour day-of-month month day-of-week
const QUARTERLY_SCHEDULE = '0 0 1 1,4,7,10 *';

// Retry configuration for failed rebalances
const RETRY_INTERVAL_HOURS = 6;
const MAX_RETRY_ATTEMPTS = 10;

// Retry state
let retryTask: cron.ScheduledTask | null = null;
let retryAttempt = 0;

function stopRetryTask(): void {
  if (retryTask) {
    retryTask.stop();
    retryTask = null;
    retryAttempt = 0;
    console.log('[Cron] Retry task stopped');
  }
}

function startRetryTask(): void {
  // Run every 6 hours: "0 */6 * * *"
  const retrySchedule = `0 */${RETRY_INTERVAL_HOURS} * * *`;

  retryTask = cron.schedule(
    retrySchedule,
    async () => {
      retryAttempt++;
      const timestamp = new Date().toISOString();
      console.log(`[Cron] Rebalance retry ${retryAttempt}/${MAX_RETRY_ATTEMPTS} at ${timestamp}`);

      try {
        const result = await executeRebalance();
        console.log(`[Cron] Retry succeeded. TX: ${result.txHash}`);
        stopRetryTask();
      } catch (error) {
        console.error(`[Cron] Retry ${retryAttempt} failed:`, error);

        if (retryAttempt >= MAX_RETRY_ATTEMPTS) {
          console.error(`[Cron] Max retry attempts (${MAX_RETRY_ATTEMPTS}) exhausted. Rebalance failed.`);
          stopRetryTask();
        } else {
          const nextRetry = new Date(Date.now() + RETRY_INTERVAL_HOURS * 60 * 60 * 1000);
          console.log(`[Cron] Next retry scheduled for ${nextRetry.toISOString()}`);
        }
      }
    },
    { timezone: 'UTC' }
  );

  console.log(`[Cron] Retry task started. Will retry every ${RETRY_INTERVAL_HOURS} hours, max ${MAX_RETRY_ATTEMPTS} attempts`);
}

export function startRebalanceCron(): void {
  if (!config.contracts.treasury) {
    console.log('[Cron] TREASURY_ADDRESS not configured, skipping rebalance cron');
    return;
  }

  cron.schedule(
    QUARTERLY_SCHEDULE,
    async () => {
      const timestamp = new Date().toISOString();
      console.log(`[Cron] Quarterly rebalance triggered at ${timestamp}`);

      // Cancel any previous retry task from last quarter
      stopRetryTask();

      try {
        const result = await executeRebalance();
        console.log(`[Cron] Rebalance succeeded. TX: ${result.txHash}`);
      } catch (error) {
        console.error('[Cron] Rebalance failed:', error);
        console.log('[Cron] Starting retry schedule...');
        startRetryTask();
      }
    },
    { timezone: 'UTC' }
  );

  console.log('[Cron] Quarterly treasury rebalance scheduled (Jan 1, Apr 1, Jul 1, Oct 1 at 00:00 UTC)');
}
