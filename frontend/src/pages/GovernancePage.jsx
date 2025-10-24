import React, { useState, useEffect, useCallback } from 'react';  
import { useEthereum } from '../hooks/useEthereum';  
import { useContract } from '../hooks/useContract';  
import { ethers } from 'ethers';  
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';

const CollapsibleSection = ({ id, title, children }) => {  
  const [isOpen, setIsOpen] = React.useState(false);  
    
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
  
const GovernancePage = () => {  
  const { isConnected, account, connectWallet } = useEthereum();  
  const { roseGovernance, roseToken, contractsReady } = useContract();  
    
  const [proposalCounter, setProposalCounter] = useState(0);  
  const [proposals, setProposals] = useState([]);  
  const [lockedTokens, setLockedTokens] = useState(0);  
  const [lockEndTime, setLockEndTime] = useState(0);  
  const [minimumTokensToPropose, setMinimumTokensToPropose] = useState(0);  
  const [proposalDuration, setProposalDuration] = useState(0);  
  const [executionDelay, setExecutionDelay] = useState(0);  
  const [error, setError] = useState(null);  
    
  const [tokenAmount, setTokenAmount] = useState('');  
  const [lockDuration, setLockDuration] = useState(7); // Default 7 days  
  const [allowance, setAllowance] = useState(0);  
  const [newProposal, setNewProposal] = useState({  
    description: '',  
    detailedDescription: '',  
    tokenAmount: '',
    proposalType: 'Work',
    fundingSource: 'DAO',
    additionalData: ''
  });  
    
  const fetchGovernanceData = useCallback(async () => {
    if (!roseGovernance || !isConnected || !contractsReady.readOnly) return;
      
    try {  
        
      const counter = await roseGovernance.proposalCounter();  
      const minTokens = await roseGovernance.minimumTokensToPropose();  
      const duration = await roseGovernance.proposalDuration();  
      const delay = await roseGovernance.executionDelay();  
        
      setProposalCounter(counter.toNumber());  
      setMinimumTokensToPropose(ethers.utils.formatEther(minTokens));  
      setProposalDuration(duration.toNumber() / 86400); // Convert to days  
      setExecutionDelay(delay.toNumber() / 86400); // Convert to days  
        
      if (account) {  
        const locked = await roseGovernance.lockedTokens(account);  
        const endTime = await roseGovernance.lockEndTime(account);  
        const tokenAllowance = await roseToken.allowance(account, roseGovernance.address);  
          
        setLockedTokens(ethers.utils.formatEther(locked));  
        setLockEndTime(endTime.toNumber());  
        setAllowance(ethers.utils.formatEther(tokenAllowance));  
      }  
        
      // Fetch proposals
      const proposalList = [];
      for (let i = 1; i <= counter.toNumber(); i++) {
        const proposal = await roseGovernance.proposals(i);
        proposalList.push({
          id: proposal.id.toNumber(),
          proposer: proposal.proposer,
          description: proposal.description,
          detailedDescription: proposal.detailedDescription,
          tokenAmount: ethers.utils.formatEther(proposal.tokenAmount),
          proposalTime: new Date(proposal.proposalTime.toNumber() * 1000),
          executionTime: proposal.executionTime.toNumber() > 0
            ? new Date(proposal.executionTime.toNumber() * 1000)
            : null,
          status: getStatusText(proposal.status),
          proposalType: proposal.proposalType,
          fundingSource: proposal.fundingSource,
          ipfsDataHash: proposal.ipfsDataHash,
          stakeholder: proposal.stakeholder,
          stakedAmount: ethers.utils.formatEther(proposal.stakedAmount)
        });
      }  
        
      setProposals(proposalList.reverse()); // Show newest first  
    } catch (err) {  
      console.error('Error fetching governance data:', err);  
      setError('Failed to load governance data. Please try again later.');  
    } finally {  
    }  
  }, [roseGovernance, roseToken, isConnected, account, contractsReady.readOnly]);  
    
  useEffect(() => {  
    fetchGovernanceData();  
  }, [fetchGovernanceData]);  
    
  const getStatusText = (statusCode) => {
    const statuses = ['Active', 'Staked', 'Approved', 'Rejected', 'Executed'];
    return statuses[statusCode] || 'Unknown';
  };  
    
  const handleLockTokens = async () => {  
    if (!roseGovernance || !isConnected || !contractsReady.readWrite) return;  
      
    try {  
      const amount = ethers.utils.parseEther(tokenAmount);  
      const durationInSeconds = lockDuration * 86400; // Convert days to seconds  
        
      if (parseFloat(allowance) < parseFloat(tokenAmount)) {  
        const tx = await roseToken.approve(roseGovernance.address, amount);  
        await tx.wait();  
      }  
        
      const tx = await roseGovernance.lockTokens(amount, durationInSeconds);  
      await tx.wait();  
        
      fetchGovernanceData();
      setTokenAmount('');  
    } catch (err) {  
      console.error('Error locking tokens:', err);  
      setError('Failed to lock tokens: ' + (err.message || 'Unknown error'));  
    }  
  };  
    
  const handleUnlockTokens = async () => {  
    if (!roseGovernance || !isConnected || !contractsReady.readWrite) return;  
      
    try {  
      const tx = await roseGovernance.unlockTokens();  
      await tx.wait();  
        
      fetchGovernanceData();
    } catch (err) {  
      console.error('Error unlocking tokens:', err);  
      setError('Failed to unlock tokens: ' + (err.message || 'Unknown error'));  
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
        
      fetchGovernanceData();
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

      fetchGovernanceData();
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

      fetchGovernanceData();
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

      fetchGovernanceData();
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
        
      fetchGovernanceData();
    } catch (err) {  
      console.error('Error executing proposal:', err);  
      setError('Failed to execute proposal: ' + (err.message || 'Unknown error'));  
    }  
  };  
  
  if (false) {
    return (
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-6">Rose Token Governance</h1>
        
        <p className="mb-6 text-lg">
          Rose Token operates on principles of community ownership and democratic decision-making.
          The governance model ensures that all token holders have a voice in the project's future.
        </p>
        
        <div className="bg-white rounded-lg shadow-md p-6 mb-6 border border-gray-200 text-center">
          <h2 className="text-xl font-semibold mb-4">Connect Your Wallet</h2>
          <div className="mb-6 text-gray-600">
            <p className="mb-4">
              Connect your wallet to participate in Rose Token governance. Once connected,
              you'll be able to view active proposals and cast votes.
            </p>
          </div>
          
          <Button
            onClick={connectWallet}
            className="bg-primary hover:bg-primary/90 text-white px-6 py-3 rounded-md font-medium"
          >
            Connect Wallet
          </Button>
        </div>
      </div>
    );
  }
  
  if (false) {
    return (
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-6">Rose Token Governance</h1>
        <div className="flex justify-center items-center p-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-rose-500"></div>
        </div>
      </div>
    );
  }
    
  return (  
    <div className="max-w-4xl mx-auto">  
      <h1 className="text-3xl font-bold mb-6">Rose Token Governance</h1>  
        
      <p className="mb-6 text-lg">  
        Rose Token operates on principles of community ownership and democratic decision-making.  
        The governance model ensures that all token holders have a voice in the project's future.  
      </p>  
        
      {/* Governance Metrics Dashboard */}  
      <div className="bg-rose-50 p-6 rounded-lg mb-6 shadow-sm">  
        <h2 className="text-xl font-semibold mb-4">Governance Metrics</h2>  
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">  
          <div className="bg-white p-4 rounded shadow">  
            <p className="text-sm text-gray-500">Total Proposals</p>  
            <p className="text-2xl font-bold">{proposalCounter}</p>  
          </div>  
          <div className="bg-white p-4 rounded shadow">  
            <p className="text-sm text-gray-500">Min. Tokens to Propose</p>  
            <p className="text-2xl font-bold">{minimumTokensToPropose} ROSE</p>  
          </div>  
          <div className="bg-white p-4 rounded shadow">  
            <p className="text-sm text-gray-500">Your Locked Tokens</p>  
            <p className="text-2xl font-bold">{lockedTokens} ROSE</p>  
            {lockEndTime > 0 && (  
              <p className="text-xs text-gray-500">  
                Unlocks on {new Date(lockEndTime * 1000).toLocaleDateString()}  
              </p>  
            )}  
          </div>  
          <div className="bg-white p-4 rounded shadow">  
            <p className="text-sm text-gray-500">Voting Period</p>  
            <p className="text-2xl font-bold">{proposalDuration} days</p>  
          </div>  
          <div className="bg-white p-4 rounded shadow">  
            <p className="text-sm text-gray-500">Execution Delay</p>  
            <p className="text-2xl font-bold">{executionDelay} days</p>  
          </div>  
          <div className="bg-white p-4 rounded shadow">
            <p className="text-sm text-gray-500">Active Proposals</p>
            <p className="text-2xl font-bold">
              {proposals.filter(p => p.status === 'Active' || p.status === 'Staked').length}
            </p>
          </div>  
        </div>  
      </div>  
        
      {/* Token Locking Section */}  
      <CollapsibleSection id="token-locking" title="Lock Tokens for Governance">  
        <div className="space-y-4">  
          <p>  
            To participate in governance, you need to lock your ROSE tokens.   
            Locked tokens grant you voting rights and the ability to create proposals.  
          </p>  
            
          <div className="bg-white p-4 rounded border">  
            <h3 className="font-semibold mb-2">Your Locked Tokens</h3>  
            <p className="mb-4">{lockedTokens} ROSE</p>  
              
            {parseFloat(lockedTokens) > 0 && lockEndTime > 0 && (  
              <div className="mb-4">  
                <p>Unlock Date: {new Date(lockEndTime * 1000).toLocaleDateString()}</p>  
                {Date.now() / 1000 > lockEndTime && (  
                  <Button   
                    onClick={handleUnlockTokens}  
                    className="mt-2 bg-rose-500 text-white hover:bg-rose-600"  
                  >  
                    Unlock Tokens  
                  </Button>  
                )}  
              </div>  
            )}  
              
            <h3 className="font-semibold mb-2">Lock More Tokens</h3>  
            <div className="flex gap-2 flex-wrap">  
              <input  
                type="number"  
                placeholder="Amount to lock"  
                value={tokenAmount}  
                onChange={(e) => setTokenAmount(e.target.value)}  
                className="border rounded p-2 flex-grow"  
              />  
              <select   
                value={lockDuration}  
                onChange={(e) => setLockDuration(Number(e.target.value))}  
                className="border rounded p-2"  
              >  
                <option value={7}>7 days</option>  
                <option value={14}>14 days</option>  
                <option value={30}>30 days</option>  
                <option value={90}>90 days</option>  
                <option value={180}>180 days</option>  
                <option value={365}>365 days</option>  
              </select>  
              <Button   
                onClick={handleLockTokens}  
                disabled={!tokenAmount}  
                className="bg-rose-500 text-white hover:bg-rose-600 disabled:bg-gray-300"  
              >  
                Lock Tokens  
              </Button>  
            </div>  
          </div>  
        </div>  
      </CollapsibleSection>  
        
      {/* Create Proposal Section - Enhanced Customer Portal */}  
      {true && (  
        <CollapsibleSection id="create-proposal" title="Customer Portal - Create New Proposal">
          <div className="bg-green-50 p-4 rounded-lg mb-4">
            <h4 className="font-semibold text-green-800 mb-2">Unified Governance Workflow</h4>
            <p className="text-sm text-green-700">
              All work now flows through DAO proposals to ensure stakeholder legitimacy and prevent bad actors. 
              Choose your funding source and let verified stakeholders evaluate proposals through ranked choice voting.
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
                <strong>Next Steps:</strong> After submission, stakeholders will evaluate your proposal using ranked choice voting. 
                Approved proposals enter a 2-week stakeholder selection cycle before work begins.
              </p>
            </div>
            <Button   
              type="submit"  
              className="bg-rose-500 text-white hover:bg-rose-600"  
            >  
              Submit to Governance Process
            </Button>  
          </form>  
        </CollapsibleSection>  
      )}  
        
        
      {/* Proposal List */}  
      <CollapsibleSection id="proposals" title="Governance Proposals">  
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
                        Reject Proposal
                      </Button>
                      <p className="text-sm text-gray-500 mt-2">
                        Stake {(parseFloat(proposal.tokenAmount) * 0.1).toFixed(2)} ROSE (10%) to validate this proposal
                      </p>
                    </div>
                  )}

                  {proposal.status === 'Staked' && proposal.stakeholder === account && (
                    <div className="mb-4">
                      <Button
                        onClick={() => handleApproveProposal(proposal.id)}
                        className="bg-green-500 text-white hover:bg-green-600 mr-2"
                      >
                        Approve Proposal
                      </Button>
                      <Button
                        onClick={() => handleRejectProposal(proposal.id)}
                        className="bg-red-500 text-white hover:bg-red-600"
                      >
                        Reject Proposal
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
      </CollapsibleSection>  
        
      {/* Original sections */}  
      <CollapsibleSection id="dao-treasury" title="DAO Treasury">  
        <div className="space-y-4">  
          <p>  
            20% of all tokens minted from completed tasks go directly to the DAO treasury.  
            This treasury serves as the financial backbone for community governance initiatives.  
          </p>  
          <p>  
            The treasury funds are used for:  
          </p>  
          <ul className="list-disc pl-6 space-y-2">  
            <li>Platform development and improvements</li>  
            <li>Marketing and community outreach</li>  
            <li>Liquidity provision and token stability measures</li>  
            <li>Grants for projects that benefit the Rose Token ecosystem</li>  
          </ul>  
        </div>  
      </CollapsibleSection>  
        
      <CollapsibleSection id="approval-mechanism" title="Stakeholder Approval Mechanism">
        <div className="space-y-4">
          <p>
            Rose Token uses a simplified single-stakeholder approval model for governance proposals.
            This ensures efficient validation while maintaining quality control.
          </p>
          <p>
            Key aspects of the approval mechanism:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>Single stakeholder stakes 10% of proposal amount to validate it</li>
            <li>Stakeholder reviews and approves or rejects the proposal</li>
            <li>Approved proposals have a 2-day execution delay</li>
            <li>Stakeholder gets their stake back when proposal is executed or rejected</li>
            <li>This model ensures accountability and prevents spam proposals</li>
          </ul>
        </div>
      </CollapsibleSection>  
        
      <CollapsibleSection id="proposal-system" title="Proposal System">
        <div className="space-y-4">
          <p>
            Any ROSE token holder with sufficient locked tokens can submit proposals for stakeholder validation.
            Proposals can be work tasks or governance changes.
          </p>
          <p>
            The proposal process follows these stages:
          </p>
          <ol className="list-decimal pl-6 space-y-2">
            <li>
              <strong>Proposal Submission</strong> - Authors must have minimum tokens locked ({minimumTokensToPropose} ROSE)
            </li>
            <li>
              <strong>Stakeholder Staking</strong> - A stakeholder stakes 10% of proposal amount to validate
            </li>
            <li>
              <strong>Stakeholder Approval</strong> - Stakeholder reviews and approves or rejects
            </li>
            <li>
              <strong>Execution Delay</strong> - {executionDelay} day delay before execution
            </li>
            <li>
              <strong>Execution</strong> - Approved proposals create tasks in the marketplace
            </li>
          </ol>
        </div>
      </CollapsibleSection>  
        
  
        
      {error && (  
        <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-md">  
          <p className="text-red-800">{error}</p>  
        </div>  
      )}  
    </div>  
  );  
};  
  
export default GovernancePage;
