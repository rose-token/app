/**
 * Auction hook for reverse auction system
 *
 * Handles off-chain bid submission to backend and on-chain winner selection.
 * Workers submit bids off-chain, customers view bids and select winners,
 * then execute on-chain with backend signature.
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import {
  useAccount,
  usePublicClient,
  useWriteContract,
  useWalletClient,
  useReadContract,
} from 'wagmi';
import { formatUnits, parseUnits, keccak256, encodePacked, isAddress } from 'viem';
import RoseMarketplaceABI from '../contracts/RoseMarketplaceABI.json';
import { CONTRACTS } from '../constants/contracts';
import { GAS_SETTINGS } from '../constants/gas';

// Backend signer URL
const SIGNER_URL = import.meta.env.VITE_PASSPORT_SIGNER_URL || 'http://localhost:3001';

/**
 * Sign bid message for submission
 * Message format: keccak256(abi.encodePacked(worker, "submitBid", taskId, bidAmount))
 */
const signBidMessage = async (walletClient, worker, taskId, bidAmount) => {
  const messageHash = keccak256(
    encodePacked(
      ['address', 'string', 'uint256', 'uint256'],
      [worker, 'submitBid', BigInt(taskId), BigInt(bidAmount)]
    )
  );

  // Sign the message hash as raw bytes (ethers.verifyMessage compatible)
  const signature = await walletClient.signMessage({
    message: { raw: messageHash },
  });

  return signature;
};

/**
 * Hook for auction operations
 * @returns {Object} Auction state and actions
 */
