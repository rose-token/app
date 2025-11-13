import React, { useState, useEffect } from 'react';
import { useEthereum } from '../../hooks/useEthereum';
import { useContract } from '../../hooks/useContract';
import { TaskStatus, getStatusText, getStatusColor } from '../../utils/taskStatus';
import { fetchTaskDescription } from '../../utils/ipfs/pinataService';
import ProgressTracker from '../governance/ProgressTracker';

const TaskCard = ({ task, onClaim, onUnclaim, onComplete, onApprove, onAcceptPayment, onStake, onCancel }) => {
  const { account } = useEthereum();
  const { roseMarketplace } = useContract();

  const [detailedContent, setDetailedContent] = useState(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [canViewDetails, setCanViewDetails] = useState(false);
  const [detailsError, setDetailsError] = useState('');

  // PR URL modal state
  const [showPrUrlModal, setShowPrUrlModal] = useState(false);
  const [prUrl, setPrUrl] = useState('');
  const [prUrlError, setPrUrlError] = useState('');

  const formatTokens = (wei) => {
    return parseFloat(wei) / 10**18;
  };

  const isCustomer = account && task.customer.toLowerCase() === account.toLowerCase();
  const isWorker = account && task.worker && task.worker.toLowerCase() === account.toLowerCase();
  const isStakeholder = account && task.stakeholder && task.stakeholder.toLowerCase() === account.toLowerCase();
  const isParticipant = isCustomer || isWorker || isStakeholder;

  // Check if user can view details
  useEffect(() => {
    const checkAccess = async () => {
      if (!account || !roseMarketplace || !task.id) return;

      try {
        const hasAccess = await roseMarketplace.isTaskParticipant(task.id);
        setCanViewDetails(hasAccess);
      } catch (error) {
        console.error('Error checking access:', error);
        setCanViewDetails(false);
      }
    };

    checkAccess();
  }, [account, roseMarketplace, task.id]);

  // Fetch detailed description from IPFS
  const loadDetailedDescription = async () => {
    if (!canViewDetails) {
      setDetailsError('You must be a task participant to view details');
      return;
    }

    if (!task.detailedDescription || task.detailedDescription.length === 0) {
      setDetailsError('No detailed description available');
      return;
    }

    setIsLoadingDetails(true);
    setDetailsError('');

    try {
      const content = await fetchTaskDescription(task.detailedDescription);
      setDetailedContent(content);
      setShowDetails(true);
    } catch (error) {
      console.error('Error loading detailed description:', error);
      setDetailsError('Failed to load detailed description from IPFS');
    } finally {
      setIsLoadingDetails(false);
    }
  };

  // Handle PR URL validation and submission
  const validatePrUrl = (url) => {
    if (!url || url.trim().length === 0) {
      return 'PR URL is required';
    }
    if (!url.includes('github.com') || !url.includes('/pull/')) {
      return 'Please enter a valid GitHub Pull Request URL (must contain "github.com" and "/pull/")';
    }
    return '';
  };

  const handleMarkCompleted = () => {
    setPrUrl('');
    setPrUrlError('');
    setShowPrUrlModal(true);
  };

  const handleSubmitCompletion = () => {
    const error = validatePrUrl(prUrl);
    if (error) {
      setPrUrlError(error);
      return;
    }

    setShowPrUrlModal(false);
    onComplete(task.id, prUrl);
  };

  const canClaim = !isCustomer && !isStakeholder && task.status === TaskStatus.Open && !isWorker;
  const canUnclaim = isWorker && task.status === TaskStatus.InProgress;
  const canStake = !isCustomer && !isWorker && task.status === TaskStatus.StakeholderRequired && task.stakeholder === '0x0000000000000000000000000000000000000000';
  const canComplete = isWorker && task.status === TaskStatus.InProgress;
  const canApproveAsCustomer = isCustomer && task.status === TaskStatus.Completed && !task.customerApproval;
  const canApproveAsStakeholder = isStakeholder && task.status === TaskStatus.Completed && !task.stakeholderApproval;
  const canAcceptPayment = isWorker && task.status === TaskStatus.ApprovedPendingPayment;

  // Task can be cancelled by customer or stakeholder before worker claims
  const canCancel = (isCustomer || isStakeholder) &&
    (task.status === TaskStatus.StakeholderRequired || task.status === TaskStatus.Open);

  console.log('TaskCard:', { isStakeholder, status: task.status, statusCompare: task.status === TaskStatus.Completed, stakeholderApproval: task.stakeholderApproval, canApproveAsStakeholder });

  return (
    <div className="bg-card rounded-lg shadow-md p-6 mb-4 border border-rose-tan">
      <div className="flex justify-between items-start mb-4">
        <h3 className="text-lg font-semibold">{task.description}</h3>
        <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(task.status)}`}>
          {getStatusText(task.status)}
        </span>
      </div>

      {/* Detailed Description Section */}
      <div className="mb-4">
        {canViewDetails ? (
          <div className="border border-rose-tan rounded-md p-3 bg-rose-blush">
            {!showDetails ? (
              <button
                onClick={loadDetailedDescription}
                disabled={isLoadingDetails}
                className="text-rose-mauve hover:text-primary text-sm font-medium flex items-center"
              >
                {isLoadingDetails ? (
                  <>
                    <span className="animate-spin mr-2">⏳</span>
                    Loading details...
                  </>
                ) : (
                  <>
                    <span className="mr-2">📄</span>
                    View Detailed Description
                  </>
                )}
              </button>
            ) : (
              <div>
                <div className="flex justify-between items-center mb-2">
                  <h4 className="font-semibold text-sm text-foreground">Detailed Description</h4>
                  <button
                    onClick={() => setShowDetails(false)}
                    className="text-muted-foreground hover:text-foreground text-xs"
                  >
                    Hide
                  </button>
                </div>
                {detailedContent && (
                  <div className="text-sm text-foreground whitespace-pre-wrap bg-card p-3 rounded border border-rose-tan">
                    {detailedContent.description}
                    {detailedContent.uploadedAt && (
                      <p className="text-xs text-muted-foreground mt-2 pt-2 border-t border-rose-tan">
                        Uploaded: {new Date(detailedContent.uploadedAt).toLocaleString()}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
            {detailsError && (
              <p className="text-xs text-destructive mt-1">{detailsError}</p>
            )}
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <p className="text-sm text-muted-foreground">Customer</p>
          <p className="text-sm font-medium truncate">{task.customer}</p>
        </div>
        <div>
          <p className="text-sm text-muted-foreground">Deposit</p>
          <p className="text-sm font-medium">{formatTokens(task.deposit)} ROSE</p>
        </div>
        <div>
          <p className="text-sm text-muted-foreground">Worker</p>
          <p className="text-sm font-medium truncate">{task.worker || 'Not assigned'}</p>
        </div>
        <div>
          <p className="text-sm text-muted-foreground">Stakeholder</p>
          <p className="text-sm font-medium truncate">{task.stakeholder || 'Not assigned'}</p>
        </div>
        {task.stakeholderDeposit && task.stakeholderDeposit !== '0' && (
          <div>
            <p className="text-sm text-muted-foreground">Stakeholder Deposit</p>
            <p className="text-sm font-medium">{formatTokens(task.stakeholderDeposit)} ROSE</p>
          </div>
        )}
      </div>

      {/* Display PR URL if task is completed or beyond */}
      {task.prUrl && task.status >= TaskStatus.Completed && (
        <div className="mb-4 p-3 bg-rose-blush rounded-md border border-rose-tan">
          <p className="text-sm text-muted-foreground mb-1">Pull Request:</p>
          <a
            href={task.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-rose-mauve hover:text-primary underline break-all"
          >
            {task.prUrl}
          </a>
        </div>
      )}

      {task.status === TaskStatus.Completed && (
        <div className="mb-4 flex space-x-4">
          <div className="flex items-center">
            <span className={`w-3 h-3 rounded-full mr-2 ${task.customerApproval ? 'bg-accent' : 'bg-rose-tan'}`}></span>
            <span className="text-sm">Customer Approval</span>
          </div>
          <div className="flex items-center">
            <span className={`w-3 h-3 rounded-full mr-2 ${task.stakeholderApproval ? 'bg-accent' : 'bg-rose-tan'}`}></span>
            <span className="text-sm">Stakeholder Approval</span>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 mt-4">
        {canStake && (
          <button
            onClick={() => onStake(task.id)}
            className="bg-primary hover:bg-rose-mauve text-primary-foreground px-4 py-2 rounded-md text-sm font-medium shadow-sm"
          >
            Stake as Stakeholder
          </button>
        )}

        {canClaim && (
          <button
            onClick={() => onClaim(task.id)}
            className="bg-primary hover:bg-rose-mauve text-primary-foreground px-4 py-2 rounded-md text-sm font-medium shadow-sm"
          >
            Claim Task
          </button>
        )}

        {canUnclaim && (
          <button
            onClick={() => onUnclaim(task.id)}
            className="bg-secondary hover:bg-rose-pink text-secondary-foreground px-4 py-2 rounded-md text-sm font-medium shadow-sm"
            title="Release this task so another worker can claim it"
          >
            Unclaim Task
          </button>
        )}

        {canComplete && (
          <button
            onClick={handleMarkCompleted}
            className="bg-accent hover:bg-rose-coral text-accent-foreground px-4 py-2 rounded-md text-sm font-medium shadow-sm"
          >
            Mark Completed
          </button>
        )}

        {canApproveAsCustomer && (
          <button
            onClick={() => onApprove(task.id, 'customer')}
            className="bg-primary hover:bg-rose-mauve text-primary-foreground px-4 py-2 rounded-md text-sm font-medium shadow-sm"
          >
            Approve as Customer
          </button>
        )}

        {canApproveAsStakeholder && (
          <button
            onClick={() => onApprove(task.id, 'stakeholder')}
            className="bg-accent hover:bg-rose-coral text-accent-foreground px-4 py-2 rounded-md text-sm font-medium transition-colors duration-150 ease-in-out shadow-md border border-rose-tan"
          >
            ✓ Approve as Stakeholder
          </button>
        )}

        {canAcceptPayment && (
          <button
            onClick={() => onAcceptPayment(task.id)}
            className="bg-primary hover:bg-rose-mauve text-primary-foreground px-4 py-2 rounded-md text-sm font-medium flex items-center space-x-1 shadow-sm"
          >
            <span>Accept Payment</span>
            <span className="text-xs">(gas fees apply)</span>
          </button>
        )}

        {canCancel && (
          <button
            onClick={() => onCancel(task.id)}
            className="bg-destructive hover:bg-rose-coral text-destructive-foreground px-4 py-2 rounded-md text-sm font-medium shadow-sm"
          >
            Cancel Task
          </button>
        )}
      </div>

      {/* Progress Tracker - visible to all participants */}
      {isParticipant && (
        <div className="mt-4">
          <ProgressTracker task={task} />
        </div>
      )}

      {/* PR URL Modal */}
      {showPrUrlModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-card rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
            <h3 className="text-lg font-semibold mb-4">Mark Task as Completed</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Please provide the GitHub Pull Request URL for the completed work:
            </p>

            <div className="mb-4">
              <label className="block text-sm font-medium text-foreground mb-2">
                GitHub PR URL *
              </label>
              <input
                type="text"
                value={prUrl}
                onChange={(e) => setPrUrl(e.target.value)}
                placeholder="https://github.com/owner/repo/pull/123"
                className="w-full px-3 py-2 border border-rose-tan rounded-md focus:outline-none focus:ring-2 focus:ring-primary bg-input"
              />
              {prUrlError && (
                <p className="text-xs text-destructive mt-1">{prUrlError}</p>
              )}
            </div>

            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setShowPrUrlModal(false)}
                className="px-4 py-2 text-sm font-medium text-muted-foreground bg-muted hover:bg-rose-tan rounded-md"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmitCompletion}
                className="px-4 py-2 text-sm font-medium text-accent-foreground bg-accent hover:bg-rose-coral rounded-md shadow-sm"
              >
                Submit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TaskCard;
