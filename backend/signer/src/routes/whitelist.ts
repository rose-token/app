import { Router, Request, Response } from 'express';
import { ethers } from 'ethers';
import {
  getAllWhitelist,
  getWhitelistedScore,
  addToWhitelist,
  removeFromWhitelist,
} from '../services/whitelist';
import { createAdminAuth } from '../middleware/adminAuth';

const router = Router();

/**
 * Validate Ethereum address format
 */
function isValidAddress(address: string): boolean {
  return ethers.isAddress(address);
}

/**
 * GET /api/whitelist
 * Get all whitelisted addresses and their scores.
 * Public endpoint - no authorization required.
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const whitelist = getAllWhitelist();
    return res.json(whitelist);
  } catch (error) {
    console.error('[Whitelist API] Error fetching whitelist:', error);
    return res.status(500).json({ error: 'Failed to fetch whitelist' });
  }
});

/**
 * GET /api/whitelist/:address
 * Get score for a specific address.
 * Public endpoint - no authorization required.
 */
router.get('/:address', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;

    if (!isValidAddress(address)) {
      return res.status(400).json({ error: 'Invalid address format' });
    }

    const score = getWhitelistedScore(address);
    if (score === null) {
      return res.status(404).json({ error: 'Address not found in whitelist' });
    }

    return res.json({ address: address.toLowerCase(), score });
  } catch (error) {
    console.error('[Whitelist API] Error fetching address:', error);
    return res.status(500).json({ error: 'Failed to fetch address' });
  }
});

/**
 * POST /api/whitelist
 * Add or update an address in the whitelist.
 * Owner-only endpoint - requires signature verification.
 *
 * Body: { callerAddress: string, timestamp: number, signature: string, address: string, score: number }
 */
router.post('/', createAdminAuth('whitelist-add'), async (req: Request, res: Response) => {
  try {
    const { address, score } = req.body;

    // Validate required fields
    if (!address) {
      return res.status(400).json({ error: 'Missing required field: address' });
    }
    if (score === undefined || score === null) {
      return res.status(400).json({ error: 'Missing required field: score' });
    }

    // Validate address format
    if (!isValidAddress(address)) {
      return res.status(400).json({ error: 'Invalid address format' });
    }

    // Validate score is a number in valid range
    const scoreNum = Number(score);
    if (isNaN(scoreNum) || scoreNum < 0 || scoreNum > 100) {
      return res.status(400).json({ error: 'Score must be a number between 0 and 100' });
    }

    // Add to whitelist
    addToWhitelist(address, scoreNum);

    console.log('[Whitelist API] Address added by owner:', req.verifiedOwner, 'address:', address);

    return res.json({
      success: true,
      address: address.toLowerCase(),
      score: scoreNum,
    });
  } catch (error) {
    console.error('[Whitelist API] Error adding address:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: 'Failed to add address', message });
  }
});

/**
 * DELETE /api/whitelist/:address
 * Remove an address from the whitelist.
 * Owner-only endpoint - requires signature verification.
 *
 * Body: { callerAddress: string, timestamp: number, signature: string }
 */
router.delete('/:address', createAdminAuth('whitelist-remove'), async (req: Request, res: Response) => {
  try {
    const { address } = req.params;

    // Validate address format
    if (!isValidAddress(address)) {
      return res.status(400).json({ error: 'Invalid address format' });
    }

    // Check if address exists
    const existingScore = getWhitelistedScore(address);
    if (existingScore === null) {
      return res.status(404).json({ error: 'Address not found in whitelist' });
    }

    // Remove from whitelist
    removeFromWhitelist(address);

    console.log('[Whitelist API] Address removed by owner:', req.verifiedOwner, 'address:', address);

    return res.json({
      success: true,
      address: address.toLowerCase(),
      removed: true,
    });
  } catch (error) {
    console.error('[Whitelist API] Error removing address:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: 'Failed to remove address', message });
  }
});

export default router;
