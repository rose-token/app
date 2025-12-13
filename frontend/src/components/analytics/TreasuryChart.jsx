/**
 * Treasury Chart Component
 * Deposit/redemption flows visualization
 */

import React, { useMemo, useState, useEffect } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from 'recharts';
import { Skeleton } from '../ui/skeleton';

/**
 * Read CSS variable values for use in Recharts SVG attributes
 */
function useChartColors() {
  const [colors, setColors] = useState({
    grid: 'rgba(255, 255, 255, 0.06)',
    axis: 'rgba(255, 255, 255, 0.1)',
    success: '#4ade80',
    error: '#f87171',
  });

  useEffect(() => {
    const root = document.documentElement;
    const style = getComputedStyle(root);
    setColors({
      grid: style.getPropertyValue('--chart-grid').trim() || colors.grid,
      axis: style.getPropertyValue('--chart-axis').trim() || colors.axis,
      success: style.getPropertyValue('--success').trim() || colors.success,
      error: style.getPropertyValue('--error').trim() || colors.error,
    });
  }, []);

  return colors;
}

/**
 * Format date for X-axis
 */
function formatDate(dateStr) {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Format USD for Y-axis
 */
function formatUSD(value) {
  if (value >= 1e6) return '$' + (value / 1e6).toFixed(1) + 'M';
  if (value >= 1e3) return '$' + (value / 1e3).toFixed(0) + 'K';
  return '$' + value.toFixed(0);
}

/**
 * Custom tooltip
 */
const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload || !payload.length) return null;

  return (
    <div
      className="rounded-xl p-4"
      style={{
        background: 'var(--bg-card-solid)',
        border: '1px solid var(--border-accent)',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      <p
        className="font-semibold mb-2 text-sm"
        style={{ color: 'var(--text-primary)' }}
      >
        {formatDate(label)}
      </p>
      <div className="space-y-1">
        {payload.map((entry, index) => (
          <div key={index} className="flex justify-between gap-4">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {entry.name}
            </span>
            <span className="text-sm font-medium" style={{ color: entry.color }}>
              {formatUSD(entry.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

const TreasuryChart = ({ data, isLoading }) => {
  const colors = useChartColors();

  const chartData = useMemo(() => {
    if (!data?.data) return [];
    return data.data.map(d => ({
      date: d.date,
      Deposits: parseFloat(d.depositsUsd) || 0,
      Redemptions: parseFloat(d.redemptionsUsd) || 0,
    }));
  }, [data]);

  if (isLoading) {
    return (
      <div
        className="rounded-[20px] p-7"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-subtle)',
        }}
      >
        <h2
          className="font-display text-xl font-medium mb-5"
          style={{ color: 'var(--text-primary)' }}
        >
          Treasury Flows
        </h2>
        <Skeleton className="h-[300px] w-full rounded-xl" />
      </div>
    );
  }

  if (!chartData.length) {
    return (
      <div
        className="rounded-[20px] p-7"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-subtle)',
        }}
      >
        <h2
          className="font-display text-xl font-medium mb-5"
          style={{ color: 'var(--text-primary)' }}
        >
          Treasury Flows
        </h2>
        <div className="h-[300px] flex items-center justify-center">
          <p style={{ color: 'var(--text-secondary)' }}>No data available</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="rounded-[20px] p-7 transition-all hover:border-[rgba(212,175,140,0.35)]"
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-subtle)',
      }}
    >
      <h2
        className="font-display text-xl font-medium mb-5"
        style={{ color: 'var(--text-primary)' }}
      >
        Treasury Flows
      </h2>
      <div className="h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="depositsGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={colors.success} stopOpacity={0.4} />
                <stop offset="100%" stopColor={colors.success} stopOpacity={0.05} />
              </linearGradient>
              <linearGradient id="redemptionsGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={colors.error} stopOpacity={0.4} />
                <stop offset="100%" stopColor={colors.error} stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={formatDate}
              tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
              axisLine={{ stroke: colors.axis }}
              tickLine={{ stroke: colors.axis }}
            />
            <YAxis
              tickFormatter={formatUSD}
              tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
              axisLine={{ stroke: colors.axis }}
              tickLine={{ stroke: colors.axis }}
              width={60}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              wrapperStyle={{ paddingTop: '20px' }}
              iconType="rect"
              iconSize={10}
            />
            <Area
              type="monotone"
              dataKey="Deposits"
              stroke={colors.success}
              strokeWidth={2}
              fill="url(#depositsGradient)"
            />
            <Area
              type="monotone"
              dataKey="Redemptions"
              stroke={colors.error}
              strokeWidth={2}
              fill="url(#redemptionsGradient)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default TreasuryChart;
