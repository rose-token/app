import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Alert, AlertDescription } from '../ui/alert';
import { useContract } from '../../hooks/useContract';
import { useEthereum } from '../../hooks/useEthereum';
import { useNotifications } from '../../hooks/useNotifications';
import NotificationCenter from '../ui/NotificationCenter';
import ApprovalProgressChart from './ApprovalProgressChart';
import { ethers } from 'ethers';
import { Clock, Users, TrendingUp, Award, Bell, CheckCircle } from 'lucide-react';

const CollapsibleSection = ({ id, title, children, defaultOpen = false }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  
  return (
    <div className="border rounded-lg overflow-hidden mb-4">
      <button
        id={id}
        onClick={() => setIsOpen(!isOpen)}
        className="w-full p-4 text-left font-semibold bg-muted flex justify-between items-center"
      >
        <span>{title}</span>
        <span>{isOpen ? '−' : '+'}</span>
      </button>
      {isOpen && <div className="p-4">{children}</div>}
    </div>
  );
};

const StakeholderDashboard = () => {
  const { roseMarketplace, roseReputation, roseToken, contractsReady } = useContract();
  const { account, isConnected } = useEthereum();
  const {
    notifications,
    addNotification,
    removeNotification,
    markAsRead,
    markAllAsRead,
    clearNotifications,
    getUnreadCount,
    addApprovalNotification,
    addReputationNotification,
    addTaskCompletionNotification
  } = useNotifications();
  
  const [stakeholderData, setStakeholderData] = useState({
    reputation: { experience: 0, level: 0 },
    stakedTasks: [],
    pendingApprovals: [],
    completedTasks: 0,
    totalEarnings: '0',
    approvalRate: 0
  });
  
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [previousData, setPreviousData] = useState(null);
  const [approvalProgress, setApprovalProgress] = useState({});

  const fetchStakeholderData = useCallback(async () => {
    if (!roseMarketplace || !roseReputation || !roseToken || !isConnected || !account || !contractsReady.readOnly) return;

    try {
      setIsLoading(true);
      setError(null);

      const stakeholderRole = 1; // Role.Stakeholder enum value
      const experience = await roseReputation.getExperience(account, stakeholderRole);
      const level = await roseReputation.getLevel(account, stakeholderRole);
      
      const reputationData = {
        experience: experience.toNumber(),
        level: level.toNumber()
      };

      const taskCount = await roseMarketplace.taskCounter();
      const stakedTasks = [];
      const pendingApprovals = [];
      const approvalProgressData = {};
      let completedTasks = 0;
      let totalEarnings = ethers.BigNumber.from(0);

      for (let i = 1; i <= taskCount.toNumber(); i++) {
        const task = await roseMarketplace.tasks(i);
        
        if (task.stakeholder.toLowerCase() === account.toLowerCase()) {
          const taskData = {
            id: i,
            description: task.description,
            deposit: ethers.utils.formatEther(task.deposit),
            status: task.status,
            customer: task.customer,
            worker: task.worker,
            stakeholder: task.stakeholder,
            createdAt: new Date(task.createdAt.toNumber() * 1000)
          };

          if (task.status === 3) {
            try {
              const approvals = await roseMarketplace.getTaskApprovals(i);
              const totalStakeholders = await roseMarketplace.getActiveStakeholderCount();
              const approvalCount = approvals.filter(approval => approval).length;
              const approvalPercentage = totalStakeholders > 0 ? (approvalCount / totalStakeholders.toNumber()) * 100 : 0;
              const requiredPercentage = 66;
              
              approvalProgressData[i] = {
                approvalCount,
                totalStakeholders: totalStakeholders.toNumber(),
                approvalPercentage,
                requiredPercentage,
                isApproved: approvalPercentage >= requiredPercentage,
                needsMoreApprovals: requiredPercentage - approvalPercentage
              };
              
              taskData.approvalProgress = approvalProgressData[i];
            } catch (err) {
              console.warn(`Could not fetch approval data for task ${i}:`, err);
              approvalProgressData[i] = {
                approvalCount: 0,
                totalStakeholders: 1,
                approvalPercentage: 0,
                requiredPercentage: 66,
                isApproved: false,
                needsMoreApprovals: 66
              };
              taskData.approvalProgress = approvalProgressData[i];
            }
            
            pendingApprovals.push(taskData);
          } else if (task.status === 5) {
            completedTasks++;
            const baseReward = ethers.utils.parseEther('100');
            const stakeholderShare = baseReward.mul(20).div(100);
            totalEarnings = totalEarnings.add(stakeholderShare);
          }

          if (task.status >= 2) {
            stakedTasks.push(taskData);
          }
        }
      }

      setApprovalProgress(approvalProgressData);

      const approvalRate = stakedTasks.length > 0 ? (completedTasks / stakedTasks.length) * 100 : 0;

      const newData = {
        reputation: reputationData,
        stakedTasks,
        pendingApprovals,
        completedTasks,
        totalEarnings: ethers.utils.formatEther(totalEarnings),
        approvalRate
      };

      setStakeholderData(newData);

      if (previousData) {
        if (newData.reputation.level > previousData.reputation.level) {
          addReputationNotification(newData.reputation.level, newData.reputation.experience);
        }

        if (newData.completedTasks > previousData.completedTasks) {
          const newEarnings = parseFloat(newData.totalEarnings) - parseFloat(previousData.totalEarnings);
          addTaskCompletionNotification(
            'recent', 
            newEarnings.toFixed(2)
          );
        }
      }

      pendingApprovals.forEach(task => {
        const daysSinceCompletion = (Date.now() - task.createdAt.getTime()) / (1000 * 60 * 60 * 24);
        const urgency = daysSinceCompletion > 2 ? 'error' : 'warning';
        addApprovalNotification(task.id, task.description, urgency);
      });

      setPreviousData(newData);

    } catch (err) {
      console.error('Error fetching stakeholder data:', err);
      setError('Failed to load stakeholder data. Please try again later.');
    } finally {
      setIsLoading(false);
    }
  }, [roseMarketplace, roseReputation, roseToken, isConnected, account, contractsReady.readOnly]);

  useEffect(() => {
    fetchStakeholderData();
  }, [fetchStakeholderData]);

  const handleApproveTask = async (taskId) => {
    if (!roseMarketplace || !isConnected || !contractsReady.readWrite) return;

    try {
      setIsLoading(true);
      const tx = await roseMarketplace.acceptPayment(taskId);
      await tx.wait();
      await fetchStakeholderData();
    } catch (err) {
      console.error('Error approving task:', err);
      setError('Failed to approve task: ' + (err.message || 'Unknown error'));
    } finally {
      setIsLoading(false);
    }
  };

  const getStatusText = (status) => {
    const statuses = ['Open', 'Stakeholder Required', 'In Progress', 'Completed', 'Disputed', 'Closed'];
    return statuses[status] || 'Unknown';
  };

  const getStatusColor = (status) => {
    const colors = {
      0: 'bg-blue-100 text-blue-800',
      1: 'bg-orange-100 text-orange-800', 
      2: 'bg-yellow-100 text-yellow-800',
      3: 'bg-green-100 text-green-800',
      4: 'bg-red-100 text-red-800',
      5: 'bg-gray-100 text-gray-800'
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
  };

  const calculateExpForLevel = (level) => {
    if (level === 0) return 0;
    if (level === 1) return 100;
    
    let exp = 100;
    for (let i = 1; i < level; i++) {
      exp = Math.floor((exp * 180) / 100);
    }
    return exp;
  };

  const getReputationProgress = (reputation) => {
    if (reputation.level === 0) {
      return Math.min(100, (reputation.experience / 100) * 100);
    }
    
    const currentLevelExp = calculateExpForLevel(reputation.level);
    const nextLevelExp = calculateExpForLevel(reputation.level + 1);
    const progressInLevel = reputation.experience - currentLevelExp;
    const expNeededForLevel = nextLevelExp - currentLevelExp;
    
    return Math.min(100, (progressInLevel / expNeededForLevel) * 100);
  };

  const getXPToNextLevel = (reputation) => {
    if (reputation.level >= 10) return 0; // Max level reached
    
    if (reputation.level === 0) {
      return 100 - reputation.experience;
    }
    
    const currentLevelExp = calculateExpForLevel(reputation.level);
    const nextLevelExp = calculateExpForLevel(reputation.level + 1);
    const progressInLevel = reputation.experience - currentLevelExp;
    const expNeededForLevel = nextLevelExp - currentLevelExp;
    
    return expNeededForLevel - progressInLevel;
  };

  if (!isConnected) {
    return (
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-6">Stakeholder Dashboard</h1>
        <Alert>
          <AlertDescription>
            Please connect your wallet to view your stakeholder dashboard.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (isLoading && stakeholderData.stakedTasks.length === 0) {
    return (
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-6">Stakeholder Dashboard</h1>
        <div className="flex justify-center items-center p-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-rose-500"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold">Stakeholder Dashboard</h1>
          <p className="text-lg mt-2">
            Manage your stakeholder responsibilities, track your reputation, and monitor task approvals.
          </p>
        </div>
        <NotificationCenter
          notifications={notifications}
          onMarkAsRead={markAsRead}
          onMarkAllAsRead={markAllAsRead}
          onRemove={removeNotification}
          onClear={clearNotifications}
          getUnreadCount={getUnreadCount}
        />
      </div>

      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}


      <div className="bg-rose-50 p-6 rounded-lg mb-6 shadow-sm">
        <h2 className="text-xl font-semibold mb-4">Stakeholder Metrics</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white p-4 rounded shadow">
            <div className="flex items-center mb-2">
              <Award className="h-5 w-5 text-rose-600 mr-2" />
              <p className="text-sm text-gray-500">Reputation Level</p>
            </div>
            <p className="text-2xl font-bold">{stakeholderData.reputation.level}</p>
            <p className="text-xs text-gray-500">{stakeholderData.reputation.experience} XP</p>
          </div>
          
          <div className="bg-white p-4 rounded shadow">
            <div className="flex items-center mb-2">
              <Users className="h-5 w-5 text-rose-600 mr-2" />
              <p className="text-sm text-gray-500">Tasks Staked</p>
            </div>
            <p className="text-2xl font-bold">{stakeholderData.stakedTasks.length}</p>
          </div>
          
          <div className="bg-white p-4 rounded shadow">
            <div className="flex items-center mb-2">
              <CheckCircle className="h-5 w-5 text-rose-600 mr-2" />
              <p className="text-sm text-gray-500">Completed Tasks</p>
            </div>
            <p className="text-2xl font-bold">{stakeholderData.completedTasks}</p>
          </div>
          
          <div className="bg-white p-4 rounded shadow">
            <div className="flex items-center mb-2">
              <TrendingUp className="h-5 w-5 text-rose-600 mr-2" />
              <p className="text-sm text-gray-500">Approval Rate</p>
            </div>
            <p className="text-2xl font-bold">{stakeholderData.approvalRate.toFixed(1)}%</p>
          </div>
          
          <div className="bg-white p-4 rounded shadow">
            <div className="flex items-center mb-2">
              <Clock className="h-5 w-5 text-rose-600 mr-2" />
              <p className="text-sm text-gray-500">Pending Approvals</p>
            </div>
            <p className="text-2xl font-bold text-orange-600">{stakeholderData.pendingApprovals.length}</p>
          </div>
          
          <div className="bg-white p-4 rounded shadow">
            <div className="flex items-center mb-2">
              <Award className="h-5 w-5 text-rose-600 mr-2" />
              <p className="text-sm text-gray-500">Total Earnings</p>
            </div>
            <p className="text-2xl font-bold">{parseFloat(stakeholderData.totalEarnings).toFixed(2)} ROSE</p>
          </div>
        </div>
      </div>

      <CollapsibleSection id="pending-approvals" title="Pending Approvals" defaultOpen={stakeholderData.pendingApprovals.length > 0}>
        {stakeholderData.pendingApprovals.length === 0 ? (
          <p className="text-gray-600">No tasks awaiting your approval.</p>
        ) : (
          <div className="space-y-4">
            {stakeholderData.pendingApprovals.map((task) => (
              <Card key={task.id}>
                <CardContent className="p-4">
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="font-semibold">Task #{task.id}: {task.description}</h3>
                    <Badge className={getStatusColor(task.status)}>
                      {getStatusText(task.status)}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-sm text-gray-600 mb-4">
                    <div>
                      <p><strong>Deposit:</strong> {task.deposit} ETH</p>
                      <p><strong>Worker:</strong> {task.worker.slice(0, 8)}...</p>
                    </div>
                    <div>
                      <p><strong>Customer:</strong> {task.customer.slice(0, 8)}...</p>
                      <p><strong>Completed:</strong> {task.createdAt.toLocaleDateString()}</p>
                    </div>
                  </div>
                  
                  {task.approvalProgress && (
                    <div className="mb-4 p-3 bg-gray-50 rounded">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-sm font-medium">Approval Progress</span>
                        <span className="text-sm text-gray-600">
                          {task.approvalProgress.approvalCount}/{task.approvalProgress.totalStakeholders} stakeholders
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
                        <div 
                          className={`h-2 rounded-full ${
                            task.approvalProgress.isApproved 
                              ? 'bg-green-600' 
                              : task.approvalProgress.approvalPercentage >= 50 
                                ? 'bg-yellow-500' 
                                : 'bg-red-500'
                          }`}
                          style={{ width: `${Math.min(100, task.approvalProgress.approvalPercentage)}%` }}
                        ></div>
                      </div>
                      <div className="flex justify-between text-xs text-gray-600">
                        <span>{task.approvalProgress.approvalPercentage.toFixed(1)}% approved</span>
                        <span>
                          {task.approvalProgress.isApproved 
                            ? '✓ Ready for payout' 
                            : `Need ${task.approvalProgress.needsMoreApprovals.toFixed(1)}% more`
                          }
                        </span>
                      </div>
                    </div>
                  )}
                  <div className="flex justify-end space-x-2">
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => window.open(`/tasks/${task.id}`, '_blank')}
                    >
                      View Details
                    </Button>
                    <Button 
                      size="sm"
                      onClick={() => handleApproveTask(task.id)}
                      disabled={isLoading || (task.approvalProgress && task.approvalProgress.isApproved)}
                      className={`${
                        task.approvalProgress && task.approvalProgress.isApproved
                          ? 'bg-gray-400 cursor-not-allowed'
                          : 'bg-green-600 hover:bg-green-700'
                      } text-white`}
                    >
                      {task.approvalProgress && task.approvalProgress.isApproved 
                        ? 'Already Approved' 
                        : 'Approve Payment'
                      }
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection id="staked-tasks" title="All Staked Tasks">
        {stakeholderData.stakedTasks.length === 0 ? (
          <p className="text-gray-600">You haven't staked on any tasks yet.</p>
        ) : (
          <div className="space-y-4">
            {stakeholderData.stakedTasks.map((task) => (
              <Card key={task.id}>
                <CardContent className="p-4">
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="font-semibold">Task #{task.id}: {task.description}</h3>
                    <Badge className={getStatusColor(task.status)}>
                      {getStatusText(task.status)}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-sm text-gray-600">
                    <div>
                      <p><strong>Deposit:</strong> {task.deposit} ETH</p>
                      <p><strong>Worker:</strong> {task.worker.slice(0, 8)}...</p>
                    </div>
                    <div>
                      <p><strong>Customer:</strong> {task.customer.slice(0, 8)}...</p>
                      <p><strong>Created:</strong> {task.createdAt.toLocaleDateString()}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection id="approval-progress" title="Approval Progress Tracking">
        <ApprovalProgressChart 
          approvalData={approvalProgress}
          className="mb-6"
        />
      </CollapsibleSection>

      <CollapsibleSection id="reputation-tracking" title="Reputation & Performance">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Reputation Progress</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between mb-2">
                    <span>Level {stakeholderData.reputation.level}</span>
                    <span>{stakeholderData.reputation.experience} XP</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-rose-600 h-2 rounded-full" 
                      style={{ 
                        width: `${getReputationProgress(stakeholderData.reputation)}%` 
                      }}
                    ></div>
                  </div>
                  <p className="text-sm text-gray-600 mt-1">
                    {getXPToNextLevel(stakeholderData.reputation)} XP to next level
                  </p>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-gray-50 p-4 rounded">
                    <h4 className="font-semibold mb-2">Performance Metrics</h4>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span>Tasks Completed:</span>
                        <span>{stakeholderData.completedTasks}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Approval Rate:</span>
                        <span>{stakeholderData.approvalRate.toFixed(1)}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Total Earnings:</span>
                        <span>{parseFloat(stakeholderData.totalEarnings).toFixed(2)} ROSE</span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="bg-gray-50 p-4 rounded">
                    <h4 className="font-semibold mb-2">Experience Breakdown</h4>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span>Staking Tasks:</span>
                        <span>+15 XP each</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Task Completion:</span>
                        <span>+20 XP each</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Current Level:</span>
                        <span>Level {stakeholderData.reputation.level}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </CollapsibleSection>
    </div>
  );
};

export default StakeholderDashboard;
