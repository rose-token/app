import React, { useMemo } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
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
        <div className="bg-card border border-border rounded-lg shadow-lg p-3">
          <p className="font-semibold text-foreground">{data.name}</p>
          <p className="text-foreground">{formatUSD(data.value)}</p>
          <p className="text-foreground">{data.percentage.toFixed(1)}%</p>
        </div>
      );
    }
    return null;
  };

  const renderLegend = () => (
    <div className="grid grid-cols-2 gap-3 mt-4">
      {chartData.map((entry) => (
        <div key={entry.name} className="flex items-center space-x-2">
          <div
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: ASSET_COLORS[entry.name] }}
          />
          <div className="flex-1">
            <p className="text-sm font-medium text-foreground">{entry.name}</p>
            <p className="text-xs text-foreground">
              {entry.percentage.toFixed(1)}% ({formatUSD(entry.value)})
            </p>
          </div>
        </div>
      ))}
    </div>
  );

  if (isLoading) {
    return (
      <div className="bg-white rounded-lg shadow-md p-6 mb-6">
        <h2 className="text-xl font-semibold text-foreground mb-4">Vault Allocation</h2>
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
      <div className="bg-white rounded-lg shadow-md p-6 mb-6">
        <h2 className="text-xl font-semibold text-foreground mb-4">Vault Allocation</h2>
        <div className="text-center py-8 text-foreground">
          <p>No assets in vault yet.</p>
          <p className="text-sm mt-2">Deposit USDC to get started.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-md p-6 mb-6">
      <h2 className="text-xl font-semibold text-foreground mb-4">Vault Allocation</h2>

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

          <div className="mt-4 pt-4 border-t border-border">
            <div className="flex justify-between items-center">
              <p className="text-sm font-medium text-foreground">Total Vault Value</p>
              <p className="text-lg font-bold text-foreground">{formatUSD(breakdown.total)}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VaultAllocation;
