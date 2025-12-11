/**
 * TaskDetailPage - Detailed view of a single task
 *
 * Route: /task/:id
 * Shows full task details with all actions available
 * Reuses TaskCard component for display and modals
 */

import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAccount } from 'wagmi';
import TaskCard from '../components/marketplace/TaskCard';
import WalletNotConnected from '../components/wallet/WalletNotConnected';
import Spinner from '../components/ui/Spinner';
import ErrorMessage from '../components/ui/ErrorMessage';
import { useTasks } from '../hooks/useTasks';

const TaskDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isConnected } = useAccount();

  // Fetch single task
  const {
    task,
    isLoading,
    error,
    loadingStates,
    handleClaimTask,
    handleUnclaimTask,
    handleCompleteTask,
    handleApproveTask,
    handleAcceptPayment,
    handleStakeTask,
    handleCancelTask,
    handleUnstakeTask,
    clearError,
  } = useTasks({ taskId: parseInt(id) });

  if (!isConnected) {
    return (
      <div className="animate-fade-in">
        <WalletNotConnected />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="animate-fade-in">
        {/* Back Link */}
        <Link
          to="/"
          className="inline-flex items-center gap-1 text-sm mb-6 transition-colors"
          style={{ color: 'var(--rose-pink)' }}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Tasks
        </Link>

        <div className="text-center py-12">
          <Spinner className="w-8 h-8 mx-auto mb-4" />
          <p style={{ color: 'var(--text-muted)' }}>Loading task...</p>
        </div>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="animate-fade-in">
        {/* Back Link */}
        <Link
          to="/"
          className="inline-flex items-center gap-1 text-sm mb-6 transition-colors"
          style={{ color: 'var(--rose-pink)' }}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Tasks
        </Link>

        <div
          className="rounded-[20px] text-center py-12 px-6"
          style={{
            background: 'var(--error-bg)',
            border: '1px solid rgba(248, 113, 113, 0.3)',
          }}
        >
          <p className="mb-4" style={{ color: 'var(--error)' }}>
            Task #{id} not found
          </p>
          <Link
            to="/"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg transition-colors"
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-primary)',
            }}
          >
            View All Tasks
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      {/* Back Link */}
      <Link
        to="/"
        className="inline-flex items-center gap-1 text-sm mb-6 transition-colors"
        style={{ color: 'var(--rose-pink)' }}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to Tasks
      </Link>

      {/* Page Header */}
      <div className="mb-6">
        <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Task #{task.id}
        </span>
        <h1 className="font-display text-2xl font-medium mt-1" style={{ color: 'var(--text-primary)' }}>
          {task.description || 'Untitled Task'}
        </h1>
      </div>

      {/* Error display */}
      {error && (
        <div className="mb-4">
          <ErrorMessage message={error} onDismiss={clearError} />
        </div>
      )}

      {/* Task Card with full functionality */}
      <TaskCard
        task={task}
        onClaim={handleClaimTask}
        onUnclaim={handleUnclaimTask}
        onComplete={handleCompleteTask}
        onApprove={handleApproveTask}
        onAcceptPayment={handleAcceptPayment}
        onStake={handleStakeTask}
        onUnstake={handleUnstakeTask}
        onCancel={handleCancelTask}
        loadingStates={loadingStates}
      />
    </div>
  );
};

export default TaskDetailPage;
