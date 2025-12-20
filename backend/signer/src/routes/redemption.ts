import { Router, Request, Response } from 'express';
import { ethers } from 'ethers';
import { config } from '../config';
import {
  getRedemptionWatcherStats,
  forceProcessPending,
  getPendingRedemptions,
} from '../services/redemptionWatcher';
import { getWsProvider } from '../utils/wsProvider';
import { RoseTreasuryABI } from '../utils/contracts';
import { createSignerAuth } from '../middleware/signerAuth';

const router = Router();

function getProvider(): ethers.Provider {
  return getWsProvider();
}

function getTreasuryContract(): ethers.Contract {
  if (!config.contracts.treasury) {
    throw new Error('TREASURY_ADDRESS not configured');
  }
  return new ethers.Contract(config.contracts.treasury, RoseTreasuryABI, getProvider());
}

/**
 * GET /api/treasury/redeem-check
 * Check if a redemption amount can be fulfilled instantly
 * Query params:
 *   - amount: ROSE amount (in wei or formatted string)
 */
router.get('/redeem-check', async (req: Request, res: Response) => {
  try {
    const amountStr = req.query.amount as string;
    if (!amountStr) {
      return res.status(400).json({ error: 'Missing required parameter: amount' });
    }

    // Parse amount - accept both wei and formatted strings
    let roseAmount: bigint;
    try {
      if (amountStr.includes('.') || !amountStr.match(/^\d+$/)) {
        // Formatted string like "100.5"
        roseAmount = ethers.parseUnits(amountStr, 18);
      } else {
        // Wei string like "100000000000000000000"
        roseAmount = BigInt(amountStr);
      }
    } catch {
      return res.status(400).json({ error: 'Invalid amount format' });
    }

    const treasury = getTreasuryContract();
    const [ready, usdcAvailable, usdcNeeded] = await treasury.canRedeemInstantly(roseAmount);

    return res.json({
      canRedeemInstantly: ready,
      usdcAvailable: ethers.formatUnits(usdcAvailable, 6),
      usdcNeeded: ethers.formatUnits(usdcNeeded, 6),
      roseAmount: ethers.formatUnits(roseAmount, 18),
      shortfall: ready ? '0' : ethers.formatUnits(usdcNeeded - usdcAvailable, 6),
    });
  } catch (error) {
    console.error('[Redemption API] Error checking redeem availability:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: 'Failed to check redemption availability', message });
  }
});

/**
 * GET /api/treasury/redemption/:id
 * Get status of a specific redemption request
 */
router.get('/redemption/:id', async (req: Request, res: Response) => {
  try {
    const requestId = req.params.id;
    if (!requestId || !requestId.match(/^\d+$/)) {
      return res.status(400).json({ error: 'Invalid request ID' });
    }

    const treasury = getTreasuryContract();
    const [user, roseAmount, usdcOwed, requestedAt, fulfilled] = await treasury.getRedemptionRequest(
      BigInt(requestId)
    );

    // Check if request exists (user will be zero address if not)
    if (user === ethers.ZeroAddress) {
      return res.status(404).json({ error: 'Redemption request not found' });
    }

    return res.json({
      requestId,
      user,
      roseAmount: ethers.formatUnits(roseAmount, 18),
      usdcOwed: ethers.formatUnits(usdcOwed, 6),
      requestedAt: Number(requestedAt),
      requestedAtDate: new Date(Number(requestedAt) * 1000).toISOString(),
      fulfilled,
      status: fulfilled ? 'fulfilled' : 'pending',
    });
  } catch (error) {
    console.error('[Redemption API] Error fetching redemption request:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: 'Failed to fetch redemption request', message });
  }
});

/**
 * GET /api/treasury/user-pending/:address
 * Get pending redemption ID for a user
 */
router.get('/user-pending/:address', async (req: Request, res: Response) => {
  try {
    const address = req.params.address;
    if (!ethers.isAddress(address)) {
      return res.status(400).json({ error: 'Invalid address format' });
    }

    const treasury = getTreasuryContract();
    const pendingId = await treasury.getUserPendingRedemption(address);

    // 0 means no pending redemption
    if (pendingId === 0n) {
      return res.json({
        hasPendingRedemption: false,
        pendingRedemptionId: null,
      });
    }

    // Fetch the full request details
    const [user, roseAmount, usdcOwed, requestedAt, fulfilled] = await treasury.getRedemptionRequest(
      pendingId
    );

    return res.json({
      hasPendingRedemption: !fulfilled,
      pendingRedemptionId: pendingId.toString(),
      request: {
        user,
        roseAmount: ethers.formatUnits(roseAmount, 18),
        usdcOwed: ethers.formatUnits(usdcOwed, 6),
        requestedAt: Number(requestedAt),
        requestedAtDate: new Date(Number(requestedAt) * 1000).toISOString(),
        fulfilled,
      },
    });
  } catch (error) {
    console.error('[Redemption API] Error fetching user pending redemption:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: 'Failed to fetch user pending redemption', message });
  }
});

/**
 * GET /api/treasury/pending-redemptions
 * Get all pending redemptions from the watcher queue (admin view)
 */
router.get('/pending-redemptions', async (req: Request, res: Response) => {
  try {
    const pending = getPendingRedemptions();

    // Also get total pending from contract
    const treasury = getTreasuryContract();
    const totalPendingUsdcOwed = await treasury.totalPendingUsdcOwed();

    return res.json({
      count: pending.length,
      totalPendingUsdcOwed: ethers.formatUnits(totalPendingUsdcOwed, 6),
      requests: pending.map((r) => ({
        requestId: r.requestId.toString(),
        user: r.user,
        roseAmount: ethers.formatUnits(r.roseAmount, 18),
        usdcOwed: ethers.formatUnits(r.usdcOwed, 6),
        requestedAt: r.requestedAt,
        block: r.block,
      })),
    });
  } catch (error) {
    console.error('[Redemption API] Error fetching pending redemptions:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: 'Failed to fetch pending redemptions', message });
  }
});

/**
 * GET /api/treasury/redemption-watcher/stats
 * Get redemption watcher statistics
 */
router.get('/redemption-watcher/stats', async (req: Request, res: Response) => {
  try {
    const stats = getRedemptionWatcherStats();

    return res.json({
      isRunning: stats.isRunning,
      startedAt: stats.startedAt?.toISOString() ?? null,
      redemptionsQueued: stats.redemptionsQueued,
      redemptionsFulfilled: stats.redemptionsFulfilled,
      fulfillmentsFailed: stats.fulfillmentsFailed,
      totalUsdcOwed: stats.totalUsdcOwed,
      pendingRedemptions: stats.pendingRedemptions,
      lastError: stats.lastError,
      lastEventBlock: stats.lastEventBlock,
    });
  } catch (error) {
    console.error('[Redemption API] Error fetching watcher stats:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: 'Failed to fetch watcher stats', message });
  }
});

/**
 * POST /api/treasury/redemption-watcher/process
 * Force process all pending redemptions (admin)
 *
 * Requires signer authentication.
 */
router.post('/redemption-watcher/process', createSignerAuth('redemption-watcher-process'), async (req: Request, res: Response) => {
  try {
    console.log('[Redemption API] Manual processing triggered');

    const beforeStats = getRedemptionWatcherStats();
    await forceProcessPending();
    const afterStats = getRedemptionWatcherStats();

    return res.json({
      success: true,
      processed: beforeStats.pendingRedemptions - afterStats.pendingRedemptions,
      remainingPending: afterStats.pendingRedemptions,
      fulfilled: afterStats.redemptionsFulfilled - beforeStats.redemptionsFulfilled,
      lastError: afterStats.lastError,
    });
  } catch (error) {
    console.error('[Redemption API] Error processing redemptions:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: 'Failed to process redemptions', message });
  }
});

export default router;
