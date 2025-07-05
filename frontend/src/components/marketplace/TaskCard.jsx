import React, { useState, useEffect } from 'react';
import { useEthereum } from '../../hooks/useEthereum';
import { TaskStatus, getStatusText, getStatusColor } from '../../utils/taskStatus';
import CommentSection from './CommentSection';
import ProgressTracker from '../governance/ProgressTracker';
import { ethers } from 'ethers';

const getBidStatusText = (status) => {
  const statusMap = {
    0: 'Active',
    1: 'Shortlisted',
    2: 'Selected',
    3: 'Rejected',
    4: 'Withdrawn'
  };
  return statusMap[status] || 'Unknown';
};

const TaskCard = ({ task, onClaim, onComplete, onApprove, onDispute, onAcceptPayment, onStake, onBid, onShortlistBids, onFinalizeWorkerSelection, onStartBidding, roseMarketplace }) => {
  const { account } = useEthereum();
  const [showComments, setShowComments] = useState(false);
  const [storyPoints, setStoryPoints] = useState(1);
  const [bidAmount, setBidAmount] = useState('');
  const [estimatedDuration, setEstimatedDuration] = useState(7);
  const [portfolioLink, setPortfolioLink] = useState('');
  const [implementationPlan, setImplementationPlan] = useState('');
  const [minimumStake, setMinimumStake] = useState('0');
  const [bids, setBids] = useState([]);
  const [isLoadingBids, setIsLoadingBids] = useState(false);
  const [selectedBids, setSelectedBids] = useState([]);
  const [finalBidIndex, setFinalBidIndex] = useState(null);
  const [biddingDuration, setBiddingDuration] = useState(7); // Default 7 days
  const [biddingMinStake, setBiddingMinStake] = useState('1'); // Default 1 ROSE
  const [showStartBiddingForm, setShowStartBiddingForm] = useState(false);
  
  useEffect(() => {
    const fetchBidInfo = async () => {
      if (task.status === TaskStatus.Bidding && roseMarketplace) {
        try {
          setIsLoadingBids(true);
          const minStake = await roseMarketplace.getMinimumBidStake(task.id);
          setMinimumStake(ethers.utils.formatEther(minStake));
          
          const bidsData = await roseMarketplace.getTaskBids(task.id);
          setBids(bidsData);
        } catch (err) {
          console.error('Error fetching bid info:', err);
        } finally {
          setIsLoadingBids(false);
        }
      }
    };
    
    fetchBidInfo();
  }, [task.id, task.status, roseMarketplace]);
  
  const formatTokens = (wei) => {
    return parseFloat(wei) / 10**18;
  };
  
  const isCustomer = account && task.customer.toLowerCase() === account.toLowerCase();
  const isWorker = account && task.worker.toLowerCase() === account.toLowerCase();
  const isStakeholder = account && task.stakeholder.toLowerCase() === account.toLowerCase();
  
  const canClaim = !isCustomer && task.status === TaskStatus.Open && !isWorker;
  const canStake = !isCustomer && !isWorker && task.status === TaskStatus.StakeholderRequired && task.stakeholder === '0x0000000000000000000000000000000000000000';
  const canComplete = isWorker && task.status === TaskStatus.InProgress;
  const canApproveAsCustomer = isCustomer && task.status === TaskStatus.Completed && !task.customerApproval;
  const canApproveAsStakeholder = isStakeholder && task.status === TaskStatus.Completed && !task.stakeholderApproval;
  const canDispute = (isCustomer || isWorker) && (task.status === TaskStatus.InProgress || task.status === TaskStatus.Completed);
  const canAcceptPayment = isWorker && task.status === TaskStatus.ApprovedPendingPayment;
  const canBid = !isCustomer && !isStakeholder && task.status === TaskStatus.Bidding && task.worker === '0x0000000000000000000000000000000000000000';
  const canStartBidding = (isCustomer || isStakeholder) && task.status === TaskStatus.Bidding && minimumStake === '0';
  
  
  console.log('TaskCard:', { isStakeholder, status: task.status, statusCompare: task.status === TaskStatus.Completed, stakeholderApproval: task.stakeholderApproval, canApproveAsStakeholder });
  
  return (
    <div className="bg-white rounded-lg shadow-md p-6 mb-4 border border-gray-200">
      <div className="flex justify-between items-start mb-4">
        <h3 className="text-lg font-semibold">{task.description}</h3>
        <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(task.status)}`}>
          {getStatusText(task.status)}
        </span>
      </div>
      
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <p className="text-sm text-gray-500">Customer</p>
          <p className="text-sm font-medium truncate">{task.customer}</p>
        </div>
        <div>
          <p className="text-sm text-gray-500">Deposit</p>
          <p className="text-sm font-medium">{formatTokens(task.deposit)} ROSE</p>
        </div>
        <div>
          <p className="text-sm text-gray-500">Worker</p>
          <p className="text-sm font-medium truncate">{task.worker || 'Not assigned'}</p>
        </div>
        <div>
          <p className="text-sm text-gray-500">Stakeholder</p>
          <p className="text-sm font-medium truncate">{task.stakeholder}</p>
        </div>
        {task.stakeholderDeposit && task.stakeholderDeposit !== '0' && (
          <div>
            <p className="text-sm text-gray-500">Stakeholder Deposit</p>
            <p className="text-sm font-medium">{formatTokens(task.stakeholderDeposit)} ROSE</p>
          </div>
        )}
      </div>
      
      {task.status === TaskStatus.Completed && (
        <div className="mb-4 flex space-x-4">
          <div className="flex items-center">
            <span className={`w-3 h-3 rounded-full mr-2 ${task.customerApproval ? 'bg-green-500' : 'bg-gray-300'}`}></span>
            <span className="text-sm">Customer Approval</span>
          </div>
          <div className="flex items-center">
            <span className={`w-3 h-3 rounded-full mr-2 ${task.stakeholderApproval ? 'bg-green-500' : 'bg-gray-300'}`}></span>
            <span className="text-sm">Stakeholder Approval</span>
          </div>
        </div>
      )}
      
      <div className="flex flex-wrap gap-2 mt-4">
        {canStake && (
          <button 
            onClick={() => onStake(task.id)} 
            className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-md text-sm font-medium"
          >
            Stake as Stakeholder
          </button>
        )}
        
        {canClaim && (
          <div className="flex flex-col space-y-2">
            <div className="flex items-center space-x-2">
              <label htmlFor="storyPoints" className="text-sm font-medium">Story Points:</label>
              <input
                id="storyPoints"
                type="number"
                min="1"
                value={storyPoints}
                onChange={(e) => setStoryPoints(parseInt(e.target.value) || 1)}
                className="w-20 text-sm border border-gray-300 rounded-md px-2 py-1"
              />
            </div>
            <button 
              onClick={() => onClaim(task.id, storyPoints)} 
              className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium"
            >
              Claim Task
            </button>
          </div>
        )}
        
        {canComplete && (
          <button 
            onClick={() => onComplete(task.id)} 
            className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-md text-sm font-medium"
          >
            Mark Completed
          </button>
        )}
        
        {canApproveAsCustomer && (
          <button 
            onClick={() => onApprove(task.id, 'customer')} 
            className="bg-purple-500 hover:bg-purple-600 text-white px-4 py-2 rounded-md text-sm font-medium"
          >
            Approve as Customer
          </button>
        )}
        
        {canApproveAsStakeholder && (
          <button 
            onClick={() => onApprove(task.id, 'stakeholder')} 
            className="bg-indigo-500 hover:bg-indigo-600 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors duration-150 ease-in-out shadow-md border border-indigo-400"
          >
            ✓ Approve as Stakeholder
          </button>
        )}
        
        {canDispute && (
          <button 
            onClick={() => onDispute(task.id)} 
            className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-md text-sm font-medium"
          >
            Dispute Task
          </button>
        )}
        
        {canAcceptPayment && (
          <button 
            onClick={() => onAcceptPayment(task.id)} 
            className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-md text-sm font-medium flex items-center space-x-1"
          >
            <span>Accept Payment</span>
            <span className="text-xs">(gas fees apply)</span>
          </button>
        )}
        
        {canStartBidding && (
          <div className="flex flex-col space-y-3 border-t pt-3 mt-2">
            {!showStartBiddingForm ? (
              <button 
                onClick={() => setShowStartBiddingForm(true)}
                className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium"
              >
                Start Bidding Phase
              </button>
            ) : (
              <div className="space-y-3">
                <h4 className="text-sm font-semibold">Initialize Bidding Phase</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="biddingDuration" className="block text-xs font-medium text-gray-700 mb-1">
                      Bidding Duration (days)
                    </label>
                    <input
                      id="biddingDuration"
                      type="number"
                      min="1"
                      max="30"
                      value={biddingDuration}
                      onChange={(e) => setBiddingDuration(parseInt(e.target.value) || 1)}
                      className="w-full text-sm border border-gray-300 rounded-md px-2 py-1"
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="biddingMinStake" className="block text-xs font-medium text-gray-700 mb-1">
                      Minimum Stake (ROSE)
                    </label>
                    <input
                      id="biddingMinStake"
                      type="number"
                      min="0.1"
                      step="0.1"
                      value={biddingMinStake}
                      onChange={(e) => setBiddingMinStake(e.target.value)}
                      className="w-full text-sm border border-gray-300 rounded-md px-2 py-1"
                      required
                    />
                  </div>
                </div>
                <div className="flex space-x-2">
                  <button 
                    onClick={() => {
                      onStartBidding(task.id, biddingDuration, biddingMinStake);
                      setShowStartBiddingForm(false);
                    }}
                    className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-md text-sm font-medium"
                  >
                    Initialize Bidding
                  </button>
                  <button 
                    onClick={() => setShowStartBiddingForm(false)}
                    className="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded-md text-sm font-medium"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        
        {canBid && (
          <div className="flex flex-col space-y-3 border-t pt-3 mt-2">
            <div className="bg-blue-50 p-3 rounded-md mb-2">
              <h4 className="text-sm font-semibold text-blue-800">Worker Bid Submission</h4>
              <p className="text-xs text-blue-600 mt-1">
                This task follows the unified governance workflow. Your bid requires token staking to demonstrate commitment.
              </p>
            </div>
            <h4 className="text-sm font-semibold">Place a Bid</h4>
            <p className="text-xs text-gray-600">Minimum stake required: {minimumStake} ROSE</p>
            
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="bidAmount" className="block text-xs font-medium text-gray-700 mb-1">
                  Bid Amount (ROSE)
                </label>
                <input
                  id="bidAmount"
                  type="number"
                  min="0.001"
                  step="0.001"
                  value={bidAmount}
                  onChange={(e) => setBidAmount(e.target.value)}
                  className="w-full text-sm border border-gray-300 rounded-md px-2 py-1"
                  placeholder="0.1"
                  required
                />
              </div>
              
              <div>
                <label htmlFor="estimatedDuration" className="block text-xs font-medium text-gray-700 mb-1">
                  Estimated Days
                </label>
                <input
                  id="estimatedDuration"
                  type="number"
                  min="1"
                  value={estimatedDuration}
                  onChange={(e) => setEstimatedDuration(parseInt(e.target.value) || 1)}
                  className="w-full text-sm border border-gray-300 rounded-md px-2 py-1"
                  required
                />
              </div>
              
              <div>
                <label htmlFor="storyPoints" className="block text-xs font-medium text-gray-700 mb-1">
                  Story Points
                </label>
                <input
                  id="storyPoints"
                  type="number"
                  min="1"
                  value={storyPoints}
                  onChange={(e) => setStoryPoints(parseInt(e.target.value) || 1)}
                  className="w-full text-sm border border-gray-300 rounded-md px-2 py-1"
                  required
                />
              </div>
            </div>
            
            <div className="space-y-2">
              <div>
                <label htmlFor="portfolioLink" className="block text-xs font-medium text-gray-700 mb-1">
                  Portfolio/Experience
                </label>
                <textarea
                  id="portfolioLink"
                  value={portfolioLink}
                  onChange={(e) => setPortfolioLink(e.target.value)}
                  className="w-full text-sm border border-gray-300 rounded-md px-2 py-1"
                  rows="2"
                  placeholder="Brief description of your experience and relevant work"
                  required
                />
                <p className="text-xs text-gray-500 mt-1">
                  Provide evidence of your expertise to help stakeholders evaluate your bid
                </p>
              </div>
              
              <div>
                <label htmlFor="implementationPlan" className="block text-xs font-medium text-gray-700 mb-1">
                  Implementation Approach
                </label>
                <textarea
                  id="implementationPlan"
                  value={implementationPlan}
                  onChange={(e) => setImplementationPlan(e.target.value)}
                  className="w-full text-sm border border-gray-300 rounded-md px-2 py-1"
                  rows="3"
                  placeholder="Detailed plan for completing this task, including milestones"
                  required
                />
                <p className="text-xs text-gray-500 mt-1">
                  Clear implementation plans help stakeholders assess feasibility and quality
                </p>
              </div>
            </div>
            
            <div className="bg-yellow-50 p-3 rounded-md mb-2">
              <p className="text-xs text-yellow-800">
                <strong>Note:</strong> By submitting this bid, you agree to stake {minimumStake} ROSE tokens. 
                Stakeholders will use ranked choice voting to evaluate all bids fairly.
              </p>
            </div>
            <button 
              onClick={() => onBid(task.id, bidAmount, estimatedDuration, storyPoints, portfolioLink, implementationPlan)} 
              className="bg-indigo-500 hover:bg-indigo-600 text-white px-4 py-2 rounded-md text-sm font-medium"
            >
              Submit Bid & Stake Tokens
            </button>
          </div>
        )}
      </div>
      
      {/* Display existing bids for customers and stakeholders */}
      {(isCustomer || isStakeholder) && task.status === TaskStatus.Bidding && (
        <div className="mt-4 border-t pt-3">
          <h4 className="text-sm font-semibold mb-2">
            {isLoadingBids ? (
              <span className="text-gray-500">Loading bids...</span>
            ) : (
              `Current Bids (${bids.length})`
            )}
          </h4>
          <div className="max-h-60 overflow-y-auto">
            {isLoadingBids ? (
              <div className="p-4 text-center text-sm text-gray-500">
                <svg className="animate-spin h-5 w-5 mx-auto mb-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Fetching bids...
              </div>
            ) : bids.length > 0 ? (
              bids.map((bid, index) => (
              <div key={index} className="p-2 bg-gray-50 rounded-md mb-2 text-sm">
                <div className="flex justify-between items-center">
                  <span className="font-medium truncate">{bid.worker}</span>
                  <span className="text-purple-600 font-medium">
                    {ethers.utils.formatEther(bid.bidAmount)} ROSE
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1 mt-1 text-xs text-gray-600">
                  <span>Story Points: {bid.storyPoints.toString()}</span>
                  <span>Duration: {bid.estimatedDuration.toString() / 86400} days</span>
                  <span>Reputation: {bid.reputationScore.toString()}</span>
                  <span>Status: {getBidStatusText(bid.status)}</span>
                </div>
                {isCustomer && task.status === TaskStatus.Bidding && bid.status === 0 && (
                  <div className="mt-1">
                    <label className="inline-flex items-center">
                      <input
                        type="checkbox"
                        className="form-checkbox h-4 w-4 text-indigo-600"
                        checked={selectedBids.includes(index)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedBids([...selectedBids, index]);
                          } else {
                            setSelectedBids(selectedBids.filter(i => i !== index));
                          }
                        }}
                      />
                      <span className="ml-2 text-xs">Select for shortlist</span>
                    </label>
                  </div>
                )}
                {isStakeholder && task.status === TaskStatus.ShortlistSelected && bid.status === 1 && (
                  <div className="mt-1">
                    <label className="inline-flex items-center">
                      <input
                        type="radio"
                        className="form-radio h-4 w-4 text-indigo-600"
                        name={`finalSelection-${task.id}`}
                        checked={finalBidIndex === index}
                        onChange={() => setFinalBidIndex(index)}
                      />
                      <span className="ml-2 text-xs">Select as final worker</span>
                    </label>
                  </div>
                )}
              </div>
              ))
            ) : (
              <div className="p-4 text-center text-sm text-gray-500">
                No bids have been placed yet
              </div>
            )}
          </div>
          
          {isCustomer && task.status === TaskStatus.Bidding && selectedBids.length > 0 && (
            <button
              onClick={() => onShortlistBids(task.id, selectedBids)}
              className="mt-2 bg-indigo-500 hover:bg-indigo-600 text-white px-4 py-2 rounded-md text-sm font-medium"
            >
              Shortlist Selected Bids
            </button>
          )}
          
          {isStakeholder && task.status === TaskStatus.ShortlistSelected && finalBidIndex !== null && (
            <button
              onClick={() => onFinalizeWorkerSelection(task.id, finalBidIndex)}
              className="mt-2 bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-md text-sm font-medium"
            >
              Select Final Worker
            </button>
          )}
        </div>
      )}
      
      {/* Comments toggle button - only visible to stakeholders, customers, and workers */}
      {(isCustomer || isWorker || isStakeholder) && (
        <div className="mt-4 flex justify-end">
          <button 
            onClick={() => setShowComments(!showComments)} 
            className="text-sm text-gray-600 hover:text-gray-900 flex items-center"
          >
            {showComments ? 'Hide Comments' : 'Show Comments'} 
            <span className="ml-1">{showComments ? '▲' : '▼'}</span>
          </button>
        </div>
      )}
      
      {/* Progress Tracker - visible to all participants */}
      {(isCustomer || isWorker || isStakeholder) && (
        <div className="mt-4">
          <ProgressTracker 
            proposal={null} // TODO: Link to actual proposal data
            task={task}
            stakeholderApprovals={{
              approvalCount: task.stakeholderApproval ? 1 : 0,
              totalStakeholders: 1, // TODO: Get actual stakeholder count
              approvalPercentage: task.stakeholderApproval ? 100 : 0,
              isApproved: task.stakeholderApproval
            }}
          />
        </div>
      )}

      {/* Comments section - only visible to stakeholders, customers, and workers */}
      {showComments && (isCustomer || isWorker || isStakeholder) && (
        <CommentSection 
          taskId={task.id} 
          roseMarketplace={roseMarketplace} 
          task={task} 
          isAuthorized={true}
        />
      )}
    </div>
  );
};

export default TaskCard;
