/**
 * VotePanel - Combined voting interface for proposals
 * Allows users to vote with own ROSE + delegated power in a single UI
 * Auto-splits amounts: own ROSE first, then delegated power
 */

import React, { useState, useMemo } from 'react';
import { formatVotePower, calculateVotePower } from '../../constants/contracts';
import useGovernance from '../../hooks/useGovernance';
import { useDelegationForProposal } from '../../hooks/useDelegation';

const VotePanel = ({
  proposalId,
  hasVoted,
  userVote,
  isProposer,
  isActive,
  onVote,
  onVoteCombined,
  onUnvote,
  loading = false,
}) => {
  const { unallocatedRose, reputationRaw, canVote, totalDelegatedPower } = useGovernance();
  const {
    availableDelegatedPower,
    delegatedVoteRecord,
    hasDelegatedVote,
  } = useDelegationForProposal(proposalId);

  const [amount, setAmount] = useState('');
  const [voteType, setVoteType] = useState(null);
  const [showAddMore, setShowAddMore] = useState(false);

  // Calculate total available voting power (all in VP units)
  const totalAvailable = useMemo(() => {
    // Convert own ROSE to VP using quadratic formula
    const ownRose = parseFloat(unallocatedRose || 0);
    const ownVP = calculateVotePower(ownRose * 1e18, reputationRaw || 6000);
    // Delegated power is already in VP units
    const delegatedVP = parseFloat(availableDelegatedPower || 0);
    return {
      ownRose,      // Keep ROSE for display
      ownVP,        // VP for calculations
      delegatedVP,  // Already VP
      totalVP: ownVP + delegatedVP,  // VP + VP = valid
    };
  }, [unallocatedRose, availableDelegatedPower, reputationRaw]);

  // Calculate how input amount splits between own ROSE and delegated VP
  const amountSplit = useMemo(() => {
    const inputAmount = parseFloat(amount || 0);
    if (inputAmount <= 0) return { ownRose: 0, ownVP: 0, delegatedVP: 0, totalVP: 0, isValid: true };

    // User input is ROSE for own stake, then VP for delegated
    const ownRoseToUse = Math.min(inputAmount, totalAvailable.ownRose);
    const ownVPFromInput = calculateVotePower(ownRoseToUse * 1e18, reputationRaw || 6000);

    // Remaining input goes to delegated (in VP units directly)
    const remainingInput = Math.max(0, inputAmount - ownRoseToUse);
    const delegatedVPToUse = Math.min(remainingInput, totalAvailable.delegatedVP);

    const totalVPUsed = ownVPFromInput + delegatedVPToUse;

    return {
      ownRose: ownRoseToUse,
      ownVP: ownVPFromInput,
      delegatedVP: delegatedVPToUse,
      totalVP: totalVPUsed,
      isValid: totalVPUsed <= totalAvailable.totalVP + 0.001, // Small epsilon for float comparison
      exceedsAvailable: totalVPUsed > totalAvailable.totalVP + 0.001,
    };
  }, [amount, totalAvailable, reputationRaw]);

  // Preview vote power is now directly from amountSplit (already calculated)
  const previewVotePower = useMemo(() => {
    return {
      own: amountSplit.ownVP,
      delegated: amountSplit.delegatedVP,
      total: amountSplit.totalVP,
    };
  }, [amountSplit]);

  // Determine existing vote direction (for add-more validation)
  const existingVoteDirection = useMemo(() => {
    if (hasVoted && userVote) return userVote.support;
    if (hasDelegatedVote && delegatedVoteRecord) return delegatedVoteRecord.support;
    return null;
  }, [hasVoted, userVote, hasDelegatedVote, delegatedVoteRecord]);

  // Handle combined vote
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
      if (onVoteCombined) {
        await onVoteCombined(
          proposalId,
          amount,
          support,
          totalAvailable.ownRose.toString(),
          totalAvailable.delegatedVP.toString()
        );
      } else {
        // Fallback to regular vote if combined not available
        await onVote(proposalId, amount, support);
      }
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
    // Max is own ROSE + delegated VP (user enters ROSE first, then VP overflows to delegated)
    setAmount((totalAvailable.ownRose + totalAvailable.delegatedVP).toString());
  };

  // Handle adding more to existing vote
  const handleAddMore = async () => {
    if (!amount || parseFloat(amount) <= 0) return;
    if (existingVoteDirection === null) return;

    try {
      if (onVoteCombined) {
        await onVoteCombined(
          proposalId,
          amount,
          existingVoteDirection,
          totalAvailable.ownRose.toString(),
          totalAvailable.delegatedVP.toString()
        );
      } else {
        await onVote(proposalId, amount, existingVoteDirection);
      }
      setAmount('');
      setShowAddMore(false);
    } catch (err) {
      console.error('Add vote failed:', err);
    }
  };

  // Already voted - show combined status and option to add more
  if (hasVoted || hasDelegatedVote) {
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
          {hasVoted && userVote && (
            <div className="flex justify-between text-sm mb-1">
              <span style={{ color: 'var(--text-muted)' }}>Own ROSE:</span>
              <span>{parseFloat(userVote.allocatedAmount).toLocaleString()} ROSE ({formatVotePower(parseFloat(userVote.votePower))} VP)</span>
            </div>
          )}

          {/* Delegated vote details */}
          {hasDelegatedVote && delegatedVoteRecord && (
            <div className="flex justify-between text-sm mb-1">
              <span style={{ color: 'var(--text-muted)' }}>Delegated Power:</span>
              <span>{parseFloat(delegatedVoteRecord.totalPowerUsed).toLocaleString()} VP</span>
            </div>
          )}

          {/* Combined vote power */}
          <div className="flex justify-between text-sm mt-2 pt-2 border-t" style={{ borderColor: 'var(--border-color)' }}>
            <span style={{ color: 'var(--text-muted)' }}>Total Vote Power:</span>
            <span className="font-semibold">
              {formatVotePower(
                (hasVoted ? parseFloat(userVote?.votePower || 0) : 0) +
                (hasDelegatedVote ? parseFloat(delegatedVoteRecord?.totalPowerUsed || 0) : 0)
              )}
            </span>
          </div>
        </div>

        {/* Add More Section */}
        {isActive && totalAvailable.totalVP > 0 && !showAddMore && (
          <div className="flex gap-2">
            <button
              onClick={() => setShowAddMore(true)}
              disabled={loading}
              className="btn-primary flex-1"
              style={{ opacity: loading ? 0.5 : 1 }}
            >
              Add More
            </button>
            {hasVoted && (
              <button
                onClick={handleUnvote}
                disabled={loading}
                className="btn-secondary flex-1"
                style={{ opacity: loading ? 0.5 : 1 }}
              >
                {loading ? 'Processing...' : 'Unallocate'}
              </button>
            )}
          </div>
        )}

        {/* Add More Form */}
        {isActive && showAddMore && (
          <div className="mt-4 p-4 rounded-lg" style={{ backgroundColor: 'var(--bg-secondary)' }}>
            <p className="text-sm mb-2" style={{ color: 'var(--text-muted)' }}>
              Add more to your {existingVoteDirection ? 'Yay' : 'Nay'} vote:
            </p>

            {/* Available Power Summary */}
            <div className="text-xs mb-3 p-2 rounded" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
              {totalAvailable.ownRose > 0 && (
                <div className="flex justify-between">
                  <span style={{ color: 'var(--text-muted)' }}>Own ROSE:</span>
                  <span>{totalAvailable.ownRose.toLocaleString()} → {formatVotePower(totalAvailable.ownVP)} VP</span>
                </div>
              )}
              {totalAvailable.delegatedVP > 0 && (
                <div className="flex justify-between">
                  <span style={{ color: 'var(--text-muted)' }}>Delegated:</span>
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
                {amountSplit.ownRose > 0 && (
                  <div className="flex justify-between">
                    <span style={{ color: 'var(--text-muted)' }}>Own ROSE:</span>
                    <span>{amountSplit.ownRose.toLocaleString()} → {formatVotePower(amountSplit.ownVP)} VP</span>
                  </div>
                )}
                {amountSplit.delegatedVP > 0 && (
                  <div className="flex justify-between">
                    <span style={{ color: 'var(--text-muted)' }}>Delegated:</span>
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
                {loading ? 'Adding...' : `Add ${existingVoteDirection ? 'Yay' : 'Nay'} Vote`}
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

  if (!canVote && totalAvailable.delegatedVP === 0) {
    return (
      <div className="card">
        <h3 className="text-lg font-semibold mb-3">Vote on Proposal</h3>
        <div className="p-4 rounded-lg text-center" style={{ backgroundColor: 'var(--bg-secondary)' }}>
          <p style={{ color: 'var(--text-muted)' }}>
            You need staked ROSE and 70%+ reputation to vote with your own tokens.
            {parseFloat(totalDelegatedPower || 0) > 0 && ' You can still vote with delegated power.'}
          </p>
        </div>
      </div>
    );
  }

  // Voting interface
  return (
    <div className="card">
      <h3 className="text-lg font-semibold mb-3">Vote on Proposal</h3>

      {/* Available Power Summary */}
      <div className="mb-4 p-3 rounded-lg" style={{ backgroundColor: 'var(--bg-secondary)' }}>
        <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>
          Available Voting Power
        </p>
        {totalAvailable.ownRose > 0 && (
          <div className="flex justify-between text-sm">
            <span style={{ color: 'var(--text-muted)' }}>Your ROSE:</span>
            <span>{totalAvailable.ownRose.toLocaleString()} ROSE → {formatVotePower(totalAvailable.ownVP)} VP</span>
          </div>
        )}
        {totalAvailable.delegatedVP > 0 && (
          <div className="flex justify-between text-sm">
            <span style={{ color: 'var(--text-muted)' }}>Delegated Power:</span>
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
          Amount to Vote With
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
          {amountSplit.ownRose > 0 && (
            <div className="flex justify-between">
              <span style={{ color: 'var(--text-muted)' }}>Own ROSE:</span>
              <span>{amountSplit.ownRose.toLocaleString()} ROSE → {formatVotePower(amountSplit.ownVP)} VP</span>
            </div>
          )}
          {amountSplit.delegatedVP > 0 && (
            <div className="flex justify-between">
              <span style={{ color: 'var(--text-muted)' }}>Delegated Power:</span>
              <span>{formatVotePower(amountSplit.delegatedVP)} VP</span>
            </div>
          )}
          <div className="flex justify-between mt-2 pt-2 border-t" style={{ borderColor: 'var(--border-color)' }}>
            <span style={{ color: 'var(--text-muted)' }}>Total Vote Power:</span>
            <span className="font-semibold">{formatVotePower(previewVotePower.total)} VP</span>
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
    </div>
  );
};

export default VotePanel;
