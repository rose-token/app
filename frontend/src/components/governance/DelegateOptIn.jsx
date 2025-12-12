/**
 * DelegateOptIn - Toggle component for opting in to receive delegations
 *
 * To receive off-chain delegations, users must:
 * 1. Meet reputation requirements (90%+ rep + 10 completed tasks)
 * 2. Have stake in the governance system (stakedRose > 0)
 * 3. Opt-in by calling setDelegateOptIn(true) on-chain
 *
 * This component displays the current opt-in status and allows toggling.
 */

import React from 'react';
import { useAccount } from 'wagmi';
import useDelegation from '../../hooks/useDelegation';
import Spinner from '../ui/Spinner';

const DelegateOptIn = () => {
  const { isConnected } = useAccount();
  const {
    canDelegate, // Reputation-based: 90%+ rep + 10 tasks
    canReceiveDelegation, // Combined: reputation + opt-in + stake
    isOptedIn,
    isDelegateOptedIn, // From contract (same as isOptedIn but from contract read)
    stakedRose,
    toggleOptIn,
    actionLoading,
    error,
  } = useDelegation();

  // Calculate requirements
  const meetsReputationReq = canDelegate;
  const hasStake = parseFloat(stakedRose || '0') > 0;
  const isCurrentlyOptedIn = isDelegateOptedIn || isOptedIn;
  const isFullyEligible = canReceiveDelegation;

  // Handle toggle
  const handleToggle = async () => {
    try {
      await toggleOptIn(!isCurrentlyOptedIn);
    } catch (err) {
      console.error('Failed to toggle opt-in:', err);
    }
  };

  // Don't render if not connected
  if (!isConnected) return null;

  return (
    <div className="card">
      <h3 className="text-lg font-semibold mb-4">Delegate Opt-In</h3>

      {/* Status Badge */}
      <div
        className="mb-4 p-3 rounded-lg"
        style={{
          backgroundColor: isCurrentlyOptedIn
            ? 'rgba(34, 197, 94, 0.1)'
            : 'rgba(239, 68, 68, 0.1)',
          color: isCurrentlyOptedIn ? 'var(--success)' : 'var(--error)',
        }}
      >
        <div className="flex items-center justify-between">
          <span className="font-semibold">
            {isCurrentlyOptedIn ? 'Opted In' : 'Not Opted In'}
          </span>
          {isFullyEligible && (
            <span
              className="px-2 py-1 text-xs rounded"
              style={{
                backgroundColor: 'rgba(34, 197, 94, 0.2)',
                color: 'var(--success)',
              }}
            >
              Eligible
            </span>
          )}
        </div>
        {isCurrentlyOptedIn && !isFullyEligible && (
          <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
            Opted in but missing requirements
          </p>
        )}
      </div>

      {/* Requirements Checklist */}
      <div className="space-y-2 mb-4 text-sm">
        <p
          className="font-semibold text-xs mb-2"
          style={{ color: 'var(--text-muted)' }}
        >
          Requirements:
        </p>
        <div className="flex items-center gap-2">
          <span
            style={{
              color: meetsReputationReq ? 'var(--success)' : 'var(--error)',
            }}
          >
            {meetsReputationReq ? '✓' : '✗'}
          </span>
          <span>90%+ reputation & 10+ tasks</span>
        </div>
        <div className="flex items-center gap-2">
          <span
            style={{ color: hasStake ? 'var(--success)' : 'var(--error)' }}
          >
            {hasStake ? '✓' : '✗'}
          </span>
          <span>Has staked ROSE</span>
        </div>
        <div className="flex items-center gap-2">
          <span
            style={{
              color: isCurrentlyOptedIn ? 'var(--success)' : 'var(--text-muted)',
            }}
          >
            {isCurrentlyOptedIn ? '✓' : '○'}
          </span>
          <span>Opt-in enabled</span>
        </div>
      </div>

      {/* Toggle Button */}
      <button
        onClick={handleToggle}
        disabled={!meetsReputationReq || !hasStake || actionLoading?.toggleOptIn}
        className={`w-full py-2 rounded-lg font-medium transition-all ${
          isCurrentlyOptedIn ? 'btn-secondary' : 'btn-primary'
        }`}
        style={{
          opacity: (!meetsReputationReq || !hasStake || actionLoading?.toggleOptIn) ? 0.5 : 1,
          cursor: (!meetsReputationReq || !hasStake || actionLoading?.toggleOptIn) ? 'not-allowed' : 'pointer',
        }}
      >
        {actionLoading?.toggleOptIn ? (
          <span className="flex items-center justify-center gap-2">
            <Spinner className="h-4 w-4" />
            Processing...
          </span>
        ) : isCurrentlyOptedIn ? (
          'Opt Out of Receiving Delegations'
        ) : (
          'Opt In to Receive Delegations'
        )}
      </button>

      {/* Error Display */}
      {error && (
        <p
          className="mt-3 text-xs p-2 rounded"
          style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: 'var(--error)' }}
        >
          {error}
        </p>
      )}

      {/* Info Message */}
      {!meetsReputationReq && (
        <p className="mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
          You need 90%+ reputation and 10+ completed tasks to be eligible as a
          delegate.
        </p>
      )}

      {meetsReputationReq && !hasStake && (
        <p className="mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
          You need to stake ROSE to be eligible as a delegate.
        </p>
      )}

      {/* Explanation */}
      <div
        className="mt-4 p-2 rounded-lg text-xs"
        style={{
          backgroundColor: 'var(--bg-secondary)',
          color: 'var(--text-muted)',
        }}
      >
        <strong>Off-Chain Delegation:</strong> Users can delegate VP to you via
        signed messages (no gas). Delegations are reflected in VP snapshots for
        Fast Track proposals.
      </div>
    </div>
  );
};

export default DelegateOptIn;
