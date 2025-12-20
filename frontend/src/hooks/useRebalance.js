import { useAccount, useWalletClient } from 'wagmi';
import { keccak256, encodePacked, toBytes } from 'viem';

const API_URL = import.meta.env.VITE_PASSPORT_SIGNER_URL || 'http://localhost:3001';

/**
 * Hook to trigger manual treasury rebalance via the backend API.
 * Calls POST /api/treasury/rebalance/trigger with a signed message proving wallet ownership.
 * Backend verifies the signature before executing.
 *
 * @returns {Object} Rebalance utilities
 * @returns {Function} triggerRebalance - Async function to trigger rebalance
 */
export const useRebalance = () => {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();

  /**
   * Trigger a manual treasury rebalance.
   * Signs a message to prove ownership of the caller wallet.
   * @returns {Promise<Object>} Rebalance result with txHash, swapsExecuted, etc.
   * @throws {Error} If wallet not connected, signing fails, unauthorized, or API error
   */
  const triggerRebalance = async () => {
    if (!address) {
      throw new Error('Wallet not connected');
    }

    if (!walletClient) {
      throw new Error('Wallet client not available');
    }

    try {
      // Generate timestamp for replay protection
      const timestamp = Math.floor(Date.now() / 1000);

      // Create message hash matching backend format:
      // keccak256(abi.encodePacked(callerAddress, "rebalance", timestamp))
      const messageHash = keccak256(
        encodePacked(
          ['address', 'string', 'uint256'],
          [address, 'rebalance', BigInt(timestamp)]
        )
      );

      // Sign the message hash to prove wallet ownership
      const signature = await walletClient.signMessage({
        message: { raw: toBytes(messageHash) },
      });

      const response = await fetch(`${API_URL}/api/treasury/rebalance/trigger`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          callerAddress: address,
          timestamp,
          signature,
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
