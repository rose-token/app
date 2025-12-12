/**
 * useAvailableVP - Hook for fetching Slow Track VP budget
 *
 * Slow Track uses "scarce VP" - users have a budget they must allocate across proposals.
 * This hook fetches the user's current allocations and available VP.
 */

import { useState, useCallback, useEffect } from 'react';
import { useAccount } from 'wagmi';
import useGovernance from './useGovernance';

// Backend signer URL
const SIGNER_URL = import.meta.env.VITE_PASSPORT_SIGNER_URL || 'http://localhost:3001';

/**
 * Hook to fetch available VP for Slow Track voting
 * @param {Object} options - Options
 * @param {boolean} options.enabled - Whether to fetch (default: true)
 * @param {number} options.refreshInterval - Auto-refresh interval in ms (0 to disable)
 * @returns {Object} VP budget state and actions
 */
export const useAvailableVP = (options = {}) => {
  const { enabled = true, refreshInterval = 0 } = options;
  const { address: account } = useAccount();
  const { votingPower } = useGovernance();

  const [data, setData] = useState({
    totalVP: '0',
    allocatedVP: '0',
    availableVP: '0',
    allocations: [],
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  /**
   * Fetch available VP from backend
   */
  const fetchAvailableVP = useCallback(async () => {
    if (!account || !votingPower) return;

    setIsLoading(true);
    setError(null);

    try {
      // Convert votingPower to wei (9 decimals)
      const totalVPWei = Math.floor(parseFloat(votingPower || '0') * 1e9).toString();

      const response = await fetch(
        `${SIGNER_URL}/api/governance/vp/available/${account}?totalVP=${totalVPWei}`
      );

      if (!response.ok) {
        throw new Error('Failed to fetch VP budget');
      }

      const result = await response.json();

      // Format values for display (VP uses 9 decimals)
      setData({
        totalVP: (Number(result.totalVP) / 1e9).toFixed(2),
        totalVPRaw: result.totalVP,
        allocatedVP: (Number(result.allocatedVP) / 1e9).toFixed(2),
        allocatedVPRaw: result.allocatedVP,
        availableVP: (Number(result.availableVP) / 1e9).toFixed(2),
        availableVPRaw: result.availableVP,
        allocations: (result.allocations || []).map(alloc => ({
          proposalId: alloc.proposalId,
          vpAmount: (Number(alloc.vpAmount) / 1e9).toFixed(2),
          vpAmountRaw: alloc.vpAmount,
          support: alloc.support,
          deadline: alloc.deadline,
          // Calculate time remaining
          timeRemaining: Math.max(0, alloc.deadline - Math.floor(Date.now() / 1000)),
        })),
      });
    } catch (err) {
      console.error('Failed to fetch VP budget:', err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [account, votingPower]);

  // Initial fetch
  useEffect(() => {
    if (enabled && account && votingPower) {
      fetchAvailableVP();
    }
  }, [enabled, account, votingPower, fetchAvailableVP]);

  // Auto-refresh interval
  useEffect(() => {
    if (!enabled || !refreshInterval || refreshInterval <= 0) return;

    const intervalId = setInterval(fetchAvailableVP, refreshInterval);
    return () => clearInterval(intervalId);
  }, [enabled, refreshInterval, fetchAvailableVP]);

  // Calculate utilization percentage
  const utilizationPercent = parseFloat(data.totalVP) > 0
    ? (parseFloat(data.allocatedVP) / parseFloat(data.totalVP)) * 100
    : 0;

  return {
    // Data
    totalVP: data.totalVP,
    allocatedVP: data.allocatedVP,
    availableVP: data.availableVP,
    allocations: data.allocations,
    utilizationPercent,
    // State
    isLoading,
    error,
    // Actions
    refetch: fetchAvailableVP,
  };
};

export default useAvailableVP;
