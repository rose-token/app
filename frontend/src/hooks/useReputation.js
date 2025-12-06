/**
 * Reputation hook for on-chain task completion data
 * Reads events from RoseMarketplace to calculate reputation metrics
 * Also reads on-chain reputation score from RoseGovernance
 * Supports new backend-computed reputation with ^0.6 formula
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { usePublicClient, useReadContracts } from 'wagmi';
import { parseAbi, formatUnits } from 'viem';
import RoseGovernanceABI from '../contracts/RoseGovernanceABI.json';
import { CONTRACTS } from '../constants/contracts';

const MARKETPLACE_ADDRESS = import.meta.env.VITE_MARKETPLACE_ADDRESS;
const PASSPORT_SIGNER_URL = import.meta.env.VITE_PASSPORT_SIGNER_URL;

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

// Cache for backend reputation (with signature)
const backendReputationCache = new Map();
const BACKEND_CACHE_TTL_MS = 60 * 1000; // 1 minute (shorter since it includes signature)

/**
 * Fetch new reputation formula from backend (with signature)
 * Uses new ^0.6 formula: reputation = (successPoints - disputePoints) / successPoints
 */
const fetchBackendReputation = async (address) => {
  if (!PASSPORT_SIGNER_URL || !address) return null;

  const cacheKey = address.toLowerCase();
  const cached = backendReputationCache.get(cacheKey);

  // Check cache (with expiry buffer for signature)
  if (cached && Date.now() - cached.fetchedAt < BACKEND_CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const response = await fetch(
      `${PASSPORT_SIGNER_URL}/api/governance/reputation-signed/${address}`
    );

    if (!response.ok) {
      console.warn('Failed to fetch backend reputation:', response.status);
      return null;
    }

    const data = await response.json();

    // Cache the result
    backendReputationCache.set(cacheKey, {
      data,
      fetchedAt: Date.now(),
    });

    return data;
  } catch (error) {
    console.error('Error fetching backend reputation:', error);
    return null;
  }
};

/**
 * Hook to fetch reputation data for an address
 * @param {string} address - Ethereum address to get reputation for
 * @returns {Object} Reputation data and state
 */
