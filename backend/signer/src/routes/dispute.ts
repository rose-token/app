/**
 * Dispute Routes
 *
 * REST API endpoints for dispute queries.
 * Read-only endpoints for admin UI.
 */

import { Router, Request, Response } from 'express';
import {
  getDispute,
  listDisputes,
  getDisputeStats,
} from '../services/dispute';
import { DisputeErrorResponse } from '../types';

const router = Router();

/**
 * GET /api/dispute/list
 * List all disputes with pagination.
 * Query params: page (default 1), pageSize (default 20), openOnly (default false)
 */
router.get('/list', async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = Math.min(parseInt(req.query.pageSize as string) || 20, 100);
    const openOnly = req.query.openOnly === 'true';

    const result = await listDisputes(page, pageSize, openOnly);
    return res.json(result);
  } catch (error) {
    console.error('List disputes error:', error);
    return res.status(500).json({
      error: 'Internal server error',
    } as DisputeErrorResponse);
  }
});

/**
 * GET /api/dispute/stats
 * Get dispute statistics.
 */
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const stats = await getDisputeStats();
    return res.json(stats);
  } catch (error) {
    console.error('Get dispute stats error:', error);
    return res.status(500).json({
      error: 'Internal server error',
    } as DisputeErrorResponse);
  }
});

/**
 * GET /api/dispute/:taskId
 * Get dispute info for a specific task.
 */
router.get('/:taskId', async (req: Request, res: Response) => {
  try {
    const taskId = parseInt(req.params.taskId);

    if (isNaN(taskId) || taskId <= 0) {
      return res.status(400).json({
        error: 'Invalid taskId',
      } as DisputeErrorResponse);
    }

    const dispute = await getDispute(taskId);

    if (!dispute) {
      return res.status(404).json({
        error: 'Dispute not found',
      } as DisputeErrorResponse);
    }

    return res.json(dispute);
  } catch (error) {
    console.error('Get dispute error:', error);
    return res.status(500).json({
      error: 'Internal server error',
    } as DisputeErrorResponse);
  }
});

export default router;
