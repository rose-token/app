/**
 * Hook to calculate delegate vote accuracy
 * Measures percentage of times delegate voted on the winning side
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { usePublicClient } from 'wagmi';
import { parseAbi } from 'viem';
import { CONTRACTS, ProposalStatus } from '../constants/contracts';

// Governance events for vote tracking
const GOVERNANCE_EVENTS = parseAbi([
  'event VoteCastFast(uint256 indexed proposalId, address indexed voter, bool support, uint256 vpAmount)',
  'event VoteCastSlow(uint256 indexed proposalId, address indexed voter, bool support, uint256 vpAmount, uint256 nonce)',
  'event ProposalFinalized(uint256 indexed proposalId, uint8 status)',
]);

// Cache for vote accuracy data
const accuracyCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Hook to fetch vote accuracy for a delegate
 * @param {string} delegateAddress - Ethereum address of the delegate
 * @returns {Object} { accuracy, votesCount, loading, error }
 */
export const useVoteAccuracy = (delegateAddress) => {
  const publicClient = usePublicClient();

  const [state, setState] = useState({
    accuracy: 0,
    votesCount: 0,
    loading: true,
    error: null,
  });

  const fetchAccuracy = useCallback(async () => {
    if (!delegateAddress || !publicClient || !CONTRACTS.GOVERNANCE) {
      setState({ accuracy: 0, votesCount: 0, loading: false, error: null });
      return;
    }

    // Check cache
    const cacheKey = delegateAddress.toLowerCase();
    const cached = accuracyCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      setState({ ...cached.data, loading: false, error: null });
      return;
    }

    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      // Fetch delegate votes and proposal outcomes in parallel
      const [fastVotes, slowVotes, finalizedProposals] = await Promise.all([
        // Get fast track votes cast by this delegate
        publicClient.getLogs({
          address: CONTRACTS.GOVERNANCE,
          event: GOVERNANCE_EVENTS[0], // VoteCastFast
          args: { voter: delegateAddress },
          fromBlock: 'earliest',
          toBlock: 'latest',
        }).catch(() => []),

        // Get slow track votes cast by this delegate
        publicClient.getLogs({
          address: CONTRACTS.GOVERNANCE,
          event: GOVERNANCE_EVENTS[1], // VoteCastSlow
          args: { voter: delegateAddress },
          fromBlock: 'earliest',
          toBlock: 'latest',
        }).catch(() => []),

        // Get all finalized proposals
        publicClient.getLogs({
          address: CONTRACTS.GOVERNANCE,
          event: GOVERNANCE_EVENTS[2], // ProposalFinalized
          fromBlock: 'earliest',
          toBlock: 'latest',
        }).catch(() => []),
      ]);

      // Combine votes from both tracks
      const delegateVotes = [...fastVotes, ...slowVotes];

      // Build map of proposal outcomes
      const proposalOutcomes = new Map();
      finalizedProposals.forEach((event) => {
        const proposalId = event.args?.proposalId?.toString();
        const status = Number(event.args?.status);
        if (proposalId) {
          proposalOutcomes.set(proposalId, status);
        }
      });

      // Calculate accuracy
      let correctVotes = 0;
      let totalVotes = 0;

      delegateVotes.forEach((event) => {
        const proposalId = event.args?.proposalId?.toString();
        const votedYay = event.args?.support;

        if (!proposalId) return;

        const outcome = proposalOutcomes.get(proposalId);
        // Only count votes on finalized proposals (Passed=1 or Failed=2)
        if (outcome === ProposalStatus.Passed || outcome === ProposalStatus.Failed) {
          totalVotes++;
          const passed = outcome === ProposalStatus.Passed;
          // Correct if (passed && votedYay) OR (failed && votedNay)
          if ((passed && votedYay) || (!passed && !votedYay)) {
            correctVotes++;
          }
        }
      });

      const accuracy = totalVotes > 0 ? (correctVotes / totalVotes) * 100 : 0;

      const result = { accuracy, votesCount: totalVotes };
      accuracyCache.set(cacheKey, { data: result, fetchedAt: Date.now() });
      setState({ ...result, loading: false, error: null });
    } catch (err) {
      console.error('Error fetching vote accuracy:', err);
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err.message || 'Failed to fetch vote accuracy',
      }));
    }
  }, [delegateAddress, publicClient]);

  useEffect(() => {
    fetchAccuracy();
  }, [fetchAccuracy]);

  const refetch = useCallback(() => {
    if (delegateAddress) {
      accuracyCache.delete(delegateAddress.toLowerCase());
    }
    return fetchAccuracy();
  }, [delegateAddress, fetchAccuracy]);

  return {
    accuracy: state.accuracy,
    votesCount: state.votesCount,
    loading: state.loading,
    error: state.error,
    refetch,
  };
};

export default useVoteAccuracy;
