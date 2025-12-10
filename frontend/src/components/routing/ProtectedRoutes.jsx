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
  const { loading, meetsThreshold, isConfigured } = usePassport();

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

  // Gate 2: Passport score (whitelist is checked by usePassport's loadScore)
  // No graceful degradation - strict blocking for sybil protection
  if (!meetsThreshold(PASSPORT_THRESHOLD)) {
    return <PassportBlockedPage threshold={PASSPORT_THRESHOLD} />;
  }

  // All gates passed - render protected content
  return children;
};

export default ProtectedRoutes;
