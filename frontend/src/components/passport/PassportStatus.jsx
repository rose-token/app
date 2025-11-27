import React from 'react';
import { usePassport } from '../../hooks/usePassport';
import { getPassportLevel, PASSPORT_LEVELS } from '../../constants/passport';

/**
 * Shield icon component
 */
const ShieldIcon = ({ className, style }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    style={style}
  >
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

/**
 * Refresh icon component
 */
const RefreshIcon = ({ className, style }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    style={style}
  >
    <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
    <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
    <path d="M16 16h5v5" />
  </svg>
);

/**
 * External link icon component
 */
const ExternalLinkIcon = ({ className, style }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    style={style}
  >
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);

/**
 * Format relative time (e.g., "5 min ago")
 */
const formatRelativeTime = (date) => {
  if (!date) return '';

  const now = new Date();
  const diffMs = now - date;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHour = Math.floor(diffMs / 3600000);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin} min ago`;
  if (diffHour < 24) return `${diffHour} hour${diffHour > 1 ? 's' : ''} ago`;
  return date.toLocaleDateString();
};

/**
 * PassportStatus component - displays Gitcoin Passport verification status
 *
 * @param {Object} props
 * @param {boolean} props.compact - Show compact version (for header)
 * @param {boolean} props.showRefresh - Show refresh button
 * @param {number} props.threshold - Optional threshold to show progress toward
 */
const PassportStatus = ({ compact = false, showRefresh = true, threshold }) => {
  const { score, loading, error, refetch, lastUpdated, isCached, isConfigured } = usePassport();

  // Get level info
  const level = getPassportLevel(score || 0);
  const displayScore = score !== null ? score.toFixed(1) : '--';

  // Handle refresh click
  const handleRefresh = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await refetch();
  };

  // Not configured - show setup message
  if (!isConfigured) {
    if (compact) return null;

    return (
      <div
        className="rounded-xl p-4"
        style={{
          background: 'rgba(255, 255, 255, 0.03)',
          border: '1px solid var(--border-subtle)',
        }}
      >
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Passport verification not configured
        </p>
      </div>
    );
  }

  // Compact version (for header)
  if (compact) {
    return (
      <div
        className="flex items-center gap-2 px-3 py-2 rounded-xl cursor-default"
        style={{
          background: 'rgba(255, 255, 255, 0.03)',
          border: '1px solid var(--border-subtle)',
        }}
        title={`Gitcoin Passport: ${displayScore} - ${level.label}`}
      >
        <ShieldIcon
          className="h-4 w-4"
          style={{ color: loading ? 'var(--text-muted)' : level.color }}
        />
        {loading ? (
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>...</span>
        ) : (
          <>
            <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
              {displayScore}
            </span>
            <span
              className="text-[10px] font-semibold uppercase tracking-wide"
              style={{ color: level.color }}
            >
              {level.label}
            </span>
          </>
        )}
        {showRefresh && !loading && (
          <button
            onClick={handleRefresh}
            className="ml-1 p-0.5 rounded hover:bg-white/10 transition-colors"
            title="Refresh score"
          >
            <RefreshIcon className="h-3 w-3" style={{ color: 'var(--text-muted)' }} />
          </button>
        )}
      </div>
    );
  }

  // Full version (for profile page)
  return (
    <div
      className="rounded-[20px] p-6"
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-subtle)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <ShieldIcon className="h-5 w-5" style={{ color: 'var(--rose-pink)' }} />
          <h3
            className="font-display text-base font-medium"
            style={{ color: 'var(--text-primary)' }}
          >
            Gitcoin Passport
          </h3>
        </div>
        {showRefresh && (
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="p-2 rounded-lg hover:bg-white/10 transition-colors disabled:opacity-50"
            title="Refresh score"
          >
            <RefreshIcon
              className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`}
              style={{ color: 'var(--text-muted)' }}
            />
          </button>
        )}
      </div>

      {/* Score display */}
      <div className="mb-4">
        <div className="flex items-baseline gap-2 mb-2">
          <span
            className="font-display text-4xl font-bold"
            style={{ color: loading ? 'var(--text-muted)' : level.color }}
          >
            {loading ? '--' : displayScore}
          </span>
          <span
            className="text-sm font-semibold uppercase tracking-wide"
            style={{ color: level.color }}
          >
            {level.label}
          </span>
        </div>

        {/* Progress bar (if threshold provided) */}
        {threshold && score !== null && (
          <div className="mb-2">
            <div
              className="h-2 rounded-full overflow-hidden"
              style={{ background: 'rgba(255, 255, 255, 0.1)' }}
            >
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${Math.min((score / threshold) * 100, 100)}%`,
                  background: score >= threshold
                    ? 'var(--success, #10b981)'
                    : 'linear-gradient(90deg, var(--rose-pink) 0%, var(--rose-gold) 100%)',
                }}
              />
            </div>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              {score >= threshold
                ? `Meets ${threshold}+ requirement`
                : `${(threshold - score).toFixed(1)} more needed for ${threshold}+ requirement`}
            </p>
          </div>
        )}

        {/* Last updated */}
        {lastUpdated && (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Updated {formatRelativeTime(lastUpdated)}
            {isCached && ' (cached)'}
          </p>
        )}
      </div>

      {/* Error message */}
      {error && (
        <div
          className="mb-4 px-3 py-2 rounded-lg text-xs"
          style={{
            background: 'var(--warning-bg)',
            border: '1px solid rgba(251, 191, 36, 0.3)',
            color: 'var(--warning)',
          }}
        >
          {error}
        </div>
      )}

      {/* Action link */}
      <a
        href="https://passport.gitcoin.co"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
        style={{ color: 'var(--rose-pink)' }}
      >
        {score !== null && score < PASSPORT_LEVELS.MEDIUM.min
          ? 'Build your Passport'
          : 'Manage Passport'}
        <ExternalLinkIcon className="h-3.5 w-3.5" />
      </a>
    </div>
  );
};

export default PassportStatus;
