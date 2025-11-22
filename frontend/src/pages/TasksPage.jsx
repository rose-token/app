import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAccount, useReadContract, useWriteContract, useWatchContractEvent } from 'wagmi';
import { formatUnits, parseUnits } from 'viem';
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
    needStakeholder: true,
    needWorker: true,
    myTasks: true,
    showClosed: false
  });

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

  // Fetch individual task details
  const fetchTaskDetails = useCallback(async (taskId) => {
    if (!MARKETPLACE_ADDRESS) return null;

    try {
      // Use direct contract read via wagmi's readContract
      const { readContract } = await import('wagmi/actions');
      const { config } = await import('../wagmi.config');

      const task = await readContract(config, {
        address: MARKETPLACE_ADDRESS,
        abi: RoseMarketplaceABI,
        functionName: 'tasks',
        args: [BigInt(taskId)]
      });

      return {
        id: taskId,
        customer: task.customer,
        worker: task.worker,
        stakeholder: task.stakeholder,
        deposit: task.deposit.toString(),
        stakeholderDeposit: task.stakeholderDeposit?.toString() || '0',
        description: task.title,  // Use 'title' field from contract
        detailedDescription: task.detailedDescriptionHash,  // IPFS hash
        prUrl: task.prUrl || '',  // GitHub PR URL
        status: task.status,
        customerApproval: task.customerApproval,
        stakeholderApproval: task.stakeholderApproval
      };
    } catch (err) {
      console.error(`Error fetching task ${taskId}:`, err);
      return null;
    }
  }, []);

  const fetchTasks = useCallback(async () => {
    if (!MARKETPLACE_ADDRESS || !taskCounter) return;

    try {
      // Use ref to check if this is the initial load
      if (isInitialLoadRef.current) {
        setIsLoading(true);
      } else {
        setIsRefreshing(true);
      }
      setError('');

      const taskCount = Number(taskCounter);
      const taskPromises = [];

      for (let i = 1; i <= taskCount; i++) {
        taskPromises.push(fetchTaskDetails(i));
      }

      const fetchedTasks = await Promise.all(taskPromises);
      setTasks(fetchedTasks.filter(task => task !== null));

      // Mark initial load as complete
      isInitialLoadRef.current = false;
    } catch (err) {
      console.error('Error fetching tasks:', err);
      setError('Failed to load tasks');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [MARKETPLACE_ADDRESS, taskCounter, fetchTaskDetails]);

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
      const hash = await writeContractAsync({
        address: MARKETPLACE_ADDRESS,
        abi: RoseMarketplaceABI,
        functionName: 'claimTask',
        args: [BigInt(taskId)]
      });

      console.log('Claim task transaction:', hash);
      debouncedFetchTasks();
    } catch (err) {
      console.error('Error claiming task:', err);
      const errorMessage = err.message.includes('execution reverted')
        ? err.message.split('execution reverted:')[1]?.split('"')[0].trim() || 'Failed to claim task'
        : 'Failed to claim task';
      setError(errorMessage);
    }
  };

  const handleUnclaimTask = async (taskId) => {
    if (!isConnected || !MARKETPLACE_ADDRESS) return;

    try {
      const hash = await writeContractAsync({
        address: MARKETPLACE_ADDRESS,
        abi: RoseMarketplaceABI,
        functionName: 'unclaimTask',
        args: [BigInt(taskId)]
      });

      console.log('Unclaim task transaction:', hash);
      debouncedFetchTasks();
    } catch (err) {
      console.error('Error unclaiming task:', err);
      const errorMessage = err.message.includes('execution reverted')
        ? err.message.split('execution reverted:')[1]?.split('"')[0].trim() || 'Failed to unclaim task'
        : 'Failed to unclaim task';
      setError(errorMessage);
    }
  };

  const handleCompleteTask = async (taskId, prUrl) => {
    if (!isConnected || !MARKETPLACE_ADDRESS) return;

    try {
      const hash = await writeContractAsync({
        address: MARKETPLACE_ADDRESS,
        abi: RoseMarketplaceABI,
        functionName: 'markTaskCompleted',
        args: [BigInt(taskId), prUrl]
      });

      console.log('Complete task transaction:', hash);
      debouncedFetchTasks();
    } catch (err) {
      console.error('Error completing task:', err);
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
        console.log("Approving as customer for task:", taskId);
        hash = await writeContractAsync({
          address: MARKETPLACE_ADDRESS,
          abi: RoseMarketplaceABI,
          functionName: 'approveCompletionByCustomer',
          args: [BigInt(taskId)]
        });
      } else if (role === 'stakeholder') {
        console.log("Approving as stakeholder for task:", taskId);
        hash = await writeContractAsync({
          address: MARKETPLACE_ADDRESS,
          abi: RoseMarketplaceABI,
          functionName: 'approveCompletionByStakeholder',
          args: [BigInt(taskId)],
          gas: 500000n // Increase gas limit for stakeholder approval
        });
      }

      console.log("Transaction hash:", hash);

      debouncedFetchTasks(); // Refresh task list after approval
    } catch (err) {
      console.error('Error approving task:', err);
      setError(`Failed to approve task as ${role}: ${err.message || "Transaction failed"}`);
    }
  };


  const handleAcceptPayment = async (taskId) => {
    if (!isConnected || !MARKETPLACE_ADDRESS) return;

    try {
      console.log("Accepting payment for task:", taskId);
      const hash = await writeContractAsync({
        address: MARKETPLACE_ADDRESS,
        abi: RoseMarketplaceABI,
        functionName: 'acceptPayment',
        args: [BigInt(taskId)],
        gas: 500000n // Increase gas limit for payment acceptance
      });

      console.log("Transaction hash:", hash);

      debouncedFetchTasks(); // Refresh task list after payment acceptance
    } catch (err) {
      console.error('Error accepting payment:', err);
      setError(`Failed to accept payment: ${err.message || "Transaction failed"}`);
    }
  };

  const handleStakeTask = async (taskId) => {
    if (!isConnected || !MARKETPLACE_ADDRESS || !TOKEN_ADDRESS) return;

    try {
      const task = tasks.find(t => t.id === taskId);
      if (!task) {
        setError('Task not found');
        return;
      }

      // Calculate required stake (10% of task deposit)
      const depositAmount = BigInt(task.deposit) / 10n;
      console.log("Staking as stakeholder for task:", taskId, "with deposit:", depositAmount.toString());

      // Check user's ROSE token balance
      const { readContract } = await import('wagmi/actions');
      const { config } = await import('../wagmi.config');

      const userBalance = await readContract(config, {
        address: TOKEN_ADDRESS,
        abi: RoseTokenABI,
        functionName: 'balanceOf',
        args: [account]
      });

      if (userBalance < depositAmount) {
        const shortfall = depositAmount - userBalance;
        const shortfallInRose = Number(formatUnits(shortfall, 18));
        setError(`Insufficient ROSE tokens. You need ${shortfallInRose.toFixed(2)} more ROSE tokens to stake.`);
        return;
      }

      console.log("Approving token transfer...");
      const approveHash = await writeContractAsync({
        address: TOKEN_ADDRESS,
        abi: RoseTokenABI,
        functionName: 'approve',
        args: [MARKETPLACE_ADDRESS, depositAmount]
      });
      console.log("Token approval transaction:", approveHash);

      console.log("Staking tokens...");
      const stakeHash = await writeContractAsync({
        address: MARKETPLACE_ADDRESS,
        abi: RoseMarketplaceABI,
        functionName: 'stakeholderStake',
        args: [BigInt(taskId), depositAmount],
        gas: 300000n
      });

      console.log("Stake transaction hash:", stakeHash);

      debouncedFetchTasks();
    } catch (err) {
      console.error('Error staking as stakeholder:', err);

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

      console.log("Cancelling task:", taskId);
      const hash = await writeContractAsync({
        address: MARKETPLACE_ADDRESS,
        abi: RoseMarketplaceABI,
        functionName: 'cancelTask',
        args: [BigInt(taskId)],
        gas: 300000n
      });

      console.log("Cancel transaction hash:", hash);

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

  // Initial load and taskCounter changes
  useEffect(() => {
    if (MARKETPLACE_ADDRESS && taskCounter) {
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
        task.customer.toLowerCase() === account.toLowerCase() ||
        task.worker.toLowerCase() === account.toLowerCase() ||
        task.stakeholder.toLowerCase() === account.toLowerCase();

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
              isLoading={isLoading}
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
