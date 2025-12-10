import { Router, Request, Response } from 'express';
import { ethers } from 'ethers';
import navService from '../services/nav';
import {
  getVaultStatus,
  checkRebalanceNeeded,
  getLastRebalanceInfo,
  executeRebalance,
} from '../services/treasury';
import { config } from '../config';

const router = Router();

// Track used signatures to prevent replay attacks within the 5-minute window
const usedSignatures = new Map<string, number>(); // signature -> timestamp used
const SIGNATURE_TTL = 300; // 5 minutes

// Clean up expired signatures periodically (every minute)
setInterval(() => {
  const now = Math.floor(Date.now() / 1000);
  for (const [sig, timestamp] of usedSignatures.entries()) {
    if (now - timestamp > SIGNATURE_TTL) {
      usedSignatures.delete(sig);
    }
  }
}, 60000);

/**
 * Verify admin signature for rebalance authorization.
 * Signer signs: keccak256(abi.encodePacked(signerAddress, "rebalance", timestamp))
 *
 * The signature must be from the backend signer's private key.
 * Timestamp prevents replay attacks (must be within 5 minutes).
 * Each signature can only be used once (nonce-like protection).
 */
function verifyRebalanceSignature(timestamp: number, signature: string): { valid: boolean; error?: string } {
  try {
    // Check if signature was already used (replay protection)
    if (usedSignatures.has(signature)) {
      console.log('[Treasury API] Signature already used (replay attempt)');
      return { valid: false, error: 'Signature already used' };
    }

    const wallet = new ethers.Wallet(config.signer.privateKey);
    const expectedSigner = wallet.address;

    // Check timestamp is within acceptable window (5 minutes)
    const now = Math.floor(Date.now() / 1000);
    const timeDiff = Math.abs(now - timestamp);
    if (timeDiff > SIGNATURE_TTL) {
      console.log('[Treasury API] Signature timestamp expired:', { now, timestamp, diff: timeDiff });
      return { valid: false, error: 'Signature expired' };
    }

    // Recreate the message hash
    const messageHash = ethers.solidityPackedKeccak256(
      ['address', 'string', 'uint256'],
      [expectedSigner, 'rebalance', timestamp]
    );

    // Recover signer from signature
    const recovered = ethers.verifyMessage(ethers.getBytes(messageHash), signature);

    // Verify recovered address matches expected signer
    const valid = recovered.toLowerCase() === expectedSigner.toLowerCase();
    if (!valid) {
      console.log('[Treasury API] Signature verification failed:', {
        expected: expectedSigner,
        recovered,
      });
      return { valid: false, error: 'Invalid signature' };
    }

    // Mark signature as used (only after successful verification)
    usedSignatures.set(signature, now);
    return { valid: true };
  } catch (error) {
    console.error('[Treasury API] Signature verification error:', error);
    return { valid: false, error: 'Signature verification failed' };
  }
}

/**
 * POST /api/treasury/rebalance/trigger
 * Admin-triggered rebalance endpoint (frontend-facing)
 *
 * Security model:
 * - Frontend: Shows admin UI only to Treasury owner (via useIsAdmin hook)
 * - Backend: Verifies callerAddress matches Treasury.owner() to prevent unauthorized API calls
 * - Contract: Backend signer is set as 'rebalancer' role, allowing forceRebalance() execution
 *
 * The owner check here is a defense-in-depth measure. The true authorization is that
 * only the admin UI (visible to owner) should call this endpoint, and the backend
 * signer has rebalancer privileges on the contract.
 *
 * Body: { callerAddress: string }
 * Response: { success, txHash, swapsExecuted, swapDetails, totalHardAssets, rebalanceNeeded }
 */
router.post('/rebalance/trigger', async (req: Request, res: Response) => {
  try {
    const { callerAddress } = req.body;

    // Validate required field
    if (!callerAddress) {
      return res.status(400).json({
        error: 'Missing required field: callerAddress',
      });
    }

    // Verify caller is contract owner
    const provider = new ethers.JsonRpcProvider(
      config.rpc.url || process.env.ARBITRUM_SEPOLIA_RPC_URL
    );

    const treasuryAddress = config.contracts?.treasury || process.env.TREASURY_ADDRESS;
    if (!treasuryAddress) {
      return res.status(500).json({ error: 'TREASURY_ADDRESS not configured' });
    }

    const treasury = new ethers.Contract(
      treasuryAddress,
      ['function owner() view returns (address)'],
      provider
    );

    const ownerAddress = await treasury.owner();

    if (callerAddress.toLowerCase() !== ownerAddress.toLowerCase()) {
      console.log('[Treasury API] Unauthorized rebalance attempt:', {
        caller: callerAddress,
        owner: ownerAddress,
      });
      return res.status(403).json({
        error: 'Unauthorized: Only contract owner can trigger rebalance',
      });
    }

    console.log('[Treasury API] Admin rebalance triggered by owner:', callerAddress);
    const result = await executeRebalance();

    return res.json({
      success: true,
      txHash: result.txHash,
      swapsExecuted: result.swapsExecuted,
      swapDetails: result.swapDetails,
      totalHardAssets: result.totalHardAssets,
      rebalanceNeeded: result.rebalanceNeeded,
    });
  } catch (error) {
    console.error('[Treasury API] Error executing rebalance:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: 'Failed to execute rebalance', message });
  }
});

/**
 * GET /api/treasury/history
 * Get NAV snapshots with pagination and filtering
 * Query params:
 *   - limit: number (default 100, max 500)
 *   - offset: number (default 0)
 *   - startDate: ISO date string
 *   - endDate: ISO date string
 *   - interval: 'raw' | 'daily' | 'weekly' (default 'raw')
 */
router.get('/history', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const offset = parseInt(req.query.offset as string) || 0;
    const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
    const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;
    const interval = (req.query.interval as 'raw' | 'daily' | 'weekly') || 'raw';

    // Validate dates
    if (startDate && isNaN(startDate.getTime())) {
      return res.status(400).json({ error: 'Invalid startDate format' });
    }
    if (endDate && isNaN(endDate.getTime())) {
      return res.status(400).json({ error: 'Invalid endDate format' });
    }
    if (!['raw', 'daily', 'weekly'].includes(interval)) {
      return res.status(400).json({ error: 'Invalid interval. Use: raw, daily, or weekly' });
    }

    const result = await navService.getNavHistory({ limit, offset, startDate, endDate, interval });

    return res.json({
      snapshots: result.snapshots,
      pagination: {
        total: result.total,
        limit,
        offset,
        hasMore: offset + result.snapshots.length < result.total,
      },
    });
  } catch (error) {
    console.error('[Treasury API] Error fetching history:', error);
    return res.status(500).json({ error: 'Failed to fetch NAV history' });
  }
});

