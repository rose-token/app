import React, { useState, useEffect, useCallback } from 'react';
import { formatUnits } from 'viem';
import { useAuction } from '../../hooks/useAuction';
import ProfileBadge from '../profile/ProfileBadge';

/**
 * Modal for customers to view all bids on an auction task and select a winner.
 * Shows bids sorted by amount (lowest first), worker profile badges,
 * and a "Select Winner" button per bid with confirmation step.
 */
const BidSelectionModal = ({
  isOpen,
  onClose,
  taskId,
  maxBudget, // in wei (string)
  onWinnerSelected, // callback after successful selection
}) => {
  const [bids, setBids] = useState([]);
  const [isLoadingBids, setIsLoadingBids] = useState(false);
  const [error, setError] = useState('');

  // Confirmation state
  const [selectedBid, setSelectedBid] = useState(null);
  const [showConfirmation, setShowConfirmation] = useState(false);

  const { getBids, selectWinner, actionLoading, error: hookError, clearError } = useAuction();

  const isSelecting = actionLoading.selectWinner;

  // Format max budget for display
  const maxBudgetFormatted = maxBudget
    ? parseFloat(formatUnits(BigInt(maxBudget), 18)).toFixed(2)
    : '0';

  // Fetch all bids when modal opens
  const fetchBids = useCallback(async () => {
    if (!taskId) return;

    setIsLoadingBids(true);
    setError('');

    try {
      const data = await getBids(taskId);
      // Sort by bid amount (lowest first - best deal for customer)
      const sortedBids = (data.bids || []).sort((a, b) => {
        const aAmount = BigInt(a.bidAmount);
        const bAmount = BigInt(b.bidAmount);
        if (aAmount < bAmount) return -1;
        if (aAmount > bAmount) return 1;
        return 0;
      });
      setBids(sortedBids);
    } catch (err) {
      console.error('Failed to fetch bids:', err);
      setError(err.message || 'Failed to load bids');
    } finally {
      setIsLoadingBids(false);
    }
  }, [taskId, getBids]);

  useEffect(() => {
    if (isOpen) {
      fetchBids();
      setSelectedBid(null);
      setShowConfirmation(false);
      clearError();
    }
  }, [isOpen, fetchBids, clearError]);

  const handleSelectBid = (bid) => {
    setSelectedBid(bid);
    setShowConfirmation(true);
    setError('');
  };

  const handleCancelSelection = () => {
    setSelectedBid(null);
    setShowConfirmation(false);
  };

  const handleConfirmSelection = async () => {
    if (!selectedBid) return;

    setError('');

    try {
      await selectWinner(taskId, selectedBid.worker, selectedBid.bidAmount);
      onWinnerSelected?.();
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to select winner');
    }
  };

  const handleClose = () => {
    if (!isSelecting) {
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
  };

  // Calculate savings for display
  const getSavings = (bidAmount) => {
    const bid = parseFloat(formatUnits(BigInt(bidAmount), 18));
    const max = parseFloat(maxBudgetFormatted);
    const savings = max - bid;
    const savingsPercent = max > 0 ? ((savings / max) * 100).toFixed(0) : 0;
    return { savings: savings.toFixed(2), percent: savingsPercent };
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ background: 'rgba(0, 0, 0, 0.7)', backdropFilter: 'blur(4px)' }}
      onClick={handleClose}
    >
      <div
        className="rounded-[20px] p-7 max-w-lg w-full mx-4 max-h-[85vh] overflow-hidden flex flex-col"
        style={{
          background: 'var(--bg-card-solid)',
          border: '1px solid var(--border-subtle)',
          boxShadow: 'var(--shadow-card)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="mb-5">
          <h3
            className="font-display text-xl font-medium mb-2"
            style={{ color: 'var(--text-primary)', letterSpacing: '-0.02em' }}
          >
            {showConfirmation ? 'Confirm Winner Selection' : 'Review Bids'}
          </h3>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {showConfirmation
              ? 'Please confirm your selection. This will transition the task to In Progress.'
              : `Select the winning bid for this auction. Max budget: ${maxBudgetFormatted} ROSE`}
          </p>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {showConfirmation && selectedBid ? (
            // Confirmation View
            <div>
              <div
                className="p-5 rounded-xl mb-5"
                style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}
              >
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <p style={labelStyle} className="mb-2">Selected Worker</p>
                    <ProfileBadge address={selectedBid.worker} size="md" />
                  </div>
                  <div className="text-right">
                    <p style={labelStyle} className="mb-1">Winning Bid</p>
                    <p
                      className="text-xl font-semibold"
                      style={{ color: 'var(--success)' }}
                    >
                      {parseFloat(formatUnits(BigInt(selectedBid.bidAmount), 18)).toFixed(2)} ROSE
                    </p>
                  </div>
                </div>

                {selectedBid.message && (
                  <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                    <p style={labelStyle} className="mb-2">Worker's Message</p>
                    <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                      "{selectedBid.message}"
                    </p>
                  </div>
                )}

                {/* Savings info */}
                {(() => {
                  const { savings, percent } = getSavings(selectedBid.bidAmount);
                  return parseFloat(savings) > 0 ? (
                    <div
                      className="mt-4 p-3 rounded-xl"
                      style={{ background: 'var(--success-bg)', border: '1px solid rgba(74, 222, 128, 0.3)' }}
                    >
                      <div className="flex justify-between items-center">
                        <span className="text-sm" style={{ color: 'var(--success)' }}>
                          You Save
                        </span>
                        <span className="text-sm font-semibold" style={{ color: 'var(--success)' }}>
                          {savings} ROSE ({percent}% below max)
                        </span>
                      </div>
                    </div>
                  ) : null;
                })()}
              </div>

              <div
                className="p-4 rounded-xl mb-5"
                style={{ background: 'var(--warning-bg)', border: '1px solid rgba(251, 191, 36, 0.3)' }}
              >
                <p className="text-sm" style={{ color: 'var(--warning)' }}>
                  <strong>Note:</strong> Once confirmed, this worker will be assigned to the task.
                  The excess stake will be refunded to the stakeholder.
                </p>
              </div>
            </div>
          ) : isLoadingBids ? (
            // Loading state
            <div className="py-12 text-center">
              <div className="animate-spin inline-block w-8 h-8 border-2 border-current border-t-transparent rounded-full mb-3" style={{ color: 'var(--rose-gold)' }} />
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading bids...</p>
            </div>
          ) : bids.length === 0 ? (
            // No bids state
            <div className="py-12 text-center">
              <p className="text-4xl mb-3">📭</p>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No bids yet</p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                Workers can place bids on this task.
              </p>
            </div>
          ) : (
            // Bid list
            <div className="space-y-3">
              {bids.map((bid, index) => {
                const bidAmountFormatted = parseFloat(formatUnits(BigInt(bid.bidAmount), 18)).toFixed(2);
                const { savings, percent } = getSavings(bid.bidAmount);
                const isLowestBid = index === 0;

                return (
                  <div
                    key={bid.worker}
                    className="p-4 rounded-xl transition-all duration-200 hover:border-[var(--rose-gold)]"
                    style={{
                      background: 'var(--bg-secondary)',
                      border: isLowestBid
                        ? '1px solid rgba(74, 222, 128, 0.5)'
                        : '1px solid var(--border-subtle)',
                    }}
                  >
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex items-center gap-2">
                        <ProfileBadge address={bid.worker} size="md" />
                        {isLowestBid && (
                          <span
                            className="px-2 py-0.5 rounded-full text-[0.6rem] font-semibold uppercase"
                            style={{
                              background: 'var(--success-bg)',
                              color: 'var(--success)',
                              border: '1px solid rgba(74, 222, 128, 0.3)',
                            }}
                          >
                            Lowest
                          </span>
                        )}
                      </div>
                      <div className="text-right">
                        <p
                          className="text-lg font-semibold"
                          style={{ color: isLowestBid ? 'var(--success)' : 'var(--text-primary)' }}
                        >
                          {bidAmountFormatted} ROSE
                        </p>
                        {parseFloat(savings) > 0 && (
                          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                            Save {percent}%
                          </p>
                        )}
                      </div>
                    </div>

                    {bid.message && (
                      <p
                        className="text-xs mb-3 p-2 rounded-lg"
                        style={{ background: 'rgba(255, 255, 255, 0.03)', color: 'var(--text-secondary)' }}
                      >
                        "{bid.message}"
                      </p>
                    )}

                    <div className="flex justify-between items-center">
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {new Date(bid.createdAt).toLocaleDateString()}
                      </span>
                      <button
                        onClick={() => handleSelectBid(bid)}
                        className="px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-200"
                        style={{
                          background: isLowestBid
                            ? 'linear-gradient(135deg, var(--success) 0%, #22c55e 100%)'
                            : 'linear-gradient(135deg, var(--rose-pink) 0%, var(--rose-gold) 100%)',
                          color: 'var(--bg-primary)',
                          boxShadow: isLowestBid
                            ? '0 4px 16px rgba(74, 222, 128, 0.3)'
                            : '0 4px 16px rgba(212, 165, 165, 0.3)',
                        }}
                      >
                        Select Winner
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Error Display */}
        {(error || hookError) && (
          <div
            className="mt-5 p-4 rounded-xl text-sm"
            style={{
              background: 'var(--error-bg)',
              border: '1px solid rgba(248, 113, 113, 0.3)',
              color: 'var(--error)',
            }}
          >
            {error || hookError}
          </div>
        )}

        {/* Footer Buttons */}
        <div className="flex justify-end gap-3 mt-5 pt-5" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          {showConfirmation ? (
            <>
              <button
                type="button"
                onClick={handleCancelSelection}
                disabled={isSelecting}
                className="px-5 py-2.5 text-sm font-semibold rounded-xl transition-all duration-200"
                style={{
                  background: 'transparent',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-secondary)',
                  opacity: isSelecting ? 0.6 : 1,
                }}
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleConfirmSelection}
                disabled={isSelecting}
                className="px-5 py-2.5 text-sm font-semibold rounded-xl transition-all duration-200"
                style={{
                  background: isSelecting
                    ? 'var(--bg-secondary)'
                    : 'linear-gradient(135deg, var(--success) 0%, #22c55e 100%)',
                  color: isSelecting ? 'var(--text-muted)' : 'var(--bg-primary)',
                  boxShadow: isSelecting ? 'none' : '0 4px 16px rgba(74, 222, 128, 0.3)',
                  opacity: isSelecting ? 0.6 : 1,
                }}
              >
                {isSelecting ? (
                  <>
                    <span className="inline-block mr-2 animate-pulse">⚡</span>
                    Confirming...
                  </>
                ) : (
                  'Confirm Selection'
                )}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={handleClose}
              disabled={isSelecting}
              className="px-5 py-2.5 text-sm font-semibold rounded-xl transition-all duration-200"
              style={{
                background: 'transparent',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-secondary)',
                opacity: isSelecting ? 0.6 : 1,
              }}
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default BidSelectionModal;
