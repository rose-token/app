/**
 * CreateTaskPage - Dedicated page for task creation
 *
 * Route: /create-task
 * Wraps CreateTaskForm with page layout and navigation
 */

import { Link, useNavigate } from 'react-router-dom';
import { useAccount } from 'wagmi';
import CreateTaskForm from '../components/marketplace/CreateTaskForm';
import WalletNotConnected from '../components/wallet/WalletNotConnected';

const CreateTaskPage = () => {
  const navigate = useNavigate();
  const { isConnected } = useAccount();

  // Callback when task is created successfully
  const handleTaskCreated = (taskData) => {
    // Navigate back to tasks list with optimistic task data
    navigate('/', { state: { newTask: taskData } });
  };

  if (!isConnected) {
    return (
      <div className="animate-page-entrance">
        <WalletNotConnected />
      </div>
    );
  }

  return (
    <div className="animate-page-entrance">
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
      <div className="mb-8 text-center">
        <h1 className="font-display text-3xl font-medium tracking-tight mb-2" style={{ letterSpacing: '-0.03em' }}>
          Create a <span className="gradient-text">New Task</span>
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '1rem' }}>
          Post a task for the community to complete
        </p>
      </div>

      {/* Task Creation Form */}
      <CreateTaskForm onTaskCreated={handleTaskCreated} />
    </div>
  );
};

export default CreateTaskPage;
