/**
 * useTasks Hook
 *
 * Centralized hook for all task-related operations:
 * - Fetch all tasks or single task
 * - Task actions (claim, stake, complete, approve, etc.)
 * - Contract event watching with debounced refetch
 * - Filter state management
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAccount, useReadContract, useReadContracts, useWriteContract, useWatchContractEvent, usePublicClient } from 'wagmi';
import { formatUnits } from 'viem';
import { TaskStatus } from '../utils/taskStatus';
import { usePassport } from './usePassport';
import { usePassportVerify } from './usePassportVerify';
import { PASSPORT_THRESHOLDS } from '../constants/passport';
import { GAS_SETTINGS } from '../constants/gas';

import RoseMarketplaceABI from '../contracts/RoseMarketplaceABI.json';
import RoseTokenABI from '../contracts/RoseTokenABI.json';
import vROSEABI from '../contracts/vROSEABI.json';

const MARKETPLACE_ADDRESS = import.meta.env.VITE_MARKETPLACE_ADDRESS;
const TOKEN_ADDRESS = import.meta.env.VITE_TOKEN_ADDRESS;
const VROSE_ADDRESS = import.meta.env.VITE_VROSE_ADDRESS;

/**
 * @param {Object} options
 * @param {number} [options.taskId] - Optional task ID for single task mode
 * @returns {Object} Task data and action handlers
 */
