import { Router, Request, Response } from 'express';
import navService from '../services/nav';
import {
  getVaultStatus,
  checkRebalanceNeeded,
  getLastRebalanceInfo,
  executeRebalance,
} from '../services/treasury';

const router = Router();

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
 * Manually trigger a rebalance (admin only in production)
 * Note: In production, this should be protected by auth
 */
router.post('/rebalance/run', async (req: Request, res: Response) => {
  try {
    console.log('[Treasury API] Manual rebalance triggered');
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
