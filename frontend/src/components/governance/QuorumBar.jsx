/**
 * QuorumBar - Visual progress indicator for proposal quorum
 * Shows participation (VP votes) vs required quorum threshold
 *
 * Quorum thresholds are track-specific:
 * - Fast Track: 10% of total system VP
 * - Slow Track: 25% of total system VP
 */

import React from 'react';
import { TRACK_CONSTANTS, Track } from '../../constants/contracts';
import useGovernance from '../../hooks/useGovernance';

const QuorumBar = ({ track, totalVotes, compact = false }) => {
  // Get total system VP from backend (includes all stakers)
  const { totalSystemVP } = useGovernance();

  // Get track-specific quorum threshold
  const quorumBps = TRACK_CONSTANTS[track ?? Track.Slow]?.QUORUM_BPS ?? 2500;
  const quorumPercent = quorumBps / 100; // 25 for Slow, 10 for Fast

  // Calculate total system VP number
  const totalSystemVPNumber = parseFloat(totalSystemVP || '0');

  // Calculate quorum requirement (% of total system VP)
  const quorumRequired = totalSystemVPNumber * (quorumBps / 10000);

  // Total votes cast on proposal (yay + nay)
  const totalVotesNumber = parseFloat(totalVotes || '0');

  // Calculate progress percentage
  const progress = quorumRequired > 0 ? Math.min((totalVotesNumber / quorumRequired) * 100, 100) : 0;
  const quorumMet = totalVotesNumber >= quorumRequired;

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
          {totalVotesNumber.toLocaleString(undefined, { maximumFractionDigits: 2 })} VP voted
        </span>
        <span>
          {quorumRequired.toLocaleString(undefined, { maximumFractionDigits: 2 })} required ({quorumPercent}%)
        </span>
      </div>
    </div>
  );
};

export default QuorumBar;
