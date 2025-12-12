/**
 * DelegateCard - Preview card for eligible delegates
 * Shows reputation, vote accuracy, own VP, and delegation action
 *
 * Off-chain EIP-712 Delegation Model:
 * - Users sign EIP-712 typed data to delegate VP
 * - Delegations stored in backend, reflected in VP snapshots
 * - Multi-delegation: Can delegate to multiple delegates simultaneously
 * - Revocation requires signed authorization
 */

import React, { useState } from 'react';
import { useReadContracts } from 'wagmi';
import RoseGovernanceABI from '../../contracts/RoseGovernanceABI.json';
import RoseReputationABI from '../../contracts/RoseReputationABI.json';
import { CONTRACTS, formatVotePower } from '../../constants/contracts';
import ProfileBadge from '../profile/ProfileBadge';
import ReputationBadge from './ReputationBadge';
import { useVoteAccuracy } from '../../hooks/useVoteAccuracy';

const DelegateCard = React.memo(({
  address,
  onDelegate,
  onRevoke,
  loading = false,
  currentDelegatedVP = '0',  // VP currently delegated to this delegate
  availableVP = '0',          // User's available VP for delegation
}) => {
  const [delegateAmount, setDelegateAmount] = useState('');
  const [showDelegateForm, setShowDelegateForm] = useState(false);
  const [showRevokeConfirm, setShowRevokeConfirm] = useState(false);

  // Fetch delegate info
  const { data: delegateData } = useReadContracts({
    contracts: [
      // Reputation from RoseReputation contract
      {
        address: CONTRACTS.REPUTATION,
        abi: RoseReputationABI,
        functionName: 'getReputation',
        args: [address],
      },
      // Voting power from Governance
      {
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'votingPower',
        args: [address],
      },
      // Combined eligibility: reputation + opt-in + stake
      {
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'canReceiveDelegation',
        args: [address],
      },
    ],
    query: {
      enabled: !!address && !!CONTRACTS.GOVERNANCE && !!CONTRACTS.REPUTATION,
    },
  });

  // Fetch vote accuracy
  const { accuracy, votesCount } = useVoteAccuracy(address);

  // Parse delegate data
  const reputation = delegateData?.[0]?.status === 'success'
    ? Number(delegateData[0].result)
    : 60;

  const votingPowerRaw = delegateData?.[1]?.status === 'success'
    ? delegateData[1].result
    : 0n;

  const canReceiveDelegation = delegateData?.[2]?.status === 'success'
    ? delegateData[2].result
    : false;

  // Convert from raw to human-readable VP (VP has 9 decimals from sqrt)
  const ownVotingPower = Number(votingPowerRaw) / 1e9;

  // Current delegation from user to this delegate
  const currentDelegation = parseFloat(currentDelegatedVP || '0');
  const hasExistingDelegation = currentDelegation > 0;

  // Available VP for new delegation
  const availableForDelegation = parseFloat(availableVP || '0');

  // Get accuracy color based on percentage
  const getAccuracyColor = () => {
    if (accuracy >= 70) return 'var(--success)';
    if (accuracy >= 50) return 'var(--warning)';
    return 'var(--error)';
  };

  const handleDelegate = async () => {
    if (!delegateAmount || parseFloat(delegateAmount) <= 0) return;
    try {
      await onDelegate(address, delegateAmount);
      setDelegateAmount('');
      setShowDelegateForm(false);
    } catch (err) {
      console.error('Delegation failed:', err);
    }
  };

  const handleRevoke = async () => {
    try {
      await onRevoke(address);
      setShowRevokeConfirm(false);
    } catch (err) {
      console.error('Revocation failed:', err);
    }
  };

  const handleMaxDelegate = () => {
    setDelegateAmount(availableForDelegation.toFixed(2));
  };

  return (
    <div
      className="card"
      style={{
        background: hasExistingDelegation ? 'var(--card-accent-bg)' : undefined,
        borderColor: hasExistingDelegation ? 'var(--card-accent-border)' : undefined,
        borderWidth: hasExistingDelegation ? '1px' : undefined,
      }}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <ProfileBadge address={address} size="md" showAddress={true} />
        <ReputationBadge score={reputation} size="sm" />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        <div className="text-center p-2 rounded" style={{ backgroundColor: 'var(--bg-secondary)' }}>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Vote Accuracy</p>
          <p className="font-semibold text-sm" style={{ color: getAccuracyColor() }}>
            {accuracy.toFixed(0)}%
            <span className="text-xs font-normal" style={{ color: 'var(--text-muted)' }}>
              {' '}({votesCount})
            </span>
          </p>
        </div>
        <div className="text-center p-2 rounded" style={{ backgroundColor: 'var(--bg-secondary)' }}>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Own VP</p>
          <p className="font-semibold text-sm">
            {formatVotePower(ownVotingPower)} VP
          </p>
        </div>
      </div>

      {/* Current Delegation Indicator */}
      {hasExistingDelegation && (
        <div
          className="p-2 rounded-lg mb-4 text-sm"
          style={{ backgroundColor: 'rgba(212, 175, 140, 0.1)', color: 'var(--accent)' }}
        >
          <div className="flex justify-between items-center">
            <span>Your delegation:</span>
            <span className="font-semibold">{formatVotePower(currentDelegation)} VP</span>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      {canReceiveDelegation && !showDelegateForm && !showRevokeConfirm && (
        <div className="flex gap-2">
          {/* Delegate Button */}
          {availableForDelegation > 0 && (
            <button
              onClick={() => setShowDelegateForm(true)}
              className="btn-primary flex-1 text-sm"
            >
              {hasExistingDelegation ? 'Add VP' : 'Delegate VP'}
            </button>
          )}

          {/* Revoke Button */}
          {hasExistingDelegation && (
            <button
              onClick={() => setShowRevokeConfirm(true)}
              className="btn-secondary flex-1 text-sm"
            >
              Revoke
            </button>
          )}
        </div>
      )}

      {/* Delegate Form */}
      {showDelegateForm && (
        <div className="space-y-3">
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Available: {formatVotePower(availableForDelegation)} VP
          </p>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type="number"
                value={delegateAmount}
                onChange={(e) => setDelegateAmount(e.target.value)}
                placeholder="VP amount"
                min="0"
                step="0.01"
                className="w-full px-3 py-2 rounded-lg text-sm"
                style={{
                  backgroundColor: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-color)',
                }}
              />
              <span
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs"
                style={{ color: 'var(--text-muted)' }}
              >
                VP
              </span>
            </div>
            <button
              onClick={handleMaxDelegate}
              className="px-2 py-2 rounded-lg text-xs"
              style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)' }}
            >
              Max
            </button>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleDelegate}
              disabled={loading || !delegateAmount || parseFloat(delegateAmount) <= 0 || parseFloat(delegateAmount) > availableForDelegation}
              className="btn-primary flex-1 text-sm py-2"
              style={{ opacity: loading || !delegateAmount || parseFloat(delegateAmount) <= 0 ? 0.5 : 1 }}
            >
              {loading ? 'Delegating...' : 'Confirm'}
            </button>
            <button
              onClick={() => { setShowDelegateForm(false); setDelegateAmount(''); }}
              className="btn-secondary flex-1 text-sm py-2"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Revoke Confirmation */}
      {showRevokeConfirm && (
        <div className="space-y-3">
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Revoke delegation of {formatVotePower(currentDelegation)} VP to this delegate?
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleRevoke}
              disabled={loading}
              className="flex-1 text-sm py-2 rounded-lg"
              style={{
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                color: 'var(--error)',
                opacity: loading ? 0.5 : 1,
              }}
            >
              {loading ? 'Revoking...' : 'Confirm Revoke'}
            </button>
            <button
              onClick={() => setShowRevokeConfirm(false)}
              className="btn-secondary flex-1 text-sm py-2"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Not eligible message */}
      {!canReceiveDelegation && !hasExistingDelegation && (
        <div
          className="p-2 rounded-lg text-sm text-center"
          style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-muted)' }}
        >
          Not eligible (90%+ rep, 10+ tasks, stake, and opt-in required)
        </div>
      )}
    </div>
  );
});

DelegateCard.displayName = 'DelegateCard';

export default DelegateCard;
