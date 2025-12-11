/**
 * TasksPage - Main marketplace page with task table
 *
 * Route: /
 * Displays:
 * - Token Distribution Chart
 * - Task Table with filtering and actions
 */

import { useAccount } from 'wagmi';
import TokenDistributionChart from '../components/marketplace/TokenDistributionChart';
import TaskTable from '../components/marketplace/TaskTable';
import WalletNotConnected from '../components/wallet/WalletNotConnected';
import ErrorMessage from '../components/ui/ErrorMessage';
import { useTasks } from '../hooks/useTasks';

const TasksPage = () => {
  const { isConnected } = useAccount();

  const {
    tasks,
    isLoading,
    error,
    loadingStates,
    filters,
    setFilters,
    handleClaimTask,
    handleStakeTask,
    handleCompleteTask,
    handleApproveTask,
    handleAcceptPayment,
    clearError,
  } = useTasks();

  return (
    <div className="animate-fade-in">
      {/* Page Header */}
      <div className="mb-10 text-center">
        <h1 className="font-display text-4xl font-medium tracking-tight mb-2" style={{ letterSpacing: '-0.03em' }}>
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
          {/* Token Distribution Chart */}
          <TokenDistributionChart />

          {/* Error display */}
          {error && (
            <div className="mb-4">
              <ErrorMessage message={error} onDismiss={clearError} />
            </div>
          )}

          {/* Task Table */}
          <div className="mb-6">
            <TaskTable
              tasks={tasks}
              isLoading={isLoading}
              loadingStates={loadingStates}
              filters={filters}
              setFilters={setFilters}
              onClaimTask={handleClaimTask}
              onStakeTask={handleStakeTask}
              onCompleteTask={handleCompleteTask}
              onApproveTask={handleApproveTask}
              onAcceptPayment={handleAcceptPayment}
            />
          </div>
        </>
      )}
    </div>
  );
};

export default TasksPage;
