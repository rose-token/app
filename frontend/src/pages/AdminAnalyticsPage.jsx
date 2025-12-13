/**
 * Admin Analytics Page
 * Dashboard for system-wide analytics and metrics
 */

import React, { useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { useIsAdmin } from '../hooks/useIsAdmin';
import { useAnalytics } from '../hooks/useAnalytics';
import WalletNotConnected from '../components/wallet/WalletNotConnected';
import ErrorMessage from '../components/ui/ErrorMessage';
import OverviewCards from '../components/analytics/OverviewCards';
import MarketplaceChart from '../components/analytics/MarketplaceChart';
import GovernanceChart from '../components/analytics/GovernanceChart';
import TreasuryChart from '../components/analytics/TreasuryChart';
import UserActivityChart from '../components/analytics/UserActivityChart';

const AdminAnalyticsPage = () => {
  const { isConnected } = useAccount();
  const { isAdmin, isLoading: adminLoading } = useIsAdmin();
  const navigate = useNavigate();

  const {
    overview,
    daily,
    isLoading,
    error,
    refetch,
  } = useAnalytics({ days: 30, pollInterval: 60000 });

  // Redirect non-admins to home
  useEffect(() => {
    if (!adminLoading && !isAdmin && isConnected) {
      navigate('/');
    }
  }, [isAdmin, adminLoading, isConnected, navigate]);

  // Show wallet not connected
  if (!isConnected) {
    return (
      <div className="max-w-7xl mx-auto animate-page-entrance">
        <WalletNotConnected />
      </div>
    );
  }

  // Show loading while checking admin status
  if (adminLoading) {
    return (
      <div className="max-w-7xl mx-auto animate-page-entrance flex justify-center items-center min-h-[400px]">
        <div className="text-center">
          <div
            className="inline-block w-8 h-8 border-4 border-t-transparent rounded-full animate-spin"
            style={{ borderColor: 'var(--rose-pink)', borderTopColor: 'transparent' }}
          />
          <p className="mt-4" style={{ color: 'var(--text-secondary)' }}>
            Verifying admin access...
          </p>
        </div>
      </div>
    );
  }

  // Safety check - useEffect should redirect, but this prevents flash of content
  if (!isAdmin) {
    return null;
  }

  return (
    <div className="max-w-7xl mx-auto animate-page-entrance">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1
            className="font-display text-4xl font-medium tracking-tight mb-2"
            style={{ letterSpacing: '-0.03em' }}
          >
            System <span className="gradient-text">Analytics</span>
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '1.0625rem' }}>
            Real-time metrics and activity trends
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            to="/admin"
            className="px-4 py-2 rounded-lg text-sm font-medium transition-all hover:opacity-80"
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-primary)',
            }}
          >
            Back to Admin
          </Link>
          <button
            onClick={refetch}
            disabled={isLoading}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-all hover:opacity-80 disabled:opacity-50"
            style={{
              background: 'var(--rose-gold)',
              color: 'var(--bg-primary)',
            }}
          >
            {isLoading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="mb-6">
          <ErrorMessage message={error} />
        </div>
      )}

      {/* Overview Cards */}
      <div className="mb-6">
        <OverviewCards data={overview} isLoading={isLoading} />
      </div>

      {/* Charts Grid - 2x2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <MarketplaceChart data={daily} isLoading={isLoading} />
        <GovernanceChart data={daily} isLoading={isLoading} />
        <TreasuryChart data={daily} isLoading={isLoading} />
        <UserActivityChart data={daily} isLoading={isLoading} />
      </div>

      {/* Data Info Card */}
      <div
        className="rounded-[20px] p-6"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-subtle)',
        }}
      >
        <h3 className="font-display text-lg font-medium mb-3" style={{ color: 'var(--text-primary)' }}>
          About Analytics Data
        </h3>
        <div className="space-y-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
          <p>
            Analytics data is collected from blockchain events and aggregated into daily snapshots.
            The dashboard refreshes automatically every 60 seconds.
          </p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>
              <strong style={{ color: 'var(--text-primary)' }}>Marketplace:</strong> Task creation,
              completion, and dispute rates from RoseMarketplace events
            </li>
            <li>
              <strong style={{ color: 'var(--text-primary)' }}>Governance:</strong> Proposal
              activity, voting participation, and pass rates from RoseGovernance events
            </li>
            <li>
              <strong style={{ color: 'var(--text-primary)' }}>Treasury:</strong> Deposit and
              redemption flows, NAV history from RoseTreasury events
            </li>
            <li>
              <strong style={{ color: 'var(--text-primary)' }}>Users:</strong> Active user counts,
              new user growth, and activity trends
            </li>
          </ul>
          <p className="mt-3 pt-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
            Data is retained for the last 30 days. Historical snapshots are rolled up daily at
            midnight UTC.
          </p>
        </div>
      </div>
    </div>
  );
};

export default AdminAnalyticsPage;
