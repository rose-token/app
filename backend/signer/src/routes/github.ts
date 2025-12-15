/**
 * GitHub Routes
 *
 * Provides endpoints for GitHub PR validation and status.
 */

import { Router, Request, Response } from 'express';
import { validatePrUrl, validatePrUrlWithAuth, getGitHubStatus, parsePrUrl } from '../services/github';
import { getTaskWatcherStats, processTaskManually } from '../services/taskWatcher';
import { query } from '../db/pool';
import { config } from '../config';

const router = Router();

/**
 * POST /api/github/validate-pr
 *
 * Validates a GitHub PR URL before task completion.
 * Checks that:
 * - URL is valid format
 * - App has access to the repo
 * - PR exists and is open
 * - Customer has authorized the repository (when taskId provided)
 *
 * @body prUrl - The GitHub PR URL to validate
 * @body taskId - Optional task ID for customer authorization check
 */
router.post('/validate-pr', async (req: Request, res: Response) => {
  try {
    const { prUrl, taskId } = req.body;

    if (!prUrl || typeof prUrl !== 'string') {
      return res.status(400).json({
        valid: false,
        error: 'prUrl is required',
      });
    }

    // If taskId is provided, validate with customer authorization check
    if (taskId !== undefined && taskId !== null) {
      const parsedTaskId = parseInt(taskId, 10);
      if (isNaN(parsedTaskId) || parsedTaskId <= 0) {
        return res.status(400).json({
          valid: false,
          error: 'Invalid task ID',
        });
      }
      const result = await validatePrUrlWithAuth(prUrl, parsedTaskId);
      return res.json(result);
    }

    // Otherwise, just validate the PR URL without authorization check
    const result = await validatePrUrl(prUrl);
    return res.json(result);
  } catch (error) {
    console.error('[GitHub] Error validating PR:', error);
    return res.status(500).json({
      valid: false,
      error: 'Internal server error',
    });
  }
});

/**
 * GET /api/github/status
 *
 * Returns GitHub bot configuration status.
 */
router.get('/status', (_req: Request, res: Response) => {
  const status = getGitHubStatus();
  const watcherStats = getTaskWatcherStats();

  return res.json({
    github: status,
    watcher: {
      isRunning: watcherStats.isRunning,
      startedAt: watcherStats.startedAt,
      eventsProcessed: watcherStats.eventsProcessed,
      mergesAttempted: watcherStats.mergesAttempted,
      mergesSucceeded: watcherStats.mergesSucceeded,
      mergesFailed: watcherStats.mergesFailed,
      lastError: watcherStats.lastError,
      lastEventBlock: watcherStats.lastEventBlock,
    },
  });
});

/**
 * GET /api/github/logs
 *
 * Returns recent GitHub merge logs.
 */
router.get('/logs', async (req: Request, res: Response) => {
  if (!config.database.url) {
    return res.status(503).json({ error: 'Database not configured' });
  }

  try {
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = Math.min(parseInt(req.query.pageSize as string) || 20, 100);
    const offset = (page - 1) * pageSize;
    const successOnly = req.query.successOnly === 'true';
    const failuresOnly = req.query.failuresOnly === 'true';

    let whereClause = '';
    if (successOnly) {
      whereClause = 'WHERE success = true';
    } else if (failuresOnly) {
      whereClause = 'WHERE success = false';
    }

    // Get total count
    const countResult = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM github_merge_log ${whereClause}`
    );
    const total = parseInt(countResult.rows[0].count, 10);

    // Get logs
    const logsResult = await query(
      `SELECT * FROM github_merge_log ${whereClause}
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [pageSize, offset]
    );

    return res.json({
      logs: logsResult.rows,
      total,
      page,
      pageSize,
    });
  } catch (error) {
    console.error('[GitHub] Error fetching logs:', error);
    return res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

/**
 * GET /api/github/logs/:taskId
 *
 * Returns merge logs for a specific task.
 */
router.get('/logs/:taskId', async (req: Request, res: Response) => {
  if (!config.database.url) {
    return res.status(503).json({ error: 'Database not configured' });
  }

  try {
    const taskId = parseInt(req.params.taskId);
    if (isNaN(taskId) || taskId <= 0) {
      return res.status(400).json({ error: 'Invalid task ID' });
    }

    const result = await query(
      `SELECT * FROM github_merge_log WHERE task_id = $1 ORDER BY created_at DESC`,
      [taskId]
    );

    return res.json({
      taskId,
      logs: result.rows,
    });
  } catch (error) {
    console.error('[GitHub] Error fetching task logs:', error);
    return res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

/**
 * POST /api/github/retry/:taskId
 *
 * Manually retry GitHub merge for a task.
 * Useful for retrying failed merges.
 */
router.post('/retry/:taskId', async (req: Request, res: Response) => {
  try {
    const taskId = parseInt(req.params.taskId);
    if (isNaN(taskId) || taskId <= 0) {
      return res.status(400).json({ error: 'Invalid task ID' });
    }

    const result = await processTaskManually(taskId);

    if (result.success) {
      return res.json({
        success: true,
        message: `Successfully processed task ${taskId}`,
      });
    } else {
      return res.status(400).json({
        success: false,
        error: result.error,
      });
    }
  } catch (error) {
    console.error('[GitHub] Error retrying task:', error);
    return res.status(500).json({ error: 'Failed to retry task' });
  }
});

/**
 * GET /api/github/parse-pr
 *
 * Parse a PR URL and return its components.
 * Useful for frontend validation/display.
 */
router.get('/parse-pr', (req: Request, res: Response) => {
  const prUrl = req.query.url as string;

  if (!prUrl) {
    return res.status(400).json({ error: 'url query parameter is required' });
  }

  const parsed = parsePrUrl(prUrl);

  if (!parsed) {
    return res.json({
      valid: false,
      error: 'Invalid GitHub PR URL format',
    });
  }

  return res.json({
    valid: true,
    owner: parsed.owner,
    repo: parsed.repo,
    pullNumber: parsed.pull_number,
  });
});

export default router;
