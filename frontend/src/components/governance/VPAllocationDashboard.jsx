/**
 * VPAllocationDashboard - Shows VP budget for Slow Track proposals
 *
 * Slow Track uses "scarce VP" - users have a budget they must allocate across proposals.
 * This dashboard shows:
 * - Total VP budget
 * - Currently allocated VP (locked in active proposals)
 * - Available VP (remaining budget)
 * - List of active allocations with proposal links
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { formatVotePower } from '../../constants/contracts';
import useAvailableVP from '../../hooks/useAvailableVP';
import Spinner from '../ui/Spinner';

/**
 * Format time remaining in human-readable format
 */
const formatTimeRemaining = (seconds) => {
  if (seconds <= 0) return 'Ended';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h`;
  const mins = Math.floor((seconds % 3600) / 60);
  return `${mins}m`;
};

const VPAllocationDashboard = () => {
  const { isConnected } = useAccount();
  const {
    totalVP,
    allocatedVP,
    availableVP,
    allocations,
    utilizationPercent,
    isLoading,
    error,
    refetch,
  } = useAvailableVP({ refreshInterval: 60000 }); // Refresh every minute

  // Don't render if not connected
  if (!isConnected) return null;

  // Don't render if user has no VP
  if (!isLoading && parseFloat(totalVP) === 0) return null;

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">VP Budget</h3>
        <span
          className="px-2 py-1 text-xs font-medium rounded"
          style={{
            backgroundColor: 'rgba(245, 158, 11, 0.1)',
            color: 'var(--warning)',
          }}
        >
          Slow Track
        </span>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-4">
          <Spinner className="h-6 w-6" />
        </div>
      ) : error ? (
        <div className="p-3 rounded-lg text-sm" style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)' }}>
          <p style={{ color: 'var(--error)' }}>{error}</p>
          <button
            onClick={refetch}
            className="mt-2 text-xs underline"
            style={{ color: 'var(--text-muted)' }}
          >
            Retry
          </button>
        </div>
      ) : (
        <>
          {/* Budget Progress Bar */}
          <div className="mb-4">
            <div className="flex justify-between text-xs mb-1">
              <span style={{ color: 'var(--text-muted)' }}>Budget Used</span>
              <span style={{ color: 'var(--warning)' }}>{utilizationPercent.toFixed(0)}%</span>
            </div>
            <div
              className="h-2 rounded-full overflow-hidden"
              style={{ backgroundColor: 'var(--bg-tertiary)' }}
            >
              <div
                className="h-full transition-all duration-500"
                style={{
                  width: `${Math.min(utilizationPercent, 100)}%`,
                  backgroundColor: utilizationPercent > 90 ? 'var(--error)' : 'var(--warning)',
                }}
              />
            </div>
          </div>

          {/* Stats Row */}
          <div className="grid grid-cols-3 gap-2 mb-4">
            <div className="text-center p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-secondary)' }}>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Total</p>
              <p className="font-semibold text-sm">{formatVotePower(parseFloat(totalVP))}</p>
            </div>
            <div className="text-center p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-secondary)' }}>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Allocated</p>
              <p className="font-semibold text-sm" style={{ color: 'var(--warning)' }}>
                {formatVotePower(parseFloat(allocatedVP))}
              </p>
            </div>
            <div className="text-center p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-secondary)' }}>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Available</p>
              <p className="font-semibold text-sm" style={{ color: 'var(--success)' }}>
                {formatVotePower(parseFloat(availableVP))}
              </p>
            </div>
          </div>

          {/* Active Allocations */}
          {allocations.length > 0 ? (
            <div>
              <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>
                Active Allocations ({allocations.length})
              </p>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {allocations.map((alloc) => (
                  <Link
                    key={alloc.proposalId}
                    to={`/governance/${alloc.proposalId}`}
                    className="block p-2 rounded-lg transition-all hover:scale-[1.01]"
                    style={{
                      backgroundColor: 'var(--bg-secondary)',
                      border: '1px solid var(--border-color)',
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">#{alloc.proposalId}</span>
                        <span
                          className="px-1.5 py-0.5 text-xs rounded font-medium"
                          style={{
                            backgroundColor: alloc.support
                              ? 'rgba(16, 185, 129, 0.1)'
                              : 'rgba(239, 68, 68, 0.1)',
                            color: alloc.support ? 'var(--success)' : 'var(--error)',
                          }}
                        >
                          {alloc.support ? 'Yay' : 'Nay'}
                        </span>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium">{formatVotePower(parseFloat(alloc.vpAmount))} VP</p>
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          {formatTimeRemaining(alloc.timeRemaining)} left
                        </p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ) : (
            <div
              className="p-3 rounded-lg text-center text-sm"
              style={{ backgroundColor: 'var(--bg-secondary)' }}
            >
              <p style={{ color: 'var(--text-muted)' }}>No active allocations</p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                Vote on Slow Track proposals to allocate VP
              </p>
            </div>
          )}

          {/* Info Box */}
          <div
            className="mt-4 p-2 rounded-lg text-xs"
            style={{ backgroundColor: 'rgba(245, 158, 11, 0.05)', color: 'var(--text-muted)' }}
          >
            <strong style={{ color: 'var(--warning)' }}>Slow Track:</strong> Your VP is a budget.
            Allocations persist until proposals resolve.
          </div>
        </>
      )}
    </div>
  );
};

export default VPAllocationDashboard;
