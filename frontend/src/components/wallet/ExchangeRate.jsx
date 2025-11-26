import React, { useMemo } from 'react';
import { useAccount, useReadContract } from 'wagmi';
import { formatUnits } from 'viem';
import RoseTokenABI from '../../contracts/RoseTokenABI.json';

const ExchangeRate = () => {
  const { address, isConnected, chain } = useAccount();

  const tokenAddress = import.meta.env.VITE_TOKEN_ADDRESS;

  const { data: totalSupply, isError } = useReadContract({
    address: tokenAddress,
    abi: RoseTokenABI,
    functionName: 'totalSupply',
    chainId: chain?.id,
    query: {
      enabled: isConnected && !!tokenAddress,
      refetchInterval: 10000, // Refetch every 10 seconds
    },
  });

  // Calculate exchange rate
  const exchangeRate = useMemo(() => {
    if (!totalSupply) return '0.0000';

    const totalSupplyEth = Number(formatUnits(totalSupply, 18));

    if (totalSupplyEth > 0) {
      const rate = 10000 / totalSupplyEth;
      return rate.toFixed(4);
    }

    return '0.0000';
  }, [totalSupply]);

  // Don't show if wallet not connected
  if (!isConnected || !address) return null;

  // Show error state if there's an issue
  if (isError) {
    return (
      <div
        className="flex items-center gap-2.5 px-4 py-3 rounded-xl"
        style={{
          background: 'rgba(255, 255, 255, 0.03)',
          border: '1px solid var(--border-subtle)'
        }}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-[18px] w-[18px]"
          style={{ color: 'var(--rose-pink)' }}
        >
          <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
        </svg>
        <div>
          <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>$--</div>
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>USD/ROSE</div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-2.5 px-4 py-3 rounded-xl"
      style={{
        background: 'rgba(255, 255, 255, 0.03)',
        border: '1px solid var(--border-subtle)'
      }}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-[18px] w-[18px]"
        style={{ color: 'var(--rose-pink)' }}
      >
        <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </svg>
      <div>
        <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>${exchangeRate}</div>
        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>USD/ROSE</div>
      </div>
    </div>
  );
};

export default ExchangeRate;
