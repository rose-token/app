/**
 * Backup Routes
 *
 * Admin-only endpoints for database backup and restore.
 * Uses signature verification via adminAuth middleware.
 */

import { Router, Request, Response } from 'express';
import { ethers } from 'ethers';
import { config } from '../config';
import {
  createBackup,
  restoreBackup,
  getBackupStatus,
  isBackupConfigured,
} from '../services/backup';
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
      return { isOwner: false, error: 'Only contract owner can access backup operations' };
    }

    return { isOwner: true };
  } catch (error) {
    console.error('[Backup API] Owner verification error:', error);
    return { isOwner: false, error: 'Failed to verify owner' };
  }
}

/**
 * POST /api/backup/create
 * Trigger a manual database backup
 *
 * Body: { callerAddress: string, timestamp: number, signature: string }
 * Response: { success, cid, size, timestamp, swapUpdated, isFirstBackup }
 */
router.post('/create', createAdminAuth('backup-create'), async (req: Request, res: Response) => {
  try {
    if (!isBackupConfigured()) {
      return res.status(500).json({
        error: 'Backup not configured',
        details: 'PINATA_JWT and DATABASE_URL are required',
      });
    }

    console.log('[Backup API] Manual backup triggered by owner:', req.verifiedOwner);
    const result = await createBackup();

    return res.json(result);
  } catch (error) {
    console.error('[Backup API] Error creating backup:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: 'Failed to create backup', message });
  }
});

/**
 * GET /api/backup/status
 * Get backup system status and last backup info
 *
 * Query: { callerAddress: string }
 * Response: { referenceCid, isConfigured, lastSwap }
 */
router.get('/status', async (req: Request, res: Response) => {
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

    const status = await getBackupStatus();

    return res.json(status);
  } catch (error) {
    console.error('[Backup API] Error fetching status:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: 'Failed to fetch backup status', message });
  }
});

/**
 * POST /api/backup/restore
 * Restore database from a backup
 *
 * DANGER: This overwrites the entire database!
 * Requires explicit `confirmed: true` in request body.
 *
 * Body: { callerAddress: string, timestamp: number, signature: string, cid?: string, confirmed: boolean }
 * Response: { success, message, cid }
 */
router.post('/restore', createAdminAuth('backup-restore'), async (req: Request, res: Response) => {
  try {
    const { cid, confirmed } = req.body;

    // Require explicit confirmation
    if (confirmed !== true) {
      return res.status(400).json({
        error: 'Restore requires confirmation',
        warning: 'This operation will OVERWRITE the entire database. Set confirmed: true to proceed.',
      });
    }

    if (!isBackupConfigured()) {
      return res.status(500).json({
        error: 'Backup not configured',
        details: 'PINATA_JWT and DATABASE_URL are required',
      });
    }

    console.log('[Backup API] Database restore triggered by owner:', req.verifiedOwner, 'CID:', cid || 'reference');
    const result = await restoreBackup(cid, true);

    return res.json(result);
  } catch (error) {
    console.error('[Backup API] Error restoring backup:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: 'Failed to restore backup', message });
  }
});

export default router;
