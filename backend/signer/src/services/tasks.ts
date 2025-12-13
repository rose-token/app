/**
 * Tasks Service
 *
 * Query functions for paginated task list.
 * Data populated by analyticsWatcher from blockchain events.
 */

import { query } from '../db/pool';

// ============================================================
// Types
// ============================================================

export interface TaskListParams {
  page?: number;
  limit?: number;
  cursor?: string; // task_id for cursor-based pagination
  status?: string | string[];
  myTasks?: string; // address to filter by involvement
  isAuction?: boolean;
  sortBy?: 'created_at' | 'deposit';
  sortOrder?: 'asc' | 'desc';
}

export interface TaskListItem {
  taskId: number;
  customer: string;
  worker: string | null;
  stakeholder: string | null;
  deposit: string;
  stakeholderDeposit: string;
  title: string;
  detailedDescriptionHash: string;
  prUrl: string | null;
  status: string;
  customerApproval: boolean;
  stakeholderApproval: boolean;
  source: number;
  proposalId: number | null;
  isAuction: boolean;
  winningBid: string;
  createdAt: string;
}

export interface TaskListResponse {
  tasks: TaskListItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
    nextCursor: string | null;
  };
}

// ============================================================
// Status Mapping
// ============================================================

// Map frontend status names to DB status values
// DB uses event-based status strings, frontend uses enum names
const STATUS_MAP: Record<string, string[]> = {
  stakeholderRequired: ['Created'],
  open: ['Staked'],
  inProgress: ['Claimed'],
  completed: ['Completed'],
  approvedPendingPayment: ['Approved'],
  closed: ['Closed', 'Cancelled'],
  disputed: ['Disputed'],
};

// Default statuses to show (excludes closed and disputed)
const DEFAULT_STATUSES = ['Created', 'Staked', 'Claimed', 'Completed', 'Approved'];

// ============================================================
// Query Functions
// ============================================================

/**
 * Get paginated task list with filtering and sorting
 */
