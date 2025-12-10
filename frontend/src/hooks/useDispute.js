/**
 * Dispute hook for task dispute resolution
 *
 * Handles on-chain dispute creation and backend queries for admin UI.
 * Customer can dispute InProgress tasks, Worker can dispute Completed tasks.
 * Owner resolves disputes with percentage split.
 */

import { useState, useCallback } from 'react';
import {
  useAccount,
  usePublicClient,
  useWriteContract,
} from 'wagmi';
import RoseMarketplaceABI from '../contracts/RoseMarketplaceABI.json';
import { CONTRACTS } from '../constants/contracts';
import { GAS_SETTINGS } from '../constants/gas';
import { TaskStatus } from '../utils/taskStatus';

// Backend signer URL
const SIGNER_URL = import.meta.env.VITE_PASSPORT_SIGNER_URL || 'http://localhost:3001';

/**
 * Hook for dispute operations
 * @returns {Object} Dispute state and actions
 */
export const useDispute = () => {
  const { address: account, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [error, setError] = useState(null);
  const [actionLoading, setActionLoading] = useState({
    disputeAsCustomer: false,
    disputeAsWorker: false,
    resolveDispute: false,
  });

  /**
   * Raise a dispute as the customer (requires InProgress status).
   * @param {number} taskId - Task ID
   * @param {string} reasonHash - IPFS hash of dispute reason
   * @returns {Promise<{success, hash}>}
   */
  const disputeAsCustomer = useCallback(async (taskId, reasonHash) => {
    if (!isConnected || !account) {
      throw new Error('Wallet not connected');
    }
    if (!CONTRACTS.MARKETPLACE) {
      throw new Error('Marketplace contract not configured');
    }

    setActionLoading(prev => ({ ...prev, disputeAsCustomer: true }));
    setError(null);

    try {
      console.log(`Disputing task ${taskId} as customer...`);
      const hash = await writeContractAsync({
        address: CONTRACTS.MARKETPLACE,
        abi: RoseMarketplaceABI,
        functionName: 'disputeTaskAsCustomer',
        args: [BigInt(taskId), reasonHash],
        ...GAS_SETTINGS,
      });

      await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: 1,
      });

      console.log('Dispute raised successfully!');
      return { success: true, hash };
    } catch (err) {
      console.error('Dispute as customer error:', err);
      const message = parseDisputeError(err);
      setError(message);
      throw new Error(message);
    } finally {
      setActionLoading(prev => ({ ...prev, disputeAsCustomer: false }));
    }
  }, [isConnected, account, writeContractAsync, publicClient]);

  /**
   * Raise a dispute as the worker (requires Completed status).
   * @param {number} taskId - Task ID
   * @param {string} reasonHash - IPFS hash of dispute reason
   * @returns {Promise<{success, hash}>}
   */
  const disputeAsWorker = useCallback(async (taskId, reasonHash) => {
    if (!isConnected || !account) {
      throw new Error('Wallet not connected');
    }
    if (!CONTRACTS.MARKETPLACE) {
      throw new Error('Marketplace contract not configured');
    }

    setActionLoading(prev => ({ ...prev, disputeAsWorker: true }));
    setError(null);

    try {
      console.log(`Disputing task ${taskId} as worker...`);
      const hash = await writeContractAsync({
        address: CONTRACTS.MARKETPLACE,
        abi: RoseMarketplaceABI,
        functionName: 'disputeTaskAsWorker',
        args: [BigInt(taskId), reasonHash],
        ...GAS_SETTINGS,
      });

      await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: 1,
      });

      console.log('Dispute raised successfully!');
      return { success: true, hash };
    } catch (err) {
      console.error('Dispute as worker error:', err);
      const message = parseDisputeError(err);
      setError(message);
      throw new Error(message);
    } finally {
      setActionLoading(prev => ({ ...prev, disputeAsWorker: false }));
    }
  }, [isConnected, account, writeContractAsync, publicClient]);

  /**
   * Resolve a dispute (owner only).
   * @param {number} taskId - Task ID
   * @param {number} workerPct - Percentage to give to worker (0-100)
   * @returns {Promise<{success, hash}>}
   */
  const resolveDispute = useCallback(async (taskId, workerPct) => {
    if (!isConnected || !account) {
      throw new Error('Wallet not connected');
    }
    if (!CONTRACTS.MARKETPLACE) {
      throw new Error('Marketplace contract not configured');
    }
    if (workerPct < 0 || workerPct > 100) {
      throw new Error('Worker percentage must be between 0 and 100');
    }

    setActionLoading(prev => ({ ...prev, resolveDispute: true }));
    setError(null);

    try {
      console.log(`Resolving dispute for task ${taskId} with ${workerPct}% to worker...`);
      const hash = await writeContractAsync({
        address: CONTRACTS.MARKETPLACE,
        abi: RoseMarketplaceABI,
        functionName: 'resolveDispute',
        args: [BigInt(taskId), BigInt(workerPct)],
        ...GAS_SETTINGS,
      });

      await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: 1,
      });

      console.log('Dispute resolved successfully!');
      return { success: true, hash };
    } catch (err) {
      console.error('Resolve dispute error:', err);
      const message = parseDisputeError(err);
      setError(message);
      throw new Error(message);
    } finally {
      setActionLoading(prev => ({ ...prev, resolveDispute: false }));
    }
  }, [isConnected, account, writeContractAsync, publicClient]);

  /**
   * Get dispute info for a task from backend.
   * @param {number} taskId - Task ID
   * @returns {Promise<DisputeInfo|null>}
   */
  const getDisputeInfo = useCallback(async (taskId) => {
    try {
      const response = await fetch(`${SIGNER_URL}/api/dispute/${taskId}`);

      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      return response.json();
    } catch (err) {
      console.error('Get dispute info error:', err);
      throw err;
    }
  }, []);

  /**
   * List disputes with pagination (for admin UI).
   * @param {number} page - Page number (default 1)
   * @param {number} pageSize - Items per page (default 20)
   * @param {boolean} openOnly - Only return unresolved disputes
   * @returns {Promise<{disputes, total, page, pageSize}>}
   */
  const listDisputes = useCallback(async (page = 1, pageSize = 20, openOnly = false) => {
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        pageSize: pageSize.toString(),
        openOnly: openOnly.toString(),
      });

      const response = await fetch(`${SIGNER_URL}/api/dispute/list?${params}`);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      return response.json();
    } catch (err) {
      console.error('List disputes error:', err);
      throw err;
    }
  }, []);

  /**
   * Get dispute statistics (for admin UI).
   * @returns {Promise<DisputeStats>}
   */
  const getDisputeStats = useCallback(async () => {
    try {
      const response = await fetch(`${SIGNER_URL}/api/dispute/stats`);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      return response.json();
    } catch (err) {
      console.error('Get dispute stats error:', err);
      throw err;
    }
  }, []);

  /**
   * Check if user can dispute a task.
   * @param {Object} task - Task object
   * @param {string} userAddress - User's wallet address
   * @returns {{canDispute: boolean, role: string|null, reason: string|null}}
   */
  const canDispute = useCallback((task, userAddress) => {
    if (!task || !userAddress) {
      return { canDispute: false, role: null, reason: 'Missing task or user' };
    }

    const address = userAddress.toLowerCase();
    const isCustomer = task.customer?.toLowerCase() === address;
    const isWorker = task.worker?.toLowerCase() === address;
    const status = parseInt(task.status);

    // Customer can dispute InProgress tasks
    if (isCustomer && status === TaskStatus.InProgress) {
      return { canDispute: true, role: 'customer', reason: null };
    }

    // Worker can dispute Completed tasks
    if (isWorker && status === TaskStatus.Completed) {
      return { canDispute: true, role: 'worker', reason: null };
    }

    // Determine reason for inability to dispute
    if (isCustomer) {
      if (status !== TaskStatus.InProgress) {
        return { canDispute: false, role: 'customer', reason: 'Task must be In Progress to dispute' };
      }
    }

    if (isWorker) {
      if (status !== TaskStatus.Completed) {
        return { canDispute: false, role: 'worker', reason: 'Task must be Completed to dispute' };
      }
    }

    if (!isCustomer && !isWorker) {
      return { canDispute: false, role: null, reason: 'Only customer or worker can dispute' };
    }

    return { canDispute: false, role: null, reason: 'Cannot dispute this task' };
  }, []);

  /**
   * Clear error state
   */
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    // State
    isConnected,
    account,
    error,
    actionLoading,

    // Actions
    disputeAsCustomer,
    disputeAsWorker,
    resolveDispute,
    getDisputeInfo,
    listDisputes,
    getDisputeStats,
    canDispute,
    clearError,
  };
};

/**
 * Parse contract errors into user-friendly messages
 */
function parseDisputeError(err) {
  const message = err.message || '';

  if (message.includes('User rejected')) {
    return 'Transaction rejected';
  }
  if (message.includes('NotCustomer')) {
    return 'Only the task customer can perform this action';
  }
  if (message.includes('NotWorker')) {
    return 'Only the task worker can perform this action';
  }
  if (message.includes('NotInDisputableStatus')) {
    return 'Task is not in a status that allows disputes';
  }
  if (message.includes('DisputeAlreadyRaised')) {
    return 'A dispute has already been raised for this task';
  }
  if (message.includes('TaskNotDisputed')) {
    return 'Task is not in disputed status';
  }
  if (message.includes('InvalidResolutionPercentage')) {
    return 'Worker percentage must be between 0 and 100';
  }
  if (message.includes('OwnableUnauthorizedAccount')) {
    return 'Only the contract owner can resolve disputes';
  }

  return message;
}

export default useDispute;
