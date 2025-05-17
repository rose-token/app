import { useState, useEffect, useCallback, useMemo } from 'react';
import { ethers } from 'ethers';
import { useEthereum } from './useEthereum';

import RoseMarketplaceABI from '../contracts/RoseMarketplaceABI.json';
import RoseTokenABI from '../contracts/RoseTokenABI.json';

const DEFAULT_ADDRESS = '0x0000000000000000000000000000000000000000';

const logInitialAddresses = () => {
  const marketplaceAddress = process.env.REACT_APP_MARKETPLACE_ADDRESS || DEFAULT_ADDRESS;
  const tokenAddress = process.env.REACT_APP_TOKEN_ADDRESS || DEFAULT_ADDRESS;
  const reputationAddress = process.env.REACT_APP_REPUTATION_ADDRESS || DEFAULT_ADDRESS;
  const governanceAddress = process.env.REACT_APP_GOVERNANCE_ADDRESS || DEFAULT_ADDRESS;
  const daoTreasuryAddress = process.env.REACT_APP_DAO_TREASURY_ADDRESS || DEFAULT_ADDRESS;
  
  console.log('🌹 Contract Addresses (Initial Config):');
  console.log('Marketplace:', marketplaceAddress);
  console.log('Token:', tokenAddress);
  console.log('DAO Treasury:', daoTreasuryAddress);
  console.log('Governance:', governanceAddress);
  console.log('Reputation:', reputationAddress);
  
  return {
    marketplaceAddress,
    tokenAddress,
    reputationAddress,
    governanceAddress,
    daoTreasuryAddress
  };
};

const initialAddresses = logInitialAddresses();

export const useContract = () => {
  const { provider, signer, isConnected, account } = useEthereum();
  const [roseMarketplace, setRoseMarketplace] = useState(null);
  const [roseToken, setRoseToken] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [allAddresses, setAllAddresses] = useState(null);
  
  const contractAddresses = useMemo(() => initialAddresses, []);

  const fetchAttempted = useMemo(() => ({ value: false }), []);
  
  const fetchAllAddresses = useCallback(async () => {
    if (!roseMarketplace || !isConnected) return null;
    
    if (allAddresses) {
      return allAddresses;
    }
    
    if (fetchAttempted.value) {
      return null;
    }
    
    fetchAttempted.value = true;
    
    try {
      const addresses = { ...contractAddresses };
        
      if (addresses.tokenAddress === DEFAULT_ADDRESS) {
        addresses.tokenAddress = await roseMarketplace.roseToken();
      }
        
      addresses.reputationAddress = await roseMarketplace.roseReputation();
      addresses.governanceAddress = await roseMarketplace.governanceContract();
      addresses.daoTreasuryAddress = await roseMarketplace.daoTreasury();
      
      console.log('=== ROSE CONTRACT ADDRESSES (Fetched) ===');
      console.log('Connected Account:', account);
      console.log('Marketplace Address:', addresses.marketplaceAddress);
      console.log('Token Address:', addresses.tokenAddress);
      console.log('Reputation Address:', addresses.reputationAddress);
      console.log('Governance Address:', addresses.governanceAddress);
      console.log('DAO Treasury Address:', addresses.daoTreasuryAddress);
      console.log('==============================');
      
      setAllAddresses(addresses);
      return addresses;
    } catch (err) {
      console.error('Error fetching contract addresses:', err);
      setError('Failed to fetch contract addresses');
      return null;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roseMarketplace, isConnected, contractAddresses, account]);

  const contractsInitialized = useMemo(() => ({ value: false }), []);
  
  useEffect(() => {
    if (contractsInitialized.value && roseMarketplace && roseToken) {
      return;
    }
    
    const initContracts = async () => {
      if (!provider) {
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        setError(null);
        
        console.log('Initializing contracts with addresses:');
        console.log('Marketplace:', contractAddresses.marketplaceAddress);
        console.log('Token:', contractAddresses.tokenAddress);

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
          
          if (!allAddresses && !fetchAttempted.value) {
            try {
              await fetchAllAddresses();
            } catch (error) {
              console.error('Failed to fetch addresses, will not retry:', error);
              setError('Failed to fetch contract addresses');
            }
          }
        }
        
        contractsInitialized.value = true;
      } catch (err) {
        console.error('Error initializing contracts:', err);
        setError('Failed to initialize contracts');
      } finally {
        setIsLoading(false);
      }
    };

    initContracts();
    
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, signer, isConnected]);

  return {
    roseMarketplace,
    roseToken,
    isLoading,
    error,
    allAddresses,
    fetchAllAddresses
  };
};
