/**
 * Database Routes
 *
 * Admin-only endpoints for database management operations.
 * Uses signature verification via adminAuth middleware.
 */

import { Router, Request, Response } from 'express';
import { ethers } from 'ethers';
import { config } from '../config';
import { truncateAllTables, getTruncatableTables } from '../services/database';
import { createBackup, isBackupConfigured } from '../services/backup';
import { getWsProvider } from '../utils/wsProvider';
import { createAdminAuth } from '../middleware/adminAuth';

const router = Router();

/**
 * Verify caller is Treasury contract owner (for GET endpoints only)
 */
async function verifyOwner(callerAddress: string): Promise<{ isOwner: boolean; error?: string }> {
  try {
    const provider = getWsProvider();

    const treasuryAddress = config.contracts?.treasury || process.env.TREASURY_ADDRESS;
    if (!treasuryAddress) {
      return { isOwner: false, error: 'TREASURY_ADDRESS not configured' };
    }

    const treasury = new ethers.Contract(
      treasuryAddress,
      ['function owner() view returns (address)'],
      provider
    );

    const ownerAddress = await treasury.owner();

    if (callerAddress.toLowerCase() !== ownerAddress.toLowerCase()) {
      return { isOwner: false, error: 'Only contract owner can access database operations' };
    }

    return { isOwner: true };
  } catch (error) {
    console.error('[Database API] Owner verification error:', error);
    return { isOwner: false, error: 'Failed to verify owner' };
  }
}

/**
 * GET /api/database/tables
 * Get list of tables that would be truncated
 *
 * Query: { callerAddress: string }
 * Response: { tables: string[], count: number }
 */
router.get('/tables', async (req: Request, res: Response) => {
  try {
    const callerAddress = req.query.callerAddress as string;

    if (!callerAddress) {
      return res.status(400).json({ error: 'Missing required query param: callerAddress' });
    }

    // Verify owner
    const { isOwner, error } = await verifyOwner(callerAddress);
    if (!isOwner) {
      return res.status(403).json({ error: error || 'Unauthorized' });
    }

    const tables = await getTruncatableTables();

    return res.json({ tables, count: tables.length });
  } catch (error) {
    console.error('[Database API] Error fetching tables:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: 'Failed to fetch tables', message });
  }
});

/**
 * POST /api/database/truncate
 * Truncate all tables in the database (with automatic backup)
 *
 * DANGER: This is a destructive operation!
 * - Creates a backup before truncating (mandatory)
 * - Requires explicit `confirmed: true` in request body
 * - Excludes schema_migrations table
 *
 * Body: { callerAddress: string, timestamp: number, signature: string, confirmed: boolean }
 * Response: { success, backup: { cid, size }, truncated: { tables, count } }
 */
router.post('/truncate', createAdminAuth('database-truncate'), async (req: Request, res: Response) => {
  try {
    const { confirmed } = req.body;

    // Require explicit confirmation
    if (confirmed !== true) {
      return res.status(400).json({
        error: 'Truncate requires confirmation',
        warning:
          'This operation will DELETE ALL DATA from the database (except migrations). Set confirmed: true to proceed.',
      });
    }

    // Check if backup is configured (mandatory)
    if (!isBackupConfigured()) {
      return res.status(500).json({
        error: 'Backup not configured',
        details:
          'PINATA_JWT and DATABASE_URL are required. Truncation requires backup to be configured.',
      });
    }

    console.log('[Database API] Truncate triggered by owner:', req.verifiedOwner);

    // Step 1: Create backup first (mandatory)
    console.log('[Database API] Creating backup before truncation...');
    let backupResult;
    try {
      backupResult = await createBackup();
      console.log('[Database API] Backup created:', backupResult.cid);
    } catch (backupError) {
      console.error('[Database API] Backup failed, aborting truncation:', backupError);
      const message = backupError instanceof Error ? backupError.message : 'Unknown backup error';
      return res.status(500).json({
        error: 'Backup failed - truncation aborted',
        message,
        warning: 'Database was NOT truncated because backup failed.',
      });
    }

    // Step 2: Truncate all tables
    console.log('[Database API] Proceeding with truncation...');
    const truncateResult = await truncateAllTables();

    console.log(
      `[Database API] Truncation complete. Backup CID: ${backupResult.cid}, Tables truncated: ${truncateResult.count}`
    );

    return res.json({
      success: true,
      backup: {
        cid: backupResult.cid,
        size: backupResult.size,
        timestamp: backupResult.timestamp,
      },
      truncated: {
        tables: truncateResult.tables,
        count: truncateResult.count,
      },
    });
  } catch (error) {
    console.error('[Database API] Error truncating database:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: 'Failed to truncate database', message });
  }
});

export default router;
