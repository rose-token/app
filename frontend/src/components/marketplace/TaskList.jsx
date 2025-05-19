import React from 'react';
import TaskCard from './TaskCard';
import ErrorMessage from '../ui/ErrorMessage';
import { RefreshCw } from 'lucide-react';

const TaskList = ({ tasks, onClaim, onComplete, onApprove, onDispute, onAcceptPayment, onStake, isLoading, isRefreshing, error, onErrorDismiss, roseMarketplace, onRefresh }) => {
  if (isLoading && tasks.length === 0) {
    return <div className="text-center py-8">Loading tasks...</div>;
  }
  
  if (error) {
    return (
      <ErrorMessage message={error} onDismiss={onErrorDismiss} />
    );
  }
  
  if (tasks.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        No tasks available. Create a new task to get started!
        {onRefresh && (
          <div className="mt-4">
            <button
              onClick={onRefresh}
              disabled={isRefreshing}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
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
            <div className="bg-blue-50 text-blue-700 p-2 rounded-md text-sm">
              Refreshing tasks...
            </div>
          )}
        </div>
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className="inline-flex items-center px-3 py-1.5 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw className="h-4 w-4 mr-1" />
            Refresh
          </button>
        )}
      </div>
      {tasks.map((task) => (
        <TaskCard
          key={task.id}
          task={task}
          onClaim={onClaim}
          onComplete={onComplete}
          onApprove={onApprove}
          onDispute={onDispute}
          onAcceptPayment={onAcceptPayment}
          onStake={onStake}
          onBid={onBid}
          roseMarketplace={roseMarketplace}
        />
      ))}
    </div>
  );
};

export default TaskList;
