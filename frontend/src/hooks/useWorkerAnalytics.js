import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { useEthereum } from './useEthereum';
import { useContract } from './useContract';

export const useWorkerAnalytics = () => {
  const { account, isConnected } = useEthereum();
  const { roseMarketplace, roseToken } = useContract();
  
  const [analytics, setAnalytics] = useState({
    totalEarnings: '0',
    totalTasksCompleted: 0,
    totalTasksClaimed: 0,
    successRate: 0,
    earnings: [],
    recentActivity: []
  });
  
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const formatTaskData = useCallback((task, taskId) => {
    const formattedTask = {
      id: taskId,
      description: task.description,
      deposit: ethers.utils.formatEther(task.deposit),
      status: ['Open', 'InProgress', 'Completed', 'Disputed', 'Closed'][task.status],
      customer: task.customer,
      worker: task.worker,
      stakeholder: task.stakeholder,
      timestamp: new Date(task.timestamp.toNumber() * 1000).toISOString(),
    };
    return formattedTask;
  }, []);

  const fetchCompletedTasks = useCallback(async () => {
    if (!roseMarketplace || !account) return [];
    
    try {
      const taskCount = await roseMarketplace.getTaskCount();
      const completedTasks = [];
      
      for (let i = 1; i <= taskCount; i++) {
        const task = await roseMarketplace.tasks(i);
        if (task.worker.toLowerCase() === account.toLowerCase() && 
            (task.status === 2 || task.status === 4)) { // Completed or Closed
          completedTasks.push({
            ...formatTaskData(task, i),
            earnings: ethers.utils.formatEther(task.deposit)
          });
        }
      }
      
      return completedTasks;
    } catch (err) {
      console.error("Error fetching completed tasks:", err);
      return [];
    }
  }, [roseMarketplace, account, formatTaskData]);

  const fetchClaimedTasks = useCallback(async () => {
    if (!roseMarketplace || !account) return [];
    
    try {
      const taskCount = await roseMarketplace.getTaskCount();
      const claimedTasks = [];
      
      for (let i = 1; i <= taskCount; i++) {
        const task = await roseMarketplace.tasks(i);
        if (task.worker.toLowerCase() === account.toLowerCase() && 
            task.status === 1) { // InProgress
          claimedTasks.push(formatTaskData(task, i));
        }
      }
      
      return claimedTasks;
    } catch (err) {
      console.error("Error fetching claimed tasks:", err);
      return [];
    }
  }, [roseMarketplace, account, formatTaskData]);

  const fetchRecentActivity = useCallback(async () => {
    if (!roseMarketplace || !account) return [];
    
    try {
      const taskCount = await roseMarketplace.getTaskCount();
      const recentActivity = [];
      
      for (let i = Math.max(1, taskCount - 10); i <= taskCount; i++) {
        const task = await roseMarketplace.tasks(i);
        if (task.worker.toLowerCase() === account.toLowerCase()) {
          recentActivity.push(formatTaskData(task, i));
        }
      }
      
      return recentActivity.sort((a, b) => 
        new Date(b.timestamp) - new Date(a.timestamp)
      );
    } catch (err) {
      console.error("Error fetching recent activity:", err);
      return [];
    }
  }, [roseMarketplace, account, formatTaskData]);

  const calculateEarningsOverTime = useCallback(async (completedTasks) => {
    if (!completedTasks || completedTasks.length === 0) return [];
    
    const sortedTasks = [...completedTasks].sort(
      (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
    );
    
    const earningsByMonth = {};
    sortedTasks.forEach(task => {
      const date = new Date(task.timestamp);
      const monthYear = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      
      if (!earningsByMonth[monthYear]) {
        earningsByMonth[monthYear] = 0;
      }
      
      earningsByMonth[monthYear] += parseFloat(task.earnings);
    });
    
    return Object.entries(earningsByMonth).map(([month, amount]) => ({
      month,
      amount: parseFloat(amount.toFixed(4))
    }));
  }, []);

  const fetchAnalytics = useCallback(async () => {
    if (!isConnected || !account || !roseMarketplace || !roseToken) {
      setIsLoading(false);
      return;
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
      const tokenBalance = await roseToken.balanceOf(account);
      
      const completedTasks = await fetchCompletedTasks();
      const claimedTasks = await fetchClaimedTasks();
      const recentActivity = await fetchRecentActivity();
      
      const totalEarnings = completedTasks.reduce(
        (sum, task) => sum + parseFloat(task.earnings), 
        0
      ).toFixed(4);
      
      const successRate = completedTasks.length > 0 
        ? ((completedTasks.length / (completedTasks.length + claimedTasks.length)) * 100).toFixed(1)
        : 0;
      
      const earnings = await calculateEarningsOverTime(completedTasks);
      
      setAnalytics({
        totalEarnings,
        totalTasksCompleted: completedTasks.length,
        totalTasksClaimed: claimedTasks.length + completedTasks.length,
        successRate,
        tokenBalance: ethers.utils.formatEther(tokenBalance),
        earnings,
        recentActivity,
        completedTasks
      });
      
      setIsLoading(false);
    } catch (err) {
      console.error("Error fetching analytics:", err);
      setError("Failed to load analytics data. Please try again later.");
      setIsLoading(false);
    }
  }, [
    isConnected, 
    account, 
    roseMarketplace, 
    roseToken, 
    fetchCompletedTasks, 
    fetchClaimedTasks, 
    fetchRecentActivity, 
    calculateEarningsOverTime
  ]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  const refreshAnalytics = useCallback(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  return {
    analytics,
    isLoading,
    error,
    refreshAnalytics
  };
};
