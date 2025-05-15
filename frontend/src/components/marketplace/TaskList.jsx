import React from 'react';
import TaskCard from './TaskCard';
import ErrorMessage from '../ui/ErrorMessage';

const TaskList = ({ tasks, onClaim, onComplete, onApprove, onDispute, onAcceptPayment, isLoading, isRefreshing, error, onErrorDismiss, roseMarketplace }) => {
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
      </div>
    );
  }
  
  return (
    <div>
      {isRefreshing && (
        <div className="bg-blue-50 text-blue-700 p-2 mb-4 rounded-md text-sm text-center">
          Refreshing tasks...
        </div>
      )}
      {tasks.map((task) => (
        <TaskCard
          key={task.id}
          task={task}
          onClaim={onClaim}
          onComplete={onComplete}
          onApprove={onApprove}
          onDispute={onDispute}
          onAcceptPayment={onAcceptPayment}
          roseMarketplace={roseMarketplace}
        />
      ))}
    </div>
  );
};

export default TaskList;
