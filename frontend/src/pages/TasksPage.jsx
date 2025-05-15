import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useEthereum } from '../hooks/useEthereum';
import { useContract } from '../hooks/useContract';
import CreateTaskForm from '../components/marketplace/CreateTaskForm';
import TaskList from '../components/marketplace/TaskList';
import TokenDistributionChart from '../components/marketplace/TokenDistributionChart';
import WalletNotConnected from '../components/wallet/WalletNotConnected';

const TasksPage = () => {
  const [tasks, setTasks] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false); // Add new state for refreshing vs initial load
  const [error, setError] = useState('');
  
  const { account, isConnected } = useEthereum();
  const { roseMarketplace } = useContract();
  
  const fetchTaskDetails = useCallback(async (taskId) => {
    if (!roseMarketplace) return null;
    
    const task = await roseMarketplace.tasks(taskId);
    
    return {
      id: taskId,
      customer: task.customer,
      worker: task.worker,
      stakeholder: task.stakeholder,
      deposit: task.deposit.toString(),
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
  }, [roseMarketplace, fetchTaskDetails, tasks.length]);
  
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
  
  const handleClaimTask = async (taskId) => {
    if (!isConnected || !roseMarketplace) return;
    
    try {
      const tx = await roseMarketplace.claimTask(taskId);
      await tx.wait();
      debouncedFetchTasks(); // Use debounced version
    } catch (err) {
      console.error('Error claiming task:', err);
      setError('Failed to claim task');
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
    
    try {
      let tx;
      
      if (role === 'customer') {
        tx = await roseMarketplace.approveCompletionByCustomer(taskId);
      } else if (role === 'stakeholder') {
        tx = await roseMarketplace.approveCompletionByStakeholder(taskId);
      }
      
      await tx.wait();
      debouncedFetchTasks(); // Use debounced version
    } catch (err) {
      console.error('Error approving task:', err);
      setError(`Failed to approve task as ${role}`);
    }
  };
  
  const handleDisputeTask = async (taskId) => {
    if (!isConnected || !roseMarketplace) return;
    
    try {
      const tx = await roseMarketplace.disputeTask(taskId);
      await tx.wait();
      debouncedFetchTasks(); // Use debounced version
    } catch (err) {
      console.error('Error disputing task:', err);
      setError('Failed to dispute task');
    }
  };
  
  useEffect(() => {
    if (roseMarketplace) {
      debouncedFetchTasks();
    }
  }, [roseMarketplace, account, debouncedFetchTasks]);
  
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Rose Token Marketplace</h1>
        <p className="text-gray-600">
          A decentralized task marketplace with a socialist token distribution model
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
            
            <TaskList
              tasks={tasks}
              onClaim={handleClaimTask}
              onComplete={handleCompleteTask}
              onApprove={handleApproveTask}
              onDispute={handleDisputeTask}
              isLoading={isLoading}
              isRefreshing={isRefreshing}
              error={error}
            />
          </div>
        </>
      )}
    </div>
  );
};

export default TasksPage;
