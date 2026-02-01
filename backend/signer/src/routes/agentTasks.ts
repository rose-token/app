/**
 * Agent Task Routes
 *
 * REST API endpoints for agents to interact with the task marketplace.
 * Wraps existing task/auction services for programmatic access.
 * All endpoints require API key authentication.
 */

import { Router, Request, Response } from 'express';
import { agentAuth } from '../middleware/agentAuth';
import { getTaskList, getTaskById, TaskListParams } from '../services/tasks';
import { submitBid, getWorkerBid } from '../services/auction';
import { query } from '../db/pool';

const router = Router();

// All agent task endpoints require authentication
router.use(agentAuth);

/**
 * GET /api/agent/tasks
 * Browse open tasks with pagination and filtering.
 *
 * Query params:
 * - page: Page number (default: 1)
 * - limit: Items per page (default: 20, max: 100)
 * - status: Filter by status (comma-separated)
 * - isAuction: Filter auction tasks (true/false)
 * - sortBy: Sort column (created_at, deposit)
 * - sortOrder: Sort order (asc, desc)
 */
router.get('/tasks', async (req: Request, res: Response) => {
  try {
    const params: TaskListParams = {
      page: parseInt(req.query.page as string, 10) || 1,
      limit: parseInt(req.query.limit as string, 10) || 20,
      cursor: req.query.cursor as string | undefined,
      status: req.query.status ? (req.query.status as string).split(',') : undefined,
      isAuction:
        req.query.isAuction !== undefined ? req.query.isAuction === 'true' : undefined,
      sortBy: req.query.sortBy as 'created_at' | 'deposit' | undefined,
      sortOrder: req.query.sortOrder as 'asc' | 'desc' | undefined,
    };

    const result = await getTaskList(params);
    return res.json(result);
  } catch (error) {
    console.error('[AgentTasks] List error:', error);
    return res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

/**
 * GET /api/agent/tasks/my
 * Get tasks the authenticated agent is involved in (as worker or customer).
 *
 * Query params:
 * - page: Page number (default: 1)
 * - limit: Items per page (default: 20, max: 100)
 * - role: Filter by role ('worker', 'customer', or omit for both)
 * - status: Filter by status (comma-separated)
 */
router.get('/tasks/my', async (req: Request, res: Response) => {
  try {
    const agentAddress = req.agent!.walletAddress;

    const params: TaskListParams = {
      page: parseInt(req.query.page as string, 10) || 1,
      limit: parseInt(req.query.limit as string, 10) || 20,
      myTasks: agentAddress,
      status: req.query.status ? (req.query.status as string).split(',') : undefined,
      sortBy: req.query.sortBy as 'created_at' | 'deposit' | undefined,
      sortOrder: req.query.sortOrder as 'asc' | 'desc' | undefined,
    };

    const result = await getTaskList(params);
    return res.json(result);
  } catch (error) {
    console.error('[AgentTasks] My tasks error:', error);
    return res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

/**
 * GET /api/agent/tasks/:id
 * Get task details by ID.
 */
router.get('/tasks/:id', async (req: Request, res: Response) => {
  try {
    const taskId = parseInt(req.params.id, 10);
    if (isNaN(taskId)) {
      return res.status(400).json({ error: 'Invalid task ID' });
    }

    const task = await getTaskById(taskId);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    return res.json(task);
  } catch (error) {
    console.error('[AgentTasks] Get task error:', error);
    return res.status(500).json({ error: 'Failed to fetch task' });
  }
});

/**
 * POST /api/agent/tasks/:id/bid
 * Submit a bid on an auction task.
 * Uses the agent's wallet address and requires a signed bid.
 *
 * Body:
 * - bidAmount: Bid amount in wei (string)
 * - message: Optional message to the customer
 * - signature: Signed bid (same format as auction system)
 */
router.post('/tasks/:id/bid', async (req: Request, res: Response) => {
  try {
    const taskId = parseInt(req.params.id, 10);
    if (isNaN(taskId) || taskId <= 0) {
      return res.status(400).json({ error: 'Invalid task ID' });
    }

    const { bidAmount, message, signature } = req.body;
    const worker = req.agent!.walletAddress;

    if (!bidAmount) {
      return res.status(400).json({ error: 'bidAmount is required' });
    }

    if (!signature) {
      return res.status(400).json({ error: 'signature is required' });
    }

    const result = await submitBid(taskId, worker, bidAmount, message || null, signature);

    // Update agent stats
    await query(
      `UPDATE agents SET updated_at = NOW() WHERE id = $1`,
      [req.agent!.id]
    );

    return res.json({
      success: true,
      taskId,
      worker,
      bidAmount,
      isUpdate: result.isUpdate,
    });
  } catch (error) {
    console.error('[AgentTasks] Bid error:', error);

    if (error instanceof Error) {
      if (
        error.message.includes('Invalid') ||
        error.message.includes('Auction') ||
        error.message.includes('Bid')
      ) {
        return res.status(400).json({ error: error.message });
      }
    }

    return res.status(500).json({ error: 'Failed to submit bid' });
  }
});

/**
 * POST /api/agent/tasks/:id/submit
 * Submit completed work for a task.
 * Records the submission metadata (PR URL, description).
 *
 * Body:
 * - prUrl: URL to the pull request or deliverable
 * - description: Description of the completed work
 *
 * Note: The actual task state transition (markComplete) happens on-chain.
 * This endpoint records the submission for off-chain tracking.
 */
router.post('/tasks/:id/submit', async (req: Request, res: Response) => {
  try {
    const taskId = parseInt(req.params.id, 10);
    if (isNaN(taskId) || taskId <= 0) {
      return res.status(400).json({ error: 'Invalid task ID' });
    }

    const { prUrl, description } = req.body;

    if (!prUrl) {
      return res.status(400).json({ error: 'prUrl is required' });
    }

    // Verify the task exists and agent is the worker
    const task = await getTaskById(taskId);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    if (task.worker?.toLowerCase() !== req.agent!.walletAddress.toLowerCase()) {
      return res.status(403).json({ error: 'Only the assigned worker can submit work' });
    }

    // Record submission in analytics_tasks (update PR URL)
    await query(
      `UPDATE analytics_tasks SET pr_url = $1 WHERE task_id = $2`,
      [prUrl, taskId]
    );

    console.log(`[AgentTasks] Work submitted for task ${taskId} by agent ${req.agent!.walletAddress}`);

    return res.json({
      success: true,
      taskId,
      prUrl,
      message: 'Work submitted. Complete the on-chain markComplete transaction to finalize.',
    });
  } catch (error) {
    console.error('[AgentTasks] Submit error:', error);
    return res.status(500).json({ error: 'Failed to submit work' });
  }
});

/**
 * POST /api/agent/tasks
 * Create a new task as a customer.
 *
 * Note: Task creation happens on-chain. This endpoint records the intent
 * and returns the parameters needed for the on-chain transaction.
 * The agent must execute the contract call themselves.
 *
 * Body:
 * - title: Task title
 * - description: Task description
 * - skills: Required skills (array of strings)
 * - budget: Budget in wei (string)
 * - isAuction: Whether to use auction system (boolean)
 */
router.post('/tasks', async (req: Request, res: Response) => {
  try {
    const { title, description, skills, budget, isAuction } = req.body;

    if (!title || !description || !budget) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['title', 'description', 'budget'],
      });
    }

    if (typeof title !== 'string' || title.length > 200) {
      return res.status(400).json({ error: 'Title must be a string of 200 characters or less' });
    }

    // Return the parameters the agent needs for the on-chain transaction
    // The actual task creation is on-chain — this is a convenience endpoint
    const response = {
      success: true,
      message: 'Task parameters validated. Execute createTask on-chain to create the task.',
      params: {
        customer: req.agent!.walletAddress,
        title,
        description,
        skills: skills || [],
        budget,
        isAuction: isAuction || false,
      },
      contractInfo: {
        method: isAuction ? 'createAuctionTask' : 'createTask',
        note: 'Call the RoseMarketplace contract with these parameters and a ROSE token deposit.',
      },
    };

    // Update agent stats
    await query(
      `UPDATE agents SET tasks_posted = tasks_posted + 1, updated_at = NOW() WHERE id = $1`,
      [req.agent!.id]
    );

    console.log(`[AgentTasks] Task creation intent by agent ${req.agent!.walletAddress}: "${title}"`);

    return res.json(response);
  } catch (error) {
    console.error('[AgentTasks] Create task error:', error);
    return res.status(500).json({ error: 'Failed to process task creation' });
  }
});

export default router;
