/**
 * QuorumBar - Visual progress indicator for proposal quorum
 * Shows participation count vs required 33% quorum
 */

import React from 'react';
import { useReadContract } from 'wagmi';
import { formatUnits } from 'viem';
import RoseGovernanceABI from '../../contracts/RoseGovernanceABI.json';
import { CONTRACTS, GOVERNANCE_CONSTANTS } from '../../constants/contracts';

const QuorumBar = ({ proposalId, totalAllocated, compact = false }) => {
  // Get total staked ROSE for calculating quorum
  const { data: totalStaked } = useReadContract({
    address: CONTRACTS.GOVERNANCE,
    abi: RoseGovernanceABI,
    functionName: 'totalStakedRose',
    query: {
      enabled: !!CONTRACTS.GOVERNANCE,
    },
  });

  // Calculate quorum requirement (33% of total staked)
  const totalStakedNumber = totalStaked ? parseFloat(formatUnits(totalStaked, 18)) : 0;
  const quorumRequired = totalStakedNumber * (GOVERNANCE_CONSTANTS.QUORUM_THRESHOLD / 10000);
  const totalAllocatedNumber = parseFloat(totalAllocated || '0');

  // Calculate progress percentage
  const progress = quorumRequired > 0 ? Math.min((totalAllocatedNumber / quorumRequired) * 100, 100) : 0;
  const quorumMet = totalAllocatedNumber >= quorumRequired;

  if (compact) {
    return (
      <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
        <div
          className="flex-1 h-1 rounded-full overflow-hidden"
          style={{ backgroundColor: 'var(--bg-tertiary)' }}
        >
          <div
            className="h-full transition-colors duration-300"
            style={{
              width: `${progress}%`,
              backgroundColor: quorumMet ? 'var(--success)' : 'var(--accent)',
            }}
          />
        </div>
        <span>
          {quorumMet ? 'Quorum met' : `${progress.toFixed(0)}% quorum`}
        </span>
      </div>
    );
  }

  return (
    <div className="p-3 rounded-lg" style={{ backgroundColor: 'var(--bg-secondary)' }}>
      <div className="flex justify-between items-center mb-2">
        <span className="text-sm font-medium">Quorum Progress</span>
        <span
          className="text-sm"
          style={{ color: quorumMet ? 'var(--success)' : 'var(--text-muted)' }}
        >
          {quorumMet ? 'Quorum Met' : `${progress.toFixed(1)}%`}
        </span>
      </div>

      <div
        className="h-2 rounded-full overflow-hidden"
        style={{ backgroundColor: 'var(--bg-tertiary)' }}
      >
        <div
          className="h-full transition-all duration-500"
          style={{
            width: `${progress}%`,
            backgroundColor: quorumMet ? 'var(--success)' : 'var(--accent)',
          }}
        />
      </div>

      <div className="flex justify-between text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
        <span>
          {totalAllocatedNumber.toLocaleString(undefined, { maximumFractionDigits: 0 })} ROSE allocated
        </span>
        <span>
          {quorumRequired.toLocaleString(undefined, { maximumFractionDigits: 0 })} required (33%)
        </span>
      </div>
    </div>
  );
};

export default QuorumBar;
