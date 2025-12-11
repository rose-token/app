/**
 * Pause hook for Treasury contract pause/unpause functionality
 *
 * Allows admin to pause/unpause the Treasury contract, which disables:
 * - Deposits
 * - Redemptions (instant and queued)
 * - Rebalancing
 * - Swap execution
 */

import { useState, useCallback } from 'react';
import {
  useAccount,
  usePublicClient,
  useReadContract,
  useWriteContract,
} from 'wagmi';
import RoseTreasuryABI from '../contracts/RoseTreasuryABI.json';
import { CONTRACTS } from '../constants/contracts';
import { GAS_SETTINGS } from '../constants/gas';

/**
 * Hook for Treasury pause operations
 * @returns {Object} Pause state and actions
 */
export const usePause = () => {
  const { address: account, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  // Read current pause status
  const {
    data: isPaused,
    isLoading: isStatusLoading,
    refetch: refetchPauseStatus,
  } = useReadContract({
    address: CONTRACTS.TREASURY,
    abi: RoseTreasuryABI,
    functionName: 'paused',
    query: {
      enabled: !!CONTRACTS.TREASURY,
    },
  });

  /**
   * Pause the Treasury contract (owner only).
   * Disables deposits, redemptions, rebalancing, and swaps.
   * @returns {Promise<{success, hash}>}
   */
  const pause = useCallback(async () => {
    if (!isConnected || !account) {
      throw new Error('Wallet not connected');
    }
    if (!CONTRACTS.TREASURY) {
      throw new Error('Treasury contract not configured');
    }

    setIsLoading(true);
    setError(null);

    try {
      console.log('Pausing Treasury contract...');
      const hash = await writeContractAsync({
        address: CONTRACTS.TREASURY,
        abi: RoseTreasuryABI,
        functionName: 'pause',
        args: [],
        ...GAS_SETTINGS,
      });

      await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: 1,
      });

      // Refetch pause status
      await refetchPauseStatus();

      console.log('Treasury paused successfully!');
      return { success: true, hash };
    } catch (err) {
      console.error('Pause error:', err);
      const message = parsePauseError(err);
      setError(message);
      throw new Error(message);
    } finally {
      setIsLoading(false);
    }
  }, [isConnected, account, writeContractAsync, publicClient, refetchPauseStatus]);

  /**
   * Unpause the Treasury contract (owner only).
   * Re-enables deposits, redemptions, rebalancing, and swaps.
   * @returns {Promise<{success, hash}>}
   */
  const unpause = useCallback(async () => {
    if (!isConnected || !account) {
      throw new Error('Wallet not connected');
    }
    if (!CONTRACTS.TREASURY) {
      throw new Error('Treasury contract not configured');
    }

    setIsLoading(true);
    setError(null);

    try {
      console.log('Unpausing Treasury contract...');
      const hash = await writeContractAsync({
        address: CONTRACTS.TREASURY,
        abi: RoseTreasuryABI,
        functionName: 'unpause',
        args: [],
        ...GAS_SETTINGS,
      });

      await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: 1,
      });

      // Refetch pause status
      await refetchPauseStatus();

      console.log('Treasury unpaused successfully!');
      return { success: true, hash };
    } catch (err) {
      console.error('Unpause error:', err);
      const message = parsePauseError(err);
      setError(message);
      throw new Error(message);
    } finally {
      setIsLoading(false);
    }
  }, [isConnected, account, writeContractAsync, publicClient, refetchPauseStatus]);

  /**
   * Clear error state
   */
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    // State
    isPaused: !!isPaused,
    isStatusLoading,
    isLoading,
    error,

    // Actions
    pause,
    unpause,
    clearError,
    refetchPauseStatus,
  };
};

/**
 * Parse contract errors into user-friendly messages
 */
function parsePauseError(err) {
  const message = err.message || '';

  if (message.includes('User rejected')) {
    return 'Transaction rejected';
  }
  if (message.includes('OwnableUnauthorizedAccount')) {
    return 'Only the contract owner can pause/unpause the Treasury';
  }
  if (message.includes('EnforcedPause')) {
    return 'Contract is already paused';
  }
  if (message.includes('ExpectedPause')) {
    return 'Contract is not currently paused';
  }
  if (message.includes('insufficient funds')) {
    return 'Insufficient funds for gas';
  }

  return message;
}

export default usePause;
