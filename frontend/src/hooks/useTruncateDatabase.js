import { useAccount } from 'wagmi';
import { useState, useCallback, useEffect } from 'react';
import { useAdminAuth } from './useAdminAuth';

const API_URL = import.meta.env.VITE_PASSPORT_SIGNER_URL || 'http://localhost:3001';

/**
 * Hook to manage database truncation operations.
 * All operations require caller to be Treasury owner (verified by signature).
 *
 * DANGER: This operation is destructive and deletes all data from the database
 * (except schema_migrations). A backup is created automatically before truncation.
 *
 * @returns {Object} Truncate utilities
 */
export const useTruncateDatabase = () => {
  const { address } = useAccount();
  const { adminPost } = useAdminAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // Reset state when address changes
  useEffect(() => {
    setIsLoading(false);
    setError(null);
  }, [address]);

  /**
   * Get list of tables that will be truncated.
   * @returns {Promise<Object>} Object with tables array and count
   */
  const getTables = useCallback(async () => {
    if (!address) {
      throw new Error('Wallet not connected');
    }

    try {
      const response = await fetch(
        `${API_URL}/api/database/tables?callerAddress=${encodeURIComponent(address)}`
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || data.message || 'Failed to get tables');
      }

      return data;
    } catch (err) {
      console.error('[useTruncateDatabase] Error getting tables:', err);
      throw err;
    }
  }, [address]);

  /**
   * Truncate all tables in the database.
   * DANGER: This is a destructive operation!
   *
   * The backend will:
   * 1. Create a backup to Pinata IPFS first (mandatory)
   * 2. Truncate all tables except schema_migrations
   *
   * @returns {Promise<Object>} Result with backup info and truncated tables
   * @throws {Error} If wallet not connected, unauthorized, backup fails, or truncation fails
   */
  const truncateDatabase = useCallback(async () => {
    if (!address) {
      throw new Error('Wallet not connected');
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await adminPost('/api/database/truncate', 'database-truncate', {
        confirmed: true, // Confirmation is handled by UI
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || data.message || 'Failed to truncate database');
      }

      return data;
    } catch (err) {
      console.error('[useTruncateDatabase] Error truncating database:', err);
      const errorMessage = err instanceof Error ? err.message : 'Network error - please try again';
      setError(errorMessage);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [address, adminPost]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    getTables,
    truncateDatabase,
    isLoading,
    error,
    clearError,
  };
};

export default useTruncateDatabase;
