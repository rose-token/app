/**
 * Overview Cards Component
 * Summary stat cards for the analytics dashboard
 */

import React from 'react';
import { Skeleton } from '../ui/skeleton';

/**
 * Format large numbers with K/M/B suffixes
 */
function formatNumber(num) {
  if (num >= 1e9) return (num / 1e9).toFixed(1) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
  return num.toString();
}

/**
 * Format Wei to ROSE with suffix
 */
function formatRose(weiStr) {
  if (!weiStr) return '0';
  const rose = parseFloat(weiStr) / 1e18;
  return formatNumber(Math.round(rose));
}

/**
 * Format USD value
 */
function formatUSD(value) {
  const num = parseFloat(value) || 0;
  if (num >= 1e6) return '$' + (num / 1e6).toFixed(2) + 'M';
  if (num >= 1e3) return '$' + (num / 1e3).toFixed(1) + 'K';
  return '$' + num.toFixed(2);
}

/**
 * Single stat card
 */
const StatCard = ({ title, value, subtitle, color = 'var(--text-primary)', loading }) => {
  if (loading) {
    return (
      <div
        className="rounded-[16px] p-5"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-subtle)',
        }}
      >
        <Skeleton className="h-4 w-24 mb-2" />
        <Skeleton className="h-8 w-16 mb-1" />
        <Skeleton className="h-3 w-20" />
      </div>
    );
  }

  return (
    <div
      className="rounded-[16px] p-5 transition-all hover:border-[rgba(212,175,140,0.35)]"
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-subtle)',
      }}
    >
      <p
        className="text-xs font-semibold uppercase tracking-wide mb-2"
        style={{ color: 'var(--text-muted)', letterSpacing: '0.08em' }}
      >
        {title}
      </p>
      <p
        className="text-2xl font-semibold mb-1"
        style={{ color }}
      >
        {value}
      </p>
      {subtitle && (
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          {subtitle}
        </p>
      )}
    </div>
  );
};

const OverviewCards = ({ data, isLoading }) => {
  const marketplace = data?.marketplace || {};
  const governance = data?.governance || {};
  const treasury = data?.treasury || {};
  const users = data?.users || {};

  // Calculate completion rate
  const completionRate = marketplace.totalTasks > 0
    ? ((marketplace.completedTasks / marketplace.totalTasks) * 100).toFixed(1)
    : '0';

  // Calculate dispute rate
  const disputeRate = marketplace.totalTasks > 0
    ? ((marketplace.disputedTasks / marketplace.totalTasks) * 100).toFixed(1)
    : '0';

  // Calculate proposal pass rate
  const passRate = governance.totalProposals > 0
    ? ((governance.passedProposals / governance.totalProposals) * 100).toFixed(1)
    : '0';

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
      {/* Marketplace */}
      <StatCard
        title="Tasks Completed"
        value={isLoading ? '-' : `${marketplace.completedTasks || 0}`}
        subtitle={`${completionRate}% completion rate`}
        color="var(--success)"
        loading={isLoading}
      />
      <StatCard
        title="Dispute Rate"
        value={isLoading ? '-' : `${disputeRate}%`}
        subtitle={`${marketplace.disputedTasks || 0} disputed`}
        color={parseFloat(disputeRate) > 10 ? 'var(--error)' : 'var(--text-primary)'}
        loading={isLoading}
      />

      {/* Governance */}
      <StatCard
        title="Proposals Passed"
        value={isLoading ? '-' : `${governance.passedProposals || 0}`}
        subtitle={`${passRate}% pass rate`}
        color="var(--rose-gold)"
        loading={isLoading}
      />

      {/* Treasury */}
      <StatCard
        title="Treasury NAV"
        value={isLoading ? '-' : formatUSD(treasury.totalAssetsUsd)}
        subtitle={`ROSE: ${formatUSD(treasury.rosePrice)}`}
        color="var(--rose-gold)"
        loading={isLoading}
      />

      {/* Users */}
      <StatCard
        title="Active Users (30d)"
        value={isLoading ? '-' : `${users.activeUsers30d || 0}`}
        subtitle={`${users.newUsers7d || 0} new this week`}
        loading={isLoading}
      />
    </div>
  );
};

export default OverviewCards;
