import React, { useMemo, useState, useEffect } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { Skeleton } from '../ui/skeleton';
import { useNavHistory } from '../../hooks/useNavHistory';

/**
 * Read CSS variable values for use in Recharts SVG attributes
 * (SVG attributes don't support var() syntax directly)
 */
function useChartColors() {
  const [colors, setColors] = useState({
    grid: 'rgba(255, 255, 255, 0.06)',
    axis: 'rgba(255, 255, 255, 0.1)',
    stroke: '#d4af8c',
    fillStart: 'rgba(212, 175, 140, 0.4)',
    fillEnd: 'rgba(212, 175, 140, 0.05)',
  });

  useEffect(() => {
    const root = document.documentElement;
    const computedStyle = getComputedStyle(root);

    setColors({
      grid: computedStyle.getPropertyValue('--chart-grid').trim() || colors.grid,
      axis: computedStyle.getPropertyValue('--chart-axis').trim() || colors.axis,
      stroke: computedStyle.getPropertyValue('--chart-rose-gold').trim() || colors.stroke,
      fillStart: computedStyle.getPropertyValue('--chart-rose-gold-fill-start').trim() || colors.fillStart,
      fillEnd: computedStyle.getPropertyValue('--chart-rose-gold-fill-end').trim() || colors.fillEnd,
    });
  }, []);

  return colors;
}

/**
 * Format date for X-axis tick marks (monthly)
 */
function formatMonthTick(timestamp) {
  const date = new Date(timestamp);
  const month = date.toLocaleString('en-US', { month: 'short' });
  const year = date.getFullYear().toString().slice(-2);
  return `${month} '${year}`;
}

/**
 * Format date for tooltip
 */
function formatTooltipDate(timestamp) {
  return new Date(timestamp).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Format USD value
 */
function formatUSD(value, decimals = 2) {
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Custom tooltip component matching existing vault styling
 */
const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload || !payload.length) return null;

  const data = payload[0].payload;

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
        {formatTooltipDate(label)}
      </p>
      <div className="space-y-1">
        <div className="flex justify-between gap-4">
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            ROSE Price
          </span>
          <span
            className="text-sm font-medium"
            style={{ color: 'var(--rose-gold)' }}
          >
            {formatUSD(data.price)}
          </span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Total Assets
          </span>
          <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {formatUSD(data.totalAssets, 0)}
          </span>
        </div>
      </div>
    </div>
  );
};

/**
 * Calculate Y-axis domain with padding
 */