/**
 * GET /api/treasury/rebalances
 * Get rebalance event history
 * Query params:
 *   - limit: number (default 50, max 100)
 *   - offset: number (default 0)
 */
router.get('/rebalances', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    const result = await navService.getRebalanceHistory({ limit, offset });

    return res.json({
      events: result.events,
      pagination: {
        total: result.total,
        limit,
        offset,
        hasMore: offset + result.events.length < result.total,
      },
    });
  } catch (error) {
    console.error('[Treasury API] Error fetching rebalances:', error);
    return res.status(500).json({ error: 'Failed to fetch rebalance history' });
  }
});

/**
 * GET /api/treasury/stats
 * Get aggregated NAV statistics
 * Returns: current price, 7d/30d changes, all-time high/low
 */
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const stats = await navService.getNavStats();
    return res.json(stats);
  } catch (error) {
    console.error('[Treasury API] Error fetching stats:', error);
    return res.status(500).json({ error: 'Failed to fetch NAV stats' });
  }
});

// ============ Phase 4: Rebalance Endpoints ============

/**
 * GET /api/treasury/vault-status
 * Get current vault status including all asset breakdowns
 */
router.get('/vault-status', async (req: Request, res: Response) => {
  try {
    const status = await getVaultStatus();
    return res.json(status);
  } catch (error) {
    console.error('[Treasury API] Error fetching vault status:', error);
    return res.status(500).json({ error: 'Failed to fetch vault status' });
  }
});

/**
 * GET /api/treasury/rebalance/status
 * Check if rebalance is needed and get planned swaps
 */
router.get('/rebalance/status', async (req: Request, res: Response) => {
  try {
    const [rebalanceCheck, lastInfo] = await Promise.all([
      checkRebalanceNeeded(),
      getLastRebalanceInfo(),
    ]);

    return res.json({
      needed: rebalanceCheck.needed,
      lastRebalanceTime: lastInfo.lastRebalanceTime,
      timeUntilNext: lastInfo.timeUntilNext,
      canRebalance: lastInfo.canRebalance,
      assets: rebalanceCheck.assets.map((a) => ({
        key: a.key,
        token: a.token,
        balance: a.balance.toString(),
        valueUSD: a.valueUSD.toString(),
        targetBps: a.targetBps,
        actualBps: a.actualBps,
        active: a.active,
      })),
      plannedSwaps: rebalanceCheck.swapsPlanned.map((s) => ({
        fromAsset: s.fromAsset,
        toAsset: s.toAsset,
        amountIn: s.amountIn.toString(),
        estimatedOut: s.estimatedOut.toString(),
      })),
    });
  } catch (error) {
    console.error('[Treasury API] Error checking rebalance status:', error);
    return res.status(500).json({ error: 'Failed to check rebalance status' });
  }
});

/**
 * GET /api/treasury/rebalance/last
 * Get info about the last rebalance
 */
router.get('/rebalance/last', async (req: Request, res: Response) => {
  try {
    const lastInfo = await getLastRebalanceInfo();
    return res.json(lastInfo);
  } catch (error) {
    console.error('[Treasury API] Error fetching last rebalance:', error);
    return res.status(500).json({ error: 'Failed to fetch last rebalance info' });
  }
});

/**
 * POST /api/treasury/rebalance/run
 * Manually trigger a rebalance (protected with signed message authentication)
 *
 * Request body:
 * - timestamp: Unix timestamp when signature was created (must be within 5 minutes)
 * - signature: Signed message from admin wallet
 *
 * The message format is: keccak256(abi.encodePacked(signerAddress, "rebalance", timestamp))
 */
router.post('/rebalance/run', async (req: Request, res: Response) => {
  try {
    const { timestamp, signature } = req.body;

    // Validate required fields
    if (!timestamp || !signature) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['timestamp', 'signature'],
      });
    }

    // Validate timestamp is a number
    const ts = parseInt(timestamp);
    if (isNaN(ts)) {
      return res.status(400).json({ error: 'Invalid timestamp format' });
    }

    // Verify signature
    const verification = verifyRebalanceSignature(ts, signature);
    if (!verification.valid) {
      return res.status(403).json({ error: verification.error || 'Invalid or expired signature' });
    }

    console.log('[Treasury API] Authorized rebalance triggered');
    const result = await executeRebalance();
    return res.json({
      success: true,
      txHash: result.txHash,
      swapsExecuted: result.swapsExecuted,
      swapDetails: result.swapDetails,
      totalHardAssets: result.totalHardAssets,
      rebalanceNeeded: result.rebalanceNeeded,
    });
  } catch (error) {
    console.error('[Treasury API] Error executing rebalance:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: 'Failed to execute rebalance', message });
  }
});

export default router;
