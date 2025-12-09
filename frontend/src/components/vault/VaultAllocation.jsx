import React, { useMemo } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { Skeleton } from '../ui/skeleton';

// Default colors for known assets, with dynamic fallback for new assets
const ASSET_COLORS = {
  BTC: '#F7931A',
  GOLD: '#FFD700',
  STABLE: '#2775CA',
  ROSE: '#D4AF8C',
};

// Generate a color from asset key hash for unknown assets
function generateAssetColor(key) {
  if (ASSET_COLORS[key]) return ASSET_COLORS[key];

  // Simple hash to generate consistent color
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = key.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash % 360);
  return `hsl(${hue}, 70%, 50%)`;
}

const VaultAllocation = ({ breakdown, isLoading, needsRebalance }) => {
  // Use dynamic assets if available, fall back to legacy structure
  const chartData = useMemo(() => {
    if (!breakdown) return [];

    // Check if we have the new dynamic assets array
    if (breakdown.assets && breakdown.assets.length > 0) {
      return breakdown.assets
        .map(asset => ({
          key: asset.key,
          name: asset.displayName,
          value: asset.value,
          percentage: asset.percentage,
          targetPercentage: asset.targetPercentage,
          driftBps: asset.driftBps,
          color: generateAssetColor(asset.key),
        }))
        .filter(item => item.value > 0);
    }

    // Fallback to legacy structure
    return [
      { key: 'BTC', name: 'BTC', value: breakdown.btc.value, percentage: breakdown.btc.percentage, color: ASSET_COLORS.BTC },
      { key: 'GOLD', name: 'Gold', value: breakdown.gold.value, percentage: breakdown.gold.percentage, color: ASSET_COLORS.GOLD },
      { key: 'STABLE', name: 'USDC', value: breakdown.usdc.value, percentage: breakdown.usdc.percentage, color: ASSET_COLORS.STABLE },
      { key: 'ROSE', name: 'ROSE', value: breakdown.rose.value, percentage: breakdown.rose.percentage, color: ASSET_COLORS.ROSE },
    ].filter(item => item.value > 0);
  }, [breakdown]);

  const formatUSD = (value) => {
    return value.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  };

  const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div
          className="rounded-xl p-4"
          style={{
            background: 'var(--bg-card-solid)',
            border: '1px solid var(--border-accent)',
            boxShadow: 'var(--shadow-card)'
          }}
        >
          <p className="font-semibold mb-1" style={{ color: data.color }}>{data.name}</p>
          <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{formatUSD(data.value)}</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {data.percentage.toFixed(1)}%
            {data.targetPercentage !== undefined && (
              <span className="ml-2">
                (Target: {data.targetPercentage.toFixed(1)}%)
              </span>
            )}
          </p>
        </div>
      );
    }
    return null;
  };

  const renderLegend = () => {
    // Dynamically calculate grid columns based on asset count
    const gridCols = chartData.length <= 4 ? 'grid-cols-2' : 'grid-cols-3';

    return (
      <div className={`grid ${gridCols} gap-4 mt-4`}>
        {chartData.map((entry) => {
          const isOverTarget = entry.targetPercentage !== undefined &&
            entry.percentage > entry.targetPercentage + 0.5;
          const isUnderTarget = entry.targetPercentage !== undefined &&
            entry.percentage < entry.targetPercentage - 0.5;

          return (
            <div
              key={entry.key}
              className="flex items-center gap-3 p-3 rounded-xl"
              style={{
                background: 'rgba(255, 255, 255, 0.03)',
                border: entry.driftBps > 500 ? '1px solid rgba(255, 165, 0, 0.4)' : '1px solid var(--border-subtle)'
              }}
            >
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: entry.color }}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                  {entry.name}
                </p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {entry.percentage.toFixed(1)}%
                  {entry.targetPercentage !== undefined && (
                    <span
                      className="ml-1"
                      style={{
                        color: isOverTarget ? '#ffa500' : isUnderTarget ? '#87CEEB' : 'var(--text-muted)'
                      }}
                    >
                      ({isOverTarget ? '+' : isUnderTarget ? '-' : ''}
                      {Math.abs(entry.percentage - entry.targetPercentage).toFixed(1)}%)
                    </span>
                  )}
                </p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {formatUSD(entry.value)}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  if (isLoading) {
    return (
      <div
        className="rounded-[20px] backdrop-blur-[20px] p-7 mb-6 transition-all duration-300"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-subtle)',
          boxShadow: 'var(--shadow-card)'
        }}
      >
        <h2 className="font-display text-xl font-medium mb-5" style={{ letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
          Vault Allocation
        </h2>
        <div className="flex flex-col md:flex-row items-center gap-6">
          <Skeleton className="h-48 w-48 rounded-full" />
          <div className="flex-1 space-y-3">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (!breakdown || breakdown.total === 0) {
    return (
      <div
        className="rounded-[20px] backdrop-blur-[20px] p-7 mb-6 transition-all duration-300"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-subtle)',
          boxShadow: 'var(--shadow-card)'
        }}
      >
        <h2 className="font-display text-xl font-medium mb-5" style={{ letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
          Vault Allocation
        </h2>
        <div className="text-center py-8">
          <p style={{ color: 'var(--text-secondary)' }}>No assets in vault yet.</p>
          <p className="text-sm mt-2" style={{ color: 'var(--text-muted)' }}>Deposit USDC to get started.</p>
        </div>
      </div>
    );
  }

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
          Vault Allocation
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
            Rebalance Needed
          </span>
        )}
      </div>

      <div className="flex flex-col md:flex-row items-center gap-6">
        <div className="w-48 h-48">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={80}
                paddingAngle={2}
                dataKey="value"
              >
                {chartData.map((entry) => (
                  <Cell
                    key={`cell-${entry.key}`}
                    fill={entry.color}
                    stroke="none"
                  />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="flex-1 w-full">
          {renderLegend()}

          <div
            className="mt-5 pt-5"
            style={{ borderTop: '1px solid var(--border-subtle)' }}
          >
            <div className="flex justify-between items-center">
              <div>
                <p className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>Total Vault Value</p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {chartData.length} assets
                </p>
              </div>
              <p className="font-display text-xl font-semibold" style={{ color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
                {formatUSD(breakdown.total)}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VaultAllocation;
