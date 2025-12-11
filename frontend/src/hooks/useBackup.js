import { useAccount } from 'wagmi';
import { useState, useCallback, useEffect } from 'react';

const API_URL = import.meta.env.VITE_PASSPORT_SIGNER_URL || 'http://localhost:3001';

/**
 * Hook to manage database backup and restore operations.
 * All operations require caller to be Treasury owner (verified by backend).
 *
 * @returns {Object} Backup utilities
 */
export const useBackup = () => {
  const { address } = useAccount();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // Reset state when address changes
  useEffect(() => {
    setIsLoading(false);
    setError(null);
  }, [address]);

  /**
   * Trigger a manual database backup.
   * @returns {Promise<Object>} Backup result with cid, size, timestamp, etc.
   * @throws {Error} If wallet not connected, unauthorized, or API error
   */
  const createBackup = useCallback(async () => {
    if (!address) {
      throw new Error('Wallet not connected');
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_URL}/api/backup/create`, {
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
        throw new Error(data.error || data.message || 'Failed to create backup');
      }

      return data;
    } catch (err) {
      console.error('[useBackup] Error creating backup:', err);
      const errorMessage = err instanceof Error ? err.message : 'Network error - please try again';
      setError(errorMessage);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [address]);

  /**
   * Get backup system status.
   * @returns {Promise<Object>} Status with referenceCid, isConfigured, lastSwap
   */
  const getStatus = useCallback(async () => {
    if (!address) {
      throw new Error('Wallet not connected');
    }

    try {
      const response = await fetch(
        `${API_URL}/api/backup/status?callerAddress=${encodeURIComponent(address)}`
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || data.message || 'Failed to get backup status');
      }

      return data;
    } catch (err) {
      console.error('[useBackup] Error getting status:', err);
      throw err;
    }
  }, [address]);

  /**
   * Restore database from a backup.
   * DANGER: This overwrites the entire database!
   *
   * @param {string} cid - Optional specific CID to restore. If not provided, uses reference CID.
   * @returns {Promise<Object>} Restore result with success, message, cid
   */
  const restoreBackup = useCallback(
    async (cid = null) => {
      if (!address) {
        throw new Error('Wallet not connected');
      }

      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(`${API_URL}/api/backup/restore`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            callerAddress: address,
            cid: cid,
            confirmed: true, // Confirmation is handled by UI
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || data.message || 'Failed to restore backup');
        }

        return data;
      } catch (err) {
        console.error('[useBackup] Error restoring backup:', err);
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
    createBackup,
    getStatus,
    restoreBackup,
    isLoading,
    error,
    clearError,
  };
};

export default useBackup;
