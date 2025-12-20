/**
 * Camelot LP Fee Collection Routes
 *
 * Owner-only endpoints for managing LP fee collection.
 * Uses signature verification via adminAuth middleware for mutations.
 */

import { Router, Request, Response } from 'express';
import { ethers } from 'ethers';
import { config } from '../config';
import {
  getAllPositions,
  collectAllFees,
  collectFees,
  getPositionInfo,
  isCamelotLPConfigured,
} from '../services/camelotLP';
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
      return { isOwner: false, error: 'Only contract owner can access Camelot LP operations' };
    }

    return { isOwner: true };
  } catch (error) {
    console.error('[CamelotLP API] Owner verification error:', error);
    return { isOwner: false, error: 'Failed to verify owner' };
  }
}

/**
 * GET /api/camelot-lp/status
 * Get configuration and position status
 *
 * Query: { callerAddress: string }
 * Response: { enabled, positionManager, treasury, cronSchedule, positions }
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

    const positions = await getAllPositions();

    return res.json({
      enabled: config.camelotLP.enabled,
      isConfigured: isCamelotLPConfigured(),
      positionManager: config.camelotLP.positionManager,
      treasury: config.contracts.treasury,
      cronSchedule: config.camelotLP.cronSchedule,
      positionCount: config.camelotLP.positionIds.length,
      positions,
    });
  } catch (error) {
    console.error('[CamelotLP API] Error fetching status:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: 'Failed to fetch status', message });
  }
});

/**
 * GET /api/camelot-lp/position/:tokenId
 * Get info for a specific position
 *
 * Query: { callerAddress: string }
 * Response: { tokenId, owner, token0, token1, liquidity, pendingFees0, pendingFees1, ... }
 */
router.get('/position/:tokenId', async (req: Request, res: Response) => {
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

    const info = await getPositionInfo(req.params.tokenId);
    return res.json(info);
  } catch (error) {
    console.error('[CamelotLP API] Error fetching position:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: 'Failed to fetch position', message });
  }
});

/**
 * POST /api/camelot-lp/collect
 * Collect fees from all configured positions
 *
 * Body: { callerAddress: string, timestamp: number, signature: string }
 * Response: { success, collected, skipped, errors, timestamp }
 */
router.post('/collect', createAdminAuth('camelot-collect'), async (req: Request, res: Response) => {
  try {
    if (!isCamelotLPConfigured()) {
      return res.status(500).json({
        error: 'Camelot LP not configured',
        details: 'CAMELOT_LP_POSITION_IDS, TREASURY_ADDRESS, and SIGNER_PRIVATE_KEY are required',
      });
    }

    console.log('[CamelotLP API] Manual collection triggered by owner:', req.verifiedOwner);
    const result = await collectAllFees();

    return res.json(result);
  } catch (error) {
    console.error('[CamelotLP API] Error collecting fees:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: 'Failed to collect fees', message });
  }
});

/**
 * POST /api/camelot-lp/collect/:tokenId
 * Collect fees from a specific position
 *
 * Body: { callerAddress: string, timestamp: number, signature: string }
 * Response: { tokenId, amount0, amount1, txHash, recipient, ... }
 */
router.post('/collect/:tokenId', createAdminAuth('camelot-collect'), async (req: Request, res: Response) => {
  try {
    if (!config.contracts.treasury) {
      return res.status(500).json({
        error: 'Treasury not configured',
        details: 'TREASURY_ADDRESS is required',
      });
    }

    console.log(
      '[CamelotLP API] Manual collection for position',
      req.params.tokenId,
      'triggered by owner:',
      req.verifiedOwner
    );
    const result = await collectFees(req.params.tokenId);

    return res.json(result);
  } catch (error) {
    console.error('[CamelotLP API] Error collecting fees:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: 'Failed to collect fees', message });
  }
});

export default router;
