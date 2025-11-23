import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAccount, useReadContract, useReadContracts, useWriteContract, useWatchContractEvent } from 'wagmi';
import { formatUnits, parseUnits, parseGwei } from 'viem';
import TaskList from '../components/marketplace/TaskList';
import TaskFilters from '../components/marketplace/TaskFilters';
import TokenDistributionChart from '../components/marketplace/TokenDistributionChart';
import CreateTaskForm from '../components/marketplace/CreateTaskForm';
import WalletNotConnected from '../components/wallet/WalletNotConnected';
import { TaskStatus } from '../utils/taskStatus';

// Import ABIs directly
import RoseMarketplaceABI from '../contracts/RoseMarketplaceABI.json';
import RoseTokenABI from '../contracts/RoseTokenABI.json';

// Contract addresses from environment
const MARKETPLACE_ADDRESS = import.meta.env.VITE_MARKETPLACE_ADDRESS;
const TOKEN_ADDRESS = import.meta.env.VITE_TOKEN_ADDRESS;

const TasksPage = () => {
  const [tasks, setTasks] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState('');

  const [filters, setFilters] = useState({
    needStakeholder: false,
    needWorker: false,
    myTasks: false,
    showClosed: false
  });
  const SEPOLIA_GAS_SETTINGS = {
    gas: 500_000n,                  // plenty for stakeholderStake, acceptPayment, etc.
    maxFeePerGas: parseGwei('0.1'), // Sepolia base fee is usually ~0.001–0.02 gwei
    maxPriorityFeePerGas: parseGwei('0.05'),
  };

  const { address: account, isConnected } = useAccount();

  // Track if this is the initial load
  const isInitialLoadRef = useRef(true);

  // Read taskCounter from marketplace contract
  const { data: taskCounter, refetch: refetchTaskCounter } = useReadContract({
    address: MARKETPLACE_ADDRESS,
    abi: RoseMarketplaceABI,
    functionName: 'taskCounter',
    query: {
      enabled: isConnected && !!MARKETPLACE_ADDRESS,
    }
  });

  // Write contract hook for all write operations
  const { writeContractAsync } = useWriteContract();

  // Batch fetch all tasks using useReadContracts (V2-compatible)
  const taskCount = useMemo(() => {
    if (!taskCounter) return 0;
    const count = Number(taskCounter); // Explicit BigInt → number conversion
    console.log('📊 Task counter:', count);
    return count;
  }, [taskCounter]);

  // Generate contract calls for all tasks
  const taskContracts = useMemo(() => {
    if (!MARKETPLACE_ADDRESS || taskCount === 0) return [];

    const contracts = Array.from({ length: taskCount }, (_, i) => ({
      address: MARKETPLACE_ADDRESS,
      abi: RoseMarketplaceABI,
      functionName: 'tasks',
      args: [BigInt(i + 1)] // Task IDs start at 1
    }));

    console.log('📋 Generated contract calls for', contracts.length, 'tasks');
    return contracts;
  }, [MARKETPLACE_ADDRESS, taskCount]);

  // Batch read all tasks at once (V2-compatible)
  const { data: tasksData, refetch: refetchTasks, isLoading: isLoadingTasks } = useReadContracts({
    contracts: taskContracts,
    allowSparse: true,   // ← This is the REAL fix
    cacheTime: 1_000,    // optional: keep cache for 1 second (default is 5min anyway)
    staleTime: 0,        // optional: consider data stale immediately (good for real-time)
    query: {
      enabled: isConnected && taskContracts.length > 0,
    }
  });

  // Process task data with explicit BigInt handling
  const processedTasks = useMemo(() => {
    if (!tasksData) {
      console.log('⏳ No tasks data yet');
      return [];
    }

    console.log('🔄 Processing', tasksData.length, 'tasks');

    const processed = tasksData
      .map((result, index) => {
        if (result.status !== 'success' || !result.result) {
          console.warn(`⚠️ Task ${index + 1} failed to load:`, result.error);
          return null;
        }

        const task = result.result;

        // Debug: Log the raw task object to see its structure
        console.log(`🔍 Task ${index + 1} raw data:`, task);
        console.log(`🔍 Task ${index + 1} status value:`, task.status, 'Type:', typeof task.status);

        // Defensive parsing — works with both object (old) and tuple array (wagmi v2)
        // Struct fields: customer, worker, stakeholder, deposit, stakeholderDeposit,
        //                title, detailedDescriptionHash, prUrl, status, customerApproval, stakeholderApproval
        const [
          customer,
          worker,
          stakeholder,
          depositBig,
          stakeholderDepositBig,
          title,
          detailedDescriptionHash,
          prUrl,
          statusRaw,
          customerApproval,
          stakeholderApproval
        ] = Array.isArray(task) ? task : [
          task.customer,
          task.worker,
          task.stakeholder,
          task.deposit,
          task.stakeholderDeposit ?? 0n,
          task.title,
          task.detailedDescriptionHash,
          task.prUrl,
          task.status,
          task.customerApproval,
          task.stakeholderApproval
        ];

        return {
          id: index + 1,
          customer,
          worker,
          stakeholder,
          deposit: depositBig.toString(),
          stakeholderDeposit: stakeholderDepositBig.toString(),
          description: title || '',
          detailedDescription: detailedDescriptionHash || '',
          prUrl: prUrl || '',
          status: Number(statusRaw),          // ← critical — forces number for your enum
          customerApproval,
          stakeholderApproval
        };
      })
      .filter(task => task !== null);

    console.log('✅ Processed valid tasks:', processed.length);
    return processed;
  }, [tasksData]);

  // Simplified fetchTasks - just triggers refetch and updates state
  const fetchTasks = useCallback(async () => {
    if (!MARKETPLACE_ADDRESS || taskCounter === undefined || taskCounter === null) {
      console.log('🚫 fetchTasks skipped: missing address or counter');
      return;
    }

    try {
      // Use ref to check if this is the initial load
      if (isInitialLoadRef.current) {
        setIsLoading(true);
      } else {
        setIsRefreshing(true);
      }
      setError('');

      console.log('🔄 Triggering task refetch');
      await refetchTasks();

      // Mark initial load as complete
      isInitialLoadRef.current = false;
    } catch (err) {
      console.error('❌ Error fetching tasks:', err);
      setError('Failed to load tasks: ' + err.message);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [MARKETPLACE_ADDRESS, taskCounter, refetchTasks]);

  const debouncedFetchRef = useRef(null);

  const debouncedFetchTasks = useCallback(() => {
    if (debouncedFetchRef.current) {
      clearTimeout(debouncedFetchRef.current);
    }

    debouncedFetchRef.current = setTimeout(() => {
      refetchTaskCounter();
      fetchTasks();
      debouncedFetchRef.current = null;
    }, 300); // 300ms debounce time
  }, [fetchTasks, refetchTaskCounter]);

  const handleClaimTask = async (taskId) => {
    if (!isConnected || !MARKETPLACE_ADDRESS) return;

    const task = tasks.find(t => t.id === taskId);
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

    try {
      console.log('⛽ Claiming task with hardcoded 2 gwei gas...');
      const hash = await writeContractAsync({
        address: MARKETPLACE_ADDRESS,
        abi: RoseMarketplaceABI,
        functionName: 'claimTask',
        args: [BigInt(taskId)],
        ...SEPOLIA_GAS_SETTINGS,
      });

      console.log('✅ Claim task transaction:', hash);
      debouncedFetchTasks();
    } catch (err) {
      console.error('❌ Error claiming task:', err);
      const errorMessage = err.message.includes('execution reverted')
        ? err.message.split('execution reverted:')[1]?.split('"')[0].trim() || 'Failed to claim task'
        : 'Failed to claim task';
      setError(errorMessage);
    }
  };

  const handleUnclaimTask = async (taskId) => {
    if (!isConnected || !MARKETPLACE_ADDRESS) return;

    try {
      console.log('⛽ Unclaiming task with hardcoded 2 gwei gas...');
      const hash = await writeContractAsync({
        address: MARKETPLACE_ADDRESS,
        abi: RoseMarketplaceABI,
        functionName: 'unclaimTask',
        args: [BigInt(taskId)],
        ...SEPOLIA_GAS_SETTINGS,
      });

      console.log('✅ Unclaim task transaction:', hash);
      debouncedFetchTasks();
    } catch (err) {
      console.error('❌ Error unclaiming task:', err);
      const errorMessage = err.message.includes('execution reverted')
        ? err.message.split('execution reverted:')[1]?.split('"')[0].trim() || 'Failed to unclaim task'
        : 'Failed to unclaim task';
      setError(errorMessage);
    }
  };

  const handleCompleteTask = async (taskId, prUrl) => {
    if (!isConnected || !MARKETPLACE_ADDRESS) return;

    try {
      console.log('⛽ Completing task with hardcoded 2 gwei gas...');
      const hash = await writeContractAsync({
        address: MARKETPLACE_ADDRESS,
        abi: RoseMarketplaceABI,
        functionName: 'markTaskCompleted',
        args: [BigInt(taskId), prUrl],
        ...SEPOLIA_GAS_SETTINGS,
      });

      console.log('✅ Complete task transaction:', hash);
      debouncedFetchTasks();
    } catch (err) {
      console.error('❌ Error completing task:', err);
      const errorMessage = err.message.includes('PR URL cannot be empty')
        ? 'PR URL is required to mark task as completed'
        : 'Failed to mark task as completed';
      setError(errorMessage);
    }
  };

  const handleApproveTask = async (taskId, role) => {
    if (!isConnected || !MARKETPLACE_ADDRESS) return;

    try {
      let hash;

      if (role === 'customer') {
        console.log("⛽ Approving as customer for task:", taskId);
        hash = await writeContractAsync({
          address: MARKETPLACE_ADDRESS,
          abi: RoseMarketplaceABI,
          functionName: 'approveCompletionByCustomer',
          args: [BigInt(taskId)],
          gasPrice: parseGwei('2'),
          ...SEPOLIA_GAS_SETTINGS,
        });
      } else if (role === 'stakeholder') {
        console.log("⛽ Approving as stakeholder for task:", taskId);
        hash = await writeContractAsync({
          address: MARKETPLACE_ADDRESS,
          abi: RoseMarketplaceABI,
          functionName: 'approveCompletionByStakeholder',
          args: [BigInt(taskId)],
          ...SEPOLIA_GAS_SETTINGS,
        });
      }

      console.log("✅ Transaction hash:", hash);

      debouncedFetchTasks(); // Refresh task list after approval
    } catch (err) {
      console.error('❌ Error approving task:', err);
      setError(`Failed to approve task as ${role}: ${err.message || "Transaction failed"}`);
    }
  };


  const handleAcceptPayment = async (taskId) => {
    if (!isConnected || !MARKETPLACE_ADDRESS) return;

    try {
      console.log("⛽ Accepting payment for task:", taskId);
      const hash = await writeContractAsync({
        address: MARKETPLACE_ADDRESS,
        abi: RoseMarketplaceABI,
        functionName: 'acceptPayment',
        args: [BigInt(taskId)],
        ...SEPOLIA_GAS_SETTINGS,
      });

      console.log("✅ Transaction hash:", hash);

      debouncedFetchTasks(); // Refresh task list after payment acceptance
    } catch (err) {
      console.error('❌ Error accepting payment:', err);
      setError(`Failed to accept payment: ${err.message || "Transaction failed"}`);
    }
  };

  // Add a hook to read user's token balance (V2-compatible)
  const { data: userBalance } = useReadContract({
    address: TOKEN_ADDRESS,
    abi: RoseTokenABI,
    functionName: 'balanceOf',
    args: [account],
    query: {
      enabled: isConnected && !!account && !!TOKEN_ADDRESS,
    }
  });

  const handleStakeTask = async (taskId) => {
    if (!isConnected || !MARKETPLACE_ADDRESS || !TOKEN_ADDRESS) return;

    try {
      const task = tasks.find(t => t.id === taskId);
      if (!task) {
        setError('Task not found');
        return;
      }

      // Calculate required stake (10% of task deposit) - explicit BigInt handling
      const taskDepositBigInt = BigInt(task.deposit);
      const depositAmount = taskDepositBigInt / 10n;
      console.log("💰 Staking as stakeholder for task:", taskId, "with deposit:", depositAmount.toString());

      // Check user's ROSE token balance (explicit BigInt handling)
      const userBalanceBigInt = userBalance ? BigInt(userBalance.toString()) : 0n;
      console.log("👛 User balance:", userBalanceBigInt.toString(), "ROSE");

      if (userBalanceBigInt < depositAmount) {
        const shortfall = depositAmount - userBalanceBigInt;
        const shortfallInRose = Number(formatUnits(shortfall, 18));
        setError(`Insufficient ROSE tokens. You need ${shortfallInRose.toFixed(2)} more ROSE tokens to stake.`);
        return;
      }

      console.log("⛽ Approving token transfer with hardcoded 2 gwei gas...");
      const approveHash = await writeContractAsync({
        address: TOKEN_ADDRESS,
        abi: RoseTokenABI,
        functionName: 'approve',
        args: [MARKETPLACE_ADDRESS, depositAmount],
        ...SEPOLIA_GAS_SETTINGS,
      });
      console.log("✅ Token approval transaction:", approveHash);

      console.log("⛽ Staking tokens with hardcoded 2 gwei gas...");
      const stakeHash = await writeContractAsync({
        address: MARKETPLACE_ADDRESS,
        abi: RoseMarketplaceABI,
        functionName: 'stakeholderStake',
        args: [BigInt(taskId), depositAmount],
        ...SEPOLIA_GAS_SETTINGS,
      });

      console.log("✅ Stake transaction hash:", stakeHash);

      debouncedFetchTasks();
    } catch (err) {
      console.error('❌ Error staking as stakeholder:', err);

      // Provide more helpful error messages
      let errorMessage = 'Failed to stake as stakeholder';

      if (err.message.includes('Not eligible stakeholder')) {
        errorMessage = 'You are not eligible to be a stakeholder. There may be a role conflict or insufficient tokens.';
      } else if (err.message.includes('Insufficient tokens')) {
        errorMessage = 'Insufficient ROSE tokens.';
      } else if (err.message.includes('Role conflict')) {
        errorMessage = 'Role conflict detected. You cannot be a stakeholder for this task (you may be the customer or worker).';
      } else if (err.message.includes('Customer cannot be stakeholder')) {
        errorMessage = 'You cannot be a stakeholder for your own task.';
      } else if (err.message.includes('Task already has a stakeholder')) {
        errorMessage = 'This task already has a stakeholder.';
      } else if (err.message.includes('Must deposit exactly 10%')) {
        errorMessage = 'Stake amount must be exactly 10% of the task deposit.';
      } else if (err.message.includes('execution reverted')) {
        const revertReason = err.message.split('execution reverted:')[1]?.split('"')[0].trim();
        if (revertReason) {
          errorMessage = revertReason;
        }
      }

      setError(errorMessage);
    }
  };

  const handleCancelTask = async (taskId) => {
    if (!isConnected || !MARKETPLACE_ADDRESS) return;

    try {
      const task = tasks.find(t => t.id === taskId);
      if (!task) {
        setError('Task not found');
        return;
      }

      console.log("⛽ Cancelling task with hardcoded 2 gwei gas:", taskId);
      const hash = await writeContractAsync({
        address: MARKETPLACE_ADDRESS,
        abi: RoseMarketplaceABI,
        functionName: 'cancelTask',
        args: [BigInt(taskId)],
        ...SEPOLIA_GAS_SETTINGS,
      });

      console.log("✅ Cancel transaction hash:", hash);

      debouncedFetchTasks();
    } catch (err) {
      console.error('Error cancelling task:', err);

      // Provide more helpful error messages
      let errorMessage = 'Failed to cancel task';

      if (err.message.includes('Task can only be cancelled in StakeholderRequired or Open status')) {
        errorMessage = 'Task cannot be cancelled at this stage. Only tasks in StakeholderRequired or Open status can be cancelled.';
      } else if (err.message.includes('Only customer or stakeholder can cancel task')) {
        errorMessage = 'You are not authorized to cancel this task. Only the customer or stakeholder can cancel.';
      } else if (err.message.includes('execution reverted')) {
        const revertReason = err.message.split('execution reverted:')[1]?.split('"')[0].trim();
        if (revertReason) {
          errorMessage = revertReason;
        }
      }

      setError(errorMessage);
    }
  };

  // Event listeners using useWatchContractEvent
  useWatchContractEvent({
    address: MARKETPLACE_ADDRESS,
    abi: RoseMarketplaceABI,
    eventName: 'PaymentReleased',
    onLogs: (logs) => {
      console.log("Payment released event:", logs);
      debouncedFetchTasks();
    },
    enabled: isConnected && !!MARKETPLACE_ADDRESS
  });

  useWatchContractEvent({
    address: MARKETPLACE_ADDRESS,
    abi: RoseMarketplaceABI,
    eventName: 'TaskClosed',
    onLogs: (logs) => {
      console.log("Task closed event:", logs);
      debouncedFetchTasks();
    },
    enabled: isConnected && !!MARKETPLACE_ADDRESS
  });

  useWatchContractEvent({
    address: MARKETPLACE_ADDRESS,
    abi: RoseMarketplaceABI,
    eventName: 'TaskReadyForPayment',
    onLogs: (logs) => {
      console.log("Task ready for payment event:", logs);
      debouncedFetchTasks();
    },
    enabled: isConnected && !!MARKETPLACE_ADDRESS
  });

  useWatchContractEvent({
    address: MARKETPLACE_ADDRESS,
    abi: RoseMarketplaceABI,
    eventName: 'StakeholderStaked',
    onLogs: (logs) => {
      console.log("Stakeholder staked event:", logs);
      debouncedFetchTasks();
    },
    enabled: isConnected && !!MARKETPLACE_ADDRESS
  });

  useWatchContractEvent({
    address: MARKETPLACE_ADDRESS,
    abi: RoseMarketplaceABI,
    eventName: 'TaskCancelled',
    onLogs: (logs) => {
      console.log("Task cancelled event:", logs);
      debouncedFetchTasks();
    },
    enabled: isConnected && !!MARKETPLACE_ADDRESS
  });

  // Sync processedTasks to tasks state
  useEffect(() => {
    console.log('Updating UI tasks →', processedTasks.length);
    setTasks(processedTasks);
  }, [processedTasks]);

  // Initial load and taskCounter changes
  useEffect(() => {
    if (MARKETPLACE_ADDRESS && taskCounter !== undefined && taskCounter !== null) {
      fetchTasks();
    }
  }, [MARKETPLACE_ADDRESS, taskCounter, fetchTasks]);

  // Cleanup debounce timeout on unmount
  useEffect(() => {
    return () => {
      if (debouncedFetchRef.current) {
        clearTimeout(debouncedFetchRef.current);
      }
    };
  }, []);

  const filteredTasks = tasks.filter(task => {
    if (task.status === TaskStatus.Closed && !filters.showClosed) {
      return false;
    }

    if (filters.needStakeholder && task.status === TaskStatus.StakeholderRequired) {
      return true;
    }

    if (filters.needWorker && task.status === TaskStatus.Open) {
      return true;
    }

    if (filters.myTasks && account) {
      const isInvolved =
        task.customer === account ||
        task.worker === account ||
        task.stakeholder === account;

      if (isInvolved) {
        return true;
      }
    }

    if (!filters.needStakeholder && !filters.needWorker && !filters.myTasks) {
      return true;
    }

    return false;
  });

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Rose Token Marketplace</h1>
        <p className="text-gray-600">
          A decentralized task marketplace with a worker token distribution model
        </p>
      </div>

      {!isConnected ? (
        <WalletNotConnected />
      ) : (
        <>
          <TokenDistributionChart />

          <CreateTaskForm onTaskCreated={debouncedFetchTasks} />

          <div className="mb-6">
            <h2 className="text-xl font-semibold mb-4">Available Tasks</h2>

            <TaskFilters filters={filters} setFilters={setFilters} />

            <TaskList
              tasks={filteredTasks}
              onClaim={handleClaimTask}
              onUnclaim={handleUnclaimTask}
              onComplete={handleCompleteTask}
              onApprove={handleApproveTask}
              onAcceptPayment={handleAcceptPayment}
              onStake={handleStakeTask}
              onCancel={handleCancelTask}
              isLoading={isLoading || isLoadingTasks}
              isRefreshing={isRefreshing}
              error={error}
              onErrorDismiss={() => setError('')}
              roseMarketplace={MARKETPLACE_ADDRESS}
              onRefresh={fetchTasks}
            />
          </div>
        </>
      )}
    </div>
  );
};

export default TasksPage;
