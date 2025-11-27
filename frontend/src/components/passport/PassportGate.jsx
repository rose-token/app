import React from 'react';
import { usePassport } from '../../hooks/usePassport';
import PassportStatus from './PassportStatus';

/**
 * Warning icon component
 */
const WarningIcon = ({ className, style }) => (
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
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

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
 * PassportGate component - conditionally renders children based on passport score
 *
 * @param {Object} props
 * @param {number} props.threshold - Required score to pass
 * @param {string} props.action - Action name for error message (e.g., "create tasks")
 * @param {React.ReactNode} props.children - Protected content
 * @param {React.ReactNode} props.fallback - Custom fallback component
 * @param {boolean} props.showStatus - Show PassportStatus in blocked state
 * @param {boolean} props.allowBypassOnTimeout - Allow action if API times out (graceful degradation)
 */
const PassportGate = ({
  threshold,
  action,
  children,
  fallback,
  showStatus = true,
  allowBypassOnTimeout = true,
}) => {
  const { score, loading, error, refetch, isConfigured } = usePassport();

  // Not configured - pass through (developer responsibility to set up)
  if (!isConfigured) {
    return children;
  }

  // Check if user passes threshold
  const meetsThreshold = score !== null && score >= threshold;

  // Handle timeout/error bypass (graceful degradation)
  const isTimeoutError = error && (
    error.includes('timeout') ||
    error.includes('AbortError') ||
    error.includes('Rate limited')
  );
  const canBypass = allowBypassOnTimeout && isTimeoutError && score === null;

  // Show loading state
  if (loading) {
    return (
      <div
        className="rounded-[20px] p-7 text-center"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-subtle)',
        }}
      >
        <div className="flex items-center justify-center gap-2">
          <div
            className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin"
            style={{ borderColor: 'var(--rose-pink)', borderTopColor: 'transparent' }}
          />
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Verifying Passport score...
          </span>
        </div>
      </div>
    );
  }

  // Bypass with warning (graceful degradation)
  if (canBypass) {
    return (
      <>
        <div
          className="mb-4 p-4 rounded-xl flex items-start gap-3"
          style={{
            background: 'var(--warning-bg)',
            border: '1px solid rgba(251, 191, 36, 0.3)',
          }}
        >
          <WarningIcon className="h-5 w-5 flex-shrink-0 mt-0.5" style={{ color: 'var(--warning)' }} />
          <div>
            <p className="text-sm font-medium" style={{ color: 'var(--warning)' }}>
              Passport verification unavailable
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              Proceeding without verification. {error}
            </p>
          </div>
        </div>
        {children}
      </>
    );
  }

  // User passes threshold - render children
  if (meetsThreshold) {
    return children;
  }

  // User blocked - show custom fallback or default blocked UI
  if (fallback) {
    return fallback;
  }

  // Default blocked UI
  return (
    <div
      className="rounded-[20px] p-7"
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-subtle)',
      }}
    >
      <div className="flex items-center gap-3 mb-4">
        <div
          className="p-2.5 rounded-xl"
          style={{
            background: 'var(--warning-bg)',
            border: '1px solid rgba(251, 191, 36, 0.3)',
          }}
        >
          <ShieldIcon className="h-6 w-6" style={{ color: 'var(--warning)' }} />
        </div>
        <div>
          <h3
            className="font-display text-lg font-medium"
            style={{ color: 'var(--text-primary)' }}
          >
            Passport Verification Required
          </h3>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Prove you're human to {action}
          </p>
        </div>
      </div>

      <p className="mb-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
        A Gitcoin Passport score of <strong>{threshold}+</strong> is required to {action}.
        {score !== null && (
          <span>
            {' '}Your current score is <strong style={{ color: 'var(--warning)' }}>{score.toFixed(1)}</strong>.
          </span>
        )}
      </p>

      {showStatus && (
        <div className="mb-5">
          <PassportStatus threshold={threshold} showRefresh={true} />
        </div>
      )}

      {!showStatus && (
        <div className="flex flex-wrap gap-3">
          <a
            href="https://passport.gitcoin.co"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm transition-transform hover:scale-[1.02]"
            style={{
              background: 'linear-gradient(135deg, var(--rose-pink) 0%, var(--rose-gold) 100%)',
              color: 'var(--bg-primary)',
            }}
          >
            Build Your Passport
            <ExternalLinkIcon className="h-4 w-4" />
          </a>
          <button
            onClick={refetch}
            className="px-4 py-2.5 rounded-xl font-semibold text-sm transition-colors"
            style={{
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-primary)',
            }}
          >
            Refresh Score
          </button>
        </div>
      )}
    </div>
  );
};

export default PassportGate;
