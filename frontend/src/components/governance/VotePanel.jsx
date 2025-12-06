/**
 * VotePanel - Combined voting interface for proposals
 * Allows users to vote with own VP + delegated VP (if delegate)
 *
 * VP-centric model: Users input VP directly (not ROSE)
 * VP can only be locked to ONE proposal at a time
 * VP unlocks only after proposal resolves via freeVP()
 */

import React, { useState, useMemo } from 'react';
import { formatVotePower } from '../../constants/contracts';
import useGovernance from '../../hooks/useGovernance';
import useDelegation from '../../hooks/useDelegation';

const VotePanel = ({
  proposalId,
  hasVoted,
  userVote,
  isProposer,
  isActive,
  onVote,
  onVoteCombined,
  onFreeVP,
  loading = false,
}) => {
  const {
    availableVP,
    votingPower,
    proposalVPLocked,
    activeProposal,
    canVote,
  } = useGovernance();

  const {
    totalReceivedVP,
    castDelegatedVote,
  } = useDelegation();

  const [amount, setAmount] = useState('');
  const [voteType, setVoteType] = useState(null);
  const [showAddMore, setShowAddMore] = useState(false);

  // Parse VP values from strings
  const availableOwnVP = parseFloat(availableVP || '0');
  const ownVotingPower = parseFloat(votingPower || '0');
  const lockedVP = parseFloat(proposalVPLocked || '0');
  const receivedVP = parseFloat(totalReceivedVP || '0');

  // Check if VP is locked to a different proposal
  const vpLockedElsewhere = activeProposal && activeProposal !== 0 && activeProposal !== proposalId;

  // Calculate total available voting power
  const totalAvailable = useMemo(() => {
    // If VP is locked to another proposal, own VP is 0 available
    const ownVP = vpLockedElsewhere ? 0 : availableOwnVP;
    // Received VP (as delegate) is always available per-proposal
    const delegatedVP = receivedVP;
    return {
      ownVP,
      delegatedVP,
      totalVP: ownVP + delegatedVP,
    };
  }, [availableOwnVP, receivedVP, vpLockedElsewhere]);

  // Calculate how input VP splits between own and delegated
  const amountSplit = useMemo(() => {
    const inputVP = parseFloat(amount || '0');
    if (inputVP <= 0) {
      return { ownVP: 0, delegatedVP: 0, totalVP: 0, isValid: true, exceedsAvailable: false };
    }

    // Use own VP first, then delegated VP
    const ownVPToUse = Math.min(inputVP, totalAvailable.ownVP);
    const remainingVP = Math.max(0, inputVP - ownVPToUse);
    const delegatedVPToUse = Math.min(remainingVP, totalAvailable.delegatedVP);
    const totalVPUsed = ownVPToUse + delegatedVPToUse;

    return {
      ownVP: ownVPToUse,
      delegatedVP: delegatedVPToUse,
      totalVP: totalVPUsed,
      isValid: totalVPUsed <= totalAvailable.totalVP + 0.001,
      exceedsAvailable: inputVP > totalAvailable.totalVP + 0.001,
    };
  }, [amount, totalAvailable]);

  // Determine existing vote direction
  const existingVoteDirection = useMemo(() => {
    if (hasVoted && userVote) return userVote.support;
    return null;
  }, [hasVoted, userVote]);

  // Handle combined vote (own VP + delegated VP)
  const handleVote = async (support) => {
    if (!amount || parseFloat(amount) <= 0) return;
    if (!amountSplit.isValid) return;

    // Check direction consistency if already voted
    if (existingVoteDirection !== null && existingVoteDirection !== support) {
      console.error('Cannot change vote direction');
      return;
    }

    try {
      setVoteType(support ? 'yay' : 'nay');

      if (onVoteCombined && (amountSplit.ownVP > 0 || amountSplit.delegatedVP > 0)) {
        // Pass totalVP + available amounts (hook will split internally)
        await onVoteCombined(
          proposalId,
          amountSplit.totalVP.toString(),
          support,
          totalAvailable.ownVP.toString(),
          totalAvailable.delegatedVP.toString()
        );
      } else if (onVote && amountSplit.ownVP > 0) {
        // Own vote only
        await onVote(proposalId, amountSplit.ownVP.toString(), support);
      }

      setAmount('');
      setVoteType(null);
    } catch (err) {
      console.error('Vote failed:', err);
      setVoteType(null);
    }
  };

  const handleFreeVP = async () => {
    try {
      if (onFreeVP) {
        await onFreeVP(proposalId);
      }
    } catch (err) {
      console.error('Free VP failed:', err);
    }
  };

  const handleMax = () => {
    setAmount(totalAvailable.totalVP.toFixed(2));
  };

  // Handle adding more to existing vote
  const handleAddMore = async () => {
    if (!amount || parseFloat(amount) <= 0) return;
    if (existingVoteDirection === null) return;

    try {
      if (onVoteCombined) {
        await onVoteCombined(
          proposalId,
          amountSplit.totalVP.toString(),
          existingVoteDirection,
          totalAvailable.ownVP.toString(),
          totalAvailable.delegatedVP.toString()
        );
      } else if (onVote && amountSplit.ownVP > 0) {
        await onVote(proposalId, amountSplit.ownVP.toString(), existingVoteDirection);
      }
      setAmount('');
      setShowAddMore(false);
    } catch (err) {
      console.error('Add vote failed:', err);
    }
  };

  // Already voted - show status and option to add more (if active) or free VP (if resolved)
  if (hasVoted) {
    return (
      <div className="card">
        <h3 className="text-lg font-semibold mb-3">Your Vote</h3>

        {/* Vote Summary */}
        <div
          className="p-4 rounded-lg mb-4"
          style={{
            backgroundColor: existingVoteDirection
              ? 'rgba(16, 185, 129, 0.1)'
              : 'rgba(239, 68, 68, 0.1)',
          }}
        >
          <div className="flex items-center justify-between mb-2">
            <span
              className="text-lg font-semibold"
              style={{ color: existingVoteDirection ? 'var(--success)' : 'var(--error)' }}
            >
              {existingVoteDirection ? 'Yay' : 'Nay'}
            </span>
          </div>

          {/* Own vote details */}
          {userVote && (
            <div className="flex justify-between text-sm mb-1">
              <span style={{ color: 'var(--text-muted)' }}>Vote Power:</span>
              <span>{formatVotePower(parseFloat(userVote.votePower || '0'))} VP</span>
            </div>
          )}

          {/* VP locked info */}
          {lockedVP > 0 && (
            <div className="flex justify-between text-sm mt-2 pt-2 border-t" style={{ borderColor: 'var(--border-color)' }}>
              <span style={{ color: 'var(--text-muted)' }}>VP Locked:</span>
              <span className="font-semibold">{formatVotePower(lockedVP)} VP</span>
            </div>
          )}
        </div>

        {/* Add More Section (if active and has available VP) */}
        {isActive && totalAvailable.totalVP > 0 && !showAddMore && (
          <button
            onClick={() => setShowAddMore(true)}
            disabled={loading}
            className="btn-primary w-full"
            style={{ opacity: loading ? 0.5 : 1 }}
          >
            Add More VP
          </button>
        )}

        {/* Free VP Button (if proposal resolved) */}
        {!isActive && lockedVP > 0 && (
          <button
            onClick={handleFreeVP}
            disabled={loading}
            className="btn-secondary w-full"
            style={{ opacity: loading ? 0.5 : 1 }}
          >
            {loading ? 'Freeing...' : 'Free VP'}
          </button>
        )}

        {/* Add More Form */}
        {isActive && showAddMore && (
          <div className="mt-4 p-4 rounded-lg" style={{ backgroundColor: 'var(--bg-secondary)' }}>
            <p className="text-sm mb-2" style={{ color: 'var(--text-muted)' }}>
              Add more to your {existingVoteDirection ? 'Yay' : 'Nay'} vote:
            </p>

            {/* Available Power Summary */}
            <div className="text-xs mb-3 p-2 rounded" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
              {totalAvailable.ownVP > 0 && (
                <div className="flex justify-between">
                  <span style={{ color: 'var(--text-muted)' }}>Own VP:</span>
                  <span>{formatVotePower(totalAvailable.ownVP)} VP</span>
                </div>
              )}
              {totalAvailable.delegatedVP > 0 && (
                <div className="flex justify-between">
                  <span style={{ color: 'var(--text-muted)' }}>Received VP:</span>
                  <span>{formatVotePower(totalAvailable.delegatedVP)} VP</span>
                </div>
              )}
              <div className="flex justify-between font-semibold mt-1 pt-1 border-t" style={{ borderColor: 'var(--border-color)' }}>
                <span>Total:</span>
                <span>{formatVotePower(totalAvailable.totalVP)} VP</span>
              </div>
            </div>

            <div className="flex gap-2 mb-2">
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                min="0"
                step="0.01"
                className="flex-1 px-3 py-2 rounded-lg"
                style={{
                  backgroundColor: 'var(--bg-tertiary)',
                  border: `1px solid ${amountSplit.exceedsAvailable ? 'var(--error)' : 'var(--border-color)'}`,
                }}
              />
              <button
                onClick={handleMax}
                className="px-3 py-2 rounded-lg text-sm"
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)' }}
              >
                Max
              </button>
            </div>

            {/* Split Preview */}
            {amount && parseFloat(amount) > 0 && (
              <div className="text-xs mb-3 p-2 rounded" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                <p className="font-semibold mb-1">Will use:</p>
                {amountSplit.ownVP > 0 && (
                  <div className="flex justify-between">
                    <span style={{ color: 'var(--text-muted)' }}>Own VP:</span>
                    <span>{formatVotePower(amountSplit.ownVP)} VP</span>
                  </div>
                )}
                {amountSplit.delegatedVP > 0 && (
                  <div className="flex justify-between">
                    <span style={{ color: 'var(--text-muted)' }}>Received VP:</span>
                    <span>{formatVotePower(amountSplit.delegatedVP)} VP</span>
                  </div>
                )}
                <div className="flex justify-between font-semibold mt-1 pt-1 border-t" style={{ borderColor: 'var(--border-color)' }}>
                  <span>Total VP:</span>
                  <span>{formatVotePower(amountSplit.totalVP)}</span>
                </div>
                {amountSplit.exceedsAvailable && (
                  <p className="mt-1" style={{ color: 'var(--error)' }}>
                    Exceeds available voting power
                  </p>
                )}
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={handleAddMore}
                disabled={loading || !amount || parseFloat(amount) <= 0 || amountSplit.exceedsAvailable}
                className="btn-primary flex-1"
                style={{
                  backgroundColor: existingVoteDirection ? 'var(--success)' : 'var(--error)',
                  opacity: loading || !amount || parseFloat(amount) <= 0 || amountSplit.exceedsAvailable ? 0.5 : 1,
                }}
              >
                {loading ? 'Adding...' : `Add ${existingVoteDirection ? 'Yay' : 'Nay'}`}
              </button>
              <button
                onClick={() => { setShowAddMore(false); setAmount(''); }}
                className="btn-secondary"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Info about VP lock */}
        {isActive && totalAvailable.totalVP === 0 && (
          <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>
            All your VP is locked to this proposal. You can free it after the proposal resolves.
          </p>
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

  // VP locked to another proposal warning
  if (vpLockedElsewhere) {
    return (
      <div className="card">
        <h3 className="text-lg font-semibold mb-3">Vote on Proposal</h3>
        <div
          className="p-4 rounded-lg mb-4"
          style={{ backgroundColor: 'rgba(245, 158, 11, 0.1)', color: 'var(--warning)' }}
        >
          <p className="font-medium mb-2">VP Locked to Another Proposal</p>
          <p className="text-sm">
            Your {formatVotePower(lockedVP)} VP is locked to proposal #{activeProposal}.
            VP can only be on ONE proposal at a time. Free it after that proposal resolves.
          </p>
        </div>

        {/* Still allow voting with received VP if user is a delegate */}
        {totalAvailable.delegatedVP > 0 && (
          <div>
            <p className="text-sm mb-3" style={{ color: 'var(--text-muted)' }}>
              You can still vote with VP delegated to you:
            </p>
            <div className="mb-3 p-3 rounded-lg" style={{ backgroundColor: 'var(--bg-secondary)' }}>
              <div className="flex justify-between text-sm">
                <span style={{ color: 'var(--text-muted)' }}>Received VP:</span>
                <span>{formatVotePower(totalAvailable.delegatedVP)} VP</span>
              </div>
            </div>

            <div className="flex gap-2 mb-3">
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                min="0"
                max={totalAvailable.delegatedVP}
                step="0.01"
                className="flex-1 px-3 py-2 rounded-lg"
                style={{
                  backgroundColor: 'var(--bg-tertiary)',
                  border: `1px solid ${amountSplit.exceedsAvailable ? 'var(--error)' : 'var(--border-color)'}`,
                }}
              />
              <button
                onClick={() => setAmount(totalAvailable.delegatedVP.toFixed(2))}
                className="px-3 py-2 rounded-lg text-sm"
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)' }}
              >
                Max
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => handleVote(true)}
                disabled={loading || !amount || parseFloat(amount) <= 0 || amountSplit.exceedsAvailable}
                className="py-3 px-4 rounded-lg font-semibold transition-all"
                style={{
                  backgroundColor: voteType === 'yay' ? 'var(--success)' : 'rgba(16, 185, 129, 0.1)',
                  color: voteType === 'yay' ? 'white' : 'var(--success)',
                  border: '2px solid var(--success)',
                  opacity: loading || !amount || parseFloat(amount) <= 0 || amountSplit.exceedsAvailable ? 0.5 : 1,
                }}
              >
                {loading && voteType === 'yay' ? 'Voting...' : 'Vote Yay'}
              </button>
              <button
                onClick={() => handleVote(false)}
                disabled={loading || !amount || parseFloat(amount) <= 0 || amountSplit.exceedsAvailable}
                className="py-3 px-4 rounded-lg font-semibold transition-all"
                style={{
                  backgroundColor: voteType === 'nay' ? 'var(--error)' : 'rgba(239, 68, 68, 0.1)',
                  color: voteType === 'nay' ? 'white' : 'var(--error)',
                  border: '2px solid var(--error)',
                  opacity: loading || !amount || parseFloat(amount) <= 0 || amountSplit.exceedsAvailable ? 0.5 : 1,
                }}
              >
                {loading && voteType === 'nay' ? 'Voting...' : 'Vote Nay'}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (!canVote && totalAvailable.delegatedVP === 0) {
    return (
      <div className="card">
        <h3 className="text-lg font-semibold mb-3">Vote on Proposal</h3>
        <div className="p-4 rounded-lg text-center" style={{ backgroundColor: 'var(--bg-secondary)' }}>
          <p style={{ color: 'var(--text-muted)' }}>
            You need staked ROSE and 70%+ reputation to vote with your own VP.
          </p>
        </div>
      </div>
    );
  }

  if (totalAvailable.totalVP === 0) {
    return (
      <div className="card">
        <h3 className="text-lg font-semibold mb-3">Vote on Proposal</h3>
        <div className="p-4 rounded-lg text-center" style={{ backgroundColor: 'var(--bg-secondary)' }}>
          <p style={{ color: 'var(--text-muted)' }}>
            No VP available. Deposit ROSE in governance to gain voting power.
          </p>
        </div>
      </div>
    );
  }

  // Main voting interface
  return (
    <div className="card">
      <h3 className="text-lg font-semibold mb-3">Vote on Proposal</h3>

      {/* Available Power Summary */}
      <div className="mb-4 p-3 rounded-lg" style={{ backgroundColor: 'var(--bg-secondary)' }}>
        <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>
          Available Voting Power
        </p>
        {totalAvailable.ownVP > 0 && (
          <div className="flex justify-between text-sm">
            <span style={{ color: 'var(--text-muted)' }}>Your VP:</span>
            <span>{formatVotePower(totalAvailable.ownVP)} VP</span>
          </div>
        )}
        {totalAvailable.delegatedVP > 0 && (
          <div className="flex justify-between text-sm">
            <span style={{ color: 'var(--text-muted)' }}>Received (as delegate):</span>
            <span>{formatVotePower(totalAvailable.delegatedVP)} VP</span>
          </div>
        )}
        <div className="flex justify-between font-semibold text-sm mt-1 pt-1 border-t" style={{ borderColor: 'var(--border-color)' }}>
          <span>Total VP:</span>
          <span>{formatVotePower(totalAvailable.totalVP)} VP</span>
        </div>
      </div>

      {/* Amount Input */}
      <div className="mb-4">
        <label className="block text-sm mb-1" style={{ color: 'var(--text-muted)' }}>
          VP Amount to Vote With
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
                border: `1px solid ${amountSplit.exceedsAvailable ? 'var(--error)' : 'var(--border-color)'}`,
              }}
            />
            <span
              className="absolute right-3 top-1/2 -translate-y-1/2 text-sm"
              style={{ color: 'var(--text-muted)' }}
            >
              VP
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
      </div>

      {/* Split Preview */}
      {amount && parseFloat(amount) > 0 && (
        <div
          className="p-3 rounded-lg mb-4 text-sm"
          style={{ backgroundColor: 'var(--bg-secondary)' }}
        >
          <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>
            Vote will use:
          </p>
          {amountSplit.ownVP > 0 && (
            <div className="flex justify-between">
              <span style={{ color: 'var(--text-muted)' }}>Your VP:</span>
              <span>{formatVotePower(amountSplit.ownVP)} VP</span>
            </div>
          )}
          {amountSplit.delegatedVP > 0 && (
            <div className="flex justify-between">
              <span style={{ color: 'var(--text-muted)' }}>Received VP:</span>
              <span>{formatVotePower(amountSplit.delegatedVP)} VP</span>
            </div>
          )}
          <div className="flex justify-between mt-2 pt-2 border-t" style={{ borderColor: 'var(--border-color)' }}>
            <span style={{ color: 'var(--text-muted)' }}>Total:</span>
            <span className="font-semibold">{formatVotePower(amountSplit.totalVP)} VP</span>
          </div>
          {amountSplit.exceedsAvailable && (
            <p className="text-xs mt-2" style={{ color: 'var(--error)' }}>
              Amount exceeds available voting power
            </p>
          )}
        </div>
      )}

      {/* Vote Buttons */}
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => handleVote(true)}
          disabled={loading || !amount || parseFloat(amount) <= 0 || amountSplit.exceedsAvailable}
          className="py-3 px-4 rounded-lg font-semibold transition-all"
          style={{
            backgroundColor: voteType === 'yay' ? 'var(--success)' : 'rgba(16, 185, 129, 0.1)',
            color: voteType === 'yay' ? 'white' : 'var(--success)',
            border: '2px solid var(--success)',
            opacity: loading || !amount || parseFloat(amount) <= 0 || amountSplit.exceedsAvailable ? 0.5 : 1,
          }}
        >
          {loading && voteType === 'yay' ? 'Voting...' : 'Vote Yay'}
        </button>
        <button
          onClick={() => handleVote(false)}
          disabled={loading || !amount || parseFloat(amount) <= 0 || amountSplit.exceedsAvailable}
          className="py-3 px-4 rounded-lg font-semibold transition-all"
          style={{
            backgroundColor: voteType === 'nay' ? 'var(--error)' : 'rgba(239, 68, 68, 0.1)',
            color: voteType === 'nay' ? 'white' : 'var(--error)',
            border: '2px solid var(--error)',
            opacity: loading || !amount || parseFloat(amount) <= 0 || amountSplit.exceedsAvailable ? 0.5 : 1,
          }}
        >
          {loading && voteType === 'nay' ? 'Voting...' : 'Vote Nay'}
        </button>
      </div>

      {/* Info Box */}
      <div className="mt-4 p-3 rounded-lg text-xs" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-muted)' }}>
        <strong>Note:</strong> Your VP will be locked to this proposal until it resolves.
        VP can only be on ONE proposal at a time.
      </div>
    </div>
  );
};

export default VotePanel;
