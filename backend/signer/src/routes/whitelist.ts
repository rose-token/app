import { Router, Request, Response } from 'express';
import { ethers } from 'ethers';
import { config } from '../config';
import {
  getAllWhitelist,
  getWhitelistedScore,
  addToWhitelist,
  removeFromWhitelist,
} from '../services/whitelist';

const router = Router();

/**
 * Verify that the caller address matches the Treasury contract owner.
 * Reuses the same authorization pattern as /api/treasury/rebalance/trigger.
 *
 * @param callerAddress - The address claiming to be admin
 * @returns true if caller is Treasury owner, false otherwise
 */
async function verifyOwner(callerAddress: string): Promise<boolean> {
  try {
    const provider = new ethers.JsonRpcProvider(
      config.rpc.url || process.env.ARBITRUM_SEPOLIA_RPC_URL
    );

    const treasuryAddress = config.contracts?.treasury || process.env.TREASURY_ADDRESS;
    if (!treasuryAddress) {
      console.error('[Whitelist API] TREASURY_ADDRESS not configured');
      return false;
    }

    const treasury = new ethers.Contract(
      treasuryAddress,
      ['function owner() view returns (address)'],
      provider
    );

    const ownerAddress = await treasury.owner();
    return callerAddress.toLowerCase() === ownerAddress.toLowerCase();
  } catch (error) {
    console.error('[Whitelist API] Error verifying owner:', error);
    return false;
  }
}

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
 * Owner-only endpoint - requires callerAddress to match Treasury.owner().
 *
 * Body: { callerAddress: string, address: string, score: number }
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { callerAddress, address, score } = req.body;

    // Validate required fields
    if (!callerAddress) {
      return res.status(400).json({ error: 'Missing required field: callerAddress' });
    }
    if (!address) {
      return res.status(400).json({ error: 'Missing required field: address' });
    }
    if (score === undefined || score === null) {
      return res.status(400).json({ error: 'Missing required field: score' });
    }

    // Validate address format
    if (!isValidAddress(callerAddress)) {
      return res.status(400).json({ error: 'Invalid callerAddress format' });
    }
    if (!isValidAddress(address)) {
      return res.status(400).json({ error: 'Invalid address format' });
    }

    // Validate score is a number in valid range
    const scoreNum = Number(score);
    if (isNaN(scoreNum) || scoreNum < 0 || scoreNum > 100) {
      return res.status(400).json({ error: 'Score must be a number between 0 and 100' });
    }

    // Verify caller is Treasury owner
    const isOwner = await verifyOwner(callerAddress);
    if (!isOwner) {
      console.log('[Whitelist API] Unauthorized add attempt:', { caller: callerAddress });
      return res.status(403).json({
        error: 'Unauthorized: Only contract owner can modify whitelist',
      });
    }

    // Add to whitelist
    addToWhitelist(address, scoreNum);

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
 * Owner-only endpoint - requires callerAddress query param to match Treasury.owner().
 *
 * Query: ?callerAddress=0x...
 */
router.delete('/:address', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;
    const { callerAddress } = req.query;

    // Validate required fields
    if (!callerAddress || typeof callerAddress !== 'string') {
      return res.status(400).json({ error: 'Missing required query param: callerAddress' });
    }

    // Validate address formats
    if (!isValidAddress(callerAddress)) {
      return res.status(400).json({ error: 'Invalid callerAddress format' });
    }
    if (!isValidAddress(address)) {
      return res.status(400).json({ error: 'Invalid address format' });
    }

    // Check if address exists
    const existingScore = getWhitelistedScore(address);
    if (existingScore === null) {
      return res.status(404).json({ error: 'Address not found in whitelist' });
    }

    // Verify caller is Treasury owner
    const isOwner = await verifyOwner(callerAddress);
    if (!isOwner) {
      console.log('[Whitelist API] Unauthorized remove attempt:', { caller: callerAddress });
      return res.status(403).json({
        error: 'Unauthorized: Only contract owner can modify whitelist',
      });
    }

    // Remove from whitelist
    removeFromWhitelist(address);

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
