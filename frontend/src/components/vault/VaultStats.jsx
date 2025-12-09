import React from 'react';
import { Skeleton } from '../ui/skeleton';

const StatCard = ({ label, value, isLoading, prefix = '', suffix = '', highlight = false, subtext = null }) => (
  <div
    className="rounded-xl p-5 transition-all duration-300"
    style={{
      background: highlight ? 'var(--rose-pink-muted)' : 'rgba(255, 255, 255, 0.03)',
      border: `1px solid ${highlight ? 'rgba(212, 165, 165, 0.3)' : 'var(--border-subtle)'}`
    }}
  >
    <p
      className="text-[0.6875rem] font-semibold uppercase tracking-wide mb-2"
      style={{ color: 'var(--text-muted)', letterSpacing: '0.08em' }}
    >
      {label}
    </p>
    {isLoading ? (
      <Skeleton className="h-8 w-24" />
    ) : (
      <>
        <p
          className="font-display text-2xl font-semibold"
          style={{ color: 'var(--rose-pink-light)', letterSpacing: '-0.02em' }}
        >
          {prefix}{value !== null ? value : '--'}{suffix}
        </p>
        {subtext && (
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            {subtext}
          </p>
        )}
      </>
    )}
  </div>
);

const VaultStats = ({
  rosePrice,
  vaultValueUSD,
  circulatingSupply,
  roseBalance,
  usdcBalance,
  assetCount,
  needsRebalance,
  isLoading,
  isConnected
}) => {
  const formatUSD = (value) => {
    if (value === null) return '--';
    return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const formatTokens = (value, decimals = 2) => {
    if (value === null) return '--';
    return value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  };

  return (
    <div
      className="rounded-[20px] backdrop-blur-[20px] p-7 mb-6 transition-all duration-300 hover:border-[rgba(212,175,140,0.35)]"
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-subtle)',
        boxShadow: 'var(--shadow-card)'
      }}
    >
      <div className="flex items-center justify-between mb-5">
        <h2 className="font-display text-xl font-medium" style={{ letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
          Vault Overview
        </h2>
        {needsRebalance && (
          <span
            className="text-xs px-2 py-1 rounded-full"
            style={{
              background: 'rgba(255, 165, 0, 0.15)',
              color: '#ffa500',
              border: '1px solid rgba(255, 165, 0, 0.3)'
            }}
          >
            Drift Detected
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <StatCard
          label="ROSE Price"
          value={formatUSD(rosePrice)}
          prefix="$"
          isLoading={isLoading}
          highlight={true}
        />

        <StatCard
          label="ROSE Supply"
          value={formatTokens(circulatingSupply, 0)}
          isLoading={isLoading}
        />

        <StatCard
          label="Assets"
          value={assetCount || '--'}
          isLoading={isLoading}
          subtext="Configured"
        />

        {isConnected && (
          <>
            <StatCard
              label="Your ROSE Balance"
              value={formatTokens(roseBalance)}
              isLoading={isLoading}
            />

            <StatCard
              label="Your USDC Balance"
              value={formatTokens(usdcBalance)}
              isLoading={isLoading}
            />
          </>
        )}
      </div>
    </div>
  );
};

export default VaultStats;
