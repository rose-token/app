/**
 * Hook for fetching analytics data from backend API
 * Used for the admin analytics dashboard
 */

import { useState, useEffect, useCallback, useRef } from 'react';

const API_URL = import.meta.env.VITE_PASSPORT_SIGNER_URL || 'http://localhost:3001';

/**
 * Fetch overview and daily analytics data with polling
 * @param {Object} options - Query options
 * @param {number} options.days - Number of days for daily data (default: 30)
 * @param {number} options.pollInterval - Polling interval in ms (default: 60000)
 * @returns {Object} { overview, daily, isLoading, error, refetch }
 */
export function useAnalytics(options = {}) {
  const { days = 30, pollInterval = 60000 } = options;

  const [overview, setOverview] = useState(null);
  const [daily, setDaily] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const intervalRef = useRef(null);

  const fetchData = useCallback(async () => {
    try {
      const [overviewRes, dailyRes] = await Promise.all([
        fetch(`${API_URL}/api/analytics/overview`),
        fetch(`${API_URL}/api/analytics/daily?days=${days}`),
      ]);

      if (!overviewRes.ok) {
        throw new Error(`Overview: HTTP ${overviewRes.status}`);
      }
      if (!dailyRes.ok) {
        throw new Error(`Daily: HTTP ${dailyRes.status}`);
      }

      setOverview(await overviewRes.json());
      setDaily(await dailyRes.json());
      setError(null);
    } catch (err) {
      console.error('[useAnalytics] Error:', err);
      setError(err.message || 'Failed to fetch analytics data');
    } finally {
      setIsLoading(false);
    }
  }, [days]);

  // Initial fetch
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Polling
  useEffect(() => {
    if (pollInterval > 0) {
      intervalRef.current = setInterval(fetchData, pollInterval);
      return () => {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
        }
      };
    }
  }, [fetchData, pollInterval]);

  return { overview, daily, isLoading, error, refetch: fetchData };
}

/**
 * Fetch detailed marketplace analytics
 * @returns {Object} { data, isLoading, error, refetch }
 */
export function useMarketplaceAnalytics() {
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_URL}/api/analytics/marketplace`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      setData(await response.json());
    } catch (err) {
      console.error('[useMarketplaceAnalytics] Error:', err);
      setError(err.message || 'Failed to fetch marketplace analytics');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, isLoading, error, refetch: fetchData };
}

/**
 * Fetch detailed governance analytics
 * @returns {Object} { data, isLoading, error, refetch }
 */
export function useGovernanceAnalytics() {
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_URL}/api/analytics/governance`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      setData(await response.json());
    } catch (err) {
      console.error('[useGovernanceAnalytics] Error:', err);
      setError(err.message || 'Failed to fetch governance analytics');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, isLoading, error, refetch: fetchData };
}

/**
 * Fetch detailed treasury analytics
 * @returns {Object} { data, isLoading, error, refetch }
 */
export function useTreasuryAnalytics() {
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_URL}/api/analytics/treasury`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      setData(await response.json());
    } catch (err) {
      console.error('[useTreasuryAnalytics] Error:', err);
      setError(err.message || 'Failed to fetch treasury analytics');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, isLoading, error, refetch: fetchData };
}

/**
 * Fetch user analytics
 * @returns {Object} { data, isLoading, error, refetch }
 */
export function useUserAnalytics() {
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_URL}/api/analytics/users`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      setData(await response.json());
    } catch (err) {
      console.error('[useUserAnalytics] Error:', err);
      setError(err.message || 'Failed to fetch user analytics');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, isLoading, error, refetch: fetchData };
}

export default useAnalytics;
