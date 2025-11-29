/**
 * Reputation hook for on-chain task completion data
 * Reads events from RoseMarketplace to calculate reputation metrics
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { usePublicClient } from 'wagmi';
import { parseAbi, formatUnits } from 'viem';

const MARKETPLACE_ADDRESS = import.meta.env.VITE_MARKETPLACE_ADDRESS;

// Relevant events from RoseMarketplace
const MARKETPLACE_EVENTS = parseAbi([
  'event TaskCompleted(uint256 taskId, string prUrl)',
  'event PaymentReleased(uint256 taskId, address indexed worker, uint256 amount)',
  'event TaskReadyForPayment(uint256 taskId, address indexed worker, uint256 amount)',
  'event TaskClaimed(uint256 taskId, address indexed worker)',
  'event TaskCreated(uint256 taskId, address indexed customer, uint256 deposit)',
  'event StakeholderStaked(uint256 taskId, address indexed stakeholder, uint256 deposit)',
  'event StakeholderFeeEarned(uint256 taskId, address indexed stakeholder, uint256 fee)',
]);

// Cache for reputation data
const reputationCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get cached reputation data
 */
const getCachedReputation = (address) => {
  const key = address.toLowerCase();
  const entry = reputationCache.get(key);

  if (!entry) return null;

  const isExpired = Date.now() - entry.fetchedAt > CACHE_TTL_MS;
  if (isExpired) {
    reputationCache.delete(key);
    return null;
  }

  return entry.data;
};

/**
 * Set cached reputation data
 */
const setCachedReputation = (address, data) => {
  const key = address.toLowerCase();
  reputationCache.set(key, {
    data,
    fetchedAt: Date.now(),
  });
};

/**
 * Hook to fetch reputation data for an address
 * @param {string} address - Ethereum address to get reputation for
 * @returns {Object} Reputation data and state
 */
export const useReputation = (address) => {
  const publicClient = usePublicClient();

  const [state, setState] = useState({
    reputation: null,
    loading: false,
    error: null,
  });

  /**
   * Fetch reputation data from on-chain events
   */
  const fetchReputation = useCallback(async () => {
    if (!address || !publicClient || !MARKETPLACE_ADDRESS) {
      setState((prev) => ({ ...prev, reputation: null, loading: false }));
      return;
    }

    // Check cache first
    const cached = getCachedReputation(address);
    if (cached) {
      setState({ reputation: cached, loading: false, error: null });
      return;
    }

    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const lowerAddress = address.toLowerCase();

      // Fetch all relevant events in parallel
      const [
        paymentEvents,
        taskCreatedEvents,
        stakeholderEvents,
        claimedEvents,
        stakeholderFeeEvents,
      ] = await Promise.all([
        // Payments received (as worker)
        publicClient.getLogs({
          address: MARKETPLACE_ADDRESS,
          event: MARKETPLACE_EVENTS[1], // PaymentReleased
          args: { worker: address },
          fromBlock: 'earliest',
          toBlock: 'latest',
        }).catch(() => []),

        // Tasks created (as customer)
        publicClient.getLogs({
          address: MARKETPLACE_ADDRESS,
          event: MARKETPLACE_EVENTS[4], // TaskCreated
          args: { customer: address },
          fromBlock: 'earliest',
          toBlock: 'latest',
        }).catch(() => []),

        // Stakes made (as stakeholder)
        publicClient.getLogs({
          address: MARKETPLACE_ADDRESS,
          event: MARKETPLACE_EVENTS[5], // StakeholderStaked
          args: { stakeholder: address },
          fromBlock: 'earliest',
          toBlock: 'latest',
        }).catch(() => []),

        // Tasks claimed (as worker)
        publicClient.getLogs({
          address: MARKETPLACE_ADDRESS,
          event: MARKETPLACE_EVENTS[3], // TaskClaimed
          args: { worker: address },
          fromBlock: 'earliest',
          toBlock: 'latest',
        }).catch(() => []),

        // Fees earned (as stakeholder)
        publicClient.getLogs({
          address: MARKETPLACE_ADDRESS,
          event: MARKETPLACE_EVENTS[6], // StakeholderFeeEarned
          args: { stakeholder: address },
          fromBlock: 'earliest',
          toBlock: 'latest',
        }).catch(() => []),
      ]);

      // Calculate totals (worker payments + stakeholder fees)
      let totalEarned = BigInt(0);
      paymentEvents.forEach((event) => {
        if (event.args?.amount) {
          totalEarned += event.args.amount;
        }
      });
      stakeholderFeeEvents.forEach((event) => {
        if (event.args?.fee) {
          totalEarned += event.args.fee;
        }
      });

      const reputation = {
        tasksAsWorker: paymentEvents.length,
        tasksAsStakeholder: stakeholderEvents.length,
        tasksAsCustomer: taskCreatedEvents.length,
        tasksClaimed: claimedEvents.length,
        totalEarned: formatUnits(totalEarned, 18),
        totalEarnedRaw: totalEarned.toString(),
      };

      setCachedReputation(address, reputation);
      setState({ reputation, loading: false, error: null });
    } catch (err) {
      console.error('Error fetching reputation:', err);
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err.message || 'Failed to fetch reputation',
      }));
    }
  }, [address, publicClient]);

  /**
   * Refresh reputation data
   */
  const refetch = useCallback(() => {
    if (address) {
      reputationCache.delete(address.toLowerCase());
    }
    return fetchReputation();
  }, [address, fetchReputation]);

  // Fetch reputation on mount and when address changes
  useEffect(() => {
    fetchReputation();
  }, [fetchReputation]);

  return {
    reputation: state.reputation,
    loading: state.loading,
    error: state.error,
    refetch,
  };
};

/**
 * Get formatted reputation summary
 * @param {Object} reputation - Reputation data
 * @returns {Object} Formatted summary
 */
export const getReputationSummary = (reputation) => {
  if (!reputation) {
    return {
      totalTasks: 0,
      totalEarned: '0',
      roles: [],
    };
  }

  const roles = [];

  if (reputation.tasksAsWorker > 0) {
    roles.push({ role: 'Worker', count: reputation.tasksAsWorker });
  }
  if (reputation.tasksAsStakeholder > 0) {
    roles.push({ role: 'Stakeholder', count: reputation.tasksAsStakeholder });
  }
  if (reputation.tasksAsCustomer > 0) {
    roles.push({ role: 'Customer', count: reputation.tasksAsCustomer });
  }

  return {
    totalTasks:
      reputation.tasksAsWorker +
      reputation.tasksAsStakeholder +
      reputation.tasksAsCustomer,
    totalEarned: reputation.totalEarned,
    roles,
  };
};

export default useReputation;
