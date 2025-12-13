/**
 * Governance Chart Component
 * Proposal and voting activity visualization
 */

import React, { useMemo, useState, useEffect } from 'react';
import {
  LineChart,
  Line,
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
    primary: '#d4af8c',
    secondary: '#60a5fa',
  });

  useEffect(() => {
    const root = document.documentElement;
    const style = getComputedStyle(root);
    setColors({
      grid: style.getPropertyValue('--chart-grid').trim() || colors.grid,
      axis: style.getPropertyValue('--chart-axis').trim() || colors.axis,
      primary: style.getPropertyValue('--chart-rose-gold').trim() || colors.primary,
      secondary: '#60a5fa',
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
              {entry.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

const GovernanceChart = ({ data, isLoading }) => {
  const colors = useChartColors();

  const chartData = useMemo(() => {
    if (!data?.data) return [];
    return data.data.map(d => ({
      date: d.date,
      Proposals: d.proposalsCreated,
      Votes: d.votesCast,
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
          Governance Activity
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
          Governance Activity
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
        Governance Activity
      </h2>
      <div className="h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={formatDate}
              tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
              axisLine={{ stroke: colors.axis }}
              tickLine={{ stroke: colors.axis }}
            />
            <YAxis
              tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
              axisLine={{ stroke: colors.axis }}
              tickLine={{ stroke: colors.axis }}
              width={40}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              wrapperStyle={{ paddingTop: '20px' }}
              iconType="line"
              iconSize={10}
            />
            <Line
              type="monotone"
              dataKey="Proposals"
              stroke={colors.primary}
              strokeWidth={2}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="Votes"
              stroke={colors.secondary}
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default GovernanceChart;
