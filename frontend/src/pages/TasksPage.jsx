/**
 * TasksPage - Main marketplace page with task table
 *
 * Route: /
 * Displays:
 * - User Historical Stats (marketplace activity metrics)
 * - Task Table with filtering and actions
 *
 * Uses useTasksAPI for paginated data fetching (scales to 1000+ tasks)
 * Uses useTasks for action handlers (claim, stake, etc.)
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { useAccount } from 'wagmi';
import UserHistoricalStats from '../components/marketplace/UserHistoricalStats';
import TaskTable from '../components/marketplace/TaskTable';
import WalletNotConnected from '../components/wallet/WalletNotConnected';
import ErrorMessage from '../components/ui/ErrorMessage';
import { useTasksAPI } from '../hooks/useTasksAPI';
import { useTasks } from '../hooks/useTasks';

const TasksPage = () => {
  const { isConnected } = useAccount();
  const location = useLocation();

  // Pagination state
  const [page, setPage] = useState(1);

  // Optimistic task state (for newly created tasks)
  const [optimisticTask, setOptimisticTask] = useState(null);

  // Filter state (shared between API and action handlers)
  const [filters, setFilters] = useState({
    status: 'all',
    myTasks: false,
    skillsMatch: false,
  });

  // Use API for paginated task list (scales to 1000+ tasks)
  const {
    tasks,
    pagination,
    isLoading: isLoadingAPI,
    error: apiError,
    refetch,
  } = useTasksAPI({
    page,
    limit: 20,
    filters,
    sortBy: 'created_at',
    sortOrder: 'desc',
  });

  // Use useTasks for action handlers only
  const {
    loadingStates,
    handleClaimTask,
    handleStakeTask,
    handleCompleteTask,
    handleApproveTask,
    handleAcceptPayment,
    error: actionError,
    clearError,
  } = useTasks();

  // Combined error from both hooks
  const error = apiError || actionError;

  // Handle optimistic task from navigation state
  useEffect(() => {
    if (location.state?.newTask) {
      const newTask = location.state.newTask;
      // Only set if task has valid ID
      if (newTask.id !== null) {
        setOptimisticTask(newTask);
      }
      // Clear navigation state to prevent re-adding on refresh
      window.history.replaceState({}, '');
    }
  }, [location.state]);

  // Clear optimistic task when it appears in API results
  useEffect(() => {
    if (optimisticTask && tasks.some((t) => t.id === optimisticTask.id)) {
      setOptimisticTask(null);
    }
  }, [tasks, optimisticTask]);

  // Merge optimistic task with API tasks (prepend if on page 1)
  const displayTasks = useMemo(() => {
    if (optimisticTask && page === 1 && filters.status === 'all' && !filters.myTasks) {
      // Avoid duplicates
      const filtered = tasks.filter((t) => t.id !== optimisticTask.id);
      return [optimisticTask, ...filtered];
    }
    return tasks;
  }, [tasks, optimisticTask, page, filters]);

  // Handle page change
  const handlePageChange = useCallback((newPage) => {
    setPage(newPage);
    // Scroll to top of task table
    window.scrollTo({ top: 300, behavior: 'smooth' });
  }, []);

  // Handle filter change (reset to page 1)
  const handleSetFilters = useCallback((newFilters) => {
    setFilters(newFilters);
    setPage(1); // Reset to first page when filters change
  }, []);

  // Refetch after action completes (optimistic update)
  const handleClaimTaskWithRefetch = useCallback(
    async (taskId) => {
      await handleClaimTask(taskId);
      refetch();
    },
    [handleClaimTask, refetch]
  );

  const handleStakeTaskWithRefetch = useCallback(
    async (taskId) => {
      await handleStakeTask(taskId);
      refetch();
    },
    [handleStakeTask, refetch]
  );

  const handleCompleteTaskWithRefetch = useCallback(
    async (taskId, prUrl) => {
      await handleCompleteTask(taskId, prUrl);
      refetch();
    },
    [handleCompleteTask, refetch]
  );

  const handleApproveTaskWithRefetch = useCallback(
    async (taskId, role) => {
      await handleApproveTask(taskId, role);
      refetch();
    },
    [handleApproveTask, refetch]
  );

  const handleAcceptPaymentWithRefetch = useCallback(
    async (taskId) => {
      await handleAcceptPayment(taskId);
      refetch();
    },
    [handleAcceptPayment, refetch]
  );

  return (
    <div className="animate-fade-in">
      {/* Page Header */}
      <div className="mb-10 text-center">
        <h1
          className="font-display text-4xl font-medium tracking-tight mb-2"
          style={{ letterSpacing: '-0.03em' }}
        >
          The Worker's <span className="gradient-text">Marketplace</span>
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '1.0625rem' }}>
          Decentralized Task Coordination Owned by Workers
        </p>
      </div>

      {!isConnected ? (
        <WalletNotConnected />
      ) : (
        <>
          {/* User Historical Stats */}
          <UserHistoricalStats />

          {/* Error display */}
          {error && (
            <div className="mb-4">
              <ErrorMessage message={error} onDismiss={clearError} />
            </div>
          )}

          {/* Task Table */}
          <div className="mb-6">
            <TaskTable
              tasks={displayTasks}
              isLoading={isLoadingAPI}
              loadingStates={loadingStates}
              filters={filters}
              setFilters={handleSetFilters}
              onClaimTask={handleClaimTaskWithRefetch}
              onStakeTask={handleStakeTaskWithRefetch}
              onCompleteTask={handleCompleteTaskWithRefetch}
              onApproveTask={handleApproveTaskWithRefetch}
              onAcceptPayment={handleAcceptPaymentWithRefetch}
              pagination={pagination}
              onPageChange={handlePageChange}
            />
          </div>
        </>
      )}
    </div>
  );
};

export default TasksPage;
