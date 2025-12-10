import React, { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { useDispute } from '../../hooks/useDispute';
import { uploadDisputeReason } from '../../utils/ipfs/pinataService';

/**
 * Modal for raising a dispute on a task.
 * Customer can dispute InProgress tasks, Worker can dispute Completed tasks.
 */
const DisputeModal = ({
  isOpen,
  onClose,
  taskId,
  role, // 'customer' or 'worker'
  onDisputeRaised, // callback after successful dispute
}) => {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [isUploading, setIsUploading] = useState(false);

  const { address: account } = useAccount();
  const {
    disputeAsCustomer,
    disputeAsWorker,
    actionLoading,
    error: hookError,
    clearError,
  } = useDispute();

  const isSubmitting = actionLoading.disputeAsCustomer || actionLoading.disputeAsWorker || isUploading;

  // Reset form on open
  useEffect(() => {
    if (isOpen) {
      setReason('');
      setError('');
      clearError();
    }
  }, [isOpen, clearError]);

  const validateReason = () => {
    if (!reason || reason.trim() === '') {
      return 'Please describe the reason for your dispute';
    }

    if (reason.trim().length < 20) {
      return 'Please provide at least 20 characters explaining the dispute';
    }

    if (reason.trim().length > 2000) {
      return 'Dispute reason cannot exceed 2000 characters';
    }

    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const validationError = validateReason();
    if (validationError) {
      setError(validationError);
      return;
    }

    try {
      // Step 1: Upload reason to IPFS
      setIsUploading(true);
      console.log('Uploading dispute reason to IPFS...');
      const reasonHash = await uploadDisputeReason(taskId, reason, account, role);
      console.log('Dispute reason uploaded:', reasonHash);
      setIsUploading(false);

      // Step 2: Submit dispute on-chain
      if (role === 'customer') {
        await disputeAsCustomer(taskId, reasonHash);
      } else {
        await disputeAsWorker(taskId, reasonHash);
      }

      onDisputeRaised?.();
      onClose();
    } catch (err) {
      setIsUploading(false);
      setError(err.message || 'Failed to raise dispute');
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
          Raise a Dispute
        </h3>

        {/* Warning Banner */}
        <div
          className="mb-5 p-4 rounded-xl"
          style={{
            background: 'var(--warning-bg)',
            border: '1px solid rgba(251, 191, 36, 0.3)',
          }}
        >
          <p className="text-sm font-medium mb-2" style={{ color: 'var(--warning)' }}>
            Important
          </p>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Disputes are reviewed by admins. Please provide a clear and detailed explanation
            of the issue. False or frivolous disputes may affect your reputation.
          </p>
        </div>

        <p className="text-sm mb-5" style={{ color: 'var(--text-secondary)' }}>
          {role === 'customer'
            ? 'As the customer, you can dispute this task if the work is not meeting expectations or there are issues with delivery.'
            : 'As the worker, you can dispute this task if payment approval is being unreasonably withheld or there are issues with the task terms.'}
        </p>

        <form onSubmit={handleSubmit}>
          <div className="mb-5">
            <label htmlFor="reason" style={labelStyle}>
              Dispute Reason *
            </label>
            <textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              style={{ ...inputStyle, minHeight: '150px', resize: 'vertical' }}
              placeholder="Describe the issue in detail. What went wrong? What outcome are you seeking?"
              maxLength={2000}
              disabled={isSubmitting}
              required
            />
            <div className="flex justify-between mt-2">
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Minimum 20 characters required
              </p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {reason.length}/2000
              </p>
            </div>
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
              disabled={isSubmitting || reason.trim().length < 20}
              className="px-5 py-2.5 text-sm font-semibold rounded-xl transition-all duration-200"
              style={{
                background: isSubmitting || reason.trim().length < 20
                  ? 'var(--bg-secondary)'
                  : 'var(--error)',
                color: isSubmitting || reason.trim().length < 20
                  ? 'var(--text-muted)'
                  : 'white',
                opacity: isSubmitting || reason.trim().length < 20 ? 0.6 : 1,
              }}
            >
              {isSubmitting ? (
                <>
                  <span className="inline-block mr-2 animate-pulse">
                    {isUploading ? '...' : '...'}
                  </span>
                  {isUploading ? 'Uploading...' : 'Submitting...'}
                </>
              ) : (
                'Submit Dispute'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default DisputeModal;
