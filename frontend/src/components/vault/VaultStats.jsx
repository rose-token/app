import React from 'react';
import { Skeleton } from '../ui/skeleton';

const StatCard = ({ label, value, isLoading, prefix = '', suffix = '' }) => (
  <div className="bg-card rounded-lg shadow-sm p-4">
    <p className="text-sm text-muted-foreground mb-1">{label}</p>
    {isLoading ? (
      <Skeleton className="h-8 w-24" />
    ) : (
      <p className="text-2xl font-bold text-foreground">
        {prefix}{value !== null ? value : '--'}{suffix}
      </p>
    )}
  </div>
);

const VaultStats = ({
  rosePrice,
  vaultValueUSD,
  circulatingSupply,
  roseBalance,
  usdcBalance,
  isLoading,
  isConnected
}) => {
  const formatUSD = (value) => {
    if (value === null) return '--';
    return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const formatTokens = (value, decimals = 2) => {
    if (value === null) return '--';
    return value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6 mb-6">
      <h2 className="text-xl font-semibold text-foreground mb-4">Vault Overview</h2>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <StatCard
          label="ROSE Price"
          value={formatUSD(rosePrice)}
          prefix="$"
          isLoading={isLoading}
        />

        <StatCard
          label="Total Vault Value"
          value={formatUSD(vaultValueUSD)}
          prefix="$"
          isLoading={isLoading}
        />

        <StatCard
          label="ROSE Supply"
          value={formatTokens(circulatingSupply, 0)}
          isLoading={isLoading}
        />

        {isConnected && (
          <>
            <StatCard
              label="Your ROSE Balance"
              value={formatTokens(roseBalance)}
              isLoading={isLoading}
            />

            <StatCard
              label="Your USDC Balance"
              value={formatTokens(usdcBalance)}
              isLoading={isLoading}
            />
          </>
        )}
      </div>
    </div>
  );
};

export default VaultStats;
