import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { useEthereum } from './useEthereum';

import RoseMarketplaceABI from '../contracts/RoseMarketplaceABI.json';
import RoseTokenABI from '../contracts/RoseTokenABI.json';

const DEFAULT_ADDRESS = '0x0000000000000000000000000000000000000000';

export const useContract = () => {
  const { provider, signer, isConnected, account } = useEthereum();
  const [roseMarketplace, setRoseMarketplace] = useState(null);
  const [roseToken, setRoseToken] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [allAddresses, setAllAddresses] = useState(null);
  const contractAddresses = useState({
    marketplaceAddress: process.env.REACT_APP_MARKETPLACE_ADDRESS || DEFAULT_ADDRESS,
    tokenAddress: process.env.REACT_APP_TOKEN_ADDRESS || DEFAULT_ADDRESS,
    reputationAddress: DEFAULT_ADDRESS,
    governanceAddress: DEFAULT_ADDRESS,
    daoTreasuryAddress: DEFAULT_ADDRESS
  })[0];

  const fetchAllAddresses = useCallback(async () => {
    if (!roseMarketplace || !isConnected) return null;
      
    try {
      const addresses = { ...contractAddresses };
        
      if (addresses.tokenAddress === DEFAULT_ADDRESS) {
        addresses.tokenAddress = await roseMarketplace.roseToken();
      }
        
      addresses.reputationAddress = await roseMarketplace.roseReputation();
        
      addresses.governanceAddress = await roseMarketplace.governanceContract();
        
      addresses.daoTreasuryAddress = await roseMarketplace.daoTreasury();
        
      setAllAddresses(addresses);
        
      console.log('=== ROSE CONTRACT ADDRESSES ===');
      console.log('Connected Account:', account);
      console.log('Marketplace Address:', addresses.marketplaceAddress);
      console.log('Token Address:', addresses.tokenAddress);
      console.log('Reputation Address:', addresses.reputationAddress);
      console.log('Governance Address:', addresses.governanceAddress);
      console.log('DAO Treasury Address:', addresses.daoTreasuryAddress);
      console.log('==============================');
        
      return addresses;
    } catch (err) {
      console.error('Error fetching contract addresses:', err);
      return null;
    }
  }, [roseMarketplace, isConnected, contractAddresses, account]);

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
          
          await fetchAllAddresses();
        }
      } catch (err) {
        console.error('Error initializing contracts:', err);
        setError('Failed to initialize contracts');
      } finally {
        setIsLoading(false);
      }
    };

    initContracts();
  }, [provider, signer, isConnected, contractAddresses, fetchAllAddresses]);

  return {
    roseMarketplace,
    roseToken,
    isLoading,
    error,
    allAddresses,
    fetchAllAddresses
  };
};
