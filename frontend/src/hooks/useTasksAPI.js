/**
 * useTasksAPI Hook
 *
 * Fetches paginated task list from backend API.
 * Used for the main task table view (scalable to 1000+ tasks).
 *
 * For single task detail pages, continue using useTasks with taskId.
 * For action handlers (claim, stake, etc.), use useTasks.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAccount } from 'wagmi';

const API_URL = import.meta.env.VITE_PASSPORT_SIGNER_URL || 'http://localhost:3001';

// DB status string to TaskStatus enum number mapping
const STATUS_NUMBER_MAP = {
  'Created': 0, // StakeholderRequired
  'Staked': 1, // Open
  'Claimed': 2, // InProgress
  'Completed': 3, // Completed
  'Approved': 4, // ApprovedPendingPayment
  'Closed': 5, // Closed
  'Cancelled': 5, // Also Closed
  'Disputed': 6, // Disputed
};

// Frontend status filter key to API status value mapping
const STATUS_API_MAP = {
  stakeholderRequired: 'stakeholderRequired',
  open: 'open',
  inProgress: 'inProgress',
  completed: 'completed',
  approvedPendingPayment: 'approvedPendingPayment',
  closed: 'closed',
  disputed: 'disputed',
};

/**
 * Paginated task list hook
 * @param {Object} options
 * @param {number} options.page - Page number (default: 1)
 * @param {number} options.limit - Items per page (default: 20)
 * @param {Object} options.filters - Filter state { status, myTasks }
 * @param {string} options.sortBy - Sort column ('created_at' or 'deposit')
 * @param {string} options.sortOrder - Sort order ('asc' or 'desc')
 */
export const useTasksAPI = ({
  page = 1,
  limit = 20,
  filters = { status: 'all', myTasks: false },
  sortBy = 'created_at',
  sortOrder = 'desc',
} = {}) => {
  const { address: account, isConnected } = useAccount();

  const [tasks, setTasks] = useState([]);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
    hasNext: false,
    hasPrev: false,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const abortControllerRef = useRef(null);

  const fetchTasks = useCallback(async () => {
    if (!isConnected) {
      setTasks([]);
      setIsLoading(false);
      return;
    }

    // Cancel previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    setIsLoading(true);
    setError(null);

    try {
      // Build query params
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', String(limit));
      params.set('sortBy', sortBy);
      params.set('sortOrder', sortOrder);

      // Status filter
      if (filters.status && filters.status !== 'all') {
        params.set('status', STATUS_API_MAP[filters.status] || filters.status);
      }
      // Note: When status is 'all', backend will use default (exclude closed/disputed)

      // myTasks filter
      if (filters.myTasks && account) {
        params.set('myTasks', account);
      }

      const response = await fetch(`${API_URL}/api/tasks?${params.toString()}`, {
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      // Transform API response to match existing task structure
      const transformedTasks = data.tasks.map((task) => ({
        id: task.taskId,
        customer: task.customer,
        worker: task.worker,
        stakeholder: task.stakeholder,
        deposit: task.deposit,
        stakeholderDeposit: task.stakeholderDeposit,
        description: task.title, // UI uses 'description' for title
        detailedDescription: task.detailedDescriptionHash,
        prUrl: task.prUrl || '',
        status: STATUS_NUMBER_MAP[task.status] ?? 0,
        customerApproval: task.customerApproval,
        stakeholderApproval: task.stakeholderApproval,
        source: task.source,
        proposalId: task.proposalId?.toString() || '0',
        isAuction: task.isAuction,
        winningBid: task.winningBid,
      }));

      setTasks(transformedTasks);
      setPagination(data.pagination);
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('[useTasksAPI] Error:', err);
      setError(err.message || 'Failed to fetch tasks');
    } finally {
      setIsLoading(false);
    }
  }, [isConnected, account, page, limit, filters.status, filters.myTasks, sortBy, sortOrder]);

  // Fetch on mount and when params change
  useEffect(() => {
    fetchTasks();
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [fetchTasks]);

  // Memoize the return object to prevent unnecessary re-renders
  const result = useMemo(
    () => ({
      tasks,
      pagination,
      isLoading,
      error,
      refetch: fetchTasks,
    }),
    [tasks, pagination, isLoading, error, fetchTasks]
  );

  return result;
};

export default useTasksAPI;
