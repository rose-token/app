import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { formatUnits } from 'viem';
import { useIsAdmin } from '../hooks/useIsAdmin';
import { useDispute } from '../hooks/useDispute';
import WalletNotConnected from '../components/wallet/WalletNotConnected';
import ErrorMessage from '../components/ui/ErrorMessage';
import { Button } from '../components/ui/button';
import ProfileBadge from '../components/profile/ProfileBadge';

const AdminDisputesPage = () => {
  const { isConnected } = useAccount();
  const { isAdmin, isLoading: adminLoading } = useIsAdmin();
  const navigate = useNavigate();

  const {
    listDisputes,
    getDisputeStats,
    resolveDispute,
    actionLoading,
  } = useDispute();

  // Disputes list state
  const [disputes, setDisputes] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [openOnly, setOpenOnly] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Stats state
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);

  // Resolution modal state
  const [selectedDispute, setSelectedDispute] = useState(null);
  const [workerPct, setWorkerPct] = useState(50);
  const [resolutionError, setResolutionError] = useState(null);

  // Redirect non-admins to home
  useEffect(() => {
    if (!adminLoading && !isAdmin && isConnected) {
      navigate('/');
    }
  }, [isAdmin, adminLoading, isConnected, navigate]);

  // Fetch disputes
  const fetchDisputes = useCallback(async () => {
    if (!isAdmin) return;

    setIsLoading(true);
    setError(null);

    try {
      const result = await listDisputes(page, pageSize, openOnly);
      setDisputes(result.disputes || []);
      setTotal(result.total || 0);
    } catch (err) {
      console.error('Failed to fetch disputes:', err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [isAdmin, listDisputes, page, pageSize, openOnly]);

  // Fetch stats
  const fetchStats = useCallback(async () => {
    if (!isAdmin) return;

    setStatsLoading(true);

    try {
      const result = await getDisputeStats();
      setStats(result);
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    } finally {
      setStatsLoading(false);
    }
  }, [isAdmin, getDisputeStats]);

  // Fetch on mount and when filters change
  useEffect(() => {
    fetchDisputes();
  }, [fetchDisputes]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  // Handle resolution
  const handleResolve = async () => {
    if (!selectedDispute) return;

    setResolutionError(null);

    try {
      await resolveDispute(selectedDispute.taskId, workerPct);
      setSelectedDispute(null);
      setWorkerPct(50);
      // Refresh data
      fetchDisputes();
      fetchStats();
    } catch (err) {
      console.error('Resolution failed:', err);
      setResolutionError(err.message);
    }
  };

  // Calculate preview amounts
  const calculatePreview = (dispute) => {
    if (!dispute) return { workerAmount: '0', customerRefund: '0' };
    // Assuming task deposit is available - in a real implementation you'd fetch this
    // For now, show percentages
    return {
      workerPct: workerPct,
      customerPct: 100 - workerPct,
    };
  };

  // Format time
  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleString();
  };

  // Format duration
  const formatDuration = (hours) => {
    if (!hours || hours === 0) return 'N/A';
    if (hours < 1) return `${Math.round(hours * 60)} minutes`;
    if (hours < 24) return `${Math.round(hours)} hours`;
    return `${Math.round(hours / 24)} days`;
  };

  // Show wallet not connected
  if (!isConnected) {
    return (
      <div className="max-w-6xl animate-fade-in">
        <WalletNotConnected />
      </div>
    );
  }

  // Show loading while checking admin status
  if (adminLoading) {
    return (
      <div className="max-w-6xl animate-fade-in flex justify-center items-center min-h-[400px]">
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

  // Safety check
  if (!isAdmin) {
    return null;
  }

  const preview = calculatePreview(selectedDispute);
  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="max-w-6xl animate-fade-in">
      {/* Header */}
      <div className="text-center mb-10">
        <h1
          className="font-display text-4xl font-medium tracking-tight mb-2"
          style={{ letterSpacing: '-0.03em' }}
        >
          Dispute <span className="gradient-text">Resolution</span>
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '1.0625rem' }}>
          Review and resolve marketplace disputes
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div
          className="rounded-xl p-5"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}
        >
          <p className="text-xs uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>
            Total Disputes
          </p>
          <p className="text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
            {statsLoading ? '...' : stats?.totalDisputes || 0}
          </p>
        </div>

        <div
          className="rounded-xl p-5"
          style={{ background: 'var(--error-bg)', border: '1px solid rgba(248, 113, 113, 0.3)' }}
        >
          <p className="text-xs uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>
            Open Disputes
          </p>
          <p className="text-2xl font-semibold" style={{ color: 'var(--error)' }}>
            {statsLoading ? '...' : stats?.openDisputes || 0}
          </p>
        </div>

        <div
          className="rounded-xl p-5"
          style={{ background: 'var(--success-bg)', border: '1px solid rgba(74, 222, 128, 0.3)' }}
        >
          <p className="text-xs uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>
            Resolved
          </p>
          <p className="text-2xl font-semibold" style={{ color: 'var(--success)' }}>
            {statsLoading ? '...' : stats?.resolvedDisputes || 0}
          </p>
        </div>

        <div
          className="rounded-xl p-5"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}
        >
          <p className="text-xs uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>
            Avg Resolution Time
          </p>
          <p className="text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
            {statsLoading ? '...' : formatDuration(stats?.avgResolutionTimeHours)}
          </p>
        </div>
      </div>

      {/* Resolution Breakdown (if stats available) */}
      {stats && stats.resolvedDisputes > 0 && (
        <div
          className="rounded-[20px] p-6 mb-6"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}
        >
          <h3 className="font-medium mb-4" style={{ color: 'var(--text-primary)' }}>
            Resolution Breakdown
          </h3>
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center">
              <p className="text-lg font-semibold" style={{ color: 'var(--success)' }}>
                {stats.resolutionBreakdown?.favorWorker || 0}
              </p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Favor Worker</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-semibold" style={{ color: 'var(--rose-pink)' }}>
                {stats.resolutionBreakdown?.partial || 0}
              </p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Partial Split</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-semibold" style={{ color: 'var(--info)' }}>
                {stats.resolutionBreakdown?.favorCustomer || 0}
              </p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Favor Customer</p>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div
        className="rounded-[20px] p-6 mb-6"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={openOnly}
                onChange={(e) => {
                  setOpenOnly(e.target.checked);
                  setPage(1);
                }}
                className="w-4 h-4 rounded"
                style={{ accentColor: 'var(--rose-pink)' }}
              />
              <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                Show only open disputes
              </span>
            </label>
          </div>

          <Button onClick={() => { fetchDisputes(); fetchStats(); }} disabled={isLoading}>
            Refresh
          </Button>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <ErrorMessage message={error} onDismiss={() => setError(null)} />
      )}

      {/* Disputes List */}
      <div
        className="rounded-[20px] backdrop-blur-[20px] p-7"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-subtle)',
          boxShadow: 'var(--shadow-card)',
        }}
      >
        <h2
          className="font-display text-2xl font-medium mb-6"
          style={{ letterSpacing: '-0.02em', color: 'var(--text-primary)' }}
        >
          {openOnly ? 'Open Disputes' : 'All Disputes'} ({total})
        </h2>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <div
              className="inline-block w-8 h-8 border-4 border-t-transparent rounded-full animate-spin"
              style={{ borderColor: 'var(--rose-pink)', borderTopColor: 'transparent' }}
            />
          </div>
        ) : disputes.length === 0 ? (
          <div
            className="text-center py-12 rounded-xl"
            style={{ background: 'var(--bg-primary)', color: 'var(--text-secondary)' }}
          >
            {openOnly ? 'No open disputes' : 'No disputes found'}
          </div>
        ) : (
          <div className="space-y-4">
            {disputes.map((dispute) => (
              <div
                key={dispute.taskId}
                className="p-5 rounded-xl"
                style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)' }}
              >
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                        Task #{dispute.taskId}
                      </span>
                      <span
                        className="px-2 py-0.5 rounded-full text-xs font-medium"
                        style={{
                          background: dispute.isResolved ? 'var(--success-bg)' : 'var(--error-bg)',
                          color: dispute.isResolved ? 'var(--success)' : 'var(--error)',
                        }}
                      >
                        {dispute.isResolved ? 'Resolved' : 'Open'}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                      <div>
                        <span style={{ color: 'var(--text-muted)' }}>Initiator: </span>
                        <ProfileBadge address={dispute.initiator} size="xs" />
                      </div>
                      <div>
                        <span style={{ color: 'var(--text-muted)' }}>Disputed At: </span>
                        <span style={{ color: 'var(--text-secondary)' }}>
                          {formatDate(dispute.disputedAt)}
                        </span>
                      </div>
                    </div>

                    {dispute.isResolved && dispute.resolution && (
                      <div className="mt-3 pt-3 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
                          <div>
                            <span style={{ color: 'var(--text-muted)' }}>Worker: </span>
                            <span style={{ color: 'var(--success)' }}>{dispute.resolution.workerPct}%</span>
                          </div>
                          <div>
                            <span style={{ color: 'var(--text-muted)' }}>Resolved: </span>
                            <span style={{ color: 'var(--text-secondary)' }}>
                              {formatDate(dispute.resolution.resolvedAt)}
                            </span>
                          </div>
                          <div>
                            <span style={{ color: 'var(--text-muted)' }}>By: </span>
                            <ProfileBadge address={dispute.resolution.resolvedBy} size="xs" />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {!dispute.isResolved && (
                    <Button
                      onClick={() => {
                        setSelectedDispute(dispute);
                        setWorkerPct(50);
                        setResolutionError(null);
                      }}
                    >
                      Resolve
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex justify-center gap-2 mt-6">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1 || isLoading}
            >
              Previous
            </Button>
            <span
              className="flex items-center px-4 text-sm"
              style={{ color: 'var(--text-secondary)' }}
            >
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages || isLoading}
            >
              Next
            </Button>
          </div>
        )}
      </div>

      {/* Resolution Modal */}
      {selectedDispute && (
        <div
          className="fixed inset-0 flex items-center justify-center z-50"
          style={{ background: 'rgba(0, 0, 0, 0.7)', backdropFilter: 'blur(4px)' }}
          onClick={() => setSelectedDispute(null)}
        >
          <div
            className="rounded-[20px] p-7 max-w-lg w-full mx-4"
            style={{
              background: 'var(--bg-card-solid)',
              border: '1px solid var(--border-subtle)',
              boxShadow: 'var(--shadow-card)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              className="font-display text-xl font-medium mb-4"
              style={{ color: 'var(--text-primary)', letterSpacing: '-0.02em' }}
            >
              Resolve Dispute - Task #{selectedDispute.taskId}
            </h3>

            <div className="space-y-4 mb-6">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p style={{ color: 'var(--text-muted)' }}>Initiator</p>
                  <ProfileBadge address={selectedDispute.initiator} size="sm" />
                </div>
                <div>
                  <p style={{ color: 'var(--text-muted)' }}>Disputed At</p>
                  <p style={{ color: 'var(--text-secondary)' }}>
                    {formatDate(selectedDispute.disputedAt)}
                  </p>
                </div>
              </div>

              {selectedDispute.reasonHash && (
                <div>
                  <p className="text-sm mb-1" style={{ color: 'var(--text-muted)' }}>
                    Reason Hash
                  </p>
                  <p
                    className="text-xs font-mono p-2 rounded-lg break-all"
                    style={{ background: 'var(--bg-primary)', color: 'var(--text-secondary)' }}
                  >
                    {selectedDispute.reasonHash}
                  </p>
                </div>
              )}
            </div>

            {/* Resolution Slider */}
            <div className="mb-6">
              <div className="flex justify-between mb-2">
                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                  Payment Split
                </span>
              </div>

              <div className="relative">
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={workerPct}
                  onChange={(e) => setWorkerPct(parseInt(e.target.value))}
                  className="w-full h-2 rounded-lg appearance-none cursor-pointer"
                  style={{
                    background: `linear-gradient(to right, var(--success) 0%, var(--success) ${workerPct}%, var(--info) ${workerPct}%, var(--info) 100%)`,
                  }}
                />
              </div>

              <div className="flex justify-between mt-4">
                <div className="text-center">
                  <p className="text-2xl font-semibold" style={{ color: 'var(--success)' }}>
                    {workerPct}%
                  </p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>To Worker</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-semibold" style={{ color: 'var(--info)' }}>
                    {100 - workerPct}%
                  </p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>To Customer</p>
                </div>
              </div>

              {/* Quick preset buttons */}
              <div className="flex justify-center gap-2 mt-4">
                <button
                  onClick={() => setWorkerPct(0)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                  style={{
                    background: workerPct === 0 ? 'var(--info)' : 'var(--bg-primary)',
                    color: workerPct === 0 ? 'white' : 'var(--text-secondary)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  100% Customer
                </button>
                <button
                  onClick={() => setWorkerPct(50)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                  style={{
                    background: workerPct === 50 ? 'var(--rose-pink)' : 'var(--bg-primary)',
                    color: workerPct === 50 ? 'white' : 'var(--text-secondary)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  50/50 Split
                </button>
                <button
                  onClick={() => setWorkerPct(100)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                  style={{
                    background: workerPct === 100 ? 'var(--success)' : 'var(--bg-primary)',
                    color: workerPct === 100 ? 'white' : 'var(--text-secondary)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  100% Worker
                </button>
              </div>
            </div>

            {/* Warning */}
            <div
              className="mb-6 p-4 rounded-xl"
              style={{ background: 'var(--warning-bg)', border: '1px solid rgba(251, 191, 36, 0.3)' }}
            >
              <p className="text-sm" style={{ color: 'var(--warning)' }}>
                This action is irreversible. The funds will be distributed according to the split
                above, and the stakeholder will receive their vROSE back.
              </p>
            </div>

            {resolutionError && (
              <div
                className="mb-4 p-4 rounded-xl text-sm"
                style={{
                  background: 'var(--error-bg)',
                  border: '1px solid rgba(248, 113, 113, 0.3)',
                  color: 'var(--error)',
                }}
              >
                {resolutionError}
              </div>
            )}

            <div className="flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => setSelectedDispute(null)}
                disabled={actionLoading.resolveDispute}
              >
                Cancel
              </Button>
              <Button
                onClick={handleResolve}
                disabled={actionLoading.resolveDispute}
                style={{
                  background: 'linear-gradient(135deg, var(--rose-pink) 0%, var(--rose-gold) 100%)',
                }}
              >
                {actionLoading.resolveDispute ? (
                  <>
                    <div
                      className="inline-block w-4 h-4 border-2 border-t-transparent rounded-full animate-spin mr-2"
                      style={{ borderColor: 'var(--bg-primary)', borderTopColor: 'transparent' }}
                    />
                    Resolving...
                  </>
                ) : (
                  'Confirm Resolution'
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminDisputesPage;
