import React from 'react';
import { usePassport } from '../../hooks/usePassport';
import PassportStatus from './PassportStatus';

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
 * PassportBlockedPage - Full-page passport requirement UI
 *
 * Displays when user's passport score is below the required threshold.
 * Reuses styling patterns from PassportGate for consistency.
 *
 * @param {Object} props
 * @param {number} props.threshold - Required score to access the platform
 */
const PassportBlockedPage = ({ threshold = 20 }) => {
  const { score, refetch, loading } = usePassport();

  return (
    <div
      className="rounded-[20px] p-7"
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-subtle)',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
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
            className="font-display text-xl font-medium"
            style={{ color: 'var(--text-primary)' }}
          >
            Passport Verification Required
          </h3>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Prove you're human to access Rose Token
          </p>
        </div>
      </div>

      {/* Explanation */}
      <p className="mb-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
        A Gitcoin Passport score of <strong>{threshold}+</strong> is required to access this platform.
        {score !== null && (
          <span>
            {' '}Your current score is <strong style={{ color: 'var(--warning)' }}>{score.toFixed(1)}</strong>.
          </span>
        )}
      </p>

      <p className="mb-6 text-sm" style={{ color: 'var(--text-secondary)' }}>
        Gitcoin Passport helps protect against bots and ensures fair access. Build your score by connecting
        verifiable credentials like GitHub, Twitter, or Google.
      </p>

      {/* Passport Status */}
      <div className="mb-6">
        <PassportStatus threshold={threshold} showRefresh={true} />
      </div>

      {/* Actions */}
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
          disabled={loading}
          className="px-4 py-2.5 rounded-xl font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            background: 'rgba(255, 255, 255, 0.05)',
            border: '1px solid var(--border-subtle)',
            color: 'var(--text-primary)',
          }}
        >
          {loading ? 'Refreshing...' : 'Refresh Score'}
        </button>
      </div>

      {/* Help Link */}
      <div className="mt-6 pt-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Need help? Visit our{' '}
          <a
            href="/help"
            className="font-medium hover:underline"
            style={{ color: 'var(--rose-pink)' }}
          >
            Help Center
          </a>
        </p>
      </div>
    </div>
  );
};

export default PassportBlockedPage;
