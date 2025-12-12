/**
 * useProposalVP - Pre-fetch merkle proof for Fast Track voting
 *
 * Fast Track proposals use merkle proofs to verify VP at snapshot time.
 * This hook pre-fetches the proof when the component mounts, eliminating
 * the fetch delay at vote time.
 *
 * @example
 * const { proof, votingPower, hasSnapshot, isLoading } = useProposalVP(proposalId);
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useAccount } from 'wagmi';

// Backend signer URL
const SIGNER_URL = import.meta.env.VITE_PASSPORT_SIGNER_URL || 'http://localhost:3001';

/**
 * Hook to pre-fetch merkle proof for Fast Track voting
 * @param {number} proposalId - Proposal ID to fetch proof for
 * @param {Object} options - Options
 * @param {boolean} options.enabled - Whether to fetch (default: true)
 * @returns {Object} Proof data and state
 */
export const useProposalVP = (proposalId, options = {}) => {
  const { enabled = true } = options;
  const { address: account } = useAccount();

  const [data, setData] = useState({
    proof: null,
    effectiveVP: '0',
    effectiveVPRaw: '0',
    baseVP: '0',
    baseVPRaw: '0',
    delegatedTo: null,
    delegatedAmount: '0',
    hasSnapshot: false,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // Prevent duplicate fetches
  const fetchInProgress = useRef(false);

  /**
   * Fetch merkle proof from backend
   */
  const fetchProof = useCallback(async () => {
    if (!account || !proposalId) return;
    if (fetchInProgress.current) return;

    fetchInProgress.current = true;
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `${SIGNER_URL}/api/governance/proposals/${proposalId}/proof/${account}`
      );

      if (!response.ok) {
        if (response.status === 404) {
          // Snapshot not ready yet - common during pending period
          setData({
            proof: null,
            effectiveVP: '0',
            effectiveVPRaw: '0',
            baseVP: '0',
            baseVPRaw: '0',
            delegatedTo: null,
            delegatedAmount: '0',
            hasSnapshot: false,
          });
          setError('VP snapshot not ready yet');
          return;
        }
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to fetch merkle proof');
      }

      const result = await response.json();

      // Parse the proof data
      // API returns: { address, effectiveVP, baseVP, delegatedTo, delegatedAmount, proof }
      setData({
        proof: result.proof || [],
        effectiveVP: (Number(result.effectiveVP || '0') / 1e9).toFixed(2),
        effectiveVPRaw: result.effectiveVP || '0',
        baseVP: (Number(result.baseVP || '0') / 1e9).toFixed(2),
        baseVPRaw: result.baseVP || '0',
        delegatedTo: result.delegatedTo || null,
        delegatedAmount: (Number(result.delegatedAmount || '0') / 1e9).toFixed(2),
        hasSnapshot: true,
      });
    } catch (err) {
      console.error('Failed to fetch merkle proof:', err);
      setError(err.message);
    } finally {
      setIsLoading(false);
      fetchInProgress.current = false;
    }
  }, [account, proposalId]);

  // Auto-fetch when enabled and params change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (enabled && account && proposalId) {
      fetchProof();
    }
  }, [enabled, account, proposalId]); // fetchProof excluded to prevent infinite loop

  // Reset state when proposalId changes
  useEffect(() => {
    if (proposalId) {
      setData({
        proof: null,
        effectiveVP: '0',
        effectiveVPRaw: '0',
        baseVP: '0',
        baseVPRaw: '0',
        delegatedTo: null,
        delegatedAmount: '0',
        hasSnapshot: false,
      });
      setError(null);
    }
  }, [proposalId]);

  return {
    // Data
    proof: data.proof,
    effectiveVP: data.effectiveVP,
    effectiveVPRaw: data.effectiveVPRaw,
    baseVP: data.baseVP,
    baseVPRaw: data.baseVPRaw,
    delegatedTo: data.delegatedTo,
    delegatedAmount: data.delegatedAmount,
    hasSnapshot: data.hasSnapshot,
    // State
    isLoading,
    error,
    // Actions
    refetch: fetchProof,
  };
};

export default useProposalVP;
