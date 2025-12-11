/**
 * Database Backup Cron Job
 *
 * Schedules automatic database backups to Pinata IPFS.
 * Default: Daily at 02:00 UTC (offset from NAV snapshot at 00:00 UTC)
 */

import cron from 'node-cron';
import { config } from '../config';
import { createBackup, isBackupConfigured } from '../services/backup';

// Default schedule: Daily at 02:00 UTC
const DEFAULT_SCHEDULE = '0 2 * * *';

// Failure tracking
let isRunning = false;
let consecutiveFailures = 0;
const MAX_CONSECUTIVE_FAILURES = 5;

/**
 * Execute database backup
 */
async function executeBackup(): Promise<void> {
  if (isRunning) {
    console.log('[Backup Cron] Previous backup still running, skipping...');
    return;
  }

  isRunning = true;
  const startTime = Date.now();

  try {
    console.log('[Backup Cron] Starting scheduled backup...');

    const result = await createBackup();

    console.log(`[Backup Cron] Backup completed:`);
    console.log(`  CID: ${result.cid}`);
    console.log(`  Size: ${(result.size / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  Swap Updated: ${result.swapUpdated}`);

    if (result.isFirstBackup) {
      console.log(`[Backup Cron] IMPORTANT: First backup created!`);
      console.log(`  Add this CID as BACKUP_REFERENCE_CID to GitHub secrets:`);
      console.log(`  ${result.cid}`);
    }

    consecutiveFailures = 0;
    console.log(`[Backup Cron] Completed in ${Date.now() - startTime}ms`);
  } catch (error) {
    consecutiveFailures++;
    const errorMessage = error instanceof Error ? error.message : String(error);

    console.error(`[Backup Cron] Error (failure ${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}):`, errorMessage);

    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      console.error('[Backup Cron] Max consecutive failures reached. Consider manual intervention.');
    }
  } finally {
    isRunning = false;
  }
}

/**
 * Start the backup cron job
 */
export function startBackupCron(): void {
  // Check if backup is enabled
  if (!config.backup.enabled) {
    console.log('[Backup Cron] Disabled via BACKUP_ENABLED=false');
    return;
  }

  // Check if backup is properly configured
  if (!isBackupConfigured()) {
    console.log('[Backup Cron] Not configured (PINATA_JWT and DATABASE_URL required), skipping');
    return;
  }

  const schedule = config.backup.cronSchedule || DEFAULT_SCHEDULE;

  console.log(`[Backup Cron] Starting with schedule: ${schedule}`);
  console.log(`[Backup Cron] Reference CID: ${config.backup.referenceCid || 'NOT SET (first backup will create)'}`);

  cron.schedule(schedule, executeBackup, {
    timezone: 'UTC',
    scheduled: true,
  });

  // Optional: Run backup on startup
  if (config.backup.backupOnStartup) {
    console.log('[Backup Cron] Running backup on startup...');
    // Delay to allow database connection to stabilize
    setTimeout(() => {
      executeBackup().catch((err) => {
        console.error('[Backup Cron] Startup backup failed:', err);
      });
    }, 10000); // 10 second delay
  }

  console.log('[Backup Cron] Database backup scheduled (daily at 02:00 UTC)');
}

// Export for manual triggering (useful for testing)
export { executeBackup };
