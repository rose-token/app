import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { useEthereum } from './useEthereum';

import RoseMarketplaceABI from '../contracts/RoseMarketplaceABI.json';
import RoseTokenABI from '../contracts/RoseTokenABI.json';

let MARKETPLACE_ADDRESS = '0x0000000000000000000000000000000000000000';
let TOKEN_ADDRESS = '0x0000000000000000000000000000000000000000';

try {
  const contractAddresses = require('../contracts/addresses.json');
  MARKETPLACE_ADDRESS = contractAddresses.marketplaceAddress || process.env.REACT_APP_MARKETPLACE_ADDRESS || MARKETPLACE_ADDRESS;
  TOKEN_ADDRESS = contractAddresses.tokenAddress || process.env.REACT_APP_TOKEN_ADDRESS || TOKEN_ADDRESS;
} catch (error) {
  MARKETPLACE_ADDRESS = process.env.REACT_APP_MARKETPLACE_ADDRESS || MARKETPLACE_ADDRESS;
  TOKEN_ADDRESS = process.env.REACT_APP_TOKEN_ADDRESS || TOKEN_ADDRESS;
  console.log('Using environment variables for contract addresses');
}

export const useContract = () => {
  const { provider, signer, isConnected } = useEthereum();
  const [roseMarketplace, setRoseMarketplace] = useState(null);
  const [roseToken, setRoseToken] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const initContracts = async () => {
      if (!provider) {
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        setError(null);

        const marketplaceContract = new ethers.Contract(
          MARKETPLACE_ADDRESS,
          RoseMarketplaceABI,
          provider
        );
        
        const tokenContract = new ethers.Contract(
          TOKEN_ADDRESS,
          RoseTokenABI,
          provider
        );

        setRoseMarketplace(marketplaceContract);
        setRoseToken(tokenContract);

        if (signer && isConnected) {
          const marketplaceWithSigner = marketplaceContract.connect(signer);
          const tokenWithSigner = tokenContract.connect(signer);
          
          setRoseMarketplace(marketplaceWithSigner);
          setRoseToken(tokenWithSigner);
        }
      } catch (err) {
        console.error('Error initializing contracts:', err);
        setError('Failed to initialize contracts');
      } finally {
        setIsLoading(false);
      }
    };

    initContracts();
  }, [provider, signer, isConnected]);

  return {
    roseMarketplace,
    roseToken,
    isLoading,
    error
  };
};
