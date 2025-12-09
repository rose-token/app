import React, { useState, useEffect } from 'react';
import { formatUnits, parseUnits } from 'viem';
import { useAuction } from '../../hooks/useAuction';

/**
 * Modal for submitting or updating a bid on an auction task.
 * Workers can enter a bid amount (<= max budget) and optional message.
 */
const BidSubmissionModal = ({
  isOpen,
  onClose,
  taskId,
  maxBudget, // in wei (string)
  existingBid, // { bidAmount, message } or null
  onBidSubmitted, // callback after successful bid
}) => {
  const [bidAmount, setBidAmount] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const { submitBid, actionLoading, error: hookError, clearError } = useAuction();

  const isSubmitting = actionLoading.submitBid;
  const isUpdate = !!existingBid;

  // Format max budget for display
  const maxBudgetFormatted = maxBudget
    ? parseFloat(formatUnits(BigInt(maxBudget), 18)).toFixed(2)
    : '0';

  // Pre-fill existing bid values
  useEffect(() => {
    if (isOpen && existingBid) {
      setBidAmount(formatUnits(BigInt(existingBid.bidAmount), 18));
      setMessage(existingBid.message || '');
    } else if (isOpen) {
      setBidAmount('');
      setMessage('');
    }
    setError('');
    clearError();
  }, [isOpen, existingBid, clearError]);

  const validateBid = () => {
    if (!bidAmount || bidAmount.trim() === '') {
      return 'Bid amount is required';
    }

    const bidValue = parseFloat(bidAmount);
    if (isNaN(bidValue) || bidValue <= 0) {
      return 'Bid amount must be greater than 0';
    }

    const maxValue = parseFloat(maxBudgetFormatted);
    if (bidValue > maxValue) {
      return `Bid cannot exceed max budget (${maxBudgetFormatted} ROSE)`;
    }

    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const validationError = validateBid();
    if (validationError) {
      setError(validationError);
      return;
    }

    try {
      await submitBid(taskId, bidAmount, message || null);
      onBidSubmitted?.();
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to submit bid');
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      onClose();
    }
  };

  if (!isOpen) return null;

  const labelStyle = {
    color: 'var(--text-muted)',
    fontSize: '0.6875rem',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    marginBottom: '0.5rem',
    display: 'block',
  };

  const inputStyle = {
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 'var(--radius-md)',
    color: 'var(--text-primary)',
    padding: '0.875rem 1rem',
    width: '100%',
    fontSize: '0.9375rem',
    transition: 'all 0.2s ease',
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ background: 'rgba(0, 0, 0, 0.7)', backdropFilter: 'blur(4px)' }}
      onClick={handleClose}
    >
      <div
        className="rounded-[20px] p-7 max-w-md w-full mx-4"
        style={{
          background: 'var(--bg-card-solid)',
          border: '1px solid var(--border-subtle)',
          boxShadow: 'var(--shadow-card)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3
          className="font-display text-xl font-medium mb-4"
          style={{ color: 'var(--text-primary)', letterSpacing: '-0.02em' }}
        >
          {isUpdate ? 'Update Your Bid' : 'Place a Bid'}
        </h3>

        <p className="text-sm mb-5" style={{ color: 'var(--text-secondary)' }}>
          {isUpdate
            ? 'Update your bid amount for this auction task.'
            : 'Enter your bid amount. The customer will review all bids and select a winner.'}
        </p>

        {/* Max Budget Info */}
        <div
          className="mb-5 p-3 rounded-xl"
          style={{ background: 'var(--info-bg)', border: '1px solid rgba(96, 165, 250, 0.3)' }}
        >
          <div className="flex justify-between items-center">
            <span className="text-sm" style={{ color: 'var(--info)' }}>
              Maximum Budget
            </span>
            <span className="text-sm font-semibold" style={{ color: 'var(--info)' }}>
              {maxBudgetFormatted} ROSE
            </span>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="mb-5">
            <label htmlFor="bidAmount" style={labelStyle}>
              Your Bid Amount *
            </label>
            <div className="relative">
              <input
                id="bidAmount"
                type="number"
                value={bidAmount}
                onChange={(e) => setBidAmount(e.target.value)}
                style={inputStyle}
                placeholder="e.g., 50"
                step="0.01"
                min="0.01"
                max={maxBudgetFormatted}
                onWheel={(e) => e.currentTarget.blur()}
                disabled={isSubmitting}
                required
              />
              <div
                className="absolute inset-y-0 right-0 flex items-center pr-4 pointer-events-none text-sm font-medium"
                style={{ color: 'var(--rose-gold)' }}
              >
                ROSE
              </div>
            </div>
            <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
              Enter an amount up to {maxBudgetFormatted} ROSE
            </p>
          </div>

          <div className="mb-5">
            <label htmlFor="message" style={labelStyle}>
              Message (Optional)
            </label>
            <textarea
              id="message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              style={{ ...inputStyle, minHeight: '100px', resize: 'vertical' }}
              placeholder="Why you're a good fit for this task..."
              maxLength={500}
              disabled={isSubmitting}
            />
            <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
              {message.length}/500 characters
            </p>
          </div>

          {(error || hookError) && (
            <div
              className="mb-5 p-4 rounded-xl text-sm"
              style={{
                background: 'var(--error-bg)',
                border: '1px solid rgba(248, 113, 113, 0.3)',
                color: 'var(--error)',
              }}
            >
              {error || hookError}
            </div>
          )}

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={handleClose}
              disabled={isSubmitting}
              className="px-5 py-2.5 text-sm font-semibold rounded-xl transition-all duration-200"
              style={{
                background: 'transparent',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-secondary)',
                opacity: isSubmitting ? 0.6 : 1,
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2.5 text-sm font-semibold rounded-xl transition-all duration-200"
              style={{
                background: isSubmitting
                  ? 'var(--bg-secondary)'
                  : 'linear-gradient(135deg, var(--rose-pink) 0%, var(--rose-gold) 100%)',
                color: isSubmitting ? 'var(--text-muted)' : 'var(--bg-primary)',
                boxShadow: isSubmitting ? 'none' : '0 4px 16px rgba(212, 165, 165, 0.3)',
                opacity: isSubmitting ? 0.6 : 1,
              }}
            >
              {isSubmitting ? (
                <>
                  <span className="inline-block mr-2 animate-pulse">⚡</span>
                  {isUpdate ? 'Updating...' : 'Submitting...'}
                </>
              ) : isUpdate ? (
                'Update Bid'
              ) : (
                'Submit Bid'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default BidSubmissionModal;
