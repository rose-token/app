/**
 * ProposalDetailPage - Detailed view of a single proposal
 * Shows full description, voting interface, and proposal status
 */

import React from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAccount } from 'wagmi';
import {
  ProposalStatus,
  ProposalStatusLabels,
  ProposalStatusColors,
  formatVotePower,
} from '../constants/contracts';
import useProposals from '../hooks/useProposals';
import VotePanel from '../components/governance/VotePanel';
import QuorumBar from '../components/governance/QuorumBar';
import ReputationBadge from '../components/governance/ReputationBadge';
import ProfileBadge from '../components/profile/ProfileBadge';
import WalletNotConnected from '../components/wallet/WalletNotConnected';

const ProposalDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { address: account, isConnected } = useAccount();

  const {
    proposal,
    isLoading,
    error,
    actionLoading,
    vote,
    voteCombined,
    unvote,
    finalizeProposal,
    executeProposal,
    cancelProposal,
  } = useProposals({ proposalId: id });

  // Format date
  const formatDate = (timestamp) => {
    return new Date(timestamp * 1000).toLocaleString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Format time remaining
  const formatTimeRemaining = (seconds) => {
    if (seconds <= 0) return 'Voting ended';
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);

    if (days > 0) return `${days} day${days > 1 ? 's' : ''}, ${hours} hour${hours !== 1 ? 's' : ''} remaining`;
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''}, ${mins} min remaining`;
    return `${mins} minute${mins !== 1 ? 's' : ''} remaining`;
  };

  if (!isConnected) {
    return (
      <div className="animate-fade-in">
        <WalletNotConnected />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="animate-fade-in text-center py-12">
        <div className="animate-spin w-8 h-8 border-2 border-accent border-t-transparent rounded-full mx-auto mb-4" />
        <p style={{ color: 'var(--text-muted)' }}>Loading proposal...</p>
      </div>
    );
  }

  if (error || !proposal) {
    return (
      <div className="animate-fade-in">
        <div className="card text-center py-12" style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)' }}>
          <p className="mb-4" style={{ color: 'var(--error)' }}>
            {error || 'Proposal not found'}
          </p>
          <Link to="/governance" className="btn-secondary">
            Back to Governance
          </Link>
        </div>
      </div>
    );
  }

  const isActive = proposal.status === ProposalStatus.Active;
  const isPassed = proposal.status === ProposalStatus.Passed;
  const isExecuted = proposal.status === ProposalStatus.Executed;
  const canFinalize = isActive && proposal.isExpired;
  const canExecute = isPassed;
  const canCancel = isActive && proposal.isProposer;

  return (
    <div className="animate-fade-in">
      {/* Back Link */}
      <Link
        to="/governance"
        className="inline-flex items-center gap-1 text-sm mb-6 hover:text-accent transition-colors"
        style={{ color: 'var(--text-muted)' }}
      >
        &larr; Back to Governance
      </Link>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Header */}
          <div className="card">
            <div className="flex items-start justify-between mb-4">
              <div>
                <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  Proposal #{proposal.id}
                </span>
                <h1 className="text-2xl font-bold mt-1">{proposal.title}</h1>
              </div>
              <span
                className="px-3 py-1 rounded-full text-sm font-medium"
                style={{
                  backgroundColor: `${ProposalStatusColors[proposal.status]}20`,
                  color: ProposalStatusColors[proposal.status],
                }}
              >
                {ProposalStatusLabels[proposal.status]}
              </span>
            </div>

            {/* Proposer */}
            <div className="flex items-center gap-3 mb-4">
              <span style={{ color: 'var(--text-muted)' }}>Proposed by</span>
              <ProfileBadge address={proposal.proposer} size="sm" showAddress={true} />
            </div>

            {/* Time Info */}
            <div className="grid sm:grid-cols-2 gap-4 p-4 rounded-lg" style={{ backgroundColor: 'var(--bg-secondary)' }}>
              <div>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Created</p>
                <p className="font-medium">{formatDate(proposal.createdAt)}</p>
              </div>
              <div>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {isActive ? 'Voting Ends' : 'Voting Ended'}
                </p>
                <p className="font-medium">
                  {isActive ? formatTimeRemaining(proposal.timeRemaining) : formatDate(proposal.votingEndsAt)}
                </p>
              </div>
            </div>
          </div>

          {/* Value & Deliverables */}
          <div className="card">
            <h2 className="text-lg font-semibold mb-4">Funding Request</h2>
            <div className="grid sm:grid-cols-2 gap-4 mb-4">
              <div className="p-4 rounded-lg" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Requested Amount</p>
                <p className="text-2xl font-bold gradient-text">
                  {parseFloat(proposal.value).toLocaleString()} ROSE
                </p>
              </div>
              <div className="p-4 rounded-lg" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Deadline</p>
                <p className="text-lg font-semibold">
                  {new Date(proposal.deadline * 1000).toLocaleDateString('en-US', {
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </p>
              </div>
            </div>

            {proposal.deliverables && (
              <div>
                <h3 className="font-medium mb-2">Deliverables</h3>
                <p style={{ color: 'var(--text-secondary)' }}>{proposal.deliverables}</p>
              </div>
            )}
          </div>

          {/* Description */}
          <div className="card">
            <h2 className="text-lg font-semibold mb-4">Description</h2>
            <div
              className="prose prose-invert max-w-none"
              style={{ color: 'var(--text-secondary)' }}
            >
              {proposal.description ? (
                <div className="whitespace-pre-wrap">{proposal.description}</div>
              ) : (
                <p style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
                  No detailed description provided
                </p>
              )}
            </div>
          </div>

          {/* Vote Results */}
          <div className="card">
            <h2 className="text-lg font-semibold mb-4">Vote Results</h2>

            {/* Progress Bar */}
            <div className="mb-4">
              <div className="flex justify-between text-sm mb-2">
                <span style={{ color: 'var(--success)' }}>
                  Yay: {proposal.yayPercent.toFixed(1)}% ({formatVotePower(parseFloat(proposal.yayVotes))} votes)
                </span>
                <span style={{ color: 'var(--error)' }}>
                  {proposal.nayPercent.toFixed(1)}% ({formatVotePower(parseFloat(proposal.nayVotes))} votes) :Nay
                </span>
              </div>
              <div className="h-4 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                <div className="h-full flex">
                  <div
                    className="h-full transition-all duration-500"
                    style={{
                      width: `${proposal.yayPercent}%`,
                      backgroundColor: 'var(--success)',
                    }}
                  />
                  <div
                    className="h-full transition-all duration-500"
                    style={{
                      width: `${proposal.nayPercent}%`,
                      backgroundColor: 'var(--error)',
                    }}
                  />
                </div>
              </div>
              <p className="text-xs mt-2 text-center" style={{ color: 'var(--text-muted)' }}>
                7/12 (58.33%) required to pass
              </p>
            </div>

            {/* Quorum */}
            <QuorumBar proposalId={proposal.id} totalAllocated={proposal.totalAllocated} />
          </div>

          {/* Task Link (if executed) */}
          {isExecuted && proposal.taskId > 0 && (
            <div
              className="card"
              style={{ backgroundColor: 'rgba(16, 185, 129, 0.1)', borderColor: 'var(--success)' }}
            >
              <h3 className="font-semibold mb-2" style={{ color: 'var(--success)' }}>
                Proposal Executed
              </h3>
              <p className="text-sm mb-3">
                This proposal has been executed and created Task #{proposal.taskId}
              </p>
              <Link to="/" className="btn-primary">
                View Task in Marketplace
              </Link>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Vote Panel */}
          <VotePanel
            proposalId={proposal.id}
            hasVoted={proposal.hasVoted}
            userVote={proposal.userVote}
            isProposer={proposal.isProposer}
            isActive={isActive}
            onVote={vote}
            onVoteCombined={voteCombined}
            onUnvote={unvote}
            loading={actionLoading[`vote-${proposal.id}`] || actionLoading[`unvote-${proposal.id}`]}
          />

          {/* Admin Actions */}
          {(canFinalize || canExecute || canCancel) && (
            <div className="card">
              <h3 className="text-lg font-semibold mb-4">Actions</h3>
              <div className="space-y-3">
                {canFinalize && (
                  <button
                    onClick={() => finalizeProposal(proposal.id)}
                    disabled={actionLoading[`finalize-${proposal.id}`]}
                    className="btn-primary w-full"
                  >
                    {actionLoading[`finalize-${proposal.id}`] ? 'Finalizing...' : 'Finalize Proposal'}
                  </button>
                )}

                {canExecute && (
                  <button
                    onClick={() => executeProposal(proposal.id)}
                    disabled={actionLoading[`execute-${proposal.id}`]}
                    className="btn-primary w-full"
                    style={{ backgroundColor: 'var(--success)' }}
                  >
                    {actionLoading[`execute-${proposal.id}`] ? 'Executing...' : 'Execute Proposal'}
                  </button>
                )}

                {canCancel && (
                  <button
                    onClick={() => {
                      if (confirm('Are you sure you want to cancel this proposal?')) {
                        cancelProposal(proposal.id).then(() => navigate('/governance'));
                      }
                    }}
                    disabled={actionLoading[`cancel-${proposal.id}`]}
                    className="btn-secondary w-full"
                    style={{ borderColor: 'var(--error)', color: 'var(--error)' }}
                  >
                    {actionLoading[`cancel-${proposal.id}`] ? 'Cancelling...' : 'Cancel Proposal'}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Edit Count */}
          {proposal.editCount > 0 && (
            <div className="card">
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                This proposal has been edited {proposal.editCount} time{proposal.editCount > 1 ? 's' : ''}.
                (Max 4 edits allowed)
              </p>
            </div>
          )}

          {/* Reward Info */}
          <div className="card">
            <h3 className="text-lg font-semibold mb-3">Potential Rewards</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-muted)' }}>Worker (95%)</span>
                <span>{(parseFloat(proposal.value) * 0.95).toLocaleString()} ROSE</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-muted)' }}>Stakeholder (5%)</span>
                <span>{(parseFloat(proposal.value) * 0.05).toLocaleString()} ROSE</span>
              </div>
              <div className="pt-2 border-t" style={{ borderColor: 'var(--border-color)' }}>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  On completion: 2% to Yay voters, 1% to proposer (minted)
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProposalDetailPage;
