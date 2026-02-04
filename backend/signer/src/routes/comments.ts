/**
 * Comments Routes
 *
 * Public REST API for task comments.
 * - GET: Anyone can read comments
 * - POST: Requires wallet signature (personal_sign)
 */

import { Router, Request, Response } from 'express';
import { ethers } from 'ethers';
import { getTaskComments, createComment, getCommentCount } from '../services/comments';
import { getTaskById } from '../services/tasks';

const router = Router();

/** Max comment length */
const MAX_COMMENT_LENGTH = 2000;

/** Signature validity window (5 minutes) */
const SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000;

/**
 * Build the message string that the frontend must sign.
 * Must match exactly between frontend and backend.
 */
function buildCommentMessage(taskId: number, content: string, timestamp: number): string {
  return `Rose Token Comment\n\nTask: #${taskId}\nComment: ${content}\nTimestamp: ${timestamp}`;
}

/**
 * GET /api/tasks/:taskId/comments
 * Get comments for a task with pagination.
 *
 * Query params:
 * - page: Page number (default: 1)
 * - limit: Items per page (default: 50, max: 100)
 */
router.get('/:taskId/comments', async (req: Request, res: Response) => {
  try {
    const taskId = parseInt(req.params.taskId, 10);
    if (isNaN(taskId) || taskId <= 0) {
      return res.status(400).json({ error: 'Invalid task ID' });
    }

    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 50;

    const result = await getTaskComments(taskId, page, limit);
    return res.json(result);
  } catch (error) {
    console.error('[Comments] List error:', error);
    return res.status(500).json({ error: 'Failed to fetch comments' });
  }
});

/**
 * GET /api/tasks/:taskId/comments/count
 * Get comment count for a task (for badges).
 */
router.get('/:taskId/comments/count', async (req: Request, res: Response) => {
  try {
    const taskId = parseInt(req.params.taskId, 10);
    if (isNaN(taskId) || taskId <= 0) {
      return res.status(400).json({ error: 'Invalid task ID' });
    }

    const count = await getCommentCount(taskId);
    return res.json({ taskId, count });
  } catch (error) {
    console.error('[Comments] Count error:', error);
    return res.status(500).json({ error: 'Failed to fetch comment count' });
  }
});

/**
 * POST /api/tasks/:taskId/comments
 * Create a comment on a task.
 * Requires a signed message from the commenter's wallet.
 *
 * Body:
 * - address: Commenter's wallet address
 * - content: Comment text (max 2000 chars)
 * - timestamp: Unix timestamp (ms) when comment was signed
 * - signature: personal_sign of the comment message
 */
router.post('/:taskId/comments', async (req: Request, res: Response) => {
  try {
    const taskId = parseInt(req.params.taskId, 10);
    if (isNaN(taskId) || taskId <= 0) {
      return res.status(400).json({ error: 'Invalid task ID' });
    }

    const { address, content, timestamp, signature } = req.body;

    // Validate required fields
    if (!address || !content || !timestamp || !signature) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['address', 'content', 'timestamp', 'signature'],
      });
    }

    // Validate address
    if (!ethers.isAddress(address)) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }

    // Validate content
    if (typeof content !== 'string' || content.trim().length === 0) {
      return res.status(400).json({ error: 'Comment content cannot be empty' });
    }
    if (content.length > MAX_COMMENT_LENGTH) {
      return res.status(400).json({
        error: `Comment must be ${MAX_COMMENT_LENGTH} characters or less`,
      });
    }

    // Validate timestamp freshness
    const now = Date.now();
    const ts = typeof timestamp === 'number' ? timestamp : parseInt(timestamp, 10);
    if (isNaN(ts) || Math.abs(now - ts) > SIGNATURE_MAX_AGE_MS) {
      return res.status(400).json({ error: 'Signature expired or invalid timestamp' });
    }

    // Verify signature
    const message = buildCommentMessage(taskId, content, ts);
    let recoveredAddress: string;
    try {
      recoveredAddress = ethers.verifyMessage(message, signature);
    } catch (err) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    if (recoveredAddress.toLowerCase() !== address.toLowerCase()) {
      return res.status(401).json({ error: 'Signature does not match address' });
    }

    // Verify the task exists
    const task = await getTaskById(taskId);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Create the comment
    const comment = await createComment({
      taskId,
      authorAddress: address,
      content: content.trim(),
      isAgent: false,
    });

    console.log(`[Comments] New comment on task ${taskId} by ${address}`);

    return res.status(201).json({ success: true, comment });
  } catch (error) {
    console.error('[Comments] Create error:', error);
    return res.status(500).json({ error: 'Failed to create comment' });
  }
});

export default router;
