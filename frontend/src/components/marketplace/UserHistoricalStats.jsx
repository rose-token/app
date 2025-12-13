/**
 * UserHistoricalStats component
 * Displays user's marketplace activity stats in a horizontal card
 */

import React from 'react';
import { useAccount } from 'wagmi';
import { useReputation } from '../../hooks/useReputation';
import { Briefcase, RefreshCw } from 'lucide-react';
import Spinner from '../ui/Spinner';
import Stagger from '../ui/Stagger';

/**
 * UserHistoricalStats - Displays user's marketplace activity metrics
 */
const UserHistoricalStats = () => {
  const { address, isConnected } = useAccount();
  const { reputation, loading, refetch } = useReputation(address);

  // Calculate in-progress tasks (claimed but not completed)
  const inProgress = reputation
    ? Math.max(0, reputation.tasksClaimed - reputation.tasksAsWorker)
    : 0;

  // Check if user has any history
  const hasHistory = reputation && (
    reputation.tasksAsWorker > 0 ||
    reputation.tasksAsStakeholder > 0 ||
    reputation.tasksAsCustomer > 0
  );

  // Refresh handler with loading state
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refetch();
    setIsRefreshing(false);
  };

  if (!isConnected) {
    return null;
  }

  if (loading) {
    return <HistoricalStatsSkeleton />;
  }

  return (
    <div
      className="rounded-[20px] backdrop-blur-[20px] p-7 mb-8 transition-all duration-300 hover:border-[rgba(212,175,140,0.35)]"
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-subtle)',
        boxShadow: 'var(--shadow-card)'
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h2
          className="font-display text-xl font-medium"
          style={{ letterSpacing: '-0.02em', color: 'var(--text-primary)' }}
        >
          Your Marketplace Activity
        </h2>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all duration-200 hover:bg-[rgba(255,255,255,0.05)]"
          style={{ color: 'var(--text-secondary)' }}
          title="Refresh stats"
        >
          {isRefreshing ? (
            <Spinner className="h-4 w-4" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          <span className="text-sm font-medium">Refresh</span>
        </button>
      </div>

      {!hasHistory ? (
        // Empty state
        <EmptyState />
      ) : (
        // Stats grid with staggered animation
        <Stagger delay={60} className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-4">
          <StatCard
            label="Completed"
            value={reputation?.tasksAsWorker || 0}
            color="var(--success)"
          />
          <StatCard
            label="Validated"
            value={reputation?.tasksAsStakeholder || 0}
            color="var(--info)"
          />
          <StatCard
            label="Created"
            value={reputation?.tasksAsCustomer || 0}
            color="var(--warning)"
          />
          <StatCard
            label="In Progress"
            value={inProgress}
            color="var(--rose-gold)"
          />
          <StatCard
            label="Disputed"
            value={reputation?.disputesInitiated || 0}
            color="var(--error)"
          />
          <StatCard
            label="Earned"
            value={formatEarned(reputation?.totalEarned || '0')}
            suffix="ROSE"
            color="var(--rose-pink)"
          />
          <StatCard
            label="Rep Score"
            value={reputation?.reputationScore || 0}
            suffix="%"
            color="var(--rose-gold)"
          />
        </Stagger>
      )}
    </div>
  );
};

/**
 * Individual stat card
 */
const StatCard = ({ label, value, suffix, color }) => (
  <div
    className="rounded-xl p-4 text-center transition-all duration-200 hover:bg-[rgba(255,255,255,0.04)]"
    style={{
      background: 'rgba(255, 255, 255, 0.02)',
      border: '1px solid var(--border-subtle)'
    }}
  >
    <div
      className="text-xs font-semibold uppercase tracking-wide mb-2"
      style={{ color, letterSpacing: '0.06em' }}
    >
      {label}
    </div>
    <div
      className="font-display text-xl font-semibold"
      style={{ color: 'var(--text-primary)', letterSpacing: '-0.02em' }}
    >
      {value}
      {suffix && (
        <span
          className="text-xs font-normal ml-1"
          style={{ color: 'var(--text-secondary)' }}
        >
          {suffix}
        </span>
      )}
    </div>
  </div>
);

/**
 * Empty state message
 */
const EmptyState = () => (
  <div
    className="py-8 text-center rounded-xl"
    style={{
      background: 'rgba(255, 255, 255, 0.02)',
      border: '1px solid var(--border-subtle)'
    }}
  >
    <Briefcase
      className="h-10 w-10 mx-auto mb-3"
      style={{ color: 'var(--text-muted)' }}
    />
    <p
      className="text-sm font-medium mb-1"
      style={{ color: 'var(--text-secondary)' }}
    >
      No marketplace activity yet
    </p>
    <p
      className="text-sm"
      style={{ color: 'var(--text-muted)' }}
    >
      Complete your first task to start building history
    </p>
  </div>
);

/**
 * Loading skeleton
 */
const HistoricalStatsSkeleton = () => (
  <div
    className="rounded-[20px] backdrop-blur-[20px] p-7 mb-8"
    style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border-subtle)',
      boxShadow: 'var(--shadow-card)'
    }}
  >
    {/* Header skeleton */}
    <div className="flex items-center justify-between mb-5">
      <div
        className="h-7 w-48 rounded animate-pulse"
        style={{ backgroundColor: 'var(--bg-tertiary)' }}
      />
      <div
        className="h-8 w-24 rounded-lg animate-pulse"
        style={{ backgroundColor: 'var(--bg-tertiary)' }}
      />
    </div>
    {/* Stats grid skeleton */}
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-4">
      {[1, 2, 3, 4, 5, 6, 7].map((i) => (
        <div
          key={i}
          className="h-20 rounded-xl animate-pulse"
          style={{ backgroundColor: 'var(--bg-tertiary)' }}
        />
      ))}
    </div>
  </div>
);

/**
 * Format earned amount for display
 */
const formatEarned = (earned) => {
  const num = parseFloat(earned);

  if (isNaN(num) || num === 0) return '0';

  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  if (num >= 1) {
    return num.toFixed(2);
  }

  return num.toFixed(4);
};

export default UserHistoricalStats;
