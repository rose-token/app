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
      <div className="bg-white/10 px-4 py-2 rounded-md text-white flex items-center space-x-2">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-5 w-5"
        >
          <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
        </svg>
        <span>$-- USD/ROSE</span>
      </div>
    );
  }

  return (
    <div className="bg-white/10 px-4 py-2 rounded-md text-white flex items-center space-x-2">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-5"
      >
        <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </svg>
      <span>${exchangeRate} USD/ROSE</span>
    </div>
  );
};

export default ExchangeRate;
