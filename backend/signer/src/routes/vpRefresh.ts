import { Router, Request, Response } from 'express';
import { ethers } from 'ethers';
import { config } from '../config';
import {
  getVPRefreshStats,
  checkAndRefreshUser,
  forceProcessPending,
  getPendingUsers,
} from '../services/vpRefresh';

const router = Router();

// Validate Ethereum address
function isValidAddress(address: string): boolean {
  return ethers.isAddress(address);
}

/**
 * GET /api/vp-refresh/stats
 * Get VP refresh watcher statistics
 */
router.get('/stats', (_req: Request, res: Response) => {
  const stats = getVPRefreshStats();

  return res.json({
    enabled: config.vpRefresh.enabled,
    executeOnChain: config.vpRefresh.executeOnChain,
    ...stats,
    config: {
      minVpDifference: config.vpRefresh.minVpDifference.toString(),
      debounceMs: config.vpRefresh.debounceMs,
      maxBatchSize: config.vpRefresh.maxBatchSize,
      startupBlockLookback: config.vpRefresh.startupBlockLookback,
    },
  });
});

/**
 * GET /api/vp-refresh/pending
 * Get list of users pending VP refresh check
 */
router.get('/pending', (_req: Request, res: Response) => {
  const pending = getPendingUsers();

  return res.json({
    count: pending.length,
    users: pending,
  });
});

/**
 * POST /api/vp-refresh/check/:address
 * Manually check and refresh VP for a specific user
 */
router.post('/check/:address', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;

    if (!isValidAddress(address)) {
      return res.status(400).json({ error: 'Invalid address' });
    }

    if (!config.contracts.governance) {
      return res.status(500).json({ error: 'Governance contract not configured' });
    }

    const result = await checkAndRefreshUser(address);

    if (!result) {
      return res.json({
        address,
        needsRefresh: false,
        message: 'User does not need VP refresh (below threshold or no stake)',
      });
    }

    return res.json({
      address,
      needsRefresh: true,
      result,
    });
  } catch (error) {
    console.error('VP refresh check error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * POST /api/vp-refresh/process
 * Force process all pending users immediately
 */
router.post('/process', async (_req: Request, res: Response) => {
  try {
    if (!config.contracts.governance) {
      return res.status(500).json({ error: 'Governance contract not configured' });
    }

    const results = await forceProcessPending();

    return res.json({
      processed: results.length,
      results,
    });
  } catch (error) {
    console.error('VP refresh process error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * GET /api/vp-refresh/config
 * Get VP refresh configuration
 */
router.get('/config', (_req: Request, res: Response) => {
  return res.json({
    enabled: config.vpRefresh.enabled,
    executeOnChain: config.vpRefresh.executeOnChain,
    minVpDifference: config.vpRefresh.minVpDifference.toString(),
    debounceMs: config.vpRefresh.debounceMs,
    maxBatchSize: config.vpRefresh.maxBatchSize,
    startupBlockLookback: config.vpRefresh.startupBlockLookback,
    contracts: {
      governance: config.contracts.governance || 'not configured',
      marketplace: config.contracts.marketplace || 'not configured',
    },
  });
});

export default router;