export const useAuction = () => {
  const { address: account, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { data: walletClient } = useWalletClient();

  const [error, setError] = useState(null);
  const [actionLoading, setActionLoading] = useState({
    submitBid: false,
    selectWinner: false,
    registerAuction: false,
  });

  /**
   * Register an auction task after it's created on-chain.
   * Should be called by frontend after createAuctionTask tx confirms.
   * @param {number} taskId - Task ID
   * @param {string} maxBudget - Max budget in wei (string)
   */
  const registerAuction = useCallback(async (taskId, maxBudget) => {
    setActionLoading(prev => ({ ...prev, registerAuction: true }));
    setError(null);

    try {
      const response = await fetch(`${SIGNER_URL}/api/auction/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: Number(taskId), maxBudget }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const data = await response.json();
      console.log(`Auction ${taskId} registered with max budget ${maxBudget}`);
      return data;
    } catch (err) {
      console.error('Register auction error:', err);
      setError(err.message);
      throw err;
    } finally {
      setActionLoading(prev => ({ ...prev, registerAuction: false }));
    }
  }, []);

  /**
   * Submit or update a bid for an auction task.
   * Signs the bid with the worker's wallet and submits to backend.
   * @param {number} taskId - Task ID
   * @param {string} amount - Bid amount in ROSE (human readable, e.g., "100")
   * @param {string} message - Optional message with bid
   */
  const submitBid = useCallback(async (taskId, amount, message = null) => {
    if (!isConnected || !account) {
      throw new Error('Wallet not connected');
    }
    if (!walletClient) {
      throw new Error('Wallet client not available');
    }

    setActionLoading(prev => ({ ...prev, submitBid: true }));
    setError(null);

    try {
      // Convert human-readable ROSE to wei (18 decimals)
      const bidAmountWei = parseUnits(amount, 18).toString();

      // Sign bid message with wallet
      console.log(`Signing bid: task=${taskId}, amount=${amount} ROSE`);
      const signature = await signBidMessage(walletClient, account, taskId, bidAmountWei);

      // Submit to backend
      const response = await fetch(`${SIGNER_URL}/api/auction/bid`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: Number(taskId),
          worker: account,
          bidAmount: bidAmountWei,
          message,
          signature,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const data = await response.json();
      console.log(`Bid ${data.isUpdate ? 'updated' : 'submitted'}: ${amount} ROSE`);
      return data;
    } catch (err) {
      console.error('Submit bid error:', err);
      const message = err.message.includes('User rejected')
        ? 'Signature rejected'
        : err.message;
      setError(message);
      throw new Error(message);
    } finally {
      setActionLoading(prev => ({ ...prev, submitBid: false }));
    }
  }, [isConnected, account, walletClient]);

  /**
   * Get all bids for an auction task.
   * Should only be called for task customers (access control at route level).
   * @param {number} taskId - Task ID
   * @returns {Promise<{taskId, maxBudget, bidCount, bids[]}>}
   */
  const getBids = useCallback(async (taskId) => {
    try {
      const response = await fetch(`${SIGNER_URL}/api/auction/${taskId}/bids`);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      return response.json();
    } catch (err) {
      console.error('Get bids error:', err);
      throw err;
    }
  }, []);

  /**
   * Get bid count for a task (public).
   * @param {number} taskId - Task ID
   * @returns {Promise<{taskId, bidCount}>}
   */
  const getBidCount = useCallback(async (taskId) => {
    try {
      const response = await fetch(`${SIGNER_URL}/api/auction/${taskId}/count`);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      return response.json();
    } catch (err) {
      console.error('Get bid count error:', err);
      throw err;
    }
  }, []);

  /**
   * Get a worker's own bid for a task.
   * @param {number} taskId - Task ID
   * @returns {Promise<{taskId, worker, hasBid, bid}>}
   */
  const getMyBid = useCallback(async (taskId) => {
    if (!account) {
      throw new Error('Wallet not connected');
    }

    try {
      const response = await fetch(`${SIGNER_URL}/api/auction/${taskId}/my-bid/${account}`);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      return response.json();
    } catch (err) {
      console.error('Get my bid error:', err);
      throw err;
    }
  }, [account]);

  /**
   * Get auction task info (public).
   * @param {number} taskId - Task ID
   * @returns {Promise<{taskId, maxBudget, bidCount, winner, winningBid, concludedAt, createdAt}>}
   */
  const getAuctionInfo = useCallback(async (taskId) => {
    try {
      const response = await fetch(`${SIGNER_URL}/api/auction/${taskId}`);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      return response.json();
    } catch (err) {
      console.error('Get auction info error:', err);
      throw err;
    }
  }, []);

  /**
   * Check if an auction task exists (public).
   * @param {number} taskId - Task ID
   * @returns {Promise<{taskId, exists}>}
   */
  const checkAuctionExists = useCallback(async (taskId) => {
    try {
      const response = await fetch(`${SIGNER_URL}/api/auction/${taskId}/exists`);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      return response.json();
    } catch (err) {
      console.error('Check auction exists error:', err);
      throw err;
    }
  }, []);

  /**
   * Select auction winner and execute on-chain.
   * Customer calls this to select a winning bid and transition task to InProgress.
   * @param {number} taskId - Task ID
   * @param {string} worker - Winner worker address
   * @param {string} winningBid - Winning bid amount in wei (string)
   * @returns {Promise<{success, hash}>}
   */
  const selectWinner = useCallback(async (taskId, worker, winningBid) => {
    if (!isConnected || !account) {
      throw new Error('Wallet not connected');
    }
    if (!CONTRACTS.MARKETPLACE) {
      throw new Error('Marketplace contract not configured');
    }
    if (!isAddress(worker)) {
      throw new Error('Invalid worker address');
    }

    setActionLoading(prev => ({ ...prev, selectWinner: true }));
    setError(null);

    try {
      // Step 1: Get signature from backend
      console.log(`Requesting winner selection signature for task ${taskId}...`);
      const response = await fetch(`${SIGNER_URL}/api/auction/select-winner`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: Number(taskId),
          customer: account,
          worker,
          winningBid,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const signatureData = await response.json();
      console.log('Got signature from backend:', signatureData);

      // Step 2: Call on-chain selectAuctionWinner
      console.log(`Executing selectAuctionWinner on-chain...`);
      const hash = await writeContractAsync({
        address: CONTRACTS.MARKETPLACE,
        abi: RoseMarketplaceABI,
        functionName: 'selectAuctionWinner',
        args: [
          BigInt(taskId),
          worker,
          BigInt(winningBid),
          BigInt(signatureData.expiry),
          signatureData.signature,
        ],
        ...GAS_SETTINGS,
      });

      await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: 1,
      });

      console.log('Winner selected on-chain!');

      // Step 3: Confirm with backend
      try {
        await confirmWinner(taskId, worker, winningBid);
      } catch (confirmErr) {
        console.warn('Failed to confirm winner with backend:', confirmErr);
        // Non-fatal - tx succeeded on-chain
      }

      return { success: true, hash };
    } catch (err) {
      console.error('Select winner error:', err);
      const message = err.message.includes('User rejected')
        ? 'Transaction rejected'
        : err.message.includes('NotCustomer')
        ? 'Only the task customer can select winner'
        : err.message.includes('NotAuctionTask')
        ? 'This is not an auction task'
        : err.message.includes('InvalidWinningBid')
        ? 'Invalid winning bid amount'
        : err.message;
      setError(message);
      throw new Error(message);
    } finally {
      setActionLoading(prev => ({ ...prev, selectWinner: false }));
    }
  }, [isConnected, account, writeContractAsync, publicClient]);

  /**
   * Confirm winner selection with backend after on-chain tx.
   * Called internally after selectWinner, or manually if initial confirm failed.
   * @param {number} taskId - Task ID
   * @param {string} winner - Winner address
   * @param {string} winningBid - Winning bid in wei (string)
   */
  const confirmWinner = useCallback(async (taskId, winner, winningBid) => {
    try {
      const response = await fetch(`${SIGNER_URL}/api/auction/confirm-winner`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: Number(taskId),
          winner,
          winningBid,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      console.log(`Auction ${taskId} confirmed with winner ${winner}`);
      return response.json();
    } catch (err) {
      console.error('Confirm winner error:', err);
      throw err;
    }
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
    registerAuction,
    submitBid,
    getBids,
    getBidCount,
    getMyBid,
    getAuctionInfo,
    checkAuctionExists,
    selectWinner,
    confirmWinner,
    clearError,
  };
};

/**
 * Hook for auction-specific task data
 * Returns auction info for a specific task, auto-refreshes
 * @param {number} taskId - Task ID
 * @returns {Object} Auction task data
 */
export const useAuctionTask = (taskId) => {
  const [auctionInfo, setAuctionInfo] = useState(null);
  const [bidCount, setBidCount] = useState(0);
  const [myBid, setMyBid] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const { account } = useAccount();

  // Read task data from on-chain to check if it's an auction
  const { data: taskData, refetch: refetchTask } = useReadContract({
    address: CONTRACTS.MARKETPLACE,
    abi: RoseMarketplaceABI,
    functionName: 'tasks',
    args: [BigInt(taskId || 0)],
    query: {
      enabled: !!taskId && !!CONTRACTS.MARKETPLACE,
    },
  });

  // Parse task data
  const parsedTask = useMemo(() => {
    if (!taskData) return null;

    return {
      customer: taskData[0],
      worker: taskData[1],
      stakeholder: taskData[2],
      deposit: taskData[3],
      stakeholderDeposit: taskData[4],
      title: taskData[5],
      detailedDescriptionHash: taskData[6],
      prUrl: taskData[7],
      status: Number(taskData[8]),
      customerApproval: taskData[9],
      stakeholderApproval: taskData[10],
      source: Number(taskData[11]),
      proposalId: taskData[12],
      isAuction: taskData[13],
      winningBid: taskData[14],
    };
  }, [taskData]);

  // Fetch auction info from backend
  const fetchAuctionInfo = useCallback(async () => {
    if (!taskId || !parsedTask?.isAuction) {
      setAuctionInfo(null);
      setIsLoading(false);
      return;
    }

    try {
      const response = await fetch(`${SIGNER_URL}/api/auction/${taskId}`);
      if (response.ok) {
        const data = await response.json();
        setAuctionInfo(data);
        setBidCount(data.bidCount || 0);
      }
    } catch (err) {
      console.error('Failed to fetch auction info:', err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [taskId, parsedTask?.isAuction]);

  // Fetch worker's bid if connected
  const fetchMyBid = useCallback(async () => {
    if (!taskId || !account || !parsedTask?.isAuction) {
      setMyBid(null);
      return;
    }

    try {
      const response = await fetch(`${SIGNER_URL}/api/auction/${taskId}/my-bid/${account}`);
      if (response.ok) {
        const data = await response.json();
        setMyBid(data.hasBid ? data.bid : null);
      }
    } catch (err) {
      console.error('Failed to fetch my bid:', err);
    }
  }, [taskId, account, parsedTask?.isAuction]);

  // Fetch on mount and when deps change
  useEffect(() => {
    if (parsedTask !== null) {
      fetchAuctionInfo();
      fetchMyBid();
    }
  }, [parsedTask, fetchAuctionInfo, fetchMyBid]);

  // Computed values
  const isAuction = parsedTask?.isAuction || false;
  const isCustomer = account && parsedTask?.customer?.toLowerCase() === account.toLowerCase();
  const hasWinner = auctionInfo?.winner !== null && auctionInfo?.winner !== undefined;

  // Format values for display
  const maxBudgetFormatted = auctionInfo?.maxBudget
    ? formatUnits(BigInt(auctionInfo.maxBudget), 18)
    : '0';
  const winningBidFormatted = auctionInfo?.winningBid
    ? formatUnits(BigInt(auctionInfo.winningBid), 18)
    : '0';
  const myBidFormatted = myBid?.bidAmount
    ? formatUnits(BigInt(myBid.bidAmount), 18)
    : null;

  return {
    // Task data
    task: parsedTask,
    isAuction,
    isCustomer,

    // Auction data
    auctionInfo,
    bidCount,
    myBid,
    hasWinner,

    // Formatted values
    maxBudget: maxBudgetFormatted,
    maxBudgetRaw: auctionInfo?.maxBudget,
    winningBid: winningBidFormatted,
    winningBidRaw: auctionInfo?.winningBid,
    myBidAmount: myBidFormatted,
    myBidRaw: myBid?.bidAmount,

    // State
    isLoading,
    error,

    // Actions
    refetch: async () => {
      await refetchTask();
      await fetchAuctionInfo();
      await fetchMyBid();
    },
    refetchBid: fetchMyBid,
  };
};

export default useAuction;
