import React, { useState, useEffect } from 'react';
import { useWallet } from '../../hooks/useWallet';
import { useContract } from '../../hooks/useContract';

const ExchangeRate = () => {
  const [exchangeRate, setExchangeRate] = useState('0.00');
  const { account } = useWallet();
  const { roseToken } = useContract();

  useEffect(() => {
    const fetchExchangeRate = async () => {
      if (roseToken) {
        try {
          const totalSupplyWei = await roseToken.totalSupply();
          const totalSupplyEth = parseFloat(totalSupplyWei) / 10**18;
          
          if (totalSupplyEth > 0) {
            const rate = 10000 / totalSupplyEth;
            setExchangeRate(rate.toFixed(4));
          } else {
            setExchangeRate('0.0000');
          }
        } catch (error) {
          console.error('Error fetching exchange rate:', error);
          setExchangeRate('Error');
        }
      }
    };

    fetchExchangeRate();
    const intervalId = setInterval(fetchExchangeRate, 10000);
    
    return () => clearInterval(intervalId);
  }, [roseToken]);

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
        <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </svg>
      <span>${exchangeRate} USD/ROSE</span>
    </div>
  );
};

export default ExchangeRate;
