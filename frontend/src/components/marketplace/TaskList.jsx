import React from 'react';
import TaskCard from './TaskCard';
import ErrorMessage from '../ui/ErrorMessage';
import { RefreshCw } from 'lucide-react';

const TaskList = ({ tasks, onClaim, onUnclaim, onComplete, onApprove, onAcceptPayment, onStake, onUnstake, onCancel, isLoading, isRefreshing, error, onErrorDismiss, roseMarketplace, onRefresh, loadingStates }) => {
  if (isLoading && tasks.length === 0) {
    return (
      <div className="text-center py-8" style={{ color: 'var(--text-secondary)' }}>
        Loading tasks...
      </div>
    );
  }

  if (error) {
    return (
      <ErrorMessage message={error} onDismiss={onErrorDismiss} />
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="text-center py-8">
        <p style={{ color: 'var(--text-secondary)' }}>No tasks available.</p>
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>Create a new task to get started!</p>
        {onRefresh && (
          <div className="mt-4">
            <button
              onClick={onRefresh}
              disabled={isRefreshing}
              className="inline-flex items-center px-4 py-2 text-sm font-medium rounded-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background: 'transparent',
                border: '1px solid var(--border-accent)',
                color: 'var(--rose-gold)'
              }}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
              Refresh Tasks
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <div>
          {isRefreshing && (
            <div
              className="p-2 rounded-xl text-sm flex items-center gap-2"
              style={{
                background: 'rgba(212, 175, 140, 0.1)',
                border: '1px solid var(--border-accent)',
                color: 'var(--rose-gold)'
              }}
            >
              <RefreshCw className="h-4 w-4 animate-spin" />
              Refreshing tasks...
            </div>
          )}
        </div>
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className="inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:border-[rgba(212,175,140,0.5)]"
            style={{
              background: 'transparent',
              border: '1px solid var(--border-accent)',
              color: 'var(--rose-gold)'
            }}
          >
            <RefreshCw className={`h-4 w-4 mr-1 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        )}
      </div>
      {tasks.map((task) => (
        <TaskCard
          key={task.id}
          task={task}
          onClaim={onClaim}
          onUnclaim={onUnclaim}
          onComplete={onComplete}
          onApprove={onApprove}
          onAcceptPayment={onAcceptPayment}
          onStake={onStake}
          onUnstake={onUnstake}
          onCancel={onCancel}
          roseMarketplace={roseMarketplace}
          loadingStates={loadingStates}
        />
      ))}
    </div>
  );
};

export default TaskList;
