/**
 * DelegateCard - Preview card for eligible delegates
 * Shows reputation, vote accuracy, total received VP, and delegation action
 *
 * VP-centric model: Users delegate VP directly (not ROSE)
 * Multi-delegation: Can delegate to multiple delegates simultaneously
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
  onUndelegate,
  loading = false,
  currentDelegatedVP = '0',  // VP currently delegated to this delegate
  availableVP = '0',          // User's available VP for delegation
}) => {
  const [delegateAmount, setDelegateAmount] = useState('');
  const [undelegateAmount, setUndelegateAmount] = useState('');
  const [showDelegateForm, setShowDelegateForm] = useState(false);
  const [showUndelegateForm, setShowUndelegateForm] = useState(false);

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
      // Delegation data stays on Governance
      {
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'totalDelegatedIn',
        args: [address],
      },
      {
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'votingPower',
        args: [address],
      },
      // Eligibility from RoseReputation contract
      {
        address: CONTRACTS.REPUTATION,
        abi: RoseReputationABI,
        functionName: 'canDelegate',
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

  const totalDelegatedInRaw = delegateData?.[1]?.status === 'success'
    ? delegateData[1].result
    : 0n;

  const votingPowerRaw = delegateData?.[2]?.status === 'success'
    ? delegateData[2].result
    : 0n;

  const canReceiveDelegation = delegateData?.[3]?.status === 'success'
    ? delegateData[3].result
    : false;

  // Convert from raw to human-readable VP (VP has 9 decimals from sqrt)
  const ownVotingPower = Number(votingPowerRaw) / 1e9;
  const receivedVP = Number(totalDelegatedInRaw) / 1e9;
  const totalVP = ownVotingPower + receivedVP;

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

  const handleUndelegate = async () => {
    if (!undelegateAmount || parseFloat(undelegateAmount) <= 0) return;
    try {
      await onUndelegate(address, undelegateAmount);
      setUndelegateAmount('');
      setShowUndelegateForm(false);
    } catch (err) {
      console.error('Undelegation failed:', err);
    }
  };

  const handleMaxDelegate = () => {
    setDelegateAmount(availableForDelegation.toFixed(2));
  };

  const handleMaxUndelegate = () => {
    setUndelegateAmount(currentDelegation.toFixed(2));
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
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Total VP</p>
          <p className="font-semibold text-sm">
            {formatVotePower(totalVP)} VP
          </p>
        </div>
      </div>

      {/* VP Breakdown */}
      <div className="mb-4 p-2 rounded text-xs" style={{ backgroundColor: 'var(--bg-secondary)' }}>
        <div className="flex justify-between mb-1">
          <span style={{ color: 'var(--text-muted)' }}>Own VP:</span>
          <span>{formatVotePower(ownVotingPower)} VP</span>
        </div>
        <div className="flex justify-between">
          <span style={{ color: 'var(--text-muted)' }}>Received VP:</span>
          <span className="text-green-500">{formatVotePower(receivedVP)} VP</span>
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
      {canReceiveDelegation && !showDelegateForm && !showUndelegateForm && (
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

          {/* Undelegate Button */}
          {hasExistingDelegation && (
            <button
              onClick={() => setShowUndelegateForm(true)}
              className="btn-secondary flex-1 text-sm"
            >
              Remove VP
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

      {/* Undelegate Form */}
      {showUndelegateForm && (
        <div className="space-y-3">
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Currently delegated: {formatVotePower(currentDelegation)} VP
          </p>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type="number"
                value={undelegateAmount}
                onChange={(e) => setUndelegateAmount(e.target.value)}
                placeholder="VP amount"
                min="0"
                max={currentDelegation}
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
              onClick={handleMaxUndelegate}
              className="px-2 py-2 rounded-lg text-xs"
              style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)' }}
            >
              Max
            </button>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleUndelegate}
              disabled={loading || !undelegateAmount || parseFloat(undelegateAmount) <= 0 || parseFloat(undelegateAmount) > currentDelegation}
              className="btn-secondary flex-1 text-sm py-2"
              style={{ opacity: loading || !undelegateAmount || parseFloat(undelegateAmount) <= 0 ? 0.5 : 1 }}
            >
              {loading ? 'Removing...' : 'Remove VP'}
            </button>
            <button
              onClick={() => { setShowUndelegateForm(false); setUndelegateAmount(''); }}
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
          Not eligible (90%+ rep + 10 tasks required)
        </div>
      )}
    </div>
  );
});

DelegateCard.displayName = 'DelegateCard';

export default DelegateCard;
