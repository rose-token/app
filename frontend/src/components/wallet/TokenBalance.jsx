import React, { useState, useEffect } from 'react';
import { useEthereum } from '../../hooks/useEthereum';
import { useContract } from '../../hooks/useContract';

const TokenBalance = () => {
  const [balance, setBalance] = useState('0');
  const { account } = useEthereum();
  const { roseToken } = useContract();

  useEffect(() => {
    const fetchBalance = async () => {
      if (account && roseToken) {
        try {
          const balanceWei = await roseToken.balanceOf(account);
          const balanceEth = parseFloat(balanceWei) / 10**18;
          setBalance(balanceEth.toFixed(2));
        } catch (error) {
          console.error('Error fetching token balance:', error);
        }
      }
    };

    fetchBalance();
    const intervalId = setInterval(fetchBalance, 10000);
    
    return () => clearInterval(intervalId);
  }, [account, roseToken]);

  if (!account) return null;

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
      <span>{balance} ROSE</span>
    </div>
  );
};

export default TokenBalance;