function calculateYDomain(data) {
  if (!data || data.length === 0) return [0, 2];

  const prices = data.map((d) => d.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min;
  const padding = range * 0.1 || 0.1; // 10% padding or minimum 0.1

  return [Math.max(0, min - padding), max + padding];
}

/**
 * Get monthly tick values for X-axis
 */
function getMonthlyTicks(data) {
  if (!data || data.length === 0) return [];

  const ticks = [];
  let lastMonth = -1;
  let lastYear = -1;

  // Sample data to get ~12-15 ticks max
  const step = Math.max(1, Math.floor(data.length / 36)); // Roughly one tick per month for 3 years

  for (let i = 0; i < data.length; i += step) {
    const date = new Date(data[i].date);
    const month = date.getMonth();
    const year = date.getFullYear();

    if (month !== lastMonth || year !== lastYear) {
      ticks.push(data[i].date);
      lastMonth = month;
      lastYear = year;
    }
  }

  return ticks;
}

const NavHistoryChart = () => {
  const { data, isLoading, error } = useNavHistory({
    limit: 1100,
    interval: 'daily',
  });
  const chartColors = useChartColors();

  const chartData = useMemo(() => data?.snapshots || [], [data]);
  const yDomain = useMemo(() => calculateYDomain(chartData), [chartData]);
  const monthlyTicks = useMemo(() => getMonthlyTicks(chartData), [chartData]);

  // Loading state
  if (isLoading) {
    return (
      <div
        className="rounded-[20px] backdrop-blur-[20px] p-7 mb-6 transition-colors duration-300"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-subtle)',
          boxShadow: 'var(--shadow-card)',
        }}
      >
        <h2
          className="font-display text-xl font-medium mb-5"
          style={{ letterSpacing: '-0.02em', color: 'var(--text-primary)' }}
        >
          NAV Price History
        </h2>
        <Skeleton className="h-[300px] w-full rounded-xl" />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div
        className="rounded-[20px] backdrop-blur-[20px] p-7 mb-6 transition-colors duration-300"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-subtle)',
          boxShadow: 'var(--shadow-card)',
        }}
      >
        <h2
          className="font-display text-xl font-medium mb-5"
          style={{ letterSpacing: '-0.02em', color: 'var(--text-primary)' }}
        >
          NAV Price History
        </h2>
        <div className="text-center py-8">
          <p style={{ color: 'var(--text-secondary)' }}>
            Unable to load price history
          </p>
          <p className="text-sm mt-2" style={{ color: 'var(--text-muted)' }}>
            {error}
          </p>
        </div>
      </div>
    );
  }

  // Empty state
  if (!chartData || chartData.length === 0) {
    return (
      <div
        className="rounded-[20px] backdrop-blur-[20px] p-7 mb-6 transition-colors duration-300"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-subtle)',
          boxShadow: 'var(--shadow-card)',
        }}
      >
        <h2
          className="font-display text-xl font-medium mb-5"
          style={{ letterSpacing: '-0.02em', color: 'var(--text-primary)' }}
        >
          NAV Price History
        </h2>
        <div className="text-center py-8">
          <p style={{ color: 'var(--text-secondary)' }}>
            No historical data available yet
          </p>
          <p className="text-sm mt-2" style={{ color: 'var(--text-muted)' }}>
            Price history will appear after daily snapshots are collected.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="rounded-[20px] backdrop-blur-[20px] p-7 mb-6"
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-subtle)',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      <h2
        className="font-display text-xl font-medium mb-5"
        style={{ letterSpacing: '-0.02em', color: 'var(--text-primary)' }}
      >
        NAV Price History
      </h2>

      <div className="h-[300px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={chartData}
            margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
          >
            <defs>
              <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={chartColors.stroke} stopOpacity={0.4} />
                <stop offset="100%" stopColor={chartColors.stroke} stopOpacity={0.05} />
              </linearGradient>
            </defs>

            <CartesianGrid
              strokeDasharray="3 3"
              stroke={chartColors.grid}
              vertical={false}
            />

            <XAxis
              dataKey="date"
              type="number"
              domain={['dataMin', 'dataMax']}
              scale="time"
              ticks={monthlyTicks}
              tickFormatter={formatMonthTick}
              tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
              axisLine={{ stroke: chartColors.axis }}
              tickLine={{ stroke: chartColors.axis }}
              interval="preserveStartEnd"
            />

            <YAxis
              domain={yDomain}
              tickFormatter={(val) => `$${val.toFixed(2)}`}
              tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
              axisLine={{ stroke: chartColors.axis }}
              tickLine={{ stroke: chartColors.axis }}
              width={60}
            />

            <Tooltip content={<CustomTooltip />} />

            <Area
              type="monotone"
              dataKey="price"
              stroke={chartColors.stroke}
              strokeWidth={2}
              fill="url(#priceGradient)"
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Summary stats below chart */}
      <div
        className="mt-5 pt-5 grid grid-cols-2 md:grid-cols-4 gap-4"
        style={{ borderTop: '1px solid var(--border-subtle)' }}
      >
        <div>
          <p
            className="text-[0.6875rem] font-semibold uppercase tracking-wide mb-1"
            style={{ color: 'var(--text-muted)', letterSpacing: '0.08em' }}
          >
            Data Points
          </p>
          <p
            className="text-sm font-medium"
            style={{ color: 'var(--text-primary)' }}
          >
            {chartData.length.toLocaleString()} days
          </p>
        </div>
        <div>
          <p
            className="text-[0.6875rem] font-semibold uppercase tracking-wide mb-1"
            style={{ color: 'var(--text-muted)', letterSpacing: '0.08em' }}
          >
            Earliest
          </p>
          <p
            className="text-sm font-medium"
            style={{ color: 'var(--text-primary)' }}
          >
            {chartData.length > 0
              ? new Date(chartData[0].date).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })
              : '-'}
          </p>
        </div>
        <div>
          <p
            className="text-[0.6875rem] font-semibold uppercase tracking-wide mb-1"
            style={{ color: 'var(--text-muted)', letterSpacing: '0.08em' }}
          >
            Latest
          </p>
          <p
            className="text-sm font-medium"
            style={{ color: 'var(--text-primary)' }}
          >
            {chartData.length > 0
              ? new Date(chartData[chartData.length - 1].date).toLocaleDateString(
                  'en-US',
                  { month: 'short', day: 'numeric', year: 'numeric' }
                )
              : '-'}
          </p>
        </div>
        <div>
          <p
            className="text-[0.6875rem] font-semibold uppercase tracking-wide mb-1"
            style={{ color: 'var(--text-muted)', letterSpacing: '0.08em' }}
          >
            Latest Price
          </p>
          <p
            className="text-sm font-medium"
            style={{ color: 'var(--rose-gold)' }}
          >
            {chartData.length > 0
              ? formatUSD(chartData[chartData.length - 1].price)
              : '-'}
          </p>
        </div>
      </div>
    </div>
  );
};

export default NavHistoryChart;
