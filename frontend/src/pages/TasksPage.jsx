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
  const { roseMarketplace, roseToken, roseGovernance, contractsReady } = useContract();
  
  const [newProposal, setNewProposal] = useState({
    description: '',
    detailedDescription: '',
    tokenAmount: '',
    proposalType: 'Work',
    fundingSource: 'DAO',
    additionalData: ''
  });
  
  const [proposals, setProposals] = useState([]);
  
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
  

  const handleCreateProposal = async (e) => {
    e.preventDefault();
    if (!roseGovernance || !isConnected || !contractsReady.readWrite) return;
    
    try {
      const amount = ethers.utils.parseEther(newProposal.tokenAmount);
      
      let ipfsHash = '';
      if (newProposal.additionalData.trim()) {
        const { uploadProposalToIPFS } = await import('../utils/ipfs/pinataService');
        ipfsHash = await uploadProposalToIPFS({
          additionalData: newProposal.additionalData,
          proposalType: newProposal.proposalType,
          fundingSource: newProposal.fundingSource,
          metadata: {
            createdBy: account,
            createdAt: new Date().toISOString()
          }
        });
      }
      
      const proposalTypeNum = newProposal.proposalType === 'Work' ? 0 : 1;
      const fundingSourceNum = newProposal.fundingSource === 'DAO' ? 0 : 1;
      
      const tx = await roseGovernance.createTaskProposal(
        newProposal.description,
        newProposal.detailedDescription,
        amount,
        proposalTypeNum,
        fundingSourceNum,
        ipfsHash
      );
      await tx.wait();
      
      setNewProposal({
        description: '',
        detailedDescription: '',
        tokenAmount: '',
        proposalType: 'Work',
        fundingSource: 'DAO',
        additionalData: ''
      });
      
      debouncedFetchTasks();
      fetchProposals();
    } catch (err) {
      console.error('Error creating proposal:', err);
      setError('Failed to create proposal: ' + (err.message || 'Unknown error'));
    }
  };

  const handleStakeOnProposal = async (proposalId, tokenAmount) => {
    if (!roseGovernance || !isConnected || !contractsReady.readWrite) return;

    try {
      const stakeAmount = ethers.utils.parseEther(tokenAmount).div(10); // 10% of proposal amount

      // Check allowance and approve if needed
      const currentAllowance = await roseToken.allowance(account, roseGovernance.address);
      if (currentAllowance.lt(stakeAmount)) {
        const approveTx = await roseToken.approve(roseGovernance.address, stakeAmount);
        await approveTx.wait();
      }

      const tx = await roseGovernance.stakeOnProposal(proposalId);
      await tx.wait();

      fetchProposals();
    } catch (err) {
      console.error('Error staking on proposal:', err);
      setError('Failed to stake on proposal: ' + (err.message || 'Unknown error'));
    }
  };

  const handleApproveProposal = async (proposalId) => {
    if (!roseGovernance || !isConnected || !contractsReady.readWrite) return;

    try {
      const tx = await roseGovernance.approveProposal(proposalId);
      await tx.wait();

      fetchProposals();
    } catch (err) {
      console.error('Error approving proposal:', err);
      setError('Failed to approve proposal: ' + (err.message || 'Unknown error'));
    }
  };

  const handleRejectProposal = async (proposalId) => {
    if (!roseGovernance || !isConnected || !contractsReady.readWrite) return;

    try {
      const tx = await roseGovernance.rejectProposal(proposalId);
      await tx.wait();

      fetchProposals();
    } catch (err) {
      console.error('Error rejecting proposal:', err);
      setError('Failed to reject proposal: ' + (err.message || 'Unknown error'));
    }
  };

  const handleExecuteProposal = async (proposalId) => {
    if (!roseGovernance || !isConnected || !contractsReady.readWrite) return;
    
    try {
      const tx = await roseGovernance.executeProposal(proposalId);
      await tx.wait();
      
      fetchProposals();
    } catch (err) {
      console.error('Error executing proposal:', err);
      setError('Failed to execute proposal: ' + (err.message || 'Unknown error'));
    }
  };

  const getStatusText = (statusCode) => {
    const statuses = ['Active', 'Staked', 'Approved', 'Rejected', 'Executed'];
    return statuses[statusCode] || 'Unknown';
  };

  const fetchProposals = useCallback(async () => {
    if (!roseGovernance || !isConnected || !contractsReady.readOnly) return;
    
    try {
      const counter = await roseGovernance.proposalCounter();
      const proposalPromises = [];
      
      for (let i = 1; i <= counter.toNumber(); i++) {
        proposalPromises.push(roseGovernance.proposals(i));
      }
      
      const proposalResults = await Promise.all(proposalPromises);
      const formattedProposals = proposalResults.map((proposal, index) => {
        const proposalTime = new Date(proposal.proposalTime.toNumber() * 1000);

        return {
          id: index + 1,
          description: proposal.description,
          detailedDescription: proposal.detailedDescription,
          proposer: proposal.proposer,
          tokenAmount: ethers.utils.formatEther(proposal.tokenAmount),
          proposalType: proposal.proposalType,
          fundingSource: proposal.fundingSource,
          proposalTime: proposalTime,
          status: getStatusText(proposal.status),
          statusCode: proposal.status,
          stakeholder: proposal.stakeholder,
          stakedAmount: ethers.utils.formatEther(proposal.stakedAmount)
        };
      });
      
      setProposals(formattedProposals);
    } catch (err) {
      console.error('Error fetching proposals:', err);
      setError('Failed to fetch proposals: ' + (err.message || 'Unknown error'));
    }
  }, [roseGovernance, isConnected, contractsReady.readOnly]);
  
  useEffect(() => {
    if (roseMarketplace) {
      debouncedFetchTasks();
    }
    
    if (roseGovernance && contractsReady.readOnly) {
      fetchProposals();
    }
  }, [roseMarketplace, roseGovernance, contractsReady.readOnly, debouncedFetchTasks, fetchProposals]);

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
          
          <div className="border rounded-lg overflow-hidden mb-4">
            <div className="bg-muted p-4">
              <h3 className="font-semibold">Create New Proposal</h3>
            </div>
            <div className="p-4">
              <div className="bg-green-50 p-4 rounded-lg mb-4">
                <h4 className="font-semibold text-green-800 mb-2">Unified Governance Workflow</h4>
                <p className="text-sm text-green-700">
                  All work now flows through DAO proposals to ensure stakeholder legitimacy and prevent bad actors.
                  Choose your funding source and let verified stakeholders validate proposals by staking 10%.
                </p>
              </div>
              <form onSubmit={handleCreateProposal} className="space-y-4">
                <div>
                  <label className="block mb-1 font-medium">Proposal Type</label>
                  <select
                    value={newProposal.proposalType}
                    onChange={(e) => setNewProposal({...newProposal, proposalType: e.target.value})}
                    className="w-full border rounded p-2"
                    required
                  >
                    <option value="Work">Work Proposal</option>
                    <option value="Governance">Governance Proposal</option>
                  </select>
                  <p className="text-xs text-gray-500 mt-1">
                    Work proposals create tasks for completion. Governance proposals modify platform rules.
                  </p>
                </div>
                
                <div>
                  <label className="block mb-1 font-medium">Funding Source</label>
                  <select
                    value={newProposal.fundingSource}
                    onChange={(e) => setNewProposal({...newProposal, fundingSource: e.target.value})}
                    className="w-full border rounded p-2"
                    required
                  >
                    <option value="DAO">DAO Treasury</option>
                    {newProposal.proposalType === 'Work' && (
                      <option value="Customer">Customer Funded</option>
                    )}
                  </select>
                  <p className="text-xs text-gray-500 mt-1">
                    {newProposal.fundingSource === 'DAO' 
                      ? 'Community treasury funds this proposal through collective decision-making'
                      : 'You provide direct funding while stakeholders ensure quality and legitimacy'
                    }
                  </p>
                </div>
                
                <div>
                  <label className="block mb-1 font-medium">Proposal Title</label>
                  <input
                    type="text"
                    value={newProposal.description}
                    onChange={(e) => setNewProposal({...newProposal, description: e.target.value})}
                    className="w-full border rounded p-2"
                    required
                  />
                </div>
                
                <div>
                  <label className="block mb-1 font-medium">Detailed Description</label>
                  <textarea
                    value={newProposal.detailedDescription}
                    onChange={(e) => setNewProposal({...newProposal, detailedDescription: e.target.value})}
                    className="w-full border rounded p-2 h-32"
                    required
                  />
                </div>
                
                <div>
                  <label className="block mb-1 font-medium">Additional Data (Optional)</label>
                  <textarea
                    value={newProposal.additionalData}
                    onChange={(e) => setNewProposal({...newProposal, additionalData: e.target.value})}
                    className="w-full border rounded p-2 h-24"
                    placeholder="Additional proposal data, requirements, or specifications (will be stored on IPFS)"
                  />
                </div>
                
                <div>
                  <label className="block mb-1 font-medium">
                    {newProposal.fundingSource === 'Customer' ? 'Your Funding Amount (ROSE)' : 'Requested Tokens (ROSE)'}
                  </label>
                  <input
                    type="number"
                    value={newProposal.tokenAmount}
                    onChange={(e) => setNewProposal({...newProposal, tokenAmount: e.target.value})}
                    className="w-full border rounded p-2"
                    required
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    {newProposal.fundingSource === 'Customer' 
                      ? 'Amount you will deposit to fund this work. Workers receive 60%, stakeholders 20%, DAO 20%'
                      : 'Amount requested from DAO treasury. Subject to community approval through STAR voting'
                    }
                  </p>
                </div>
                
                <div className="bg-blue-50 p-3 rounded-md mb-4">
                  <p className="text-xs text-blue-800">
                    <strong>Next Steps:</strong> After submission, a stakeholder will stake 10% to validate your proposal.
                    Once approved, there's a 2-day execution delay before the task is created.
                  </p>
                </div>
                <Button
                  type="submit"
                  className="bg-rose-500 text-white hover:bg-rose-600"
                >
                  Submit to Governance Process
                </Button>
              </form>
            </div>
          </div>
          
          <div className="border rounded-lg overflow-hidden mb-4">
            <div className="bg-muted p-4">
              <h3 className="font-semibold">Governance Proposals</h3>
            </div>
            <div className="p-4">
              {proposals.length === 0 ? (
                <p>No proposals found.</p>
              ) : (
                <div className="space-y-6">
                  {proposals.map(proposal => (
                    <Card key={proposal.id} className="overflow-hidden">
                      <div className="bg-gray-50 p-4 flex justify-between items-center">
                        <div>
                          <h3 className="font-semibold">{proposal.description}</h3>
                          <div className="flex items-center space-x-2 mt-1">
                            <span className={`px-2 py-1 rounded text-xs ${
                              proposal.proposalType === 0 ? 'bg-blue-100 text-blue-800' : 'bg-purple-100 text-purple-800'
                            }`}>
                              {proposal.proposalType === 0 ? 'Work' : 'Governance'}
                            </span>
                            <span className={`px-2 py-1 rounded text-xs ${
                              proposal.fundingSource === 0 ? 'bg-green-100 text-green-800' : 'bg-orange-100 text-orange-800'
                            }`}>
                              {proposal.fundingSource === 0 ? 'DAO Funded' : 'Customer Funded'}
                            </span>
                          </div>
                          <p className="text-sm text-gray-500">
                            Proposed by {proposal.proposer.substring(0, 6)}...{proposal.proposer.substring(38)} 
                            on {proposal.proposalTime.toLocaleDateString()}
                          </p>
                        </div>
                        <div>
                          <span className={`px-3 py-1 rounded text-sm ${
                            proposal.status === 'Active' ? 'bg-blue-100 text-blue-800' :
                            proposal.status === 'Approved' ? 'bg-green-100 text-green-800' :
                            proposal.status === 'Executed' ? 'bg-purple-100 text-purple-800' :
                            'bg-red-100 text-red-800'
                          }`}>
                            {proposal.status}
                          </span>
                        </div>
                      </div>
                      
                      <div className="p-4">
                        <p className="mb-4">{proposal.detailedDescription}</p>
                        
                        <div className="flex items-center mb-4">
                          <span className="font-medium mr-2">Requested amount:</span>
                          <span>{proposal.tokenAmount} ROSE</span>
                        </div>
                        
                        {proposal.stakeholder && proposal.stakeholder !== ethers.constants.AddressZero && (
                          <div className="mb-4 p-3 bg-blue-50 rounded">
                            <p className="text-sm">
                              <span className="font-medium">Stakeholder:</span> {proposal.stakeholder.substring(0, 6)}...{proposal.stakeholder.substring(38)}
                            </p>
                            <p className="text-sm">
                              <span className="font-medium">Staked:</span> {proposal.stakedAmount} ROSE (10%)
                            </p>
                          </div>
                        )}

                        {proposal.status === 'Active' && (
                          <div className="mb-4">
                            <Button
                              onClick={() => handleStakeOnProposal(proposal.id, proposal.tokenAmount)}
                              className="bg-blue-500 text-white hover:bg-blue-600 mr-2"
                            >
                              Stake 10% & Validate
                            </Button>
                            <Button
                              onClick={() => handleRejectProposal(proposal.id)}
                              className="bg-red-500 text-white hover:bg-red-600"
                            >
                              Reject
                            </Button>
                            <p className="text-sm text-gray-500 mt-2">
                              Stake {(parseFloat(proposal.tokenAmount) * 0.1).toFixed(2)} ROSE (10%) to validate
                            </p>
                          </div>
                        )}

                        {proposal.status === 'Staked' && proposal.stakeholder === account && (
                          <div className="mb-4">
                            <Button
                              onClick={() => handleApproveProposal(proposal.id)}
                              className="bg-green-500 text-white hover:bg-green-600 mr-2"
                            >
                              Approve
                            </Button>
                            <Button
                              onClick={() => handleRejectProposal(proposal.id)}
                              className="bg-red-500 text-white hover:bg-red-600"
                            >
                              Reject
                            </Button>
                          </div>
                        )}

                        {proposal.status === 'Approved' && (
                          <Button
                            onClick={() => handleExecuteProposal(proposal.id)}
                            className="bg-green-500 text-white hover:bg-green-600"
                          >
                            Execute Proposal
                          </Button>
                        )}
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </div>
          
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
