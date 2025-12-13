/**
 * Analytics Routes
 *
 * REST API endpoints for the analytics dashboard.
 * Read-only endpoints - data populated by analyticsWatcher.
 */

import { Router, Request, Response } from 'express';
import {
  getOverviewStats,
  getMarketplaceStats,
  getGovernanceStats,
  getTreasuryStats,
  getUserStats,
  getDailyData,
} from '../services/analytics';

const router = Router();

/**
 * GET /api/analytics/overview
 * Dashboard summary cards - all key metrics at a glance
 */
router.get('/overview', async (_req: Request, res: Response) => {
  try {
    const stats = await getOverviewStats();
    return res.json(stats);
  } catch (error) {
    console.error('[Analytics] Overview error:', error);
    return res.status(500).json({
      error: 'Failed to fetch overview statistics',
    });
  }
});

/**
 * GET /api/analytics/marketplace
 * Detailed marketplace statistics - tasks, customers, workers
 */
router.get('/marketplace', async (_req: Request, res: Response) => {
  try {
    const stats = await getMarketplaceStats();
    return res.json(stats);
  } catch (error) {
    console.error('[Analytics] Marketplace error:', error);
    return res.status(500).json({
      error: 'Failed to fetch marketplace statistics',
    });
  }
});

/**
 * GET /api/analytics/governance
 * Detailed governance statistics - proposals, voting, staking
 */
router.get('/governance', async (_req: Request, res: Response) => {
  try {
    const stats = await getGovernanceStats();
    return res.json(stats);
  } catch (error) {
    console.error('[Analytics] Governance error:', error);
    return res.status(500).json({
      error: 'Failed to fetch governance statistics',
    });
  }
});

/**
 * GET /api/analytics/treasury
 * Detailed treasury statistics - NAV, allocations, flows
 */
router.get('/treasury', async (_req: Request, res: Response) => {
  try {
    const stats = await getTreasuryStats();
    return res.json(stats);
  } catch (error) {
    console.error('[Analytics] Treasury error:', error);
    return res.status(500).json({
      error: 'Failed to fetch treasury statistics',
    });
  }
});

/**
 * GET /api/analytics/users
 * User activity statistics - counts, top users
 */
router.get('/users', async (_req: Request, res: Response) => {
  try {
    const stats = await getUserStats();
    return res.json(stats);
  } catch (error) {
    console.error('[Analytics] Users error:', error);
    return res.status(500).json({
      error: 'Failed to fetch user statistics',
    });
  }
});

/**
 * GET /api/analytics/daily?days=30
 * Time series data for charts
 * Query params: days (default 30, max 365)
 */
router.get('/daily', async (req: Request, res: Response) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days as string) || 30, 1), 365);
    const data = await getDailyData(days);
    return res.json(data);
  } catch (error) {
    console.error('[Analytics] Daily error:', error);
    return res.status(500).json({
      error: 'Failed to fetch daily statistics',
    });
  }
});

export default router;
