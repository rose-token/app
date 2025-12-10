import React from 'react';
import { useAccount } from 'wagmi';
import { useLocation } from 'react-router-dom';
import { usePassport } from '../../hooks/usePassport';
import WalletNotConnected from '../wallet/WalletNotConnected';
import PassportBlockedPage from '../passport/PassportBlockedPage';

const PASSPORT_THRESHOLD = 20;
const UNPROTECTED_ROUTES = ['/help'];

/**
 * ProtectedRoutes - Route-level gate for wallet connection and passport verification
 *
 * Flow:
 * 1. Check if route is unprotected (/help) - bypass all checks
 * 2. Check wallet connection - show WalletNotConnected if disconnected
 * 3. Check passport score >= 20 - show PassportBlockedPage if blocked
 * 4. Render children if all checks pass
 *
 * Whitelist bypass is handled automatically by usePassport hook
 */
const ProtectedRoutes = ({ children }) => {
  const { isConnected } = useAccount();
  const location = useLocation();
  const { score, loading, meetsThreshold, isConfigured, error } = usePassport();

  // Check if current route is unprotected
  const isUnprotectedRoute = UNPROTECTED_ROUTES.includes(location.pathname);

  // Skip all checks for unprotected routes
  if (isUnprotectedRoute) {
    return children;
  }

  // Gate 1: Wallet connection
  if (!isConnected) {
    return <WalletNotConnected />;
  }

  // Passport not configured - pass through (dev responsibility)
  if (!isConfigured) {
    return children;
  }

  // Show loading state during any passport check (prevents flash of content)
  if (loading) {
    return (
      <div
        className="rounded-[20px] p-7 text-center"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-subtle)',
          boxShadow: 'var(--shadow-card)',
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

  // Graceful degradation: Allow access on API errors (same pattern as PassportGate)
  const isTimeoutError = error && (
    error.includes('timeout') ||
    error.includes('AbortError') ||
    error.includes('Rate limited')
  );
  if (isTimeoutError && score === null) {
    // Show warning but allow access to prevent lockout during API outages
    return (
      <>
        <div
          className="mb-4 p-4 rounded-xl flex items-start gap-3"
          style={{
            background: 'var(--warning-bg)',
            border: '1px solid rgba(251, 191, 36, 0.3)',
          }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="h-5 w-5 flex-shrink-0 mt-0.5"
            style={{ color: 'var(--warning)' }}
          >
            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
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

  // Gate 2: Passport score (whitelist is checked by usePassport's loadScore)
  if (!meetsThreshold(PASSPORT_THRESHOLD)) {
    return <PassportBlockedPage threshold={PASSPORT_THRESHOLD} />;
  }

  // All gates passed - render protected content
  return children;
};

export default ProtectedRoutes;
