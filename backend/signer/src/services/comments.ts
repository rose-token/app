/**
 * Comments Service
 *
 * CRUD operations for task comments.
 * Comments are stored off-chain in PostgreSQL.
 */

import { query } from '../db/pool';

export interface TaskComment {
  id: number;
  taskId: number;
  authorAddress: string;
  content: string;
  isAgent: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCommentParams {
  taskId: number;
  authorAddress: string;
  content: string;
  isAgent: boolean;
}

export interface CommentListResult {
  comments: TaskComment[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

/**
 * Get comments for a task with pagination.
 * Ordered by creation time ascending (oldest first).
 */
export async function getTaskComments(
  taskId: number,
  page: number = 1,
  limit: number = 50
): Promise<CommentListResult> {
  // Clamp limit
  limit = Math.min(Math.max(1, limit), 100);
  page = Math.max(1, page);
  const offset = (page - 1) * limit;

  // Get total count
  const countResult = await query<{ count: string }>(
    'SELECT COUNT(*) as count FROM task_comments WHERE task_id = $1',
    [taskId]
  );
  const total = parseInt(countResult.rows[0].count, 10);
  const totalPages = Math.ceil(total / limit);

  // Get comments
  const result = await query<{
    id: number;
    task_id: number;
    author_address: string;
    content: string;
    is_agent: boolean;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT id, task_id, author_address, content, is_agent, created_at, updated_at
     FROM task_comments
     WHERE task_id = $1
     ORDER BY created_at ASC
     LIMIT $2 OFFSET $3`,
    [taskId, limit, offset]
  );

  const comments: TaskComment[] = result.rows.map((row) => ({
    id: row.id,
    taskId: row.task_id,
    authorAddress: row.author_address,
    content: row.content,
    isAgent: row.is_agent,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

  return {
    comments,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
  };
}

/**
 * Create a new comment on a task.
 */
export async function createComment(params: CreateCommentParams): Promise<TaskComment> {
  const { taskId, authorAddress, content, isAgent } = params;

  const result = await query<{
    id: number;
    task_id: number;
    author_address: string;
    content: string;
    is_agent: boolean;
    created_at: string;
    updated_at: string;
  }>(
    `INSERT INTO task_comments (task_id, author_address, content, is_agent)
     VALUES ($1, $2, $3, $4)
     RETURNING id, task_id, author_address, content, is_agent, created_at, updated_at`,
    [taskId, authorAddress.toLowerCase(), content, isAgent]
  );

  const row = result.rows[0];
  return {
    id: row.id,
    taskId: row.task_id,
    authorAddress: row.author_address,
    content: row.content,
    isAgent: row.is_agent,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Get comment count for a task (for display badges).
 */
export async function getCommentCount(taskId: number): Promise<number> {
  const result = await query<{ count: string }>(
    'SELECT COUNT(*) as count FROM task_comments WHERE task_id = $1',
    [taskId]
  );
  return parseInt(result.rows[0].count, 10);
}

/**
 * Get comment counts for multiple tasks at once (for list views).
 */
export async function getCommentCounts(taskIds: number[]): Promise<Record<number, number>> {
  if (taskIds.length === 0) return {};

  const result = await query<{ task_id: number; count: string }>(
    `SELECT task_id, COUNT(*) as count
     FROM task_comments
     WHERE task_id = ANY($1)
     GROUP BY task_id`,
    [taskIds]
  );

  const counts: Record<number, number> = {};
  for (const row of result.rows) {
    counts[row.task_id] = parseInt(row.count, 10);
  }
  return counts;
}
