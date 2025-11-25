import React from 'react';
import { useAccount } from 'wagmi';
import useVaultData from '../hooks/useVaultData';
import VaultStats from '../components/vault/VaultStats';
import VaultAllocation from '../components/vault/VaultAllocation';
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
    // Addresses
    treasuryAddress,
    tokenAddress,
    usdcAddress,
    // Status
    isLoading,
    refetch,
  } = useVaultData();

  const handleSuccess = () => {
    // Refetch all vault data after successful transaction
    refetch();
  };

  return (
    <div className="container mx-auto px-4 py-6 max-w-6xl">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-foreground">Vault</h1>
        <p className="text-foreground mt-1">
          Deposit USDC to mint ROSE. Redeem ROSE for USDC. Real asset backing.
        </p>
      </div>

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
      <VaultAllocation breakdown={breakdown} isLoading={isLoading} />

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
          />
        </div>
      )}

      {/* Transaction History */}
      {isConnected && <TransactionHistory treasuryAddress={treasuryAddress} />}

      {/* How it works section */}
      <div className="mt-6 bg-white rounded-lg shadow-md p-6">
        <h3 className="text-lg font-semibold text-foreground mb-3">How it works</h3>
        <div className="space-y-2 text-sm text-foreground">
          <p>
            <span className="font-medium text-foreground">Deposit:</span> Send USDC to the vault and receive ROSE tokens at the current exchange rate. The vault automatically diversifies your deposit into BTC, ETH, Gold, and USDC.
          </p>
          <p>
            <span className="font-medium text-foreground">Redeem:</span> Burn ROSE tokens to withdraw USDC from the vault at the current exchange rate. The ROSE price reflects the total value of all assets held in the vault.
          </p>
          <p>
            <span className="font-medium text-foreground">Backing:</span> Each ROSE token is backed by real-world assets held in the treasury. As asset prices change, so does the ROSE price.
          </p>
        </div>
      </div>
    </div>
  );
};

export default VaultPage;
