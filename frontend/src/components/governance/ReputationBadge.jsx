/**
 * ReputationBadge - Display reputation score with color coding
 * Shows reputation percentage with tooltip breakdown
 */

import React, { useState } from 'react';

// Reputation level colors
const getReputationColor = (score) => {
  if (score >= 90) return 'var(--success)';
  if (score >= 70) return 'var(--accent)';
  if (score >= 50) return 'var(--warning)';
  return 'var(--error)';
};

const getReputationLabel = (score) => {
  if (score >= 90) return 'Excellent';
  if (score >= 70) return 'Good';
  if (score >= 50) return 'Fair';
  return 'Low';
};

const ReputationBadge = ({
  score,
  size = 'md',
  showLabel = false,
  showTooltip = true,
  tasksCompleted,
  disputes,
  failedProposals,
}) => {
  const [showTip, setShowTip] = useState(false);

  const color = getReputationColor(score);
  const label = getReputationLabel(score);

  const sizeClasses = {
    sm: 'text-xs px-2 py-0.5',
    md: 'text-sm px-2.5 py-1',
    lg: 'text-base px-3 py-1.5',
  };

  return (
    <div
      className="relative inline-block"
      onMouseEnter={() => showTooltip && setShowTip(true)}
      onMouseLeave={() => setShowTip(false)}
    >
      <div
        className={`rounded-full font-semibold ${sizeClasses[size]}`}
        style={{
          backgroundColor: `${color}20`,
          color: color,
        }}
      >
        {score.toFixed(0)}%{showLabel && ` ${label}`}
      </div>

      {/* Tooltip */}
      {showTip && (
        <div
          className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 p-3 rounded-lg text-sm whitespace-nowrap"
          style={{
            backgroundColor: 'var(--bg-primary)',
            border: '1px solid var(--border-color)',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
          }}
        >
          <div className="font-semibold mb-2" style={{ color }}>
            {label} Reputation
          </div>

          {tasksCompleted !== undefined && (
            <div className="flex justify-between gap-4 text-xs" style={{ color: 'var(--text-muted)' }}>
              <span>Tasks Completed:</span>
              <span>{tasksCompleted}</span>
            </div>
          )}

          {disputes !== undefined && (
            <div className="flex justify-between gap-4 text-xs" style={{ color: 'var(--text-muted)' }}>
              <span>Disputes:</span>
              <span style={{ color: disputes > 0 ? 'var(--error)' : 'var(--text-muted)' }}>
                {disputes}
              </span>
            </div>
          )}

          {failedProposals !== undefined && (
            <div className="flex justify-between gap-4 text-xs" style={{ color: 'var(--text-muted)' }}>
              <span>Failed Proposals:</span>
              <span style={{ color: failedProposals > 0 ? 'var(--warning)' : 'var(--text-muted)' }}>
                {failedProposals}
              </span>
            </div>
          )}

          <div className="mt-2 pt-2 border-t text-xs" style={{ borderColor: 'var(--border-color)', color: 'var(--text-muted)' }}>
            <p>70%+ to vote</p>
            <p>90%+ to propose/delegate</p>
          </div>

          {/* Arrow */}
          <div
            className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0"
            style={{
              borderLeft: '6px solid transparent',
              borderRight: '6px solid transparent',
              borderTop: '6px solid var(--border-color)',
            }}
          />
        </div>
      )}
    </div>
  );
};

export default ReputationBadge;