export const useTasks = ({ taskId = null } = {}) => {
  const [tasks, setTasks] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState('');

  // Loading states for each button type
  const [loadingStates, setLoadingStates] = useState({
    stake: {},
    unstake: {},
    claim: {},
    unclaim: {},
    complete: {},
    approveCustomer: {},
    approveStakeholder: {},
    acceptPayment: {},
    cancel: {}
  });

  // Filter state
  const [filters, setFilters] = useState({
    status: 'all', // 'all', 'stakeholderRequired', 'open', 'inProgress', 'completed', etc.
    myTasks: false
  });

  const { address: account, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { score: passportScore, isConfigured: passportConfigured } = usePassport();
  const { getSignature } = usePassportVerify();

  const isInitialLoadRef = useRef(true);
  const debouncedFetchRef = useRef(null);

  // Read taskCounter from marketplace contract
  const { data: taskCounter, refetch: refetchTaskCounter } = useReadContract({
    address: MARKETPLACE_ADDRESS,
    abi: RoseMarketplaceABI,
    functionName: 'taskCounter',
    query: {
      enabled: isConnected && !!MARKETPLACE_ADDRESS,
    }
  });

  const { writeContractAsync } = useWriteContract();

  // Task count
  const taskCount = useMemo(() => {
    if (!taskCounter) return 0;
    return Number(taskCounter);
  }, [taskCounter]);

  // Generate contract calls for all tasks (or single task)
  const taskContracts = useMemo(() => {
    if (!MARKETPLACE_ADDRESS) return [];

    if (taskId) {
      // Single task mode
      return [{
        address: MARKETPLACE_ADDRESS,
        abi: RoseMarketplaceABI,
        functionName: 'tasks',
        args: [BigInt(taskId)]
      }];
    }

    if (taskCount === 0) return [];

    // All tasks mode
    return Array.from({ length: taskCount }, (_, i) => ({
      address: MARKETPLACE_ADDRESS,
      abi: RoseMarketplaceABI,
      functionName: 'tasks',
      args: [BigInt(i + 1)]
    }));
  }, [MARKETPLACE_ADDRESS, taskCount, taskId]);

  // Batch read tasks
  const { data: tasksData, refetch: refetchTasks, isLoading: isLoadingTasks } = useReadContracts({
    contracts: taskContracts,
    allowSparse: true,
    cacheTime: 1_000,
    staleTime: 0,
    query: {
      enabled: isConnected && taskContracts.length > 0,
    }
  });

  // Process task data
  const processedTasks = useMemo(() => {
    if (!tasksData) return [];

    return tasksData
      .map((result, index) => {
        if (result.status !== 'success' || !result.result) return null;

        const task = result.result;
        const taskIdValue = taskId || (index + 1);

        const [
          customer, worker, stakeholder, depositBig, stakeholderDepositBig,
          title, detailedDescriptionHash, prUrl, statusRaw, customerApproval,
          stakeholderApproval, source, proposalId, isAuction, winningBidBig,
          disputeInitiator, disputedAt, disputeReasonHash, githubIntegration
        ] = Array.isArray(task) ? task : [
          task.customer, task.worker, task.stakeholder, task.deposit,
          task.stakeholderDeposit ?? 0n, task.title, task.detailedDescriptionHash,
          task.prUrl, task.status, task.customerApproval, task.stakeholderApproval,
          task.source ?? 0, task.proposalId ?? 0n, task.isAuction ?? false, task.winningBid ?? 0n,
          task.disputeInitiator ?? '0x0000000000000000000000000000000000000000',
          task.disputedAt ?? 0n, task.disputeReasonHash ?? '', task.githubIntegration ?? true
        ];

        return {
          id: taskIdValue,
          customer,
          worker,
          stakeholder,
          deposit: depositBig.toString(),
          stakeholderDeposit: stakeholderDepositBig.toString(),
          description: title || '',
          detailedDescription: detailedDescriptionHash || '',
          prUrl: prUrl || '',
          status: Number(statusRaw),
          customerApproval,
          stakeholderApproval,
          source: Number(source ?? 0),
          proposalId: proposalId?.toString() ?? '0',
          isAuction: Boolean(isAuction),
          winningBid: winningBidBig?.toString() ?? '0',
          disputeInitiator: disputeInitiator || '0x0000000000000000000000000000000000000000',
          disputedAt: disputedAt?.toString() ?? '0',
          disputeReasonHash: disputeReasonHash || '',
          githubIntegration: Boolean(githubIntegration ?? true)
        };
      })
      .filter(task => task !== null);
  }, [tasksData, taskId]);

  // Fetch tasks
  const fetchTasks = useCallback(async () => {
    if (!MARKETPLACE_ADDRESS || taskCounter === undefined || taskCounter === null) return;

    try {
      if (isInitialLoadRef.current) {
        setIsLoading(true);
      } else {
        setIsRefreshing(true);
      }
      setError('');

      await refetchTaskCounter();
      await refetchTasks();

      isInitialLoadRef.current = false;
    } catch (err) {
      console.error('Error fetching tasks:', err);
      setError('Failed to load tasks: ' + err.message);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [MARKETPLACE_ADDRESS, taskCounter, refetchTasks, refetchTaskCounter]);

  // Debounced fetch
  const debouncedFetchTasks = useCallback(() => {
    if (debouncedFetchRef.current) {
      clearTimeout(debouncedFetchRef.current);
    }
    debouncedFetchRef.current = setTimeout(() => {
      refetchTaskCounter();
      fetchTasks();
      debouncedFetchRef.current = null;
    }, 300);
  }, [fetchTasks, refetchTaskCounter]);

  // ============ ACTION HANDLERS ============

  const handleClaimTask = useCallback(async (id) => {
    if (!isConnected || !MARKETPLACE_ADDRESS) return;

    const task = tasks.find(t => t.id === id);
    if (!task) {
      setError('Task not found');
      return;
    }

    if (task.customer === account) {
      setError('You cannot claim your own task');
      return;
    }

    if (task.stakeholder === account) {
      setError('You cannot claim a task you are validating as stakeholder');
      return;
    }

    if (task.worker !== '0x0000000000000000000000000000000000000000') {
      setError('Task has already been claimed by another worker');
      return;
    }

    if (passportConfigured && passportScore !== null && passportScore < PASSPORT_THRESHOLDS.CLAIM_TASK) {
      setError(`Gitcoin Passport score of ${PASSPORT_THRESHOLDS.CLAIM_TASK}+ required to claim tasks. Your score: ${passportScore.toFixed(1)}`);
      return;
    }

    try {
      setError('');
      setLoadingStates(prev => ({ ...prev, claim: { ...prev.claim, [id]: true } }));

      const { expiry, signature } = await getSignature('claim');

      const hash = await writeContractAsync({
        address: MARKETPLACE_ADDRESS,
        abi: RoseMarketplaceABI,
        functionName: 'claimTask',
        args: [BigInt(id), BigInt(expiry), signature],
        ...GAS_SETTINGS,
      });

      await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });

      setLoadingStates(prev => ({ ...prev, claim: { ...prev.claim, [id]: false } }));
      debouncedFetchTasks();
    } catch (err) {
      console.error('Error claiming task:', err);
      setLoadingStates(prev => ({ ...prev, claim: { ...prev.claim, [id]: false } }));
      const errorMessage = err.message.includes('execution reverted')
        ? err.message.split('execution reverted:')[1]?.split('"')[0].trim() || 'Failed to claim task'
        : err.message.includes('User rejected') || err.message.includes('user rejected')
        ? 'Transaction rejected. Please approve the transaction in your wallet to continue.'
        : 'Failed to claim task';
      setError(errorMessage);
    }
  }, [isConnected, tasks, account, passportConfigured, passportScore, getSignature, writeContractAsync, publicClient, debouncedFetchTasks]);

  const handleUnclaimTask = useCallback(async (id) => {
    if (!isConnected || !MARKETPLACE_ADDRESS) return;

    try {
      setError('');
      setLoadingStates(prev => ({ ...prev, unclaim: { ...prev.unclaim, [id]: true } }));

      const hash = await writeContractAsync({
        address: MARKETPLACE_ADDRESS,
        abi: RoseMarketplaceABI,
        functionName: 'unclaimTask',
        args: [BigInt(id)],
        ...GAS_SETTINGS,
      });

      await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });

      setLoadingStates(prev => ({ ...prev, unclaim: { ...prev.unclaim, [id]: false } }));
      debouncedFetchTasks();
    } catch (err) {
      console.error('Error unclaiming task:', err);
      setLoadingStates(prev => ({ ...prev, unclaim: { ...prev.unclaim, [id]: false } }));
      const errorMessage = err.message.includes('execution reverted')
        ? err.message.split('execution reverted:')[1]?.split('"')[0].trim() || 'Failed to unclaim task'
        : err.message.includes('User rejected') || err.message.includes('user rejected')
        ? 'Transaction rejected.'
        : 'Failed to unclaim task';
      setError(errorMessage);
    }
  }, [isConnected, writeContractAsync, publicClient, debouncedFetchTasks]);

  const handleCompleteTask = useCallback(async (id, prUrl) => {
    if (!isConnected || !MARKETPLACE_ADDRESS) return;

    try {
      setError('');
      setLoadingStates(prev => ({ ...prev, complete: { ...prev.complete, [id]: true } }));

      const hash = await writeContractAsync({
        address: MARKETPLACE_ADDRESS,
        abi: RoseMarketplaceABI,
        functionName: 'markTaskCompleted',
        args: [BigInt(id), prUrl],
        ...GAS_SETTINGS,
      });

      await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });

      setLoadingStates(prev => ({ ...prev, complete: { ...prev.complete, [id]: false } }));
      debouncedFetchTasks();
    } catch (err) {
      console.error('Error completing task:', err);
      setLoadingStates(prev => ({ ...prev, complete: { ...prev.complete, [id]: false } }));
      const errorMessage = err.message.includes('PR URL cannot be empty')
        ? 'PR URL is required to mark task as completed'
        : err.message.includes('User rejected') || err.message.includes('user rejected')
        ? 'Transaction rejected.'
        : 'Failed to mark task as completed';
      setError(errorMessage);
    }
  }, [isConnected, writeContractAsync, publicClient, debouncedFetchTasks]);

  const handleApproveTask = useCallback(async (id, role) => {
    if (!isConnected || !MARKETPLACE_ADDRESS) return;

    const loadingKey = role === 'customer' ? 'approveCustomer' : 'approveStakeholder';

    try {
      setError('');
      setLoadingStates(prev => ({ ...prev, [loadingKey]: { ...prev[loadingKey], [id]: true } }));

      const functionName = role === 'customer' ? 'approveCompletionByCustomer' : 'approveCompletionByStakeholder';

      const hash = await writeContractAsync({
        address: MARKETPLACE_ADDRESS,
        abi: RoseMarketplaceABI,
        functionName,
        args: [BigInt(id)],
        ...GAS_SETTINGS,
      });

      await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });

      setLoadingStates(prev => ({ ...prev, [loadingKey]: { ...prev[loadingKey], [id]: false } }));
      debouncedFetchTasks();
    } catch (err) {
      console.error('Error approving task:', err);
      setLoadingStates(prev => ({ ...prev, [loadingKey]: { ...prev[loadingKey], [id]: false } }));
      const errorMessage = err.message.includes('User rejected') || err.message.includes('user rejected')
        ? 'Transaction rejected.'
        : `Failed to approve task as ${role}`;
      setError(errorMessage);
    }
  }, [isConnected, writeContractAsync, publicClient, debouncedFetchTasks]);

  const handleAcceptPayment = useCallback(async (id) => {
    if (!isConnected || !MARKETPLACE_ADDRESS) return;

    try {
      setError('');
      setLoadingStates(prev => ({ ...prev, acceptPayment: { ...prev.acceptPayment, [id]: true } }));

      const hash = await writeContractAsync({
        address: MARKETPLACE_ADDRESS,
        abi: RoseMarketplaceABI,
        functionName: 'acceptPayment',
        args: [BigInt(id)],
        ...GAS_SETTINGS,
      });

      await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });

      setLoadingStates(prev => ({ ...prev, acceptPayment: { ...prev.acceptPayment, [id]: false } }));
      debouncedFetchTasks();
    } catch (err) {
      console.error('Error accepting payment:', err);
      setLoadingStates(prev => ({ ...prev, acceptPayment: { ...prev.acceptPayment, [id]: false } }));
      const errorMessage = err.message.includes('User rejected') || err.message.includes('user rejected')
        ? 'Transaction rejected.'
        : 'Failed to accept payment';
      setError(errorMessage);
    }
  }, [isConnected, writeContractAsync, publicClient, debouncedFetchTasks]);

  const handleStakeTask = useCallback(async (id) => {
    if (!isConnected || !MARKETPLACE_ADDRESS || !TOKEN_ADDRESS) return;

    try {
      setError('');
      setLoadingStates(prev => ({ ...prev, stake: { ...prev.stake, [id]: true } }));

      const task = tasks.find(t => t.id === id);
      if (!task) {
        setLoadingStates(prev => ({ ...prev, stake: { ...prev.stake, [id]: false } }));
        setError('Task not found');
        return;
      }

      if (passportConfigured && passportScore !== null && passportScore < PASSPORT_THRESHOLDS.STAKE) {
        setLoadingStates(prev => ({ ...prev, stake: { ...prev.stake, [id]: false } }));
        setError(`Gitcoin Passport score of ${PASSPORT_THRESHOLDS.STAKE}+ required to stake. Your score: ${passportScore.toFixed(1)}`);
        return;
      }

      const taskDepositBigInt = BigInt(task.deposit);
      const depositAmount = taskDepositBigInt / 10n;

      // Check vROSE balance
      const vRoseBalance = await publicClient.readContract({
        address: VROSE_ADDRESS,
        abi: vROSEABI,
        functionName: 'balanceOf',
        args: [account]
      });

      if (BigInt(vRoseBalance) < depositAmount) {
        const shortfall = depositAmount - BigInt(vRoseBalance);
        const shortfallInVRose = Number(formatUnits(shortfall, 18));
        setLoadingStates(prev => ({ ...prev, stake: { ...prev.stake, [id]: false } }));
        setError(`Insufficient vROSE tokens. You need ${shortfallInVRose.toFixed(2)} more vROSE.`);
        return;
      }

      // Approve vROSE
      const approveHash = await writeContractAsync({
        address: VROSE_ADDRESS,
        abi: vROSEABI,
        functionName: 'approve',
        args: [MARKETPLACE_ADDRESS, depositAmount],
        ...GAS_SETTINGS,
      });

      const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveHash, confirmations: 1 });
      if (approveReceipt.status !== 'success') {
        throw new Error('vROSE approval transaction failed');
      }
      await new Promise(r => setTimeout(r, 1000));

      // Get passport signature
      const { expiry, signature } = await getSignature('stake');

      // Stake
      const stakeHash = await writeContractAsync({
        address: MARKETPLACE_ADDRESS,
        abi: RoseMarketplaceABI,
        functionName: 'stakeholderStake',
        args: [BigInt(id), depositAmount, BigInt(expiry), signature],
        ...GAS_SETTINGS,
      });

      const stakeReceipt = await publicClient.waitForTransactionReceipt({ hash: stakeHash, confirmations: 1 });
      if (stakeReceipt.status !== 'success') {
        throw new Error('Stake transaction reverted on-chain');
      }

      setLoadingStates(prev => ({ ...prev, stake: { ...prev.stake, [id]: false } }));
      debouncedFetchTasks();
    } catch (err) {
      console.error('Error staking:', err);
      setLoadingStates(prev => ({ ...prev, stake: { ...prev.stake, [id]: false } }));

      let errorMessage = 'Failed to stake as stakeholder';
      if (err.message.includes('Not eligible stakeholder')) {
        errorMessage = 'You are not eligible to be a stakeholder.';
      } else if (err.message.includes('InsufficientVRose') || err.message.includes('Insufficient vROSE')) {
        errorMessage = 'Insufficient vROSE tokens.';
      } else if (err.message.includes('Customer cannot be stakeholder')) {
        errorMessage = 'You cannot be a stakeholder for your own task.';
      } else if (err.message.includes('Task already has a stakeholder')) {
        errorMessage = 'This task already has a stakeholder.';
      } else if (err.message.includes('User rejected') || err.message.includes('user rejected')) {
        errorMessage = 'Transaction rejected.';
      }
      setError(errorMessage);
    }
  }, [isConnected, tasks, account, passportConfigured, passportScore, publicClient, getSignature, writeContractAsync, debouncedFetchTasks]);

  const handleCancelTask = useCallback(async (id) => {
    if (!isConnected || !MARKETPLACE_ADDRESS) return;

    try {
      setError('');
      setLoadingStates(prev => ({ ...prev, cancel: { ...prev.cancel, [id]: true } }));

      const hash = await writeContractAsync({
        address: MARKETPLACE_ADDRESS,
        abi: RoseMarketplaceABI,
        functionName: 'cancelTask',
        args: [BigInt(id)],
        ...GAS_SETTINGS,
      });

      await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });

      setLoadingStates(prev => ({ ...prev, cancel: { ...prev.cancel, [id]: false } }));
      debouncedFetchTasks();
    } catch (err) {
      console.error('Error cancelling task:', err);
      setLoadingStates(prev => ({ ...prev, cancel: { ...prev.cancel, [id]: false } }));

      let errorMessage = 'Failed to cancel task';
      if (err.message.includes('Task can only be cancelled in StakeholderRequired or Open status')) {
        errorMessage = 'Task cannot be cancelled at this stage.';
      } else if (err.message.includes('Only customer or stakeholder can cancel task')) {
        errorMessage = 'You are not authorized to cancel this task.';
      } else if (err.message.includes('User rejected') || err.message.includes('user rejected')) {
        errorMessage = 'Transaction rejected.';
      }
      setError(errorMessage);
    }
  }, [isConnected, writeContractAsync, publicClient, debouncedFetchTasks]);

  const handleUnstakeTask = useCallback(async (id) => {
    if (!isConnected || !MARKETPLACE_ADDRESS) return;

    try {
      setError('');
      setLoadingStates(prev => ({ ...prev, unstake: { ...prev.unstake, [id]: true } }));

      const hash = await writeContractAsync({
        address: MARKETPLACE_ADDRESS,
        abi: RoseMarketplaceABI,
        functionName: 'unstakeStakeholder',
        args: [BigInt(id)],
        ...GAS_SETTINGS,
      });

      await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });

      setLoadingStates(prev => ({ ...prev, unstake: { ...prev.unstake, [id]: false } }));
      debouncedFetchTasks();
    } catch (err) {
      console.error('Error unstaking:', err);
      setLoadingStates(prev => ({ ...prev, unstake: { ...prev.unstake, [id]: false } }));

      let errorMessage = 'Failed to unstake';
      if (err.message.includes('Only stakeholder can unstake')) {
        errorMessage = 'You are not the stakeholder for this task.';
      } else if (err.message.includes('Task must be Open to unstake')) {
        errorMessage = 'Task cannot be unstaked at this stage.';
      } else if (err.message.includes('User rejected') || err.message.includes('user rejected')) {
        errorMessage = 'Transaction rejected.';
      }
      setError(errorMessage);
    }
  }, [isConnected, writeContractAsync, publicClient, debouncedFetchTasks]);

  // ============ CONTRACT EVENT WATCHERS ============

  useWatchContractEvent({
    address: MARKETPLACE_ADDRESS,
    abi: RoseMarketplaceABI,
    eventName: 'PaymentReleased',
    onLogs: () => debouncedFetchTasks(),
    enabled: isConnected && !!MARKETPLACE_ADDRESS
  });

  useWatchContractEvent({
    address: MARKETPLACE_ADDRESS,
    abi: RoseMarketplaceABI,
    eventName: 'TaskClosed',
    onLogs: () => debouncedFetchTasks(),
    enabled: isConnected && !!MARKETPLACE_ADDRESS
  });

  useWatchContractEvent({
    address: MARKETPLACE_ADDRESS,
    abi: RoseMarketplaceABI,
    eventName: 'TaskReadyForPayment',
    onLogs: () => debouncedFetchTasks(),
    enabled: isConnected && !!MARKETPLACE_ADDRESS
  });

  useWatchContractEvent({
    address: MARKETPLACE_ADDRESS,
    abi: RoseMarketplaceABI,
    eventName: 'StakeholderStaked',
    onLogs: () => debouncedFetchTasks(),
    enabled: isConnected && !!MARKETPLACE_ADDRESS
  });

  useWatchContractEvent({
    address: MARKETPLACE_ADDRESS,
    abi: RoseMarketplaceABI,
    eventName: 'StakeholderUnstaked',
    onLogs: () => debouncedFetchTasks(),
    enabled: isConnected && !!MARKETPLACE_ADDRESS
  });

  useWatchContractEvent({
    address: MARKETPLACE_ADDRESS,
    abi: RoseMarketplaceABI,
    eventName: 'TaskCancelled',
    onLogs: () => debouncedFetchTasks(),
    enabled: isConnected && !!MARKETPLACE_ADDRESS
  });

  useWatchContractEvent({
    address: MARKETPLACE_ADDRESS,
    abi: RoseMarketplaceABI,
    eventName: 'TaskClaimed',
    onLogs: () => debouncedFetchTasks(),
    enabled: isConnected && !!MARKETPLACE_ADDRESS
  });

  useWatchContractEvent({
    address: MARKETPLACE_ADDRESS,
    abi: RoseMarketplaceABI,
    eventName: 'TaskUnclaimed',
    onLogs: () => debouncedFetchTasks(),
    enabled: isConnected && !!MARKETPLACE_ADDRESS
  });

  useWatchContractEvent({
    address: MARKETPLACE_ADDRESS,
    abi: RoseMarketplaceABI,
    eventName: 'TaskCompleted',
    onLogs: () => debouncedFetchTasks(),
    enabled: isConnected && !!MARKETPLACE_ADDRESS
  });

  useWatchContractEvent({
    address: MARKETPLACE_ADDRESS,
    abi: RoseMarketplaceABI,
    eventName: 'TaskCreated',
    onLogs: () => {
      refetchTaskCounter();
      debouncedFetchTasks();
    },
    enabled: isConnected && !!MARKETPLACE_ADDRESS
  });

  // Sync processedTasks to state
  useEffect(() => {
    setTasks(processedTasks);
  }, [processedTasks]);

  // Initial load
  useEffect(() => {
    if (MARKETPLACE_ADDRESS && taskCounter !== undefined && taskCounter !== null) {
      fetchTasks();
    }
  }, [MARKETPLACE_ADDRESS, taskCounter, fetchTasks]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (debouncedFetchRef.current) {
        clearTimeout(debouncedFetchRef.current);
      }
    };
  }, []);

  // ============ FILTER LOGIC ============

  const filteredTasks = useMemo(() => {
    return tasks.filter(task => {
      // Filter by status
      if (filters.status !== 'all') {
        const statusMap = {
          'stakeholderRequired': TaskStatus.StakeholderRequired,
          'open': TaskStatus.Open,
          'inProgress': TaskStatus.InProgress,
          'completed': TaskStatus.Completed,
          'closed': TaskStatus.Closed,
          'approvedPendingPayment': TaskStatus.ApprovedPendingPayment,
          'disputed': TaskStatus.Disputed
        };
        if (task.status !== statusMap[filters.status]) {
          return false;
        }
      } else {
        // By default, hide closed and disputed tasks unless explicitly filtered
        if (task.status === TaskStatus.Closed || task.status === TaskStatus.Disputed) {
          return false;
        }
      }

      // Filter by myTasks
      if (filters.myTasks && account) {
        const isInvolved = task.customer === account || task.worker === account || task.stakeholder === account;
        if (!isInvolved) return false;
      }

      return true;
    });
  }, [tasks, filters, account]);

  // Get single task for detail page
  const task = taskId ? tasks[0] : null;

  return {
    // Data
    tasks: filteredTasks,
    allTasks: tasks,
    task, // Single task for detail mode
    isLoading: isLoading || isLoadingTasks,
    isRefreshing,
    error,
    loadingStates,

    // Filters
    filters,
    setFilters,

    // Actions
    handleClaimTask,
    handleUnclaimTask,
    handleCompleteTask,
    handleApproveTask,
    handleAcceptPayment,
    handleStakeTask,
    handleCancelTask,
    handleUnstakeTask,
    refetchTasks: fetchTasks,
    clearError: () => setError(''),
  };
};

export default useTasks;
