import { useState, useCallback } from 'react';
import { useAccount } from 'wagmi';
import { reloadWhitelist } from '../services/whitelist';

const API_URL = import.meta.env.VITE_PASSPORT_SIGNER_URL || 'http://localhost:3001';

/**
 * Hook to manage whitelist entries via the backend API.
 * Provides CRUD operations with owner-only authorization for mutations.
 *
 * @returns {Object} Whitelist utilities and state
 */
export const useWhitelist = () => {
  const { address } = useAccount();
  const [whitelist, setWhitelist] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  /**
   * Fetch all whitelist entries from backend
   */
  const fetchWhitelist = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_URL}/api/whitelist`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch whitelist');
      }

      setWhitelist(data);
      return data;
    } catch (err) {
      console.error('[useWhitelist] Fetch error:', err);
      const message = err instanceof Error ? err.message : 'Failed to fetch whitelist';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Add or update an address in the whitelist
   * @param {string} addr - Ethereum address to add
   * @param {number} score - Passport score (0-100)
   */
  const addAddress = useCallback(async (addr, score) => {
    if (!address) {
      throw new Error('Wallet not connected');
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_URL}/api/whitelist`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          callerAddress: address,
          address: addr,
          score: Number(score),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to add address');
      }

      // Refresh whitelist after successful add
      await fetchWhitelist();
      // Also reload the service cache for passport checks
      await reloadWhitelist();

      return data;
    } catch (err) {
      console.error('[useWhitelist] Add error:', err);
      const message = err instanceof Error ? err.message : 'Failed to add address';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [address, fetchWhitelist]);

  /**
   * Remove an address from the whitelist
   * @param {string} addr - Ethereum address to remove
   */
  const removeAddress = useCallback(async (addr) => {
    if (!address) {
      throw new Error('Wallet not connected');
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `${API_URL}/api/whitelist/${addr}?callerAddress=${encodeURIComponent(address)}`,
        {
          method: 'DELETE',
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to remove address');
      }

      // Refresh whitelist after successful remove
      await fetchWhitelist();
      // Also reload the service cache for passport checks
      await reloadWhitelist();

      return data;
    } catch (err) {
      console.error('[useWhitelist] Remove error:', err);
      const message = err instanceof Error ? err.message : 'Failed to remove address';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [address, fetchWhitelist]);

  /**
   * Clear any error state
   */
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    whitelist,
    isLoading,
    error,
    fetchWhitelist,
    addAddress,
    removeAddress,
    clearError,
  };
};

export default useWhitelist;
