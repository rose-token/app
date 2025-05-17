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
  
  const marketplaceAddress = process.env.REACT_APP_MARKETPLACE_ADDRESS || DEFAULT_ADDRESS;
  const tokenAddress = process.env.REACT_APP_TOKEN_ADDRESS || DEFAULT_ADDRESS;
  const reputationAddress = process.env.REACT_APP_REPUTATION_ADDRESS || DEFAULT_ADDRESS;
  const governanceAddress = process.env.REACT_APP_GOVERNANCE_ADDRESS || DEFAULT_ADDRESS;
  const daoTreasuryAddress = process.env.REACT_APP_DAO_TREASURY_ADDRESS || DEFAULT_ADDRESS;
  
  console.log('🌹 Contract Addresses:');
  console.log('Marketplace:', marketplaceAddress);
  console.log('Token:', tokenAddress);
  console.log('DAO Treasury:', daoTreasuryAddress);
  console.log('Governance:', governanceAddress);
  console.log('Reputation:', reputationAddress);
  
  const contractAddresses = useState({
    marketplaceAddress: marketplaceAddress,
    tokenAddress: tokenAddress,
    reputationAddress: reputationAddress,
    governanceAddress: governanceAddress,
    daoTreasuryAddress: daoTreasuryAddress
  })[0];

  const fetchAllAddresses = useCallback(async () => {
    if (!roseMarketplace || !isConnected) return null;
    
    if (allAddresses) return allAddresses;
      
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
      setError('Failed to fetch contract addresses');
      return null;
    }
  }, [roseMarketplace, isConnected, contractAddresses, account, allAddresses]);

  useEffect(() => {
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
          
          if (!allAddresses) {
            try {
              await fetchAllAddresses();
            } catch (error) {
              console.error('Failed to fetch addresses, will not retry:', error);
              setError('Failed to fetch contract addresses');
            }
          }
        }
      } catch (err) {
        console.error('Error initializing contracts:', err);
        setError('Failed to initialize contracts');
      } finally {
        setIsLoading(false);
      }
    };

    initContracts();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, signer, isConnected, contractAddresses]);

  return {
    roseMarketplace,
    roseToken,
    isLoading,
    error,
    allAddresses,
    fetchAllAddresses
  };
};
