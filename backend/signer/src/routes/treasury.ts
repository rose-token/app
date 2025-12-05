import { Router, Request, Response } from 'express';
import navService from '../services/nav';

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

export default router;
