import { useState, useEffect, useCallback, useMemo } from 'react';
import { ethers } from 'ethers';
import { useEthereum } from './useEthereum';

import RoseMarketplaceABI from '../contracts/RoseMarketplaceABI.json';
import RoseTokenABI from '../contracts/RoseTokenABI.json';
import RoseReputationABI from '../contracts/RoseReputationABI.json';
import RoseGovernanceABI from '../contracts/RoseGovernanceABI.json';

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
  const [roseReputation, setRoseReputation] = useState(null);
  const [roseGovernance, setRoseGovernance] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [allAddresses, setAllAddresses] = useState(null);
  const [contractMethods, setContractMethods] = useState({ initialized: false, valid: false });
  const [retryCount, setRetryCount] = useState(0);
  const MAX_RETRY_COUNT = 3;
  
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
    if (contractsInitialized.value && roseMarketplace && roseToken && contractMethods.valid) {
      return;
    }
    
    if (retryCount > MAX_RETRY_COUNT) {
      console.error('Max retry count reached for contract initialization');
      setError('Failed to initialize contracts after multiple attempts. Please refresh the page.');
      setIsLoading(false);
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
        
        const validateAddress = (address) => {
          return address && address !== DEFAULT_ADDRESS && ethers.utils.isAddress(address);
        };
        
        if (!validateAddress(contractAddresses.marketplaceAddress)) {
          setError('Invalid marketplace contract address');
          setIsLoading(false);
          return;
        }
        
        if (!validateAddress(contractAddresses.tokenAddress)) {
          setError('Invalid token contract address');
          setIsLoading(false);
          return;
        }
        
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

        const reputationContract = new ethers.Contract(
          contractAddresses.reputationAddress,
          RoseReputationABI,
          provider
        );

        const governanceContract = new ethers.Contract(
          contractAddresses.governanceAddress,
          RoseGovernanceABI,
          provider
        );

        setRoseMarketplace(marketplaceContract);
        setRoseToken(tokenContract);
        setRoseReputation(reputationContract);
        setRoseGovernance(governanceContract);

        if (signer && isConnected) {
          const marketplaceWithSigner = marketplaceContract.connect(signer);
          const tokenWithSigner = tokenContract.connect(signer);
          const reputationWithSigner = reputationContract.connect(signer);
          const governanceWithSigner = governanceContract.connect(signer);
          
          setRoseMarketplace(marketplaceWithSigner);
          setRoseToken(tokenWithSigner);
          setRoseReputation(reputationWithSigner);
          setRoseGovernance(governanceWithSigner);
          
          if (!allAddresses && !fetchAttempted.value) {
            try {
              await fetchAllAddresses();
            } catch (error) {
              console.error('Failed to fetch addresses, will not retry:', error);
              setError('Failed to fetch contract addresses');
            }
          }
        }
        
        if (marketplaceContract && typeof marketplaceContract.createTask === 'function') {
          setContractMethods({ initialized: true, valid: true });
          console.log('Contract methods validated successfully');
        } else {
          console.error('Contract methods validation failed: createTask not found');
          setContractMethods({ initialized: true, valid: false });
          setError('Contract methods validation failed: createTask function not available');
        }
        
        contractsInitialized.value = true;
      } catch (err) {
        console.error('Error initializing contracts:', err);
        setError('Failed to initialize contracts');
        
        if (retryCount < MAX_RETRY_COUNT) {
          console.log(`Retrying contract initialization (attempt ${retryCount + 1} of ${MAX_RETRY_COUNT})...`);
          setTimeout(() => {
            setRetryCount(prev => prev + 1);
          }, 1500); // 1.5 second delay between retries
        }
      } finally {
        setIsLoading(false);
      }
    };

    initContracts();
    
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, signer, isConnected, retryCount]);

  return {
    roseMarketplace,
    roseToken,
    roseReputation,
    roseGovernance,
    isLoading,
    error,
    allAddresses,
    fetchAllAddresses,
    contractMethods
  };
};
