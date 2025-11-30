/**
 * DelegateCard - Preview card for eligible delegates
 * Shows reputation, vote accuracy, total power, and delegation action
 */

import React, { useState } from 'react';
import { useReadContracts } from 'wagmi';
import RoseGovernanceABI from '../../contracts/RoseGovernanceABI.json';
import { CONTRACTS, formatVotePower, calculateVotePower } from '../../constants/contracts';
import ProfileBadge from '../profile/ProfileBadge';
import ReputationBadge from './ReputationBadge';
import { useVoteAccuracy } from '../../hooks/useVoteAccuracy';

const DelegateCard = React.memo(({
  address,
  onDelegate,
  loading = false,
  isCurrentDelegate = false,
  currentDelegationAmount = '0',
}) => {
  const [delegateAmount, setDelegateAmount] = useState('');
  const [showDelegateForm, setShowDelegateForm] = useState(false);

  // Fetch delegate info
  const { data: delegateData } = useReadContracts({
    contracts: [
      {
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'getReputation',
        args: [address],
      },
      {
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'totalDelegatedPower',
        args: [address],
      },
      {
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'stakedRose',
        args: [address],
      },
      {
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'canDelegate',
        args: [address],
      },
      {
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'allocatedRose',
        args: [address],
      },
    ],
    query: {
      enabled: !!address && !!CONTRACTS.GOVERNANCE,
    },
  });

  // Fetch vote accuracy
  const { accuracy, votesCount } = useVoteAccuracy(address);

  // Contract returns reputation as 0-100 percentage
  const reputation = delegateData?.[0]?.status === 'success'
    ? Number(delegateData[0].result)
    : 60;

  const totalDelegatedPowerRaw = delegateData?.[1]?.status === 'success'
    ? delegateData[1].result
    : 0n;

  const stakedRoseRaw = delegateData?.[2]?.status === 'success'
    ? delegateData[2].result
    : 0n;

  const canReceiveDelegation = delegateData?.[3]?.status === 'success'
    ? delegateData[3].result
    : false;

  const allocatedRoseRaw = delegateData?.[4]?.status === 'success'
    ? delegateData[4].result
    : 0n;

  // Calculate delegate's own voting power from their unallocated stake
  // (staked ROSE minus any ROSE already allocated to votes or their own delegation)
  const unallocatedRoseRaw = stakedRoseRaw > allocatedRoseRaw
    ? stakedRoseRaw - allocatedRoseRaw
    : 0n;
  const ownVotePower = calculateVotePower(unallocatedRoseRaw, reputation);

  // Power received from delegators - contract stores as final vote power (sqrt(wei) × rep/100)
  // Divide by 1e9 to convert from wei-scale to human-readable VP units
  const receivedDelegatedPower = Number(totalDelegatedPowerRaw) / 1e9;

  // Total voting power available to this delegate
  const totalPower = ownVotePower + receivedDelegatedPower;

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

  return (
    <div
      className="card"
      style={{
        borderColor: isCurrentDelegate ? 'var(--accent)' : undefined,
        borderWidth: isCurrentDelegate ? '2px' : undefined,
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
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Voting Power</p>
          <p className="font-semibold text-sm">
            {formatVotePower(totalPower)} VP
          </p>
        </div>
      </div>

      {/* Current Delegate Indicator */}
      {isCurrentDelegate && (
        <div
          className="p-2 rounded-lg mb-4 text-sm text-center"
          style={{ backgroundColor: 'rgba(212, 175, 140, 0.1)', color: 'var(--accent)' }}
        >
          Currently delegating {parseFloat(currentDelegationAmount).toLocaleString(undefined, { maximumFractionDigits: 2 })} ROSE
        </div>
      )}

      {/* Delegation Form or Button - show for both new and increase allocation */}
      {canReceiveDelegation && (
        <>
          {showDelegateForm ? (
            <div className="space-y-3">
              <div className="flex gap-2">
                <input
                  type="number"
                  value={delegateAmount}
                  onChange={(e) => setDelegateAmount(e.target.value)}
                  placeholder={isCurrentDelegate ? "Additional amount" : "Amount to delegate"}
                  min="0"
                  step="0.01"
                  className="flex-1 px-3 py-2 rounded-lg text-sm"
                  style={{
                    backgroundColor: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-color)',
                  }}
                />
                <span className="px-2 py-2 text-sm" style={{ color: 'var(--text-muted)' }}>
                  ROSE
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleDelegate}
                  disabled={loading || !delegateAmount || parseFloat(delegateAmount) <= 0}
                  className="btn-primary flex-1 text-sm py-2"
                  style={{ opacity: loading ? 0.5 : 1 }}
                >
                  {loading ? (isCurrentDelegate ? 'Increasing...' : 'Delegating...') : 'Confirm'}
                </button>
                <button
                  onClick={() => setShowDelegateForm(false)}
                  className="btn-secondary flex-1 text-sm py-2"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowDelegateForm(true)}
              className="btn-primary w-full text-sm"
            >
              {isCurrentDelegate ? 'Increase Allocation' : 'Delegate to this user'}
            </button>
          )}
        </>
      )}

      {/* Not eligible message */}
      {!canReceiveDelegation && !isCurrentDelegate && (
        <div
          className="p-2 rounded-lg text-sm text-center"
          style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-muted)' }}
        >
          Not eligible to receive delegation (90%+ rep required)
        </div>
      )}
    </div>
  );
});

DelegateCard.displayName = 'DelegateCard';

export default DelegateCard;
