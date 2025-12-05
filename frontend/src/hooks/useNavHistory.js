/**
 * Hook for fetching NAV history from backend API
 * Used for historical price charts on VaultPage
 */

import { useState, useEffect, useCallback } from 'react';

const API_URL = import.meta.env.VITE_PASSPORT_SIGNER_URL || 'http://localhost:3001';

// 3 years of daily data
const DEFAULT_LIMIT = 1100;
const DEFAULT_INTERVAL = 'daily';

/**
 * Transform API response to chart-friendly format
 */
function transformSnapshots(snapshots) {
  if (!snapshots || !Array.isArray(snapshots)) return [];

  return snapshots
    .map((snapshot) => ({
      date: new Date(snapshot.recorded_at).getTime(),
      price: parseFloat(snapshot.rose_price_usd) || 0,
      totalAssets: parseFloat(snapshot.total_hard_assets_usd) || 0,
      circulatingRose: parseFloat(snapshot.circulating_rose) || 0,
      btcPercent: (snapshot.actual_btc_bps || 0) / 100,
      goldPercent: (snapshot.actual_gold_bps || 0) / 100,
      usdcPercent: (snapshot.actual_usdc_bps || 0) / 100,
      rosePercent: (snapshot.actual_rose_bps || 0) / 100,
    }))
    .sort((a, b) => a.date - b.date); // Oldest first for chart
}

/**
 * Fetch NAV history from backend
 * @param {Object} options - Query options
 * @param {number} options.limit - Max records to fetch (default: 1100 for 3 years)
 * @param {string} options.interval - Aggregation interval: 'raw' | 'daily' | 'weekly'
 * @param {Date} options.startDate - Optional start date filter
 * @param {Date} options.endDate - Optional end date filter
 * @returns {Object} { data, isLoading, error, refetch }
 */
export function useNavHistory(options = {}) {
  const {
    limit = DEFAULT_LIMIT,
    interval = DEFAULT_INTERVAL,
    startDate,
    endDate
  } = options;

  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchHistory = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        limit: limit.toString(),
        interval,
      });

      if (startDate) {
        params.append('startDate', startDate.toISOString());
      }
      if (endDate) {
        params.append('endDate', endDate.toISOString());
      }

      const response = await fetch(`${API_URL}/api/treasury/history?${params}`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();

      const chartData = transformSnapshots(result.snapshots);

      setData({
        snapshots: chartData,
        pagination: result.pagination,
        raw: result.snapshots,
      });
    } catch (err) {
      console.error('[useNavHistory] Error fetching NAV history:', err);
      setError(err.message || 'Failed to fetch NAV history');
    } finally {
      setIsLoading(false);
    }
  }, [limit, interval, startDate, endDate]);

  // Fetch on mount and when options change
  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  return {
    data,
    isLoading,
    error,
    refetch: fetchHistory,
  };
}

/**
 * Fetch NAV stats (current, 7d/30d change, ATH/ATL)
 * @returns {Object} { stats, isLoading, error, refetch }
 */
export function useNavStats() {
  const [stats, setStats] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchStats = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_URL}/api/treasury/stats`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      setStats(result);
    } catch (err) {
      console.error('[useNavStats] Error fetching NAV stats:', err);
      setError(err.message || 'Failed to fetch NAV stats');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  return {
    stats,
    isLoading,
    error,
    refetch: fetchStats,
  };
}

export default useNavHistory;
