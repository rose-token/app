import cron from 'node-cron';
import { config } from '../config';
import { executeRebalance } from '../services/treasury';

// Quarterly: Jan 1, Apr 1, Jul 1, Oct 1 at 00:00 UTC
// Cron format: minute hour day-of-month month day-of-week
const QUARTERLY_SCHEDULE = '0 0 1 1,4,7,10 *';

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

      try {
        const result = await executeRebalance();
        console.log(`[Cron] Rebalance succeeded. TX: ${result.txHash}`);
      } catch (error) {
        console.error('[Cron] Rebalance failed:', error);
      }
    },
    { timezone: 'UTC' }
  );

  console.log('[Cron] Quarterly treasury rebalance scheduled (Jan 1, Apr 1, Jul 1, Oct 1 at 00:00 UTC)');
}
