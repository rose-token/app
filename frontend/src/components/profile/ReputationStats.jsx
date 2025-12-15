/**
 * ReputationStats component
 * Displays on-chain reputation metrics (tasks completed, earnings)
 */

import React from 'react';
import { useReputation, getReputationSummary } from '../../hooks/useReputation';
import { Briefcase, Shield, Users, Coins, RefreshCw } from 'lucide-react';
import ReputationBadge from '../governance/ReputationBadge';

/**
 * ReputationStats - Displays reputation metrics for an address
 * @param {Object} props
 * @param {string} props.address - Ethereum address
 * @param {string} props.variant - Display variant: 'card' | 'inline' | 'compact' (default: 'card')
 */
const ReputationStats = ({ address, variant = 'card' }) => {
  const { reputation, loading, error, refetch } = useReputation(address);
  const summary = getReputationSummary(reputation);

  if (loading) {
    return <ReputationSkeleton variant={variant} />;
  }

  if (error && !reputation) {
    return (
      <div
        className="text-sm text-center py-4"
        style={{ color: 'var(--text-secondary)' }}
      >
        Unable to load reputation
      </div>
    );
  }

  if (variant === 'compact') {
    return <CompactStats summary={summary} />;
  }

  if (variant === 'inline') {
    return <InlineStats summary={summary} />;
  }

  return <CardStats summary={summary} reputation={reputation} onRefresh={refetch} />;
};

/**
 * Card variant - Full stats display
 */
const CardStats = ({ summary, reputation, onRefresh }) => {
  return (
    <div
      className="rounded-xl p-4"
      style={{
        backgroundColor: 'var(--bg-secondary)',
        border: '1px solid var(--border-color)',
      }}
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h3
            className="text-sm font-semibold uppercase tracking-wide"
            style={{ color: 'var(--text-secondary)' }}
          >
            Reputation
          </h3>
          {reputation?.reputationScore !== undefined && (
            <ReputationBadge
              score={reputation.reputationScore}
              size="sm"
              showTooltip={true}
              tasksCompleted={reputation?.governanceStats?.tasksCompleted}
              disputes={reputation?.governanceStats?.disputes}
              failedProposals={reputation?.governanceStats?.failedProposals}
            />
          )}
        </div>
        <button
          type="button"
          onClick={onRefresh}
          className="p-1.5 rounded-lg transition-colors hover:bg-[var(--bg-tertiary)]"
          title="Refresh reputation"
        >
          <RefreshCw className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
        </button>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3">
        {/* Tasks as Worker */}
        <StatBox
          icon={<Briefcase className="w-4 h-4" />}
          label="As Worker"
          value={reputation?.tasksAsWorker || 0}
          color="var(--success)"
        />

        {/* Tasks as Stakeholder */}
        <StatBox
          icon={<Shield className="w-4 h-4" />}
          label="As Validator"
          value={reputation?.tasksAsStakeholder || 0}
          color="var(--info)"
        />

        {/* Tasks as Customer */}
        <StatBox
          icon={<Users className="w-4 h-4" />}
          label="As Customer"
          value={reputation?.tasksAsCustomer || 0}
          color="var(--warning)"
        />

        {/* Total Earned */}
        <StatBox
          icon={<Coins className="w-4 h-4" />}
          label="Earned"
          value={formatEarned(summary.totalEarned)}
          suffix="ROSE"
          color="var(--rose-pink)"
        />
      </div>

      {/* Total tasks footer */}
      <div
        className="mt-3 pt-3 text-center"
        style={{ borderTop: '1px solid var(--border-color)' }}
      >
        <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          Total Tasks:{' '}
          <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
            {summary.totalTasks}
          </span>
        </span>
      </div>
    </div>
  );
};

/**
 * Individual stat box
 */
const StatBox = ({ icon, label, value, suffix, color }) => {
  return (
    <div
      className="rounded-lg p-3 text-center"
      style={{ backgroundColor: 'var(--bg-tertiary)' }}
    >
      <div className="flex items-center justify-center gap-1.5 mb-1.5" style={{ color }}>
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <div className="font-bold text-lg" style={{ color: 'var(--text-primary)' }}>
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
};

/**
 * Inline variant - Horizontal stats
 */
const InlineStats = ({ summary }) => {
  return (
    <div className="flex items-center gap-4 flex-wrap">
      {summary.roles.map(({ role, count }) => (
        <div key={role} className="flex items-center gap-1.5">
          {role === 'Worker' && <Briefcase className="w-4 h-4" style={{ color: 'var(--success)' }} />}
          {role === 'Stakeholder' && <Shield className="w-4 h-4" style={{ color: 'var(--info)' }} />}
          {role === 'Customer' && <Users className="w-4 h-4" style={{ color: 'var(--warning)' }} />}
          <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {count} as {role}
          </span>
        </div>
      ))}

      {summary.totalEarned !== '0' && (
        <div className="flex items-center gap-1.5">
          <Coins className="w-4 h-4" style={{ color: 'var(--rose-pink)' }} />
          <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {formatEarned(summary.totalEarned)} ROSE earned
          </span>
        </div>
      )}
    </div>
  );
};

/**
 * Compact variant - Minimal display
 */
const CompactStats = ({ summary }) => {
  return (
    <div className="flex items-center gap-2">
      <span
        className="text-xs px-2 py-0.5 rounded-full"
        style={{
          backgroundColor: 'var(--bg-tertiary)',
          color: 'var(--text-secondary)',
        }}
      >
        {summary.totalTasks} tasks
      </span>
      {summary.totalEarned !== '0' && (
        <span
          className="text-xs px-2 py-0.5 rounded-full"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--rose-pink) 15%, transparent)',
            color: 'var(--rose-pink)',
          }}
        >
          {formatEarned(summary.totalEarned)} ROSE
        </span>
      )}
    </div>
  );
};

/**
 * Loading skeleton
 */
const ReputationSkeleton = ({ variant }) => {
  if (variant === 'compact') {
    return (
      <div className="flex items-center gap-2">
        <div
          className="w-16 h-5 rounded-full animate-pulse"
          style={{ backgroundColor: 'var(--bg-tertiary)' }}
        />
      </div>
    );
  }

  if (variant === 'inline') {
    return (
      <div className="flex items-center gap-4">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="w-24 h-5 rounded animate-pulse"
            style={{ backgroundColor: 'var(--bg-tertiary)' }}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      className="rounded-xl p-4"
      style={{
        backgroundColor: 'var(--bg-secondary)',
        border: '1px solid var(--border-color)',
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-20 rounded-lg animate-pulse"
            style={{ backgroundColor: 'var(--bg-tertiary)' }}
          />
        ))}
      </div>
    </div>
  );
};

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

export default ReputationStats;
