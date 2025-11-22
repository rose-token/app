import React, { useState } from 'react';
import { useAccount, useReadContract } from 'wagmi';
import RoseMarketplaceABI from '../../contracts/RoseMarketplaceABI.json';
import { TaskStatus, getStatusText, getStatusColor } from '../../utils/taskStatus';
import { fetchTaskDescription } from '../../utils/ipfs/pinataService';
import ProgressTracker from '../governance/ProgressTracker';

const TaskCard = ({ task, onClaim, onUnclaim, onComplete, onApprove, onAcceptPayment, onStake, onCancel }) => {
  const { address: account, isConnected, chain } = useAccount();

  const [detailedContent, setDetailedContent] = useState(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [detailsError, setDetailsError] = useState('');

  // PR URL modal state
  const [showPrUrlModal, setShowPrUrlModal] = useState(false);
  const [prUrl, setPrUrl] = useState('');
  const [prUrlError, setPrUrlError] = useState('');

  const marketplaceAddress = import.meta.env.VITE_MARKETPLACE_ADDRESS;

  const formatTokens = (wei) => {
    return parseFloat(wei) / 10**18;
  };

  const isCustomer = account && task.customer.toLowerCase() === account.toLowerCase();
  const isWorker = account && task.worker && task.worker.toLowerCase() === account.toLowerCase();
  const isStakeholder = account && task.stakeholder && task.stakeholder.toLowerCase() === account.toLowerCase();
  const isParticipant = isCustomer || isWorker || isStakeholder;

  // Check if user can view details using wagmi's useReadContract
  const { data: canViewDetails } = useReadContract({
    address: marketplaceAddress,
    abi: RoseMarketplaceABI,
    functionName: 'isTaskParticipant',
    args: task.id ? [task.id] : undefined,
    chainId: chain?.id,
    query: {
      enabled: !!account && isConnected && !!task.id && !!marketplaceAddress,
    },
  });

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
    <div className="bg-card rounded-lg shadow-md p-6 mb-4 ">
      <div className="flex justify-between items-start mb-4">
        <h3 className="text-lg font-semibold text-foreground">{task.description}</h3>
        <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(task.status)}`}>
          {getStatusText(task.status)}
        </span>
      </div>

      {/* Detailed Description Section */}
      <div className="mb-4">
        {canViewDetails ? (
          <div className="rounded-md p-3 bg-muted/20">
            {!showDetails ? (
              <button
                onClick={loadDetailedDescription}
                disabled={isLoadingDetails}
                className="text-primary hover:text-primary/80 text-sm font-medium flex items-center"
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
                  <div className="text-sm text-foreground whitespace-pre-wrap bg-card p-3 rounded">
                    {detailedContent.description}
                    {detailedContent.uploadedAt && (
                      <p className="text-xs text-muted mt-2 pt-2 border-t border-border">
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
          <p className="text-sm text-muted">Customer</p>
          <p className="text-sm font-medium text-foreground truncate">{task.customer}</p>
        </div>
        <div>
          <p className="text-sm text-muted">Deposit</p>
          <p className="text-sm font-medium text-foreground">{formatTokens(task.deposit)} ROSE</p>
        </div>
        <div>
          <p className="text-sm text-muted">Worker</p>
          <p className="text-sm font-medium text-foreground truncate">{task.worker || 'Not assigned'}</p>
        </div>
        <div>
          <p className="text-sm text-muted">Stakeholder</p>
          <p className="text-sm font-medium text-foreground truncate">{task.stakeholder || 'Not assigned'}</p>
        </div>
        {task.stakeholderDeposit && task.stakeholderDeposit !== '0' && (
          <div>
            <p className="text-sm text-muted">Stakeholder Deposit</p>
            <p className="text-sm font-medium text-foreground">{formatTokens(task.stakeholderDeposit)} ROSE</p>
          </div>
        )}
      </div>

      {/* Display PR URL if task is completed or beyond */}
      {task.prUrl && task.status >= TaskStatus.Completed && (
        <div className="mb-4 p-3 bg-accent/20 rounded-md border border-accent">
          <p className="text-sm text-muted-foreground mb-1">Pull Request:</p>
          <a
            href={task.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-primary hover:text-primary/80 underline break-all"
          >
            {task.prUrl}
          </a>
        </div>
      )}

      {task.status === TaskStatus.Completed && (
        <div className="mb-4 flex space-x-4">
          <div className="flex items-center">
            <span className={`w-3 h-3 rounded-full mr-2 ${task.customerApproval ? 'bg-accent' : 'bg-muted'}`}></span>
            <span className="text-sm text-foreground">Customer Approval</span>
          </div>
          <div className="flex items-center">
            <span className={`w-3 h-3 rounded-full mr-2 ${task.stakeholderApproval ? 'bg-accent' : 'bg-muted'}`}></span>
            <span className="text-sm text-foreground">Stakeholder Approval</span>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 mt-4">
        {canStake && (
          <button
            onClick={() => onStake(task.id)}
            className="bg-task-stake hover:bg-task-stake/90 text-task-stake-foreground px-4 py-2 rounded-md text-sm font-medium"
          >
            Stake as Stakeholder
          </button>
        )}

        {canClaim && (
          <button
            onClick={() => onClaim(task.id)}
            className="bg-task-claim hover:bg-task-claim/90 text-task-claim-foreground px-4 py-2 rounded-md text-sm font-medium"
          >
            Claim Task
          </button>
        )}

        {canUnclaim && (
          <button
            onClick={() => onUnclaim(task.id)}
            className="bg-task-unclaim hover:bg-task-unclaim/90 text-task-unclaim-foreground px-4 py-2 rounded-md text-sm font-medium"
            title="Release this task so another worker can claim it"
          >
            Unclaim Task
          </button>
        )}

        {canComplete && (
          <button
            onClick={handleMarkCompleted}
            className="bg-task-complete hover:bg-task-complete/90 text-task-complete-foreground px-4 py-2 rounded-md text-sm font-medium"
          >
            Mark Completed
          </button>
        )}

        {canApproveAsCustomer && (
          <button
            onClick={() => onApprove(task.id, 'customer')}
            className="bg-task-approve hover:bg-task-approve/90 text-task-approve-foreground px-4 py-2 rounded-md text-sm font-medium"
          >
            Approve as Customer
          </button>
        )}

        {canApproveAsStakeholder && (
          <button
            onClick={() => onApprove(task.id, 'stakeholder')}
            className="bg-task-approve hover:bg-task-approve/90 text-task-approve-foreground px-4 py-2 rounded-md text-sm font-medium transition-colors duration-150 ease-in-out shadow-md"
          >
            ✓ Approve as Stakeholder
          </button>
        )}

        {canAcceptPayment && (
          <button
            onClick={() => onAcceptPayment(task.id)}
            className="bg-task-complete hover:bg-task-complete/90 text-task-complete-foreground px-4 py-2 rounded-md text-sm font-medium flex items-center space-x-1"
          >
            <span>Accept Payment</span>
            <span className="text-xs">(gas fees apply)</span>
          </button>
        )}

        {canCancel && (
          <button
            onClick={() => onCancel(task.id)}
            className="bg-task-cancel hover:bg-task-cancel/90 text-task-cancel-foreground px-4 py-2 rounded-md text-sm font-medium"
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
          <div className="bg-card rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-foreground mb-4">Mark Task as Completed</h3>
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
                className="w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary bg-input text-foreground"
              />
              {prUrlError && (
                <p className="text-xs text-destructive mt-1">{prUrlError}</p>
              )}
            </div>

            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setShowPrUrlModal(false)}
                className="px-4 py-2 text-sm font-medium text-foreground bg-muted hover:bg-muted/80 rounded-md"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmitCompletion}
                className="px-4 py-2 text-sm font-medium bg-task-complete hover:bg-task-complete/90 text-task-complete-foreground rounded-md"
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
