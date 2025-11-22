import React from 'react';
import { useAccount, useReadContract } from 'wagmi';
import { formatUnits } from 'viem';
import RoseTokenABI from '../../contracts/RoseTokenABI.json';

const TokenBalance = () => {
  const { address, isConnected, chain } = useAccount();

  const tokenAddress = import.meta.env.VITE_TOKEN_ADDRESS;

  const { data: balance, isError, error } = useReadContract({
    address: tokenAddress,
    abi: RoseTokenABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: chain?.id,
    query: {
      enabled: !!address && isConnected && !!tokenAddress,
      refetchInterval: 10000, // Refetch every 10 seconds
    },
  });

  // Don't show anything if wallet not connected
  if (!isConnected || !address) return null;

  // Show error state if there's an issue
  if (isError) {
    console.error('Error fetching token balance:', error);
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
          <path d="M12 2s.35-.008 8 9c0 0-7.5 13-8 13-.5 0-8-13-8-13 7.65-9.008 8-9 8-9Z" />
        </svg>
        <span>-- ROSE</span>
      </div>
    );
  }

  // Format balance (default to 0 if no balance yet)
  const formattedBalance = balance
    ? Number(formatUnits(balance, 18)).toFixed(2)
    : '0.00';

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
        <path d="M12 2s.35-.008 8 9c0 0-7.5 13-8 13-.5 0-8-13-8-13 7.65-9.008 8-9 8-9Z" />
      </svg>
      <span>{formattedBalance} ROSE</span>
    </div>
  );
};

export default TokenBalance;
