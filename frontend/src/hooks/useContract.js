import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { useEthereum } from './useEthereum';

import RoseMarketplaceABI from '../contracts/RoseMarketplaceABI.json';
import RoseTokenABI from '../contracts/RoseTokenABI.json';

const loadContractAddresses = async () => {
  try {
    const response = await fetch('/rose-token/contracts/addresses.json');
    if (!response.ok) {
      throw new Error('Failed to load contract addresses');
    }
    return await response.json();
  } catch (error) {
    console.log('Using environment variables for contract addresses:', error.message);
    return null;
  }
};

const DEFAULT_ADDRESS = '0x0000000000000000000000000000000000000000';


export const useContract = () => {
  const { provider, signer, isConnected } = useEthereum();
  const [roseMarketplace, setRoseMarketplace] = useState(null);
  const [roseToken, setRoseToken] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [contractAddresses, setContractAddresses] = useState({
    marketplaceAddress: process.env.REACT_APP_MARKETPLACE_ADDRESS || DEFAULT_ADDRESS,
    tokenAddress: process.env.REACT_APP_TOKEN_ADDRESS || DEFAULT_ADDRESS
  });

  useEffect(() => {
    const loadAddresses = async () => {
      const addresses = await loadContractAddresses();
      if (addresses) {
        console.log('Using contract addresses from deployment artifact:', addresses);
        setContractAddresses({
          marketplaceAddress: addresses.marketplaceAddress || process.env.REACT_APP_MARKETPLACE_ADDRESS || DEFAULT_ADDRESS,
          tokenAddress: addresses.tokenAddress || process.env.REACT_APP_TOKEN_ADDRESS || DEFAULT_ADDRESS
        });
      }
    };
    
    loadAddresses();
  }, []);

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
          contractAddresses.marketplaceAddress,
          RoseMarketplaceABI,
          provider
        );
        
        const tokenContract = new ethers.Contract(
          contractAddresses.tokenAddress,
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
  }, [provider, signer, isConnected, contractAddresses]);

  return {
    roseMarketplace,
    roseToken,
    isLoading,
    error
  };
};
