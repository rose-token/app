import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { useIsAdmin } from '../hooks/useIsAdmin';
import { useRebalance } from '../hooks/useRebalance';
import { useWhitelist } from '../hooks/useWhitelist';
import { useBackup } from '../hooks/useBackup';
import WalletNotConnected from '../components/wallet/WalletNotConnected';
import ErrorMessage from '../components/ui/ErrorMessage';
import { Button } from '../components/ui/button';
import { ethers } from 'ethers';

const AdminPage = () => {
  const { isConnected } = useAccount();
  const { isAdmin, isLoading: adminLoading } = useIsAdmin();
  const navigate = useNavigate();
  const { triggerRebalance } = useRebalance();
  const {
    whitelist,
    isLoading: whitelistLoading,
    error: whitelistError,
    fetchWhitelist,
    addAddress,
    removeAddress,
    clearError: clearWhitelistError,
  } = useWhitelist();
  const {
    createBackup,
    getStatus: getBackupStatus,
    restoreBackup,
    isLoading: backupLoading,
    error: backupError,
    clearError: clearBackupError,
  } = useBackup();

  // Rebalance state
  const [rebalanceLoading, setRebalanceLoading] = useState(false);
  const [rebalanceError, setRebalanceError] = useState(null);
  const [rebalanceResult, setRebalanceResult] = useState(null);

  // Whitelist form state
  const [newAddress, setNewAddress] = useState('');
  const [newScore, setNewScore] = useState('');
  const [addressToRemove, setAddressToRemove] = useState(null);
  const [whitelistActionLoading, setWhitelistActionLoading] = useState(false);

  // Backup state
  const [backupStatus, setBackupStatus] = useState(null);
  const [backupResult, setBackupResult] = useState(null);
  const [restoreConfirm, setRestoreConfirm] = useState(false);
  const [restoreResult, setRestoreResult] = useState(null);

  // Redirect non-admins to home
  useEffect(() => {
    if (!adminLoading && !isAdmin && isConnected) {
      navigate('/');
    }
  }, [isAdmin, adminLoading, isConnected, navigate]);

  // Fetch whitelist when admin is confirmed
  useEffect(() => {
    if (isAdmin) {
      fetchWhitelist();
    }
  }, [isAdmin, fetchWhitelist]);

  // Fetch backup status when admin is confirmed
  useEffect(() => {
    if (isAdmin) {
      getBackupStatus()
        .then(setBackupStatus)
        .catch((err) => console.error('Failed to fetch backup status:', err));
    }
  }, [isAdmin, getBackupStatus]);

  // Handle adding a new address to whitelist
  const handleAddAddress = async (e) => {
    e.preventDefault();

    if (!newAddress || !newScore) {
      return;
    }

    if (!ethers.isAddress(newAddress)) {
      alert('Please enter a valid Ethereum address');
      return;
    }

    const scoreNum = Number(newScore);
    if (isNaN(scoreNum) || scoreNum < 0 || scoreNum > 100) {
      alert('Score must be a number between 0 and 100');
      return;
    }

    setWhitelistActionLoading(true);
    try {
      await addAddress(newAddress, scoreNum);
      setNewAddress('');
      setNewScore('');
    } catch (error) {
      console.error('Failed to add address:', error);
    } finally {
      setWhitelistActionLoading(false);
    }
  };

  // Handle removing an address from whitelist
  const handleRemoveAddress = async (addr) => {
    setWhitelistActionLoading(true);
    try {
      await removeAddress(addr);
      setAddressToRemove(null);
    } catch (error) {
      console.error('Failed to remove address:', error);
    } finally {
      setWhitelistActionLoading(false);
    }
  };

  // Handle rebalance trigger
  const handleRebalance = async () => {
    setRebalanceLoading(true);
    setRebalanceError(null);
    setRebalanceResult(null);

    try {
      const result = await triggerRebalance();
      setRebalanceResult(result);
    } catch (error) {
      setRebalanceError(error.message);
    } finally {
      setRebalanceLoading(false);
    }
  };

  // Handle backup creation
  const handleCreateBackup = async () => {
    clearBackupError();
    setBackupResult(null);

    try {
      const result = await createBackup();
      setBackupResult(result);
      // Refresh status after backup
      const status = await getBackupStatus();
      setBackupStatus(status);
    } catch (error) {
      console.error('Backup failed:', error);
    }
  };

  // Handle restore
  const handleRestore = async () => {
    if (!restoreConfirm) {
      setRestoreConfirm(true);
      return;
    }

    clearBackupError();
    setRestoreResult(null);

    try {
      const result = await restoreBackup();
      setRestoreResult(result);
      setRestoreConfirm(false);
    } catch (error) {
      console.error('Restore failed:', error);
      setRestoreConfirm(false);
    }
  };

  const cancelRestore = () => {
    setRestoreConfirm(false);
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

  // Safety check - useEffect should redirect, but this prevents flash of content
  if (!isAdmin) {
    return null;
  }

  return (
    <div className="max-w-6xl animate-fade-in">
      {/* Header */}
      <div className="text-center mb-10">
        <h1
          className="font-display text-4xl font-medium tracking-tight mb-2"
          style={{ letterSpacing: '-0.03em' }}
        >
          Admin <span className="gradient-text">Dashboard</span>
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '1.0625rem' }}>
          Treasury Management & System Controls
        </p>
      </div>

      {/* Quick Navigation */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <Link
          to="/admin/disputes"
          className="rounded-[20px] p-6 transition-all hover:border-[rgba(248,113,113,0.5)]"
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-subtle)',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium text-lg" style={{ color: 'var(--text-primary)' }}>
                Dispute Resolution
              </h3>
              <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                Review and resolve marketplace disputes
              </p>
            </div>
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center"
              style={{ background: 'var(--error-bg)' }}
            >
              <span style={{ color: 'var(--error)', fontSize: '1.5rem' }}>!</span>
            </div>
          </div>
        </Link>

        <Link
          to="#backup"
          onClick={(e) => {
            e.preventDefault();
            document.getElementById('backup-section')?.scrollIntoView({ behavior: 'smooth' });
          }}
          className="rounded-[20px] p-6 transition-all hover:border-[rgba(74,222,128,0.5)]"
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-subtle)',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium text-lg" style={{ color: 'var(--text-primary)' }}>
                Database Backup
              </h3>
              <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                Backup and restore PostgreSQL database
              </p>
            </div>
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center"
              style={{ background: 'rgba(74, 222, 128, 0.15)' }}
            >
              <span style={{ color: 'var(--success)', fontSize: '1.5rem' }}>&#x1F4BE;</span>
            </div>
          </div>
        </Link>
      </div>

      {/* Rebalance Card */}
      <div
        className="rounded-[20px] backdrop-blur-[20px] p-7 mb-6 transition-all hover:border-[rgba(212,175,140,0.35)]"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-subtle)',
          boxShadow: 'var(--shadow-card)',
        }}
      >
        <h2
          className="font-display text-2xl font-medium mb-4"
          style={{ letterSpacing: '-0.02em', color: 'var(--text-primary)' }}
        >
          Manual Treasury Rebalance
        </h2>

        <p className="mb-6" style={{ color: 'var(--text-secondary)' }}>
          Trigger a manual rebalance of treasury assets to target allocations (BTC: 30%, Gold: 30%,
          USDC: 20%, ROSE: 20%). The system will calculate required swaps and execute them via LiFi.
        </p>

        {rebalanceError && (
          <ErrorMessage message={rebalanceError} onDismiss={() => setRebalanceError(null)} />
        )}

        <Button onClick={handleRebalance} disabled={rebalanceLoading} className="w-full sm:w-auto">
          {rebalanceLoading ? (
            <>
              <div
                className="inline-block w-4 h-4 border-2 border-t-transparent rounded-full animate-spin mr-2"
                style={{ borderColor: 'var(--bg-primary)', borderTopColor: 'transparent' }}
              />
              Rebalancing...
            </>
          ) : (
            'Trigger Rebalance'
          )}
        </Button>
      </div>

      {/* Results Card */}
      {rebalanceResult && (
        <div
          className="rounded-[20px] backdrop-blur-[20px] p-7 mb-6"
          style={{
            background: 'var(--bg-card)',
            border: '1px solid rgba(74, 222, 128, 0.3)',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          <h3 className="font-display text-xl font-medium mb-4" style={{ color: 'var(--success)' }}>
            Rebalance Complete
          </h3>

          <div className="space-y-3">
            {rebalanceResult.txHash && (
              <div>
                <span style={{ color: 'var(--text-secondary)' }}>Transaction Hash:</span>
                <a
                  href={`https://sepolia.arbiscan.io/tx/${rebalanceResult.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-2 font-mono text-sm hover:opacity-80 transition-opacity"
                  style={{ color: 'var(--rose-pink)' }}
                >
                  {rebalanceResult.txHash?.slice(0, 10)}...{rebalanceResult.txHash?.slice(-8)}
                </a>
              </div>
            )}

            <div>
              <span style={{ color: 'var(--text-secondary)' }}>Swaps Executed:</span>
              <span className="ml-2" style={{ color: 'var(--text-primary)' }}>
                {rebalanceResult.swapsExecuted}
              </span>
            </div>

            {rebalanceResult.totalHardAssets && (
              <div>
                <span style={{ color: 'var(--text-secondary)' }}>Total Hard Assets:</span>
                <span className="ml-2 font-semibold" style={{ color: 'var(--text-primary)' }}>
                  $
                  {parseFloat(rebalanceResult.totalHardAssets).toLocaleString('en-US', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
              </div>
            )}

            {rebalanceResult.swapDetails && rebalanceResult.swapDetails.length > 0 && (
              <div className="mt-4">
                <h4 className="font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
                  Swap Details:
                </h4>
                <div className="space-y-2">
                  {rebalanceResult.swapDetails.map((swap, index) => (
                    <div key={index} className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                      {swap.fromAsset} → {swap.toAsset}: {swap.amountIn} (est. {swap.amountOut})
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!rebalanceResult.rebalanceNeeded && rebalanceResult.swapsExecuted === 0 && (
              <div
                className="mt-4 p-3 rounded-lg"
                style={{ background: 'rgba(74, 222, 128, 0.1)' }}
              >
                <p style={{ color: 'var(--success)' }}>
                  Treasury is already balanced. No swaps were needed.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Whitelist Management Card */}
      <div
        className="rounded-[20px] backdrop-blur-[20px] p-7 mb-6 transition-all hover:border-[rgba(212,175,140,0.35)]"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-subtle)',
          boxShadow: 'var(--shadow-card)',
        }}
      >
        <h2
          className="font-display text-2xl font-medium mb-4"
          style={{ letterSpacing: '-0.02em', color: 'var(--text-primary)' }}
        >
          Passport Whitelist
        </h2>

        <p className="mb-6" style={{ color: 'var(--text-secondary)' }}>
          Override Gitcoin Passport scores for testing. Whitelisted addresses bypass the Passport API
          and use the score specified here instead.
        </p>

        {whitelistError && (
          <ErrorMessage message={whitelistError} onDismiss={clearWhitelistError} />
        )}

        {/* Add Address Form */}
        <form onSubmit={handleAddAddress} className="mb-6">
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              placeholder="0x... (Ethereum address)"
              value={newAddress}
              onChange={(e) => setNewAddress(e.target.value)}
              className="flex-1 px-4 py-2.5 rounded-lg font-mono text-sm"
              style={{
                background: 'var(--bg-primary)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-primary)',
              }}
              disabled={whitelistActionLoading}
            />
            <input
              type="number"
              placeholder="Score (0-100)"
              value={newScore}
              onChange={(e) => setNewScore(e.target.value)}
              min="0"
              max="100"
              className="w-full sm:w-32 px-4 py-2.5 rounded-lg text-sm"
              style={{
                background: 'var(--bg-primary)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-primary)',
              }}
              disabled={whitelistActionLoading}
            />
            <Button
              type="submit"
              disabled={whitelistActionLoading || !newAddress || !newScore}
              className="w-full sm:w-auto"
            >
              {whitelistActionLoading ? (
                <>
                  <div
                    className="inline-block w-4 h-4 border-2 border-t-transparent rounded-full animate-spin mr-2"
                    style={{ borderColor: 'var(--bg-primary)', borderTopColor: 'transparent' }}
                  />
                  Adding...
                </>
              ) : (
                'Add Address'
              )}
            </Button>
          </div>
        </form>

        {/* Whitelist Entries */}
        <div>
          <h3 className="font-medium mb-3" style={{ color: 'var(--text-primary)' }}>
            Current Whitelist ({Object.keys(whitelist).length} addresses)
          </h3>

          {whitelistLoading && Object.keys(whitelist).length === 0 ? (
            <div className="flex justify-center py-8">
              <div
                className="inline-block w-6 h-6 border-2 border-t-transparent rounded-full animate-spin"
                style={{ borderColor: 'var(--rose-pink)', borderTopColor: 'transparent' }}
              />
            </div>
          ) : Object.keys(whitelist).length === 0 ? (
            <div
              className="text-center py-8 rounded-lg"
              style={{ background: 'var(--bg-primary)', color: 'var(--text-secondary)' }}
            >
              No addresses in whitelist
            </div>
          ) : (
            <div className="space-y-2">
              {Object.entries(whitelist).map(([addr, score]) => (
                <div
                  key={addr}
                  className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-lg gap-3"
                  style={{ background: 'var(--bg-primary)' }}
                >
                  <div className="flex-1 min-w-0">
                    <span
                      className="font-mono text-sm break-all"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {addr}
                    </span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span
                      className="px-3 py-1 rounded-full text-sm font-medium"
                      style={{
                        background: 'rgba(212, 175, 140, 0.15)',
                        color: 'var(--rose-pink)',
                      }}
                    >
                      Score: {score}
                    </span>
                    {addressToRemove === addr ? (
                      <div className="flex gap-2">
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleRemoveAddress(addr)}
                          disabled={whitelistActionLoading}
                        >
                          {whitelistActionLoading ? 'Removing...' : 'Confirm'}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setAddressToRemove(null)}
                          disabled={whitelistActionLoading}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setAddressToRemove(addr)}
                        disabled={whitelistActionLoading}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Database Backup Card */}
      <div
        id="backup-section"
        className="rounded-[20px] backdrop-blur-[20px] p-7 mb-6 transition-all hover:border-[rgba(74,222,128,0.35)]"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-subtle)',
          boxShadow: 'var(--shadow-card)',
        }}
      >
        <h2
          className="font-display text-2xl font-medium mb-4"
          style={{ letterSpacing: '-0.02em', color: 'var(--text-primary)' }}
        >
          Database Backup & Restore
        </h2>

        <p className="mb-6" style={{ color: 'var(--text-secondary)' }}>
          Backup the PostgreSQL database to Pinata IPFS with Hot Swaps for mutable references.
          Backups run automatically daily at 02:00 UTC. You can also trigger manual backups or
          restore from the latest backup.
        </p>

        {backupError && (
          <ErrorMessage message={backupError} onDismiss={clearBackupError} />
        )}

        {/* Status */}
        {backupStatus && (
          <div
            className="p-4 rounded-lg mb-4"
            style={{ background: 'var(--bg-primary)' }}
          >
            <h4 className="font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
              Backup Status
            </h4>
            <div className="space-y-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
              <p>
                <span className="font-medium">Configured:</span>{' '}
                <span style={{ color: backupStatus.isConfigured ? 'var(--success)' : 'var(--error)' }}>
                  {backupStatus.isConfigured ? 'Yes' : 'No'}
                </span>
              </p>
              {backupStatus.referenceCid && (
                <p>
                  <span className="font-medium">Reference CID:</span>{' '}
                  <span className="font-mono text-xs break-all">{backupStatus.referenceCid}</span>
                </p>
              )}
              {backupStatus.lastSwap && (
                <p>
                  <span className="font-medium">Last Backup:</span>{' '}
                  {new Date(backupStatus.lastSwap.created_at).toLocaleString()}
                </p>
              )}
              {!backupStatus.referenceCid && (
                <p style={{ color: 'var(--warning)' }}>
                  No BACKUP_REFERENCE_CID set. First backup will create the reference CID.
                </p>
              )}
            </div>
          </div>
        )}

        {/* Backup Result */}
        {backupResult && (
          <div
            className="p-4 rounded-lg mb-4"
            style={{
              background: 'rgba(74, 222, 128, 0.1)',
              border: '1px solid rgba(74, 222, 128, 0.3)',
            }}
          >
            <h4 className="font-medium mb-2" style={{ color: 'var(--success)' }}>
              Backup Created Successfully
            </h4>
            <div className="space-y-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
              <p>
                <span className="font-medium">CID:</span>{' '}
                <span className="font-mono text-xs break-all">{backupResult.cid}</span>
              </p>
              <p>
                <span className="font-medium">Size:</span>{' '}
                {(backupResult.size / 1024 / 1024).toFixed(2)} MB
              </p>
              <p>
                <span className="font-medium">Timestamp:</span>{' '}
                {new Date(backupResult.timestamp).toLocaleString()}
              </p>
              {backupResult.isFirstBackup && (
                <p className="mt-2 p-2 rounded" style={{ background: 'rgba(251, 191, 36, 0.1)', color: 'var(--warning)' }}>
                  <strong>Important:</strong> This is the first backup. Add this CID as{' '}
                  <code className="font-mono">BACKUP_REFERENCE_CID</code> to GitHub secrets.
                </p>
              )}
            </div>
          </div>
        )}

        {/* Restore Result */}
        {restoreResult && (
          <div
            className="p-4 rounded-lg mb-4"
            style={{
              background: 'rgba(74, 222, 128, 0.1)',
              border: '1px solid rgba(74, 222, 128, 0.3)',
            }}
          >
            <h4 className="font-medium mb-2" style={{ color: 'var(--success)' }}>
              Database Restored Successfully
            </h4>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              {restoreResult.message}
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-3">
          <Button
            onClick={handleCreateBackup}
            disabled={backupLoading}
            className="flex items-center gap-2"
          >
            {backupLoading ? (
              <>
                <div
                  className="inline-block w-4 h-4 border-2 border-t-transparent rounded-full animate-spin"
                  style={{ borderColor: 'var(--bg-primary)', borderTopColor: 'transparent' }}
                />
                Creating Backup...
              </>
            ) : (
              'Create Backup Now'
            )}
          </Button>

          {backupStatus?.referenceCid && (
            <>
              {restoreConfirm ? (
                <div className="flex gap-2">
                  <Button
                    variant="destructive"
                    onClick={handleRestore}
                    disabled={backupLoading}
                  >
                    {backupLoading ? 'Restoring...' : 'Confirm Restore'}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={cancelRestore}
                    disabled={backupLoading}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  onClick={handleRestore}
                  disabled={backupLoading}
                >
                  Restore from Backup
                </Button>
              )}
            </>
          )}
        </div>

        {restoreConfirm && (
          <p className="mt-3 text-sm" style={{ color: 'var(--error)' }}>
            Warning: This will OVERWRITE the entire database. Are you sure?
          </p>
        )}
      </div>

      {/* Info Card */}
      <div
        className="rounded-[20px] backdrop-blur-[20px] p-7"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-subtle)',
          boxShadow: 'var(--shadow-card)',
        }}
      >
        <h3 className="font-display text-xl font-medium mb-4" style={{ color: 'var(--text-primary)' }}>
          About Treasury Rebalancing
        </h3>
        <div className="space-y-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
          <p>
            The treasury automatically rebalances monthly, but you can trigger a manual rebalance at
            any time. This operation will:
          </p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>Calculate current asset allocations vs. target allocations</li>
            <li>Determine optimal swap routes via LiFi protocol</li>
            <li>Execute necessary swaps to bring assets back to target ratios</li>
            <li>Update the lastRebalanceTime timestamp on-chain</li>
          </ul>
          <p className="mt-4">
            <strong style={{ color: 'var(--text-primary)' }}>Target Allocations:</strong>
          </p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>Bitcoin (BTC): 30%</li>
            <li>Gold (XAUt): 30%</li>
            <li>Stablecoin (USDC): 20%</li>
            <li>ROSE Token: 20%</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default AdminPage;
