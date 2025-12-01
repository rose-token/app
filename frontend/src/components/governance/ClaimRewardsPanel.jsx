/**
 * ClaimRewardsPanel - Claim pending voter rewards from governance proposals
 * Shows claimable rewards and allows batch claiming
 */

import React, { useState, useEffect } from 'react';
import { formatUnits } from 'viem';
import useDelegation from '../../hooks/useDelegation';

// Claim type enum matching contract
const CLAIM_TYPE = {
  0: 'Direct Vote',
  1: 'Delegated',
};

const ClaimRewardsPanel = () => {
  const {
    claimableRewards,
    claimableLoading,
    fetchClaimableRewards,
    claimAllRewards,
    actionLoading,
    error,
    setError,
    isConnected,
  } = useDelegation();

  const [showDetails, setShowDetails] = useState(false);
  const [claimError, setClaimError] = useState(null);

  // Fetch claimable rewards on mount and when connected
  useEffect(() => {
    if (isConnected) {
      fetchClaimableRewards();
    }
  }, [isConnected, fetchClaimableRewards]);

  const handleClaim = async () => {
    setClaimError(null);
    try {
      await claimAllRewards();
    } catch (err) {
      setClaimError(err.message);
    }
  };

  const totalClaimable = claimableRewards?.totalClaimable
    ? formatUnits(BigInt(claimableRewards.totalClaimable), 18)
    : '0';

  const claimCount = claimableRewards?.claims?.length || 0;
  const hasClaimable = claimCount > 0 && parseFloat(totalClaimable) > 0;
  const isLoading = claimableLoading || actionLoading?.claimRewards;

  // Don't show panel if not connected
  if (!isConnected) {
    return null;
  }

  return (
    <div className="card">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold">Voter Rewards</h3>
        <button
          onClick={fetchClaimableRewards}
          disabled={claimableLoading}
          className="text-sm px-2 py-1 rounded"
          style={{
            backgroundColor: 'var(--bg-tertiary)',
            color: 'var(--text-muted)',
            opacity: claimableLoading ? 0.5 : 1,
          }}
        >
          {claimableLoading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {/* Total Claimable Display */}
      <div
        className="p-4 rounded-lg mb-4 text-center"
        style={{ backgroundColor: 'var(--bg-secondary)' }}
      >
        <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
          Total Claimable
        </p>
        <p
          className="text-2xl font-bold"
          style={{ color: hasClaimable ? 'var(--success)' : 'var(--text-primary)' }}
        >
          {parseFloat(totalClaimable).toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 4,
          })}{' '}
          ROSE
        </p>
        {claimCount > 0 && (
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            From {claimCount} proposal{claimCount !== 1 ? 's' : ''}
          </p>
        )}
      </div>

      {/* Error Display */}
      {(claimError || error) && (
        <div
          className="p-3 rounded-lg mb-4 text-sm flex justify-between items-center"
          style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: 'var(--error)' }}
        >
          <span>{claimError || error}</span>
          <button
            onClick={() => {
              setClaimError(null);
              if (setError) setError(null);
            }}
            className="ml-2 font-bold"
          >
            &times;
          </button>
        </div>
      )}

      {/* Claim Button */}
      <button
        onClick={handleClaim}
        disabled={!hasClaimable || isLoading}
        className="btn-primary w-full mb-4"
        style={{
          opacity: !hasClaimable || isLoading ? 0.5 : 1,
          backgroundColor: hasClaimable ? 'var(--success)' : undefined,
        }}
      >
        {actionLoading?.claimRewards
          ? 'Claiming...'
          : hasClaimable
          ? `Claim ${parseFloat(totalClaimable).toLocaleString()} ROSE`
          : 'No Rewards to Claim'}
      </button>

      {/* Expandable Claims List */}
      {claimCount > 0 && (
        <div>
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="w-full text-sm py-2 flex justify-between items-center"
            style={{ color: 'var(--text-muted)' }}
          >
            <span>View Details</span>
            <span>{showDetails ? '▲' : '▼'}</span>
          </button>

          {showDetails && (
            <div
              className="mt-2 rounded-lg overflow-hidden"
              style={{ border: '1px solid var(--border-color)' }}
            >
              {claimableRewards.claims.map((claim, index) => (
                <div
                  key={`${claim.proposalId}-${claim.claimType}`}
                  className="p-3 flex justify-between items-center text-sm"
                  style={{
                    backgroundColor: index % 2 === 0 ? 'var(--bg-secondary)' : 'var(--bg-tertiary)',
                  }}
                >
                  <div>
                    <span className="font-medium">Proposal #{claim.proposalId}</span>
                    <span
                      className="ml-2 text-xs px-2 py-0.5 rounded"
                      style={{
                        backgroundColor:
                          claim.claimType === 0
                            ? 'rgba(59, 130, 246, 0.2)'
                            : 'rgba(168, 85, 247, 0.2)',
                        color: claim.claimType === 0 ? '#3b82f6' : '#a855f7',
                      }}
                    >
                      {CLAIM_TYPE[claim.claimType]}
                    </span>
                  </div>
                  <span style={{ color: 'var(--text-muted)' }}>
                    {parseFloat(
                      formatUnits(BigInt(claim.votePower), 18)
                    ).toLocaleString()}{' '}
                    VP
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Info Box */}
      <div
        className="mt-4 p-3 rounded-lg text-xs"
        style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-muted)' }}
      >
        <strong>How it works:</strong>
        <ul className="mt-1 list-disc list-inside space-y-1">
          <li>Rewards are earned by voting on winning proposals</li>
          <li>Both direct votes and delegated votes earn rewards</li>
          <li>Claimed rewards are added to your staked ROSE</li>
          <li>Claim all pending rewards in a single transaction</li>
        </ul>
      </div>
    </div>
  );
};

export default ClaimRewardsPanel;
