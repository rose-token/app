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
      refetchInterval: 45000, // Refetch every 45 seconds
    },
  });

  // Don't show anything if wallet not connected
  if (!isConnected || !address) return null;

  // Show error state if there's an issue
  if (isError) {
    console.error('Error fetching token balance:', error);
    return (
      <div
        className="flex items-center gap-2.5 px-4 py-3 rounded-xl"
        style={{
          background: 'rgba(255, 255, 255, 0.03)',
          border: '1px solid var(--border-subtle)'
        }}
      >
        <div
          className="w-5 h-5 rounded-full flex items-center justify-center font-display text-xs font-semibold"
          style={{
            background: 'linear-gradient(135deg, var(--rose-pink) 0%, var(--rose-gold) 100%)',
            color: 'var(--bg-primary)',
            boxShadow: 'rgba(212, 165, 165, 0.35) 0px 0px 24px'
          }}
        >
          R
        </div>
        <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>-- ROSE</span>
      </div>
    );
  }

  // Format balance (default to 0 if no balance yet)
  const formattedBalance = balance
    ? Number(formatUnits(balance, 18)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '0.00';

  return (
    <div
      className="flex items-center gap-2.5 px-4 py-3 rounded-xl"
      style={{
        background: 'rgba(255, 255, 255, 0.03)',
        border: '1px solid var(--border-subtle)'
      }}
    >
      <svg width="12%" height="12%" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
              <linearGradient id="roseGoldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stop-color="#d4a5a5"/>
                  <stop offset="100%" stop-color="#d4af8c"/>
              </linearGradient>
          </defs>
          
          <path d="M256 0L478.71 128.57V383.43L256 512L33.29 383.43V128.57L256 0Z" fill="url(#roseGoldGrad)" opacity="0.4"/>
          
          <path d="M256 85.33L404.48 170.67V341.33L256 426.67L107.52 341.33V170.67L256 85.33Z" fill="url(#roseGoldGrad)" opacity="0.7"/>

          <path d="M256 170.67L330.24 213.33V298.67L256 341.33L181.76 298.67V213.33L256 170.67Z" fill="url(#roseGoldGrad)"/>
      </svg>
      <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{formattedBalance} ROSE</span>
    </div>
  );
};

export default TokenBalance;
