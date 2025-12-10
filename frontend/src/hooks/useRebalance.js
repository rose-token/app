import { useAccount } from 'wagmi';

const API_URL = import.meta.env.VITE_PASSPORT_SIGNER_URL || 'http://localhost:3001';

/**
 * Hook to trigger manual treasury rebalance via the backend API.
 * Calls POST /api/treasury/rebalance/trigger with the connected wallet address.
 * Backend verifies the caller is the Treasury owner before executing.
 *
 * @returns {Object} Rebalance utilities
 * @returns {Function} triggerRebalance - Async function to trigger rebalance
 */
export const useRebalance = () => {
  const { address } = useAccount();

  /**
   * Trigger a manual treasury rebalance.
   * @returns {Promise<Object>} Rebalance result with txHash, swapsExecuted, etc.
   * @throws {Error} If wallet not connected, unauthorized, or API error
   */
  const triggerRebalance = async () => {
    if (!address) {
      throw new Error('Wallet not connected');
    }

    try {
      const response = await fetch(`${API_URL}/api/treasury/rebalance/trigger`, {
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
        throw new Error(data.error || data.message || 'Failed to trigger rebalance');
      }

      return data;
    } catch (error) {
      console.error('[useRebalance] Error:', error);
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('Network error - please try again');
    }
  };

  return { triggerRebalance };
};

export default useRebalance;
