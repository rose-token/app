/**
 * VotePanel - Voting interface for proposals
 * Allows users to vote Yay/Nay with a specified amount of ROSE
 */

import React, { useState } from 'react';
import { formatVotePower, calculateVotePower } from '../../constants/contracts';
import useGovernance from '../../hooks/useGovernance';

const VotePanel = ({
  proposalId,
  hasVoted,
  userVote,
  isProposer,
  isActive,
  onVote,
  onUnvote,
  loading = false,
}) => {
  const { unallocatedRose, reputationRaw, canVote } = useGovernance();
  const [amount, setAmount] = useState('');
  const [voteType, setVoteType] = useState(null); // 'yay' or 'nay'

  // Calculate preview vote power
  const previewVotePower = amount
    ? calculateVotePower(parseFloat(amount) * 1e18, reputationRaw || 6000)
    : 0;

  const handleVote = async () => {
    if (!amount || parseFloat(amount) <= 0) return;
    try {
      await onVote(proposalId, amount, voteType === 'yay');
      setAmount('');
      setVoteType(null);
    } catch (err) {
      console.error('Vote failed:', err);
    }
  };

  const handleUnvote = async () => {
    try {
      await onUnvote(proposalId);
    } catch (err) {
      console.error('Unvote failed:', err);
    }
  };

  const handleMax = () => {
    setAmount(unallocatedRose || '0');
  };

  // Already voted - show status and unvote option
  if (hasVoted && userVote) {
    return (
      <div className="card">
        <h3 className="text-lg font-semibold mb-3">Your Vote</h3>
        <div
          className="p-4 rounded-lg mb-4"
          style={{
            backgroundColor: userVote.support ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
          }}
        >
          <div className="flex items-center justify-between">
            <div>
              <span
                className="text-lg font-semibold"
                style={{ color: userVote.support ? 'var(--success)' : 'var(--error)' }}
              >
                {userVote.support ? 'Yay' : 'Nay'}
              </span>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                {parseFloat(userVote.allocatedAmount).toLocaleString()} ROSE allocated
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Vote Power</p>
              <p className="font-semibold">{formatVotePower(parseFloat(userVote.votePower))}</p>
            </div>
          </div>
        </div>

        {isActive && (
          <button
            onClick={handleUnvote}
            disabled={loading}
            className="btn-secondary w-full"
            style={{ opacity: loading ? 0.5 : 1 }}
          >
            {loading ? 'Processing...' : 'Unallocate Vote'}
          </button>
        )}
      </div>
    );
  }

  // Cannot vote - show reason
  if (isProposer) {
    return (
      <div className="card">
        <h3 className="text-lg font-semibold mb-3">Vote on Proposal</h3>
        <div className="p-4 rounded-lg text-center" style={{ backgroundColor: 'var(--bg-secondary)' }}>
          <p style={{ color: 'var(--text-muted)' }}>
            You cannot vote on your own proposal
          </p>
        </div>
      </div>
    );
  }

  if (!isActive) {
    return (
      <div className="card">
        <h3 className="text-lg font-semibold mb-3">Voting</h3>
        <div className="p-4 rounded-lg text-center" style={{ backgroundColor: 'var(--bg-secondary)' }}>
          <p style={{ color: 'var(--text-muted)' }}>
            Voting period has ended
          </p>
        </div>
      </div>
    );
  }

  if (!canVote) {
    return (
      <div className="card">
        <h3 className="text-lg font-semibold mb-3">Vote on Proposal</h3>
        <div className="p-4 rounded-lg text-center" style={{ backgroundColor: 'var(--bg-secondary)' }}>
          <p style={{ color: 'var(--text-muted)' }}>
            You need staked ROSE and 70%+ reputation to vote
          </p>
        </div>
      </div>
    );
  }

  // Voting interface
  return (
    <div className="card">
      <h3 className="text-lg font-semibold mb-3">Vote on Proposal</h3>

      {/* Amount Input */}
      <div className="mb-4">
        <label className="block text-sm mb-1" style={{ color: 'var(--text-muted)' }}>
          Amount to Allocate
        </label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              min="0"
              step="0.01"
              className="w-full px-3 py-2 rounded-lg"
              style={{
                backgroundColor: 'var(--bg-tertiary)',
                border: '1px solid var(--border-color)',
              }}
            />
            <span
              className="absolute right-3 top-1/2 -translate-y-1/2 text-sm"
              style={{ color: 'var(--text-muted)' }}
            >
              ROSE
            </span>
          </div>
          <button
            onClick={handleMax}
            className="px-3 py-2 rounded-lg text-sm font-medium"
            style={{
              backgroundColor: 'var(--bg-tertiary)',
              border: '1px solid var(--border-color)',
            }}
          >
            Max
          </button>
        </div>
        <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
          Available: {parseFloat(unallocatedRose || 0).toLocaleString()} ROSE
        </p>
      </div>

      {/* Vote Power Preview */}
      {amount && parseFloat(amount) > 0 && (
        <div
          className="p-3 rounded-lg mb-4 text-sm"
          style={{ backgroundColor: 'var(--bg-secondary)' }}
        >
          <div className="flex justify-between">
            <span style={{ color: 'var(--text-muted)' }}>Your vote power:</span>
            <span className="font-semibold">{formatVotePower(previewVotePower)}</span>
          </div>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            sqrt({amount} ROSE) x {((reputationRaw || 6000) / 100).toFixed(0)}% reputation
          </p>
        </div>
      )}

      {/* Vote Buttons */}
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => {
            setVoteType('yay');
            handleVote();
          }}
          disabled={loading || !amount || parseFloat(amount) <= 0}
          className="py-3 px-4 rounded-lg font-semibold transition-all"
          style={{
            backgroundColor: voteType === 'yay' ? 'var(--success)' : 'rgba(16, 185, 129, 0.1)',
            color: voteType === 'yay' ? 'white' : 'var(--success)',
            border: '2px solid var(--success)',
            opacity: loading || !amount || parseFloat(amount) <= 0 ? 0.5 : 1,
          }}
        >
          {loading && voteType === 'yay' ? 'Voting...' : 'Vote Yay'}
        </button>
        <button
          onClick={() => {
            setVoteType('nay');
            handleVote();
          }}
          disabled={loading || !amount || parseFloat(amount) <= 0}
          className="py-3 px-4 rounded-lg font-semibold transition-all"
          style={{
            backgroundColor: voteType === 'nay' ? 'var(--error)' : 'rgba(239, 68, 68, 0.1)',
            color: voteType === 'nay' ? 'white' : 'var(--error)',
            border: '2px solid var(--error)',
            opacity: loading || !amount || parseFloat(amount) <= 0 ? 0.5 : 1,
          }}
        >
          {loading && voteType === 'nay' ? 'Voting...' : 'Vote Nay'}
        </button>
      </div>
    </div>
  );
};

export default VotePanel;
