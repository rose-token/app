import { useAccount } from 'wagmi';
import { useState, useCallback, useEffect } from 'react';

const API_URL = import.meta.env.VITE_PASSPORT_SIGNER_URL || 'http://localhost:3001';

/**
 * Hook to manage Camelot LP fee collection operations.
 * All operations require caller to be Treasury owner (verified by backend).
 *
 * @returns {Object} Camelot LP utilities
 */
export const useCamelotLP = () => {
  const { address } = useAccount();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // Reset state when address changes
  useEffect(() => {
    setIsLoading(false);
    setError(null);
  }, [address]);

  /**
   * Get Camelot LP status including configuration and all positions.
   * @returns {Promise<Object>} Status with enabled, positions, cronSchedule, etc.
   */
  const getStatus = useCallback(async () => {
    if (!address) {
      throw new Error('Wallet not connected');
    }

    try {
      const response = await fetch(
        `${API_URL}/api/camelot-lp/status?callerAddress=${encodeURIComponent(address)}`
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || data.message || 'Failed to get Camelot LP status');
      }

      return data;
    } catch (err) {
      console.error('[useCamelotLP] Error getting status:', err);
      throw err;
    }
  }, [address]);

  /**
   * Get info for a specific LP position.
   * @param {string} tokenId - The position token ID
   * @returns {Promise<Object>} Position info with pending fees, liquidity, etc.
   */
  const getPositionInfo = useCallback(
    async (tokenId) => {
      if (!address) {
        throw new Error('Wallet not connected');
      }

      try {
        const response = await fetch(
          `${API_URL}/api/camelot-lp/position/${tokenId}?callerAddress=${encodeURIComponent(address)}`
        );

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || data.message || 'Failed to get position info');
        }

        return data;
      } catch (err) {
        console.error('[useCamelotLP] Error getting position info:', err);
        throw err;
      }
    },
    [address]
  );

  /**
   * Collect fees from all configured LP positions.
   * @returns {Promise<Object>} Collection result with collected, skipped, errors
   */
  const collectAllFees = useCallback(async () => {
    if (!address) {
      throw new Error('Wallet not connected');
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_URL}/api/camelot-lp/collect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          callerAddress: address,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || data.message || 'Failed to collect fees');
      }

      return data;
    } catch (err) {
      console.error('[useCamelotLP] Error collecting fees:', err);
      const errorMessage = err instanceof Error ? err.message : 'Network error - please try again';
      setError(errorMessage);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [address]);

  /**
   * Collect fees from a specific LP position.
   * @param {string} tokenId - The position token ID
   * @returns {Promise<Object>} Collection result with amount0, amount1, txHash
   */
  const collectFees = useCallback(
    async (tokenId) => {
      if (!address) {
        throw new Error('Wallet not connected');
      }

      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(`${API_URL}/api/camelot-lp/collect/${tokenId}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            callerAddress: address,
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || data.message || 'Failed to collect fees');
        }

        return data;
      } catch (err) {
        console.error('[useCamelotLP] Error collecting fees:', err);
        const errorMessage = err instanceof Error ? err.message : 'Network error - please try again';
        setError(errorMessage);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [address]
  );

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    getStatus,
    getPositionInfo,
    collectAllFees,
    collectFees,
    isLoading,
    error,
    clearError,
  };
};

export default useCamelotLP;
