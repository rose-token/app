import React from 'react';
import { useAccount } from 'wagmi';
import useVaultData from '../hooks/useVaultData';
import VaultStats from '../components/vault/VaultStats';
import VaultAllocation from '../components/vault/VaultAllocation';
import NavHistoryChart from '../components/vault/NavHistoryChart';
import DepositCard from '../components/vault/DepositCard';
import RedeemCard from '../components/vault/RedeemCard';
import TransactionHistory from '../components/vault/TransactionHistory';
import WalletNotConnected from '../components/wallet/WalletNotConnected';

const VaultPage = () => {
  const { isConnected } = useAccount();
  const {
    // Vault data
    rosePrice,
    vaultValueUSD,
    breakdown,
    circulatingSupply,
    // User data
    roseBalance,
    roseBalanceRaw,
    usdcBalance,
    usdcBalanceRaw,
    roseAllowance,
    roseAllowanceRaw,
    usdcAllowance,
    usdcAllowanceRaw,
    // Cooldowns
    depositCooldown,
    redeemCooldown,
    // Phase 5: Pending redemption
    pendingRedemptionId,
    // Addresses
    treasuryAddress,
    tokenAddress,
    usdcAddress,
    // Status
    isLoading,
    isPaused,
    refetch,
  } = useVaultData();

  const handleSuccess = () => {
    // Refetch all vault data after successful transaction
    refetch();
  };

  return (
    <div className="max-w-6xl animate-fade-in">
      {/* Header */}
      <div className="text-center mb-10">
        <h1 className="font-display text-4xl font-medium tracking-tight mb-2" style={{ letterSpacing: '-0.03em' }}>
          Treasury <span className="gradient-text">Vault</span>
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '1.0625rem' }}>
          Asset-Backed Stability, Transparent On-chain Reserves
        </p>
      </div>

      {/* Pause Warning Banner */}
      {isPaused && (
        <div
          className="mb-6 p-4 rounded-[12px] flex items-center gap-3"
          style={{
            background: 'var(--error-bg)',
            border: '1px solid rgba(248, 113, 113, 0.5)',
          }}
        >
          <div
            className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(248, 113, 113, 0.2)' }}
          >
            <span style={{ color: 'var(--error)', fontSize: '1.25rem' }}>!</span>
          </div>
          <div>
            <h3 className="font-medium" style={{ color: 'var(--error)' }}>
              Treasury Operations Paused
            </h3>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Deposits and redemptions are temporarily disabled. Please check back later.
            </p>
          </div>
        </div>
      )}

      {/* Wallet not connected message */}
      {!isConnected && (
        <div className="mb-6">
          <WalletNotConnected />
        </div>
      )}

      {/* Vault Stats */}
      <VaultStats
        rosePrice={rosePrice}
        vaultValueUSD={vaultValueUSD}
        circulatingSupply={circulatingSupply}
        roseBalance={roseBalance}
        usdcBalance={usdcBalance}
        isLoading={isLoading}
        isConnected={isConnected}
      />

      {/* Vault Allocation Chart */}
      <VaultAllocation
        breakdown={breakdown}
        isLoading={isLoading}
      />

      {/* NAV Price History Chart */}
      <NavHistoryChart />

      {/* Deposit / Redeem Cards */}
      {isConnected && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          <DepositCard
            usdcBalance={usdcBalance}
            usdcBalanceRaw={usdcBalanceRaw}
            usdcAllowance={usdcAllowance}
            usdcAllowanceRaw={usdcAllowanceRaw}
            rosePrice={rosePrice}
            treasuryAddress={treasuryAddress}
            usdcAddress={usdcAddress}
            onSuccess={handleSuccess}
            depositCooldown={depositCooldown}
            isPaused={isPaused}
          />

          <RedeemCard
            roseBalance={roseBalance}
            roseBalanceRaw={roseBalanceRaw}
            roseAllowance={roseAllowance}
            roseAllowanceRaw={roseAllowanceRaw}
            rosePrice={rosePrice}
            treasuryAddress={treasuryAddress}
            tokenAddress={tokenAddress}
            onSuccess={handleSuccess}
            redeemCooldown={redeemCooldown}
            pendingRedemptionId={pendingRedemptionId}
            isPaused={isPaused}
          />
        </div>
      )}

      {/* Transaction History */}
      {isConnected && <TransactionHistory treasuryAddress={treasuryAddress} />}

      {/* How it works section */}
      <div
        className="mt-6 p-7 rounded-[20px] backdrop-blur-[20px] transition-all hover:border-[rgba(212,175,140,0.35)]"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-subtle)',
          boxShadow: 'var(--shadow-card)'
        }}
      >
        <h3 className="font-display text-xl font-medium mb-5" style={{ letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
          How It Works
        </h3>
        <div className="space-y-4">
          {[
            { num: '1', title: 'Deposit', desc: 'Send USDC to the vault and receive ROSE tokens at the current NAV. The vault automatically diversifies into BTC, Gold, and stablecoins.' },
            { num: '2', title: 'Redeem', desc: 'Burn ROSE tokens to withdraw USDC at the current exchange rate. The ROSE price reflects total treasury value.' },
            { num: '3', title: 'Asset Backing', desc: 'Each ROSE token is backed by real-world assets: 40% Bitcoin, 40% Gold (PAXG), 20% USDC. As asset prices change, so does your position.' }
          ].map((item) => (
            <div key={item.num} className="flex gap-3.5">
              <div
                className="flex-shrink-0 w-[26px] h-[26px] rounded-full flex items-center justify-center text-xs font-semibold"
                style={{
                  background: 'linear-gradient(135deg, var(--rose-pink) 0%, var(--rose-gold) 100%)',
                  color: 'var(--bg-primary)'
                }}
              >
                {item.num}
              </div>
              <div>
                <h4 className="font-display text-[0.9375rem] font-medium mb-0.5" style={{ color: 'var(--text-primary)' }}>{item.title}</h4>
                <p className="text-[0.8125rem] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default VaultPage;
