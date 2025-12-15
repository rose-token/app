import React, { useState, useEffect, useCallback } from 'react';
import { useAccount, useReadContract } from 'wagmi';
import { formatUnits } from 'viem';
import RoseMarketplaceABI from '../../contracts/RoseMarketplaceABI.json';
import { TaskStatus, getStatusText, getStatusColor } from '../../utils/taskStatus';
import { fetchTaskDescription } from '../../utils/ipfs/pinataService';
import ProgressTracker from '../governance/ProgressTracker';
import ProfileBadge from '../profile/ProfileBadge';
import BidSubmissionModal from './BidSubmissionModal';
import BidSelectionModal from './BidSelectionModal';
import DisputeModal from './DisputeModal';
import { useAuction } from '../../hooks/useAuction';
import { useDispute } from '../../hooks/useDispute';
import { GITHUB_INTEGRATION, validatePrUrl as validatePrUrlFormat, validatePrUrlWithBackend } from '../../constants/github';
import Spinner from '../ui/Spinner';
import { SkillBadgeList } from '../profile/SkillBadge';

const TaskCard = ({ task, onClaim, onUnclaim, onComplete, onApprove, onAcceptPayment, onStake, onUnstake, onCancel, loadingStates = {}, onRefetch }) => {
  const { address: account, isConnected, chain } = useAccount();

  const [detailedContent, setDetailedContent] = useState(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [detailsError, setDetailsError] = useState('');

  // Derive skills from detailedContent to avoid duplicate state
  const skills = detailedContent?.skills || [];

  // PR URL modal state
  const [showPrUrlModal, setShowPrUrlModal] = useState(false);
  const [prUrl, setPrUrl] = useState('');
  const [prUrlError, setPrUrlError] = useState('');
  const [isValidatingPr, setIsValidatingPr] = useState(false);

  // Bid modal state (for auction tasks)
  const [showBidModal, setShowBidModal] = useState(false);
  const [showBidSelectionModal, setShowBidSelectionModal] = useState(false);
  const [bidCount, setBidCount] = useState(0);
  const [myBid, setMyBid] = useState(null);
  const [isLoadingBid, setIsLoadingBid] = useState(false);

  // Dispute modal state
  const [showDisputeModal, setShowDisputeModal] = useState(false);

  const { getBidCount, getMyBid } = useAuction();
  const { canDispute, actionLoading: disputeLoading } = useDispute();

  const marketplaceAddress = import.meta.env.VITE_MARKETPLACE_ADDRESS;

  const formatTokens = (wei) => {
    return parseFloat(wei) / 10**18;
  };

  const isCustomer = account && task.customer === account;
  const isWorker = account && task.worker && task.worker === account;
  const isStakeholder = account && task.stakeholder && task.stakeholder === account;
  const isParticipant = isCustomer || isWorker || isStakeholder;

  // Auction-specific checks
  const isAuction = task.isAuction || false;
  const isOpenAuction = isAuction && task.status === TaskStatus.Open;

  // Fetch bid count and my bid for auction tasks
  const fetchBidInfo = useCallback(async () => {
    if (!isAuction || !task.id) return;

    setIsLoadingBid(true);
    try {
      // Fetch bid count (public)
      const countData = await getBidCount(task.id);
      setBidCount(countData.bidCount || 0);

      // Fetch my bid if connected
      if (account && !isCustomer && !isStakeholder) {
        const myBidData = await getMyBid(task.id);
        setMyBid(myBidData.hasBid ? myBidData.bid : null);
      }
    } catch (err) {
      console.error('Failed to fetch bid info:', err);
    } finally {
      setIsLoadingBid(false);
    }
  }, [isAuction, task.id, account, isCustomer, isStakeholder, getBidCount, getMyBid]);

  useEffect(() => {
    fetchBidInfo();
  }, [fetchBidInfo]);

  // Auto-fetch IPFS content on mount for skills display
  useEffect(() => {
    let isMounted = true;

    const fetchContent = async () => {
      if (!task.detailedDescription || task.detailedDescription.length === 0) return;

      try {
        const content = await fetchTaskDescription(task.detailedDescription);
        if (isMounted) {
          setDetailedContent(content);
        }
      } catch (error) {
        console.error('Error loading task content:', error);
      }
    };

    fetchContent();

    return () => {
      isMounted = false;
    };
  }, [task.detailedDescription]);

  // Handle bid submission callback - also refetch task for status updates
  const handleBidSubmitted = useCallback(() => {
    fetchBidInfo();
    onRefetch?.();
  }, [fetchBidInfo, onRefetch]);

  // Fetch detailed description from IPFS
  const loadDetailedDescription = async () => {
    if (!task.detailedDescription || task.detailedDescription.length === 0) {
      setDetailsError('No detailed description available');
      return;
    }

    // Use cached content if available (from auto-fetch)
    if (detailedContent) {
      setShowDetails(true);
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
  const handleMarkCompleted = () => {
    // Check if GitHub integration is enabled for this task (from on-chain data)
    if (!task.githubIntegration) {
      // Skip PR URL modal, complete directly with empty string
      onComplete(task.id, '');
      return;
    }

    // Show PR URL modal for GitHub-integrated tasks
    setPrUrl('');
    setPrUrlError('');
    setIsValidatingPr(false);
    setShowPrUrlModal(true);
  };

  const handleSubmitCompletion = async () => {
    // Step 1: Client-side format validation
    const formatError = validatePrUrlFormat(prUrl);
    if (formatError) {
      setPrUrlError(formatError);
      return;
    }

    // Step 2: Backend validation (checks if PR exists, app has access, PR is open, customer authorized repo)
    // Only validate with backend if the PR URL looks like a GitHub PR
    if (GITHUB_INTEGRATION.PR_URL_REGEX.test(prUrl.trim())) {
      setIsValidatingPr(true);
      setPrUrlError('');

      try {
        const signerUrl = import.meta.env.VITE_PASSPORT_SIGNER_URL;
        // Pass task.id for customer authorization check
        const result = await validatePrUrlWithBackend(prUrl, signerUrl, task.id);

        if (!result.valid) {
          setPrUrlError(result.error || 'Failed to validate PR URL');
          setIsValidatingPr(false);
          return;
        }
      } catch (err) {
        console.error('PR validation error:', err);
        // Don't block on validation errors - allow submission with warning
        console.warn('Could not validate PR with backend, proceeding anyway');
      } finally {
        setIsValidatingPr(false);
      }
    }

    setShowPrUrlModal(false);
    onComplete(task.id, prUrl);
  };

  // Workers can claim fixed-price tasks, but must bid on auctions
  const canClaim = !isCustomer && !isStakeholder && task.status === TaskStatus.Open && !isWorker && !isAuction;
  const canBid = !isCustomer && !isStakeholder && isOpenAuction && !isWorker;
  // Customers can view bids on open auctions
  const canViewBids = isCustomer && isOpenAuction;
  const canUnclaim = isWorker && task.status === TaskStatus.InProgress;
  const canStake = !isCustomer && !isWorker && task.status === TaskStatus.StakeholderRequired && task.stakeholder === '0x0000000000000000000000000000000000000000';
  const canComplete = isWorker && task.status === TaskStatus.InProgress;
  const canApproveAsCustomer = isCustomer && task.status === TaskStatus.Completed && !task.customerApproval;
  const canApproveAsStakeholder = isStakeholder && task.status === TaskStatus.Completed && !task.stakeholderApproval;
  const canAcceptPayment = isWorker && task.status === TaskStatus.ApprovedPendingPayment;

  // Stakeholder can unstake in Open status only (before worker claims)
  const canUnstake = isStakeholder && task.status === TaskStatus.Open;

  // Task can be cancelled by customer (anytime before worker claims) or stakeholder (only in StakeholderRequired)
  // In Open status, stakeholder uses unstake instead of cancel
  const canCancel = (isCustomer && (task.status === TaskStatus.StakeholderRequired || task.status === TaskStatus.Open)) ||
    (isStakeholder && task.status === TaskStatus.StakeholderRequired);

  // Dispute eligibility
  const disputeEligibility = canDispute(task, account);
  const canRaiseDispute = disputeEligibility.canDispute;
  const disputeRole = disputeEligibility.role;

  // Check loading states for each button type
  const isStaking = loadingStates.stake?.[task.id] || false;
  const isUnstaking = loadingStates.unstake?.[task.id] || false;
  const isClaiming = loadingStates.claim?.[task.id] || false;
  const isUnclaiming = loadingStates.unclaim?.[task.id] || false;
  const isCompleting = loadingStates.complete?.[task.id] || false;
  const isApprovingCustomer = loadingStates.approveCustomer?.[task.id] || false;
  const isApprovingStakeholder = loadingStates.approveStakeholder?.[task.id] || false;
  const isAcceptingPayment = loadingStates.acceptPayment?.[task.id] || false;
  const isCancelling = loadingStates.cancel?.[task.id] || false;
  const isDisputing = disputeLoading.disputeAsCustomer || disputeLoading.disputeAsWorker;

  // Status badge styling
  const getStatusBadgeStyle = (status) => {
    const styles = {
      [TaskStatus.StakeholderRequired]: { background: 'var(--warning-bg)', border: '1px solid rgba(251, 191, 36, 0.3)', color: 'var(--warning)' },
      [TaskStatus.Open]: { background: 'var(--info-bg)', border: '1px solid rgba(96, 165, 250, 0.3)', color: 'var(--info)' },
      [TaskStatus.InProgress]: { background: 'var(--rose-pink-muted)', border: '1px solid rgba(212, 165, 165, 0.3)', color: 'var(--rose-pink-light)' },
      [TaskStatus.Completed]: { background: 'var(--success-bg)', border: '1px solid rgba(74, 222, 128, 0.3)', color: 'var(--success)' },
      [TaskStatus.ApprovedPendingPayment]: { background: 'var(--success-bg)', border: '1px solid rgba(74, 222, 128, 0.3)', color: 'var(--success)' },
      [TaskStatus.Closed]: { background: 'rgba(255, 255, 255, 0.05)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' },
      [TaskStatus.Disputed]: { background: 'var(--error-bg)', border: '1px solid rgba(248, 113, 113, 0.3)', color: 'var(--error)' },
    };
    return styles[status] || styles[TaskStatus.Closed];
  };

  const labelStyle = {
    color: 'var(--text-muted)',
    fontSize: '0.6875rem',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.08em'
  };

  const buttonBaseClass = "px-4 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200";

  return (
    <div
      className="rounded-[20px] backdrop-blur-[20px] p-7 mb-5 task-card-hover"
      style={{
        background: 'var(--bg-card)',
        boxShadow: 'var(--shadow-card)'
      }}
    >
      <div className="flex justify-between items-start mb-5">
        <h3 className="font-display text-xl font-medium" style={{ color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
          {task.description}
        </h3>
        <div className="flex items-center gap-2">
          {/* Bid count badge for auctions */}
          {isAuction && task.status <= TaskStatus.Open && (
            <span
              className="px-3 py-1.5 rounded-full text-[0.6875rem] font-semibold"
              style={{
                background: 'var(--rose-pink-muted)',
                border: '1px solid rgba(212, 165, 165, 0.3)',
                color: 'var(--rose-pink-light)'
              }}
            >
              {bidCount} {bidCount === 1 ? 'bid' : 'bids'}
            </span>
          )}
          <span
            className="px-3.5 py-1.5 rounded-full text-[0.6875rem] font-semibold uppercase tracking-wide"
            style={getStatusBadgeStyle(task.status)}
          >
            {getStatusText(task.status, isAuction)}
          </span>
        </div>
      </div>

      {/* Required Skills */}
      {skills.length > 0 && (
        <div className="mb-5">
          <p style={labelStyle} className="mb-2">Required Skills</p>
          <SkillBadgeList skills={skills} size="sm" />
        </div>
      )}

      {/* Detailed Description Section */}
      <div className="mb-5">
        {!showDetails ? (
          <button
            onClick={loadDetailedDescription}
            disabled={isLoadingDetails}
            className="flex items-center gap-2 text-sm font-medium transition-all duration-200 hover:bg-[rgba(212,165,165,0.2)] hover:border-[var(--rose-pink)]"
            style={{
              padding: '0.75rem 1rem',
              background: 'var(--rose-pink-muted)',
              border: '1px solid rgba(212, 165, 165, 0.2)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--rose-pink-light)',
              cursor: isLoadingDetails ? 'wait' : 'pointer'
            }}
          >
            {isLoadingDetails ? (
              <>
                <Spinner className="h-4 w-4 inline-block" />
                Loading details...
              </>
            ) : (
              <>
                <span>📄</span>
                View Detailed Description
              </>
            )}
          </button>
        ) : (
          <div
            className="rounded-xl p-4"
            style={{ background: 'rgba(255, 255, 255, 0.03)', border: '1px solid var(--border-subtle)' }}
          >
            <div className="flex justify-between items-center mb-3">
              <h4 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Detailed Description</h4>
              <button
                onClick={() => setShowDetails(false)}
                className="text-xs transition-colors hover:text-[var(--rose-pink)]"
                style={{ color: 'var(--text-muted)' }}
              >
                Hide
              </button>
            </div>
            {detailedContent && (
              <div
                className="text-sm whitespace-pre-wrap p-4 rounded-lg"
                style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}
              >
                {detailedContent.description}
                {detailedContent.uploadedAt && (
                  <p
                    className="text-xs mt-3 pt-3"
                    style={{ borderTop: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}
                  >
                    Uploaded: {new Date(detailedContent.uploadedAt).toLocaleString()}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
        {detailsError && (
          <p className="text-xs mt-2" style={{ color: 'var(--error)' }}>{detailsError}</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-5 mb-5">
        <div>
          <p style={labelStyle}>Customer</p>
          <div className="mt-1">
            <ProfileBadge address={task.customer} size="sm" />
          </div>
        </div>
        <div>
          <p style={labelStyle}>{isAuction ? 'Max Budget' : 'Deposit'}</p>
          <p className="text-sm font-medium mt-1" style={{ color: 'var(--rose-gold)' }}>{formatTokens(task.deposit)} ROSE</p>
        </div>
        <div>
          <p style={labelStyle}>Worker</p>
          <div className="mt-1">
            {task.worker && task.worker !== '0x0000000000000000000000000000000000000000' ? (
              <ProfileBadge address={task.worker} size="sm" />
            ) : (
              <p className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>Not assigned</p>
            )}
          </div>
        </div>
        <div>
          <p style={labelStyle}>Stakeholder</p>
          <div className="mt-1">
            {task.stakeholder && task.stakeholder !== '0x0000000000000000000000000000000000000000' ? (
              <ProfileBadge address={task.stakeholder} size="sm" />
            ) : (
              <p className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>Not assigned</p>
            )}
          </div>
        </div>
        {task.stakeholderDeposit && task.stakeholderDeposit !== '0' && (
          <div>
            <p style={labelStyle}>Stakeholder Deposit</p>
            <p className="text-sm font-medium mt-1" style={{ color: 'var(--text-primary)' }}>{formatTokens(task.stakeholderDeposit)} ROSE</p>
          </div>
        )}
        {/* Show winning bid for auctions in progress or beyond */}
        {isAuction && task.winningBid && task.winningBid !== '0' && (
          <div>
            <p style={labelStyle}>Winning Bid</p>
            <p className="text-sm font-medium mt-1" style={{ color: 'var(--success)' }}>{formatTokens(task.winningBid)} ROSE</p>
          </div>
        )}
      </div>

      {/* Show worker's current bid for open auctions */}
      {isOpenAuction && myBid && (
        <div
          className="mb-5 p-4 rounded-xl"
          style={{ background: 'var(--rose-pink-muted)', border: '1px solid rgba(212, 165, 165, 0.3)' }}
        >
          <div className="flex justify-between items-center">
            <span className="text-sm" style={{ color: 'var(--rose-pink-light)' }}>
              Your Current Bid
            </span>
            <span className="text-sm font-semibold" style={{ color: 'var(--rose-pink-light)' }}>
              {formatUnits(BigInt(myBid.bidAmount), 18)} ROSE
            </span>
          </div>
          {myBid.message && (
            <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
              "{myBid.message}"
            </p>
          )}
        </div>
      )}

      {/* Display PR URL if task is completed or beyond */}
      {task.prUrl && task.status >= TaskStatus.Completed && (
        <div
          className="mb-5 p-4 rounded-xl"
          style={{ background: 'var(--success-bg)', border: '1px solid rgba(74, 222, 128, 0.3)' }}
        >
          <p style={labelStyle} className="mb-2">Pull Request</p>
          <a
            href={task.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm underline break-all"
            style={{ color: 'var(--success)' }}
          >
            {task.prUrl}
          </a>
        </div>
      )}

      {task.status === TaskStatus.Completed && (
        <div className="mb-5 flex space-x-6">
          <div className="flex items-center">
            <span
              className="w-3 h-3 rounded-full mr-2"
              style={{ background: task.customerApproval ? 'var(--success)' : 'var(--border-subtle)' }}
            />
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Customer Approval</span>
          </div>
          <div className="flex items-center">
            <span
              className="w-3 h-3 rounded-full mr-2"
              style={{ background: task.stakeholderApproval ? 'var(--success)' : 'var(--border-subtle)' }}
            />
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Stakeholder Approval</span>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-3 mt-5">
        {canStake && (
          <button
            onClick={() => onStake(task.id)}
            disabled={isStaking}
            className={buttonBaseClass}
            style={{
              background: isStaking ? 'var(--bg-secondary)' : 'linear-gradient(135deg, var(--warning) 0%, #f59e0b 100%)',
              color: isStaking ? 'var(--text-muted)' : 'var(--bg-primary)',
              boxShadow: isStaking ? 'none' : '0 4px 16px rgba(251, 191, 36, 0.3)',
              opacity: isStaking ? 0.6 : 1
            }}
          >
            {isStaking ? (
              <>
                <Spinner className="h-4 w-4 mr-2" />
                Staking...
              </>
            ) : (
              'Stake as Stakeholder'
            )}
          </button>
        )}

        {canClaim && (
          <button
            onClick={() => onClaim(task.id)}
            disabled={isClaiming}
            className={buttonBaseClass}
            style={{
              background: isClaiming ? 'var(--bg-secondary)' : 'linear-gradient(135deg, var(--info) 0%, #3b82f6 100%)',
              color: isClaiming ? 'var(--text-muted)' : 'var(--bg-primary)',
              boxShadow: isClaiming ? 'none' : '0 4px 16px rgba(96, 165, 250, 0.3)',
              opacity: isClaiming ? 0.6 : 1
            }}
          >
            {isClaiming ? (
              <>
                <Spinner className="h-4 w-4 mr-2" />
                Claiming...
              </>
            ) : (
              'Claim Task'
            )}
          </button>
        )}

        {canBid && (
          <button
            onClick={() => setShowBidModal(true)}
            disabled={isLoadingBid}
            className={buttonBaseClass}
            style={{
              background: isLoadingBid ? 'var(--bg-secondary)' : 'linear-gradient(135deg, var(--info) 0%, #3b82f6 100%)',
              color: isLoadingBid ? 'var(--text-muted)' : 'var(--bg-primary)',
              boxShadow: isLoadingBid ? 'none' : '0 4px 16px rgba(96, 165, 250, 0.3)',
              opacity: isLoadingBid ? 0.6 : 1
            }}
          >
            {isLoadingBid ? (
              <>
                <Spinner className="h-4 w-4 mr-2" />
                Loading...
              </>
            ) : myBid ? (
              'Update Bid'
            ) : (
              'Place Bid'
            )}
          </button>
        )}

        {canViewBids && (
          <button
            onClick={() => setShowBidSelectionModal(true)}
            className={buttonBaseClass}
            style={{
              background: bidCount > 0
                ? 'linear-gradient(135deg, var(--rose-pink) 0%, var(--rose-gold) 100%)'
                : 'var(--bg-secondary)',
              color: bidCount > 0 ? 'var(--bg-primary)' : 'var(--text-muted)',
              boxShadow: bidCount > 0 ? '0 4px 16px rgba(212, 165, 165, 0.3)' : 'none',
              opacity: bidCount > 0 ? 1 : 0.8
            }}
          >
            View Bids ({bidCount})
          </button>
        )}

        {canUnclaim && (
          <button
            onClick={() => onUnclaim(task.id)}
            disabled={isUnclaiming}
            className={buttonBaseClass}
            style={{
              background: 'transparent',
              border: '1px solid var(--border-subtle)',
              color: isUnclaiming ? 'var(--text-muted)' : 'var(--text-secondary)',
              opacity: isUnclaiming ? 0.6 : 1
            }}
            title="Release this task so another worker can claim it"
          >
            {isUnclaiming ? (
              <>
                <Spinner className="h-4 w-4 mr-2" />
                Unclaiming...
              </>
            ) : (
              'Unclaim Task'
            )}
          </button>
        )}

        {canComplete && (
          <button
            onClick={handleMarkCompleted}
            disabled={isCompleting}
            className={buttonBaseClass}
            style={{
              background: isCompleting ? 'var(--bg-secondary)' : 'linear-gradient(135deg, var(--rose-pink) 0%, var(--rose-gold) 100%)',
              color: isCompleting ? 'var(--text-muted)' : 'var(--bg-primary)',
              boxShadow: isCompleting ? 'none' : '0 4px 16px rgba(212, 165, 165, 0.3)',
              opacity: isCompleting ? 0.6 : 1
            }}
          >
            {isCompleting ? (
              <>
                <Spinner className="h-4 w-4 mr-2" />
                Marking Complete...
              </>
            ) : (
              'Mark Completed'
            )}
          </button>
        )}

        {canApproveAsCustomer && (
          <button
            onClick={() => onApprove(task.id, 'customer')}
            disabled={isApprovingCustomer}
            className={buttonBaseClass}
            style={{
              background: isApprovingCustomer ? 'var(--bg-secondary)' : 'linear-gradient(135deg, var(--success) 0%, #22c55e 100%)',
              color: isApprovingCustomer ? 'var(--text-muted)' : 'var(--bg-primary)',
              boxShadow: isApprovingCustomer ? 'none' : '0 4px 16px rgba(74, 222, 128, 0.3)',
              opacity: isApprovingCustomer ? 0.6 : 1
            }}
          >
            {isApprovingCustomer ? (
              <>
                <Spinner className="h-4 w-4 mr-2" />
                Approving...
              </>
            ) : (
              'Approve as Customer'
            )}
          </button>
        )}

        {canApproveAsStakeholder && (
          <button
            onClick={() => onApprove(task.id, 'stakeholder')}
            disabled={isApprovingStakeholder}
            className={buttonBaseClass}
            style={{
              background: isApprovingStakeholder ? 'var(--bg-secondary)' : 'linear-gradient(135deg, var(--success) 0%, #22c55e 100%)',
              color: isApprovingStakeholder ? 'var(--text-muted)' : 'var(--bg-primary)',
              boxShadow: isApprovingStakeholder ? 'none' : '0 4px 16px rgba(74, 222, 128, 0.3)',
              opacity: isApprovingStakeholder ? 0.6 : 1
            }}
          >
            {isApprovingStakeholder ? (
              <>
                <Spinner className="h-4 w-4 mr-2" />
                Approving...
              </>
            ) : (
              'Approve as Stakeholder'
            )}
          </button>
        )}

        {canAcceptPayment && (
          <button
            onClick={() => onAcceptPayment(task.id)}
            disabled={isAcceptingPayment}
            className={buttonBaseClass}
            style={{
              background: isAcceptingPayment ? 'var(--bg-secondary)' : 'linear-gradient(135deg, var(--rose-pink) 0%, var(--rose-gold) 100%)',
              color: isAcceptingPayment ? 'var(--text-muted)' : 'var(--bg-primary)',
              boxShadow: isAcceptingPayment ? 'none' : '0 4px 16px rgba(212, 165, 165, 0.3)',
              opacity: isAcceptingPayment ? 0.6 : 1
            }}
          >
            {isAcceptingPayment ? (
              <>
                <Spinner className="h-4 w-4 mr-2" />
                Accepting Payment...
              </>
            ) : (
              'Accept Payment'
            )}
          </button>
        )}

        {canUnstake && (
          <button
            onClick={() => onUnstake(task.id)}
            disabled={isUnstaking}
            className={buttonBaseClass}
            style={{
              background: isUnstaking ? 'var(--bg-secondary)' : 'linear-gradient(135deg, var(--warning) 0%, #f59e0b 100%)',
              border: '1px solid rgba(251, 191, 36, 0.3)',
              color: isUnstaking ? 'var(--text-muted)' : 'var(--bg-primary)',
              boxShadow: isUnstaking ? 'none' : '0 4px 16px rgba(251, 191, 36, 0.3)',
              opacity: isUnstaking ? 0.6 : 1
            }}
          >
            {isUnstaking ? (
              <>
                <Spinner className="h-4 w-4 mr-2" />
                Unstaking...
              </>
            ) : (
              'Unstake'
            )}
          </button>
        )}

        {canCancel && (
          <button
            onClick={() => onCancel(task.id)}
            disabled={isCancelling}
            className={buttonBaseClass}
            style={{
              background: isCancelling ? 'var(--bg-secondary)' : 'var(--error-bg)',
              border: '1px solid rgba(248, 113, 113, 0.3)',
              color: isCancelling ? 'var(--text-muted)' : 'var(--error)',
              opacity: isCancelling ? 0.6 : 1
            }}
          >
            {isCancelling ? (
              <>
                <Spinner className="h-4 w-4 mr-2" />
                Cancelling...
              </>
            ) : (
              'Cancel Task'
            )}
          </button>
        )}

        {canRaiseDispute && (
          <button
            onClick={() => setShowDisputeModal(true)}
            disabled={isDisputing}
            className={buttonBaseClass}
            style={{
              background: isDisputing ? 'var(--bg-secondary)' : 'var(--error-bg)',
              border: '1px solid rgba(248, 113, 113, 0.3)',
              color: isDisputing ? 'var(--text-muted)' : 'var(--error)',
              opacity: isDisputing ? 0.6 : 1
            }}
          >
            {isDisputing ? (
              <>
                <Spinner className="h-4 w-4 mr-2" />
                Raising Dispute...
              </>
            ) : (
              'Raise Dispute'
            )}
          </button>
        )}
      </div>

      {/* Progress Tracker - visible to all participants */}
      {isParticipant && (
        <div className="mt-6">
          <ProgressTracker task={task} />
        </div>
      )}

      {/* PR URL Modal */}
      {showPrUrlModal && (
        <div
          className="fixed inset-0 flex items-center justify-center z-50"
          style={{ background: 'rgba(0, 0, 0, 0.7)', backdropFilter: 'blur(4px)' }}
        >
          <div
            className="rounded-[20px] p-7 max-w-md w-full mx-4"
            style={{
              background: 'var(--bg-card-solid)',
              border: '1px solid var(--border-subtle)',
              boxShadow: 'var(--shadow-card)'
            }}
          >
            <h3 className="font-display text-xl font-medium mb-4" style={{ color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
              Mark Task as Completed
            </h3>
            <p className="text-sm mb-5" style={{ color: 'var(--text-secondary)' }}>
              Please provide the GitHub Pull Request URL for the completed work:
            </p>

            <div className="mb-5">
              <label style={{ ...labelStyle, display: 'block', marginBottom: '0.5rem' }}>
                GitHub PR URL *
              </label>
              <input
                type="text"
                value={prUrl}
                onChange={(e) => setPrUrl(e.target.value)}
                placeholder="https://github.com/owner/repo/pull/123"
                className="w-full px-4 py-3 rounded-xl"
                style={{
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-primary)',
                  fontSize: '0.9375rem'
                }}
              />
              {prUrlError && (
                <p className="text-xs mt-2" style={{ color: 'var(--error)' }}>{prUrlError}</p>
              )}
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowPrUrlModal(false)}
                disabled={isValidatingPr}
                className="px-5 py-2.5 text-sm font-semibold rounded-xl"
                style={{
                  background: 'transparent',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-secondary)',
                  opacity: isValidatingPr ? 0.6 : 1,
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSubmitCompletion}
                disabled={isValidatingPr}
                className="px-5 py-2.5 text-sm font-semibold rounded-xl"
                style={{
                  background: isValidatingPr
                    ? 'var(--bg-secondary)'
                    : 'linear-gradient(135deg, var(--rose-pink) 0%, var(--rose-gold) 100%)',
                  color: isValidatingPr ? 'var(--text-muted)' : 'var(--bg-primary)',
                  boxShadow: isValidatingPr ? 'none' : '0 4px 16px rgba(212, 165, 165, 0.3)',
                  opacity: isValidatingPr ? 0.6 : 1,
                }}
              >
                {isValidatingPr ? (
                  <>
                    <span className="animate-pulse inline-block mr-2">...</span>
                    Validating
                  </>
                ) : (
                  'Submit'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bid Submission Modal for auctions */}
      <BidSubmissionModal
        isOpen={showBidModal}
        onClose={() => setShowBidModal(false)}
        taskId={task.id}
        maxBudget={task.deposit?.toString()}
        existingBid={myBid}
        onBidSubmitted={handleBidSubmitted}
      />

      {/* Bid Selection Modal for customers to select winner */}
      <BidSelectionModal
        isOpen={showBidSelectionModal}
        onClose={() => setShowBidSelectionModal(false)}
        taskId={task.id}
        maxBudget={task.deposit?.toString()}
        onWinnerSelected={handleBidSubmitted}
      />

      {/* Dispute Modal */}
      <DisputeModal
        isOpen={showDisputeModal}
        onClose={() => setShowDisputeModal(false)}
        taskId={task.id}
        role={disputeRole}
        onDisputeRaised={() => {
          setShowDisputeModal(false);
          // Force a refresh - parent component should handle this
          window.location.reload();
        }}
      />
    </div>
  );
};

export default TaskCard;
