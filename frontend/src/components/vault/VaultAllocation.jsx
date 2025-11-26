import React, { useMemo } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { Skeleton } from '../ui/skeleton';

const ASSET_COLORS = {
  BTC: '#F7931A',
  ETH: '#627EEA',
  Gold: '#FFD700',
  USDC: '#2775CA',
};

const VaultAllocation = ({ breakdown, isLoading }) => {
  const chartData = useMemo(() => {
    if (!breakdown) return [];

    return [
      { name: 'BTC', value: breakdown.btc.value, percentage: breakdown.btc.percentage },
      { name: 'ETH', value: breakdown.eth.value, percentage: breakdown.eth.percentage },
      { name: 'Gold', value: breakdown.gold.value, percentage: breakdown.gold.percentage },
      { name: 'USDC', value: breakdown.usdc.value, percentage: breakdown.usdc.percentage },
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
          <p className="font-semibold mb-1" style={{ color: ASSET_COLORS[data.name] }}>{data.name}</p>
          <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{formatUSD(data.value)}</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{data.percentage.toFixed(1)}%</p>
        </div>
      );
    }
    return null;
  };

  const renderLegend = () => (
    <div className="grid grid-cols-2 gap-4 mt-4">
      {chartData.map((entry) => (
        <div
          key={entry.name}
          className="flex items-center gap-3 p-3 rounded-xl"
          style={{ background: 'rgba(255, 255, 255, 0.03)', border: '1px solid var(--border-subtle)' }}
        >
          <div
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: ASSET_COLORS[entry.name] }}
          />
          <div className="flex-1">
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{entry.name}</p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {entry.percentage.toFixed(1)}% ({formatUSD(entry.value)})
            </p>
          </div>
        </div>
      ))}
    </div>
  );

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
      <h2 className="font-display text-xl font-medium mb-5" style={{ letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
        Vault Allocation
      </h2>

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
                    key={`cell-${entry.name}`}
                    fill={ASSET_COLORS[entry.name]}
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
              <p className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>Total Vault Value</p>
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