export async function getTaskList(params: TaskListParams): Promise<TaskListResponse> {
  const {
    page = 1,
    limit = 20,
    cursor,
    status,
    myTasks,
    isAuction,
    sortBy = 'created_at',
    sortOrder = 'desc',
  } = params;

  // Build WHERE clauses
  const conditions: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  // Status filter
  if (status) {
    const statuses = Array.isArray(status) ? status : [status];
    // Map frontend status names to DB values
    const dbStatuses = statuses.flatMap((s) => STATUS_MAP[s] || [s]);
    if (dbStatuses.length > 0) {
      conditions.push(`status = ANY($${paramIndex++})`);
      values.push(dbStatuses);
    }
  } else {
    // Default: exclude closed and disputed
    conditions.push(`status = ANY($${paramIndex++})`);
    values.push(DEFAULT_STATUSES);
  }

  // myTasks filter (user is customer, worker, or stakeholder)
  if (myTasks) {
    const addr = myTasks.toLowerCase();
    conditions.push(
      `(LOWER(customer) = $${paramIndex} OR LOWER(worker) = $${paramIndex} OR LOWER(stakeholder) = $${paramIndex})`
    );
    values.push(addr);
    paramIndex++;
  }

  // isAuction filter
  if (isAuction !== undefined) {
    conditions.push(`is_auction = $${paramIndex++}`);
    values.push(isAuction);
  }

  // Cursor-based pagination (for infinite scroll)
  if (cursor) {
    const cursorOp = sortOrder === 'desc' ? '<' : '>';
    conditions.push(`task_id ${cursorOp} $${paramIndex++}`);
    values.push(parseInt(cursor, 10));
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Validate sort column to prevent SQL injection
  const validSortColumns = ['created_at', 'deposit'];
  const sortColumn = validSortColumns.includes(sortBy) ? sortBy : 'created_at';
  const order = sortOrder === 'asc' ? 'ASC' : 'DESC';

  // Count total (without cursor for accurate count)
  const countConditions = conditions.filter((c) => !c.includes('task_id <') && !c.includes('task_id >'));
  const countWhere = countConditions.length > 0 ? `WHERE ${countConditions.join(' AND ')}` : '';
  const countValues = values.slice(0, countConditions.length);

  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM analytics_tasks ${countWhere}`,
    countValues
  );
  const total = parseInt(countResult.rows[0]?.count || '0', 10);

  // Fetch tasks with pagination
  const limitValue = Math.min(Math.max(limit, 1), 100); // Cap at 100
  const offset = cursor ? 0 : (page - 1) * limitValue;

  // Add LIMIT parameter
  const limitParam = paramIndex++;
  values.push(limitValue);

  // Build offset clause only for page-based pagination
  let offsetClause = '';
  if (!cursor) {
    const offsetParam = paramIndex++;
    values.push(offset);
    offsetClause = `OFFSET $${offsetParam}`;
  }

  const tasksResult = await query<{
    task_id: number;
    customer: string;
    worker: string | null;
    stakeholder: string | null;
    deposit: string;
    stakeholder_deposit: string;
    title: string | null;
    detailed_description_hash: string | null;
    pr_url: string | null;
    status: string;
    customer_approval: boolean;
    stakeholder_approval: boolean;
    source: number;
    proposal_id: number | null;
    is_auction: boolean;
    winning_bid: string;
    created_at: string;
  }>(
    `
    SELECT
      task_id,
      customer,
      worker,
      stakeholder,
      deposit::text,
      COALESCE(stakeholder_deposit, 0)::text as stakeholder_deposit,
      title,
      detailed_description_hash,
      pr_url,
      status,
      COALESCE(customer_approval, false) as customer_approval,
      COALESCE(stakeholder_approval, false) as stakeholder_approval,
      COALESCE(source, 0) as source,
      proposal_id,
      is_auction,
      COALESCE(winning_bid, 0)::text as winning_bid,
      created_at::text
    FROM analytics_tasks
    ${whereClause}
    ORDER BY ${sortColumn} ${order}, task_id ${order}
    LIMIT $${limitParam}
    ${offsetClause}
  `,
    values
  );

  const tasks: TaskListItem[] = tasksResult.rows.map((row) => ({
    taskId: row.task_id,
    customer: row.customer,
    worker: row.worker,
    stakeholder: row.stakeholder,
    deposit: row.deposit,
    stakeholderDeposit: row.stakeholder_deposit,
    title: row.title || '',
    detailedDescriptionHash: row.detailed_description_hash || '',
    prUrl: row.pr_url,
    status: row.status,
    customerApproval: row.customer_approval,
    stakeholderApproval: row.stakeholder_approval,
    source: row.source,
    proposalId: row.proposal_id,
    isAuction: row.is_auction,
    winningBid: row.winning_bid,
    createdAt: row.created_at,
  }));

  const totalPages = Math.ceil(total / limitValue);
  const lastTask = tasks[tasks.length - 1];

  return {
    tasks,
    pagination: {
      page: cursor ? 1 : page,
      limit: limitValue,
      total,
      totalPages,
      hasNext: cursor ? tasks.length === limitValue : page < totalPages,
      hasPrev: cursor ? true : page > 1,
      nextCursor: lastTask ? String(lastTask.taskId) : null,
    },
  };
}

/**
 * Get single task by ID
 */
export async function getTaskById(taskId: number): Promise<TaskListItem | null> {
  const result = await query<{
    task_id: number;
    customer: string;
    worker: string | null;
    stakeholder: string | null;
    deposit: string;
    stakeholder_deposit: string;
    title: string | null;
    detailed_description_hash: string | null;
    pr_url: string | null;
    status: string;
    customer_approval: boolean;
    stakeholder_approval: boolean;
    source: number;
    proposal_id: number | null;
    is_auction: boolean;
    winning_bid: string;
    created_at: string;
  }>(
    `
    SELECT
      task_id,
      customer,
      worker,
      stakeholder,
      deposit::text,
      COALESCE(stakeholder_deposit, 0)::text as stakeholder_deposit,
      title,
      detailed_description_hash,
      pr_url,
      status,
      COALESCE(customer_approval, false) as customer_approval,
      COALESCE(stakeholder_approval, false) as stakeholder_approval,
      COALESCE(source, 0) as source,
      proposal_id,
      is_auction,
      COALESCE(winning_bid, 0)::text as winning_bid,
      created_at::text
    FROM analytics_tasks
    WHERE task_id = $1
  `,
    [taskId]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    taskId: row.task_id,
    customer: row.customer,
    worker: row.worker,
    stakeholder: row.stakeholder,
    deposit: row.deposit,
    stakeholderDeposit: row.stakeholder_deposit,
    title: row.title || '',
    detailedDescriptionHash: row.detailed_description_hash || '',
    prUrl: row.pr_url,
    status: row.status,
    customerApproval: row.customer_approval,
    stakeholderApproval: row.stakeholder_approval,
    source: row.source,
    proposalId: row.proposal_id,
    isAuction: row.is_auction,
    winningBid: row.winning_bid,
    createdAt: row.created_at,
  };
}

/**
 * Get task count by status (for filter badges)
 */
export async function getTaskCountByStatus(): Promise<Record<string, number>> {
  const result = await query<{ status: string; count: string }>(`
    SELECT status, COUNT(*) as count
    FROM analytics_tasks
    GROUP BY status
  `);

  const counts: Record<string, number> = {};
  for (const row of result.rows) {
    counts[row.status] = parseInt(row.count, 10);
  }
  return counts;
}
