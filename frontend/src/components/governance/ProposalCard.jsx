/**
 * ProposalCard - Summary card for governance proposals
 * Displays proposal title, value, status, vote tally, and time remaining
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { ProposalStatus, ProposalStatusLabels, ProposalStatusColors, Track, TrackLabels, TrackColors, formatVotePower } from '../../constants/contracts';
import ProfileBadge from '../profile/ProfileBadge';
import QuorumBar from './QuorumBar';

const ProposalCard = React.memo(({ proposal, showActions = false }) => {
  const {
    id,
    title,
    proposer,
    value,
    status,
    track = Track.Slow, // Default to Slow if not set
    yayPercent,
    nayPercent,
    yayVotes,
    nayVotes,
    timeRemaining,
    isExpired,
    votingEndsAt,
    hasVoted,
    userVote,
    totalVotes,
  } = proposal;

  // Format time remaining
  const formatTimeRemaining = (seconds) => {
    if (seconds <= 0) return 'Ended';
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);

    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  };

  // Format date
  const formatDate = (timestamp) => {
    return new Date(timestamp * 1000).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const isActive = status === ProposalStatus.Active;

  return (
    <div className="card hover:border-accent/30 transition-all duration-200">
      <div className="flex justify-between items-start mb-3">
        <div className="flex-1 min-w-0">
          <Link
            to={`/governance/${id}`}
            className="text-lg font-medium hover:text-accent transition-colors line-clamp-1"
          >
            {title || `Proposal #${id}`}
          </Link>
          <div className="flex items-center gap-2 mt-1">
            <ProfileBadge address={proposer} size="sm" showAddress={false} />
            <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
              {formatDate(proposal.createdAt)}
            </span>
          </div>
        </div>

        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-1">
            {/* Track Badge */}
            <span
              className="px-2 py-0.5 rounded text-xs font-medium"
              style={{
                backgroundColor: track === Track.Fast ? 'rgba(14, 165, 233, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                color: TrackColors[track],
              }}
            >
              {TrackLabels[track]}
            </span>
            {/* Status Badge */}
            <span
              className="px-2 py-0.5 rounded text-xs font-medium"
              style={{
                backgroundColor: `${ProposalStatusColors[status]}20`,
                color: ProposalStatusColors[status],
              }}
            >
              {ProposalStatusLabels[status]}
            </span>
          </div>
          {isActive && (
            <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
              {formatTimeRemaining(timeRemaining)} left
            </span>
          )}
        </div>
      </div>

      {/* Value */}
      <div className="mb-4">
        <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Requesting</span>
        <span className="ml-2 text-lg font-semibold gradient-text">
          {parseFloat(value).toLocaleString()} ROSE
        </span>
      </div>

      {/* Vote Progress Bar */}
      <div className="mb-3">
        <div className="flex justify-between text-sm mb-1">
          <span style={{ color: 'var(--success)' }}>
            Yay {yayPercent.toFixed(1)}%
          </span>
          <span style={{ color: 'var(--error)' }}>
            {nayPercent.toFixed(1)}% Nay
          </span>
        </div>
        <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
          <div className="h-full flex">
            <div
              className="h-full transition-colors duration-300"
              style={{
                width: `${yayPercent}%`,
                backgroundColor: 'var(--success)',
              }}
            />
            <div
              className="h-full transition-colors duration-300"
              style={{
                width: `${nayPercent}%`,
                backgroundColor: 'var(--error)',
              }}
            />
          </div>
        </div>
        <div className="flex justify-between text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
          <span>{formatVotePower(parseFloat(yayVotes))} votes</span>
          <span>{formatVotePower(parseFloat(nayVotes))} votes</span>
        </div>
      </div>

      {/* Quorum Progress */}
      <QuorumBar track={track} totalVotes={totalVotes} compact />

      {/* User's Vote Status */}
      {hasVoted && userVote && (
        <div
          className="mt-3 p-2 rounded text-sm"
          style={{
            backgroundColor: userVote.support ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
            color: userVote.support ? 'var(--success)' : 'var(--error)',
          }}
        >
          You voted {userVote.support ? 'Yay' : 'Nay'} with {formatVotePower(parseFloat(userVote.votePower))} power
        </div>
      )}

      {/* View Details Link */}
      <div className="mt-4 pt-3 border-t" style={{ borderColor: 'var(--border-color)' }}>
        <Link
          to={`/governance/${id}`}
          className="btn-secondary text-sm w-full"
        >
          View Details &rarr;
        </Link>
      </div>
    </div>
  );
});

ProposalCard.displayName = 'ProposalCard';

export default ProposalCard;
