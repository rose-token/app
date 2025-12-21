/**
 * useAvailableVP - Hook for fetching Slow Track VP budget
 *
 * Slow Track uses "scarce VP" - users have a budget they must allocate across proposals.
 * This hook fetches the user's current allocations and available VP.
 *
 * Backend calculates total VP including received delegations (VP delegated to user by others).
 *
 * Features:
 * - Timestamp-based caching to prevent over-fetching
 * - Event-driven refetch after voting
 * - Manual clearCache for forced refresh
 * - Returns ownVP and receivedVP breakdown for display
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useAccount, useWatchContractEvent } from 'wagmi';
import RoseGovernanceABI from '../contracts/RoseGovernanceABI.json';
import { CONTRACTS } from '../constants/contracts';

// Backend signer URL
const SIGNER_URL = import.meta.env.VITE_PASSPORT_SIGNER_URL || 'http://localhost:3001';

// Default cache duration (5 seconds)
const DEFAULT_STALE_TIME = 5000;

/**
 * Hook to fetch available VP for Slow Track voting
 * @param {Object} options - Options
 * @param {boolean} options.enabled - Whether to fetch (default: true)
 * @param {number} options.refreshInterval - Auto-refresh interval in ms (0 to disable)
 * @param {number} options.staleTime - Cache duration in ms (default: 5000)
 * @param {boolean} options.refetchOnVote - Auto-refresh on VoteCastSlow events (default: true)
 * @returns {Object} VP budget state and actions
 */
export const useAvailableVP = (options = {}) => {
  const {
    enabled = true,
    refreshInterval = 0,
    staleTime = DEFAULT_STALE_TIME,
    refetchOnVote = true,
  } = options;

  const { address: account } = useAccount();

  const [data, setData] = useState({
    ownVP: '0',
    ownVPRaw: '0',
    receivedVP: '0',
    receivedVPRaw: '0',
    totalVP: '0',
    totalVPRaw: '0',
    allocatedVP: '0',
    allocatedVPRaw: '0',
    availableVP: '0',
    availableVPRaw: '0',
    allocations: [],
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // Cache tracking
  const lastFetched = useRef(null);
  const fetchInProgress = useRef(false);
  const debounceTimeout = useRef(null);

  /**
   * Fetch available VP from backend
   * Backend calculates total VP including received delegations
   * @param {boolean} bypassCache - Skip cache check
   */
  const fetchAvailableVP = useCallback(async (bypassCache = false) => {
    if (!account) return;

    // Skip if data is fresh and not bypassing cache (inline check to avoid dependency issues)
    const isFresh = lastFetched.current && (Date.now() - lastFetched.current) < staleTime;
    if (!bypassCache && isFresh) {
      return;
    }

    // Prevent concurrent fetches
    if (fetchInProgress.current) return;

    fetchInProgress.current = true;
    setIsLoading(true);
    setError(null);

    try {
      // Backend calculates totalVP = ownVP + receivedVP
      const response = await fetch(
        `${SIGNER_URL}/api/governance/vp/available/${account}`
      );

      if (!response.ok) {
        throw new Error('Failed to fetch VP budget');
      }

      const result = await response.json();

      // Format values for display (VP uses 9 decimals)
      setData({
        ownVP: (Number(result.ownVP) / 1e9).toFixed(2),
        ownVPRaw: result.ownVP,
        receivedVP: (Number(result.receivedVP) / 1e9).toFixed(2),
        receivedVPRaw: result.receivedVP,
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

      // Update cache timestamp
      lastFetched.current = Date.now();
    } catch (err) {
      console.error('Failed to fetch VP budget:', err);
      setError(err.message);
    } finally {
      setIsLoading(false);
      fetchInProgress.current = false;
    }
  }, [account, staleTime]);

  /**
   * Clear cache and force fresh fetch
   */
  const clearCache = useCallback(() => {
    lastFetched.current = null;
    fetchAvailableVP(true);
  }, [fetchAvailableVP]);

  /**
   * Debounced refetch (for event handlers)
   */
  const debouncedRefetch = useCallback(() => {
    if (debounceTimeout.current) {
      clearTimeout(debounceTimeout.current);
    }
    debounceTimeout.current = setTimeout(() => {
      fetchAvailableVP(true); // Bypass cache for event-triggered refetch
      debounceTimeout.current = null;
    }, 500);
  }, [fetchAvailableVP]);

  // Initial fetch
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (enabled && account) {
      fetchAvailableVP();
    }
  }, [enabled, account]); // fetchAvailableVP excluded to prevent infinite loop

  // Auto-refresh interval
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!enabled || !refreshInterval || refreshInterval <= 0) return;

    const intervalId = setInterval(() => fetchAvailableVP(), refreshInterval);
    return () => clearInterval(intervalId);
  }, [enabled, refreshInterval]); // fetchAvailableVP excluded to prevent infinite loop

  // Watch for VoteCastSlow events to auto-refetch
  useWatchContractEvent({
    address: CONTRACTS.GOVERNANCE,
    abi: RoseGovernanceABI,
    eventName: 'VoteCastSlow',
    onLogs: (logs) => {
      // Only refetch if the event is for our account
      const isRelevant = logs.some(log =>
        log.args?.voter?.toLowerCase() === account?.toLowerCase()
      );
      if (isRelevant) {
        debouncedRefetch();
      }
    },
    enabled: refetchOnVote && !!CONTRACTS.GOVERNANCE && !!account,
  });

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceTimeout.current) {
        clearTimeout(debounceTimeout.current);
      }
    };
  }, []);

  // Calculate utilization percentage
  const utilizationPercent = parseFloat(data.totalVP) > 0
    ? (parseFloat(data.allocatedVP) / parseFloat(data.totalVP)) * 100
    : 0;

  // Calculate if data is fresh (inline to avoid stale closure)
  const dataIsFresh = lastFetched.current && (Date.now() - lastFetched.current) < staleTime;

  return {
    // Data - VP breakdown
    ownVP: data.ownVP,
    ownVPRaw: data.ownVPRaw,
    receivedVP: data.receivedVP,
    receivedVPRaw: data.receivedVPRaw,
    totalVP: data.totalVP,
    totalVPRaw: data.totalVPRaw,
    allocatedVP: data.allocatedVP,
    allocatedVPRaw: data.allocatedVPRaw,
    availableVP: data.availableVP,
    availableVPRaw: data.availableVPRaw,
    allocations: data.allocations,
    utilizationPercent,
    // State
    isLoading,
    error,
    isFresh: dataIsFresh,
    lastFetched: lastFetched.current,
    // Actions
    refetch: fetchAvailableVP,
    clearCache,
  };
};

export default useAvailableVP;
