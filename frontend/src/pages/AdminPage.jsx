import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { useIsAdmin } from '../hooks/useIsAdmin';
import { useRebalance } from '../hooks/useRebalance';
import WalletNotConnected from '../components/wallet/WalletNotConnected';
import ErrorMessage from '../components/ui/ErrorMessage';
import { Button } from '../components/ui/button';

const AdminPage = () => {
  const { isConnected } = useAccount();
  const { isAdmin, isLoading: adminLoading } = useIsAdmin();
  const navigate = useNavigate();
  const { triggerRebalance } = useRebalance();

  // Rebalance state
  const [rebalanceLoading, setRebalanceLoading] = useState(false);
  const [rebalanceError, setRebalanceError] = useState(null);
  const [rebalanceResult, setRebalanceResult] = useState(null);

  // Redirect non-admins to home
  useEffect(() => {
    if (!adminLoading && !isAdmin && isConnected) {
      navigate('/');
    }
  }, [isAdmin, adminLoading, isConnected, navigate]);

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
