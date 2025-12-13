/**
 * Tasks Routes
 *
 * REST API endpoints for paginated task list.
 * Read-only endpoints - data populated by analyticsWatcher.
 */

import { Router, Request, Response } from 'express';
import { getTaskList, getTaskById, getTaskCountByStatus, TaskListParams } from '../services/tasks';

const router = Router();

/**
 * GET /api/tasks
 * Paginated task list with filtering and sorting
 *
 * Query params:
 * - page: Page number (default: 1)
 * - limit: Items per page (default: 20, max: 100)
 * - cursor: Task ID for cursor-based pagination
 * - status: Filter by status (comma-separated for multiple)
 * - myTasks: Address to filter by involvement (customer/worker/stakeholder)
 * - isAuction: Filter auction tasks (true/false)
 * - sortBy: Sort column (created_at, deposit)
 * - sortOrder: Sort order (asc, desc)
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const params: TaskListParams = {
      page: parseInt(req.query.page as string, 10) || 1,
      limit: parseInt(req.query.limit as string, 10) || 20,
      cursor: req.query.cursor as string | undefined,
      status: req.query.status ? (req.query.status as string).split(',') : undefined,
      myTasks: req.query.myTasks as string | undefined,
      isAuction:
        req.query.isAuction !== undefined ? req.query.isAuction === 'true' : undefined,
      sortBy: req.query.sortBy as 'created_at' | 'deposit' | undefined,
      sortOrder: req.query.sortOrder as 'asc' | 'desc' | undefined,
    };

    const result = await getTaskList(params);
    return res.json(result);
  } catch (error) {
    console.error('[Tasks] List error:', error);
    return res.status(500).json({
      error: 'Failed to fetch tasks',
    });
  }
});

/**
 * GET /api/tasks/counts
 * Get task count by status (for filter badges)
 */
router.get('/counts', async (_req: Request, res: Response) => {
  try {
    const counts = await getTaskCountByStatus();
    return res.json(counts);
  } catch (error) {
    console.error('[Tasks] Counts error:', error);
    return res.status(500).json({
      error: 'Failed to fetch task counts',
    });
  }
});

/**
 * GET /api/tasks/:taskId
 * Get single task by ID
 */
router.get('/:taskId', async (req: Request, res: Response) => {
  try {
    const taskId = parseInt(req.params.taskId, 10);
    if (isNaN(taskId)) {
      return res.status(400).json({ error: 'Invalid task ID' });
    }

    const task = await getTaskById(taskId);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    return res.json(task);
  } catch (error) {
    console.error('[Tasks] Get error:', error);
    return res.status(500).json({
      error: 'Failed to fetch task',
    });
  }
});

export default router;
