import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useEthereum } from '../hooks/useEthereum';
import { useContract } from '../hooks/useContract';
import { ethers } from 'ethers';
import TaskList from '../components/marketplace/TaskList';
import TaskFilters from '../components/marketplace/TaskFilters';
import TokenDistributionChart from '../components/marketplace/TokenDistributionChart';
import WalletNotConnected from '../components/wallet/WalletNotConnected';
import { TaskStatus } from '../utils/taskStatus';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';

const TasksPage = () => {
  const [tasks, setTasks] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false); // Add new state for refreshing vs initial load
  const [error, setError] = useState('');
  
  const [filters, setFilters] = useState({
    needStakeholder: true,
    needWorker: true,
    myTasks: true,
    showClosed: false
  });
  
  const { account, isConnected } = useEthereum();
  const { roseMarketplace, roseToken, contractsReady } = useContract();
  
  const fetchTaskDetails = useCallback(async (taskId) => {
    if (!roseMarketplace) return null;
    
    const task = await roseMarketplace.tasks(taskId);
    
    return {
      id: taskId,
      customer: task.customer,
      worker: task.worker,
      stakeholder: task.stakeholder,
      deposit: task.deposit.toString(),
      stakeholderDeposit: task.stakeholderDeposit?.toString() || '0',
      description: task.description,
      status: task.status,
      customerApproval: task.customerApproval,
      stakeholderApproval: task.stakeholderApproval
    };
  }, [roseMarketplace]);
  
  const fetchTasks = useCallback(async () => {
    if (!roseMarketplace) return;
    
    try {
      if (tasks.length === 0) {
        setIsLoading(true);
      } else {
        setIsRefreshing(true);
      }
      setError('');
      
      const taskCount = await roseMarketplace.taskCounter();
      const taskPromises = [];
      
      for (let i = 1; i <= taskCount; i++) {
        taskPromises.push(fetchTaskDetails(i));
      }
      
      const fetchedTasks = await Promise.all(taskPromises);
      setTasks(fetchedTasks.filter(task => task !== null));
    } catch (err) {
      console.error('Error fetching tasks:', err);
      setError('Failed to load tasks');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [roseMarketplace, fetchTaskDetails, tasks.length, setIsLoading, setIsRefreshing, setError, setTasks]);
  
  const debouncedFetchRef = useRef(null);

  const debouncedFetchTasks = useCallback(() => {
    if (debouncedFetchRef.current) {
      clearTimeout(debouncedFetchRef.current);
    }
    
    debouncedFetchRef.current = setTimeout(() => {
      fetchTasks();
      debouncedFetchRef.current = null;
    }, 300); // 300ms debounce time
  }, [fetchTasks]);
  
  const handleClaimTask = async (taskId, storyPoints) => {
    if (!isConnected || !roseMarketplace) return;
    
    const task = tasks.find(t => t.id === taskId);
    if (!task) {
      setError('Task not found');
      return;
    }
    
    if (task.customer === account) {
      setError('You cannot claim your own task');
      return;
    }
    
    if (task.worker !== '0x0000000000000000000000000000000000000000') {
      setError('Task has already been claimed by another worker');
      return;
    }
    
    if (!storyPoints || storyPoints <= 0) {
      setError('Story points must be greater than zero');
      return;
    }
    
    try {
      const tx = await roseMarketplace.claimTask(taskId, storyPoints);
      await tx.wait();
      debouncedFetchTasks(); // Use debounced version
    } catch (err) {
      console.error('Error claiming task:', err);
      const errorMessage = err.message.includes('execution reverted') 
        ? err.message.split('execution reverted:')[1]?.split('"')[0].trim() || 'Failed to claim task'
        : 'Failed to claim task';
      setError(errorMessage);
    }
  };
  
  const handleCompleteTask = async (taskId) => {
    if (!isConnected || !roseMarketplace) return;
    
    try {
      const tx = await roseMarketplace.markTaskCompleted(taskId);
      await tx.wait();
      debouncedFetchTasks(); // Use debounced version
    } catch (err) {
      console.error('Error completing task:', err);
      setError('Failed to mark task as completed');
    }
  };
  
  const handleApproveTask = async (taskId, role) => {
    if (!isConnected || !roseMarketplace) return;
    
    setIsLoading(true);
    try {
      let tx;
      
      if (role === 'customer') {
        console.log("Approving as customer for task:", taskId);
        tx = await roseMarketplace.approveCompletionByCustomer(taskId);
      } else if (role === 'stakeholder') {
        console.log("Approving as stakeholder for task:", taskId);
        tx = await roseMarketplace.approveCompletionByStakeholder(taskId, {
          gasLimit: 500000 // Increase gas limit for stakeholder approval (which may trigger payment)
        });
      }
      
      console.log("Waiting for transaction:", tx.hash);
      await tx.wait();
      console.log("Transaction confirmed");
      
      await fetchTasks(); // Refresh task list after approval
      await fetchTaskDetails(taskId); // Refresh the specific task details
    } catch (err) {
      console.error('Error approving task:', err);
      setError(`Failed to approve task as ${role}: ${err.message || "Transaction failed"}`);
    } finally {
      setIsLoading(false);
    }
  };
  
  
  const handleAcceptPayment = async (taskId) => {
    if (!isConnected || !roseMarketplace) return;
    
    setIsLoading(true);
    try {
      console.log("Accepting payment for task:", taskId);
      const tx = await roseMarketplace.acceptPayment(taskId, {
        gasLimit: 500000 // Increase gas limit for payment acceptance which includes token transfer and token minting
      });
      
      console.log("Waiting for transaction:", tx.hash);
      await tx.wait();
      console.log("Transaction confirmed");
      
      await fetchTasks(); // Refresh task list after payment acceptance
    } catch (err) {
      console.error('Error accepting payment:', err);
      setError(`Failed to accept payment: ${err.message || "Transaction failed"}`);
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleStakeTask = async (taskId) => {
    if (!isConnected || !roseMarketplace || !roseToken) return;
    
    try {
      const task = tasks.find(t => t.id === taskId);
      if (!task) {
        setError('Task not found');
        return;
      }
      
      const depositAmount = window.BigInt(task.deposit) / window.BigInt(10);
      console.log("Staking as stakeholder for task:", taskId, "with deposit:", depositAmount.toString());
      
      console.log("Approving token transfer...");
      const approveTx = await roseToken.approve(roseMarketplace.address, depositAmount.toString());
      await approveTx.wait();
      console.log("Token approval confirmed");
      
      console.log("Staking tokens...");
      const tx = await roseMarketplace.stakeholderStake(taskId, depositAmount.toString(), {
        gasLimit: 300000
      });
      
      console.log("Waiting for transaction:", tx.hash);
      await tx.wait();
      console.log("Transaction confirmed");
      
      debouncedFetchTasks();
    } catch (err) {
      console.error('Error staking as stakeholder:', err);
      const errorMessage = err.message.includes('execution reverted') 
        ? err.message.split('execution reverted:')[1]?.split('"')[0].trim() || 'Failed to stake as stakeholder'
        : 'Failed to stake as stakeholder';
      setError(errorMessage);
    }
  };

  useEffect(() => {
    if (roseMarketplace) {
      debouncedFetchTasks();
    }
  }, [roseMarketplace, debouncedFetchTasks]);

  useEffect(() => {
    if (roseMarketplace) {
      
      const paymentFilter = roseMarketplace.filters.PaymentReleased();
      const paymentListener = (taskId, worker, amount) => {
        console.log("Payment released event:", { taskId, worker, amount });
        fetchTasks(); // Refresh tasks after payment
      };
      roseMarketplace.on(paymentFilter, paymentListener);
      
      const closedFilter = roseMarketplace.filters.TaskClosed();
      const closedListener = (taskId) => {
        console.log("Task closed event:", taskId);
        fetchTasks(); // Refresh tasks after closing
      };
      roseMarketplace.on(closedFilter, closedListener);
      
      const readyForPaymentFilter = roseMarketplace.filters.TaskReadyForPayment();
      const readyForPaymentListener = (taskId, worker, amount) => {
        console.log("Task ready for payment event:", { taskId, worker, amount });
        fetchTasks(); // Refresh tasks after task is ready for payment
      };
      roseMarketplace.on(readyForPaymentFilter, readyForPaymentListener);
      
      const stakeholderStakedFilter = roseMarketplace.filters.StakeholderStaked();
      const stakeholderStakedListener = (taskId, stakeholder, stakeholderDeposit) => {
        console.log("Stakeholder staked event:", { taskId, stakeholder, stakeholderDeposit });
        fetchTasks(); // Refresh tasks after stakeholder staking
      };
      roseMarketplace.on(stakeholderStakedFilter, stakeholderStakedListener);
      
      return () => {
        roseMarketplace.off(paymentFilter, paymentListener);
        roseMarketplace.off(closedFilter, closedListener);
        roseMarketplace.off(readyForPaymentFilter, readyForPaymentListener);
        roseMarketplace.off(stakeholderStakedFilter, stakeholderStakedListener);
      };
    }
  }, [roseMarketplace, debouncedFetchTasks, fetchTasks]);
  
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

          <div className="mb-6">
            <h2 className="text-xl font-semibold mb-4">Available Tasks</h2>
            
            <TaskFilters filters={filters} setFilters={setFilters} />
            
            <TaskList
              tasks={filteredTasks}
              onClaim={handleClaimTask}
              onComplete={handleCompleteTask}
              onApprove={handleApproveTask}
              onAcceptPayment={handleAcceptPayment}
              onStake={handleStakeTask}
              isLoading={isLoading}
              isRefreshing={isRefreshing}
              error={error}
              onErrorDismiss={() => setError('')}
              roseMarketplace={roseMarketplace}
              onRefresh={fetchTasks}
            />
          </div>
        </>
      )}
    </div>
  );
};

export default TasksPage;