export const useReputation = (address) => {
  const publicClient = usePublicClient();
  const publicClientRef = useRef(publicClient);
  const hasFetchedRef = useRef(false);
  const addressRef = useRef(address);

  // Keep ref updated
  publicClientRef.current = publicClient;

  const [state, setState] = useState({
    reputation: null,
    loading: false,
    error: null,
  });

  // Backend reputation state (new ^0.6 formula with signature)
  const [backendReputation, setBackendReputation] = useState(null);

  // Read on-chain governance data for reputation score and eligibility
  const { data: governanceData, refetch: refetchGovernance } = useReadContracts({
    contracts: [
      // On-chain reputation score (0-100)
      {
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'getReputation',
        args: [address],
      },
      // User stats from governance
      {
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'userStats',
        args: [address],
      },
      // Can propose (90%+ rep + 10 tasks)
      {
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'canPropose',
        args: [address],
      },
      // Can vote (70%+ rep)
      {
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'canVote',
        args: [address],
      },
      // Can be delegate (90%+ rep + 10 tasks)
      {
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'canDelegate',
        args: [address],
      },
    ],
    query: {
      enabled: !!address && !!CONTRACTS.GOVERNANCE,
    },
  });

  // Parse governance data
  const governanceParsed = useMemo(() => {
    if (!governanceData) return null;

    const getResult = (index) => {
      const result = governanceData[index];
      return result?.status === 'success' ? result.result : null;
    };

    const reputationScore = getResult(0);
    const userStats = getResult(1);
    const canPropose = getResult(2);
    const canVote = getResult(3);
    const canDelegate = getResult(4);

    // Parse user stats struct
    const stats = userStats ? {
      tasksCompleted: Number(userStats.tasksCompleted || 0),
      totalTaskValue: userStats.totalTaskValue || 0n,
      disputes: Number(userStats.disputes || 0),
      failedProposals: Number(userStats.failedProposals || 0),
      lastTaskTimestamp: Number(userStats.lastTaskTimestamp || 0),
    } : null;

    return {
      reputationScore: reputationScore !== null ? Number(reputationScore) : 60, // Default 60%
      userStats: stats,
      canPropose: canPropose || false,
      canVote: canVote || false,
      canDelegate: canDelegate || false,
    };
  }, [governanceData]);

  /**
   * Fetch reputation data from on-chain events
   * Uses publicClientRef to avoid callback recreation on every render
   */
  const fetchReputation = useCallback(async () => {
    const client = publicClientRef.current;
    if (!address || !client || !MARKETPLACE_ADDRESS) {
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
        client.getLogs({
          address: MARKETPLACE_ADDRESS,
          event: MARKETPLACE_EVENTS[1], // PaymentReleased
          args: { worker: address },
          fromBlock: 'earliest',
          toBlock: 'latest',
        }).catch(() => []),

        // Tasks created (as customer)
        client.getLogs({
          address: MARKETPLACE_ADDRESS,
          event: MARKETPLACE_EVENTS[4], // TaskCreated
          args: { customer: address },
          fromBlock: 'earliest',
          toBlock: 'latest',
        }).catch(() => []),

        // Stakes made (as stakeholder)
        client.getLogs({
          address: MARKETPLACE_ADDRESS,
          event: MARKETPLACE_EVENTS[5], // StakeholderStaked
          args: { stakeholder: address },
          fromBlock: 'earliest',
          toBlock: 'latest',
        }).catch(() => []),

        // Tasks claimed (as worker)
        client.getLogs({
          address: MARKETPLACE_ADDRESS,
          event: MARKETPLACE_EVENTS[3], // TaskClaimed
          args: { worker: address },
          fromBlock: 'earliest',
          toBlock: 'latest',
        }).catch(() => []),

        // Fees earned (as stakeholder)
        client.getLogs({
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
        // Event-based task counts
        tasksAsWorker: paymentEvents.length,
        tasksAsStakeholder: stakeholderEvents.length,
        tasksAsCustomer: taskCreatedEvents.length,
        tasksClaimed: claimedEvents.length,
        totalEarned: formatUnits(totalEarned, 18),
        totalEarnedRaw: totalEarned.toString(),
        // On-chain governance data (merged in below)
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
  }, [address]); // Only depends on address - publicClient accessed via ref

  /**
   * Refresh reputation data
   */
  const refetch = useCallback(() => {
    if (address) {
      reputationCache.delete(address.toLowerCase());
    }
    return fetchReputation();
  }, [address, fetchReputation]);

  // Fetch backend reputation (new ^0.6 formula)
  const fetchBackendRep = useCallback(async () => {
    if (!address) return;
    const data = await fetchBackendReputation(address);
    setBackendReputation(data);
  }, [address]);

  // Fetch reputation on mount and when address changes
  // Only refetch if address actually changed (not on every render)
  useEffect(() => {
    if (addressRef.current !== address) {
      hasFetchedRef.current = false;
      addressRef.current = address;
      setBackendReputation(null); // Reset backend reputation on address change
    }
    if (!hasFetchedRef.current && address) {
      hasFetchedRef.current = true;
      fetchReputation();
      fetchBackendRep(); // Also fetch backend reputation
    }
  }, [address, fetchReputation, fetchBackendRep]);

  // Merge event-based reputation with on-chain governance data and backend reputation
  const mergedReputation = useMemo(() => {
    if (!state.reputation) return governanceParsed;

    // Use backend reputation (new ^0.6 formula) if available, fallback to on-chain
    const reputationScore = backendReputation?.reputation ?? governanceParsed?.reputationScore ?? 60;

    return {
      ...state.reputation,
      // Reputation score - prefer new backend formula, fallback to on-chain
      reputationScore,
      // Legacy on-chain reputation (for comparison/debugging)
      reputationScoreLegacy: governanceParsed?.reputationScore ?? 60,
      // Governance eligibility flags
      canPropose: governanceParsed?.canPropose ?? false,
      canVote: governanceParsed?.canVote ?? false,
      canDelegate: governanceParsed?.canDelegate ?? false,
      // User stats from governance contract
      governanceStats: governanceParsed?.userStats ?? null,
      // Backend reputation attestation (for on-chain validation)
      reputationAttestation: backendReputation ? {
        reputation: backendReputation.reputation,
        expiry: backendReputation.expiry,
        signature: backendReputation.signature,
      } : null,
    };
  }, [state.reputation, governanceParsed, backendReputation]);

  // Combined refetch for event data, governance data, and backend reputation
  const refetchAll = useCallback(() => {
    refetchGovernance();
    fetchBackendRep(); // Also refresh backend reputation
    // Clear backend cache for this address
    if (address) {
      backendReputationCache.delete(address.toLowerCase());
    }
    return refetch();
  }, [address, refetch, refetchGovernance, fetchBackendRep]);

  return {
    reputation: mergedReputation,
    loading: state.loading,
    error: state.error,
    refetch: refetchAll,
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
