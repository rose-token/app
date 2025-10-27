import { useState, useEffect, useCallback, useMemo } from 'react';
import { ethers } from 'ethers';
import { useEthereum } from './useEthereum';

import RoseMarketplaceABI from '../contracts/RoseMarketplaceABI.json';
import RoseTokenABI from '../contracts/RoseTokenABI.json';
import TokenStakingABI from '../contracts/TokenStakingABI.json';
import StakeholderRegistryABI from '../contracts/StakeholderRegistryABI.json';
import BidEvaluationManagerABI from '../contracts/BidEvaluationManagerABI.json';

const DEFAULT_ADDRESS = '0x0000000000000000000000000000000000000000';

const logInitialAddresses = () => {
  const marketplaceAddress = process.env.REACT_APP_MARKETPLACE_ADDRESS || DEFAULT_ADDRESS;
  const tokenAddress = process.env.REACT_APP_TOKEN_ADDRESS || DEFAULT_ADDRESS;
  const daoTreasuryAddress = process.env.REACT_APP_DAO_TREASURY_ADDRESS || DEFAULT_ADDRESS;
  const tokenStakingAddress = process.env.REACT_APP_TOKEN_STAKING_ADDRESS || DEFAULT_ADDRESS;
  const stakeholderRegistryAddress = process.env.REACT_APP_STAKEHOLDER_REGISTRY_ADDRESS || DEFAULT_ADDRESS;
  const bidEvaluationManagerAddress = process.env.REACT_APP_BID_EVALUATION_MANAGER_ADDRESS || DEFAULT_ADDRESS;

  console.log('🌹 Contract Addresses (Initial Config):');
  console.log('Marketplace:', marketplaceAddress);
  console.log('Token:', tokenAddress);
  console.log('DAO Treasury:', daoTreasuryAddress);
  console.log('Token Staking:', tokenStakingAddress);
  console.log('Stakeholder Registry:', stakeholderRegistryAddress);
  console.log('Bid Evaluation Manager:', bidEvaluationManagerAddress);

  return {
    marketplaceAddress,
    tokenAddress,
    daoTreasuryAddress,
    tokenStakingAddress,
    stakeholderRegistryAddress,
    bidEvaluationManagerAddress
  };
};

const initialAddresses = logInitialAddresses();

export const useContract = () => {
  const { provider, signer, isConnected, account } = useEthereum();
  const [roseMarketplace, setRoseMarketplace] = useState(null);
  const [roseToken, setRoseToken] = useState(null);
  const [tokenStaking, setTokenStaking] = useState(null);
  const [stakeholderRegistry, setStakeholderRegistry] = useState(null);
  const [bidEvaluationManager, setBidEvaluationManager] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [allAddresses, setAllAddresses] = useState(null);
  const [contractMethods, setContractMethods] = useState({ initialized: false, valid: false });
  const [retryCount, setRetryCount] = useState(0);
  const [contractsReady, setContractsReady] = useState({ readOnly: false, readWrite: false });
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

      addresses.daoTreasuryAddress = await roseMarketplace.daoTreasury();
      addresses.tokenStakingAddress = await roseMarketplace.tokenStaking();
      addresses.stakeholderRegistryAddress = await roseMarketplace.stakeholderRegistry();
      addresses.bidEvaluationManagerAddress = await roseMarketplace.bidEvaluationManager();

      console.log('=== ROSE CONTRACT ADDRESSES (Fetched) ===');
      console.log('Connected Account:', account);
      console.log('Marketplace Address:', addresses.marketplaceAddress);
      console.log('Token Address:', addresses.tokenAddress);
      console.log('DAO Treasury Address:', addresses.daoTreasuryAddress);
      console.log('Token Staking Address:', addresses.tokenStakingAddress);
      console.log('Stakeholder Registry Address:', addresses.stakeholderRegistryAddress);
      console.log('Bid Evaluation Manager Address:', addresses.bidEvaluationManagerAddress);
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

  const contractsInitialized = useMemo(() => ({ readOnly: false, readWrite: false }), []);
  
  useEffect(() => {
    if (!provider) {
      console.log('Provider not available for read-only contract initialization');
      return;
    }
    
    if (contractsInitialized.readOnly && roseMarketplace && roseToken && tokenStaking && stakeholderRegistry && bidEvaluationManager) {
      return;
    }
    
    const initReadOnlyContracts = async () => {
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
        
        console.log('Initializing read-only contracts with provider:');
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

        const tokenStakingContract = new ethers.Contract(
          contractAddresses.tokenStakingAddress,
          TokenStakingABI,
          provider
        );

        const stakeholderRegistryContract = new ethers.Contract(
          contractAddresses.stakeholderRegistryAddress,
          StakeholderRegistryABI,
          provider
        );

        const bidEvaluationManagerContract = new ethers.Contract(
          contractAddresses.bidEvaluationManagerAddress,
          BidEvaluationManagerABI,
          provider
        );

        setRoseMarketplace(marketplaceContract);
        setRoseToken(tokenContract);
        setTokenStaking(tokenStakingContract);
        setStakeholderRegistry(stakeholderRegistryContract);
        setBidEvaluationManager(bidEvaluationManagerContract);

        contractsInitialized.readOnly = true;
        setContractsReady(prev => ({ ...prev, readOnly: true }));
        console.log('Read-only contracts initialized successfully');
      } catch (err) {
        console.error('Error initializing read-only contracts:', err);
        setError('Failed to initialize read-only contracts: ' + (err.message || 'Unknown error'));
      } finally {
        setIsLoading(false);
      }
    };

    initReadOnlyContracts();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, contractAddresses]);
  
  useEffect(() => {
    if (!provider || !signer || !isConnected) {
      if (!isConnected) {
        console.log('Waiting for wallet connection before initializing read-write contracts...');
      }
      return;
    }
    
    if (contractsInitialized.readWrite && roseMarketplace && roseToken && tokenStaking && stakeholderRegistry && bidEvaluationManager && contractMethods.valid) {
      return;
    }
    
    if (retryCount > MAX_RETRY_COUNT) {
      console.error('Max retry count reached for read-write contract initialization');
      setError('Failed to initialize contracts after multiple attempts. Please refresh the page.');
      return;
    }
    
    const initReadWriteContracts = async () => {
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
        
        console.log('Initializing read-write contracts with signer:');
        console.log('Marketplace:', contractAddresses.marketplaceAddress);
        console.log('Token:', contractAddresses.tokenAddress);
        console.log('Account:', account);

        const marketplaceContract = new ethers.Contract(
          contractAddresses.marketplaceAddress,
          RoseMarketplaceABI,
          signer
        );
        
        const tokenContract = new ethers.Contract(
          contractAddresses.tokenAddress,
          RoseTokenABI,
          signer
        );

        const tokenStakingContract = new ethers.Contract(
          contractAddresses.tokenStakingAddress,
          TokenStakingABI,
          signer
        );

        const stakeholderRegistryContract = new ethers.Contract(
          contractAddresses.stakeholderRegistryAddress,
          StakeholderRegistryABI,
          signer
        );

        const bidEvaluationManagerContract = new ethers.Contract(
          contractAddresses.bidEvaluationManagerAddress,
          BidEvaluationManagerABI,
          signer
        );

        setRoseMarketplace(marketplaceContract);
        setRoseToken(tokenContract);
        setTokenStaking(tokenStakingContract);
        setStakeholderRegistry(stakeholderRegistryContract);
        setBidEvaluationManager(bidEvaluationManagerContract);

        if (!allAddresses && !fetchAttempted.value) {
          try {
            await fetchAllAddresses();
          } catch (error) {
            console.error('Failed to fetch addresses, will not retry:', error);
            setError('Failed to fetch contract addresses');
          }
        }
        
        if (marketplaceContract && typeof marketplaceContract.createTask === 'function') {
          setContractMethods({ initialized: true, valid: true });
          console.log('Contract methods validated successfully with signer');
          contractsInitialized.readWrite = true;
          setContractsReady(prev => ({ ...prev, readWrite: true }));
        } else {
          console.error('Contract methods validation failed: createTask not found');
          setContractMethods({ initialized: true, valid: false });
          setError('Contract methods validation failed: createTask function not available');
          
          console.error('Contract details:', {
            address: marketplaceContract?.address,
            functions: Object.keys(marketplaceContract || {}).filter(key => typeof marketplaceContract[key] === 'function'),
            hasCreateTask: marketplaceContract && 'createTask' in marketplaceContract,
            typeofCreateTask: marketplaceContract && typeof marketplaceContract.createTask
          });
        }
      } catch (err) {
        console.error('Error initializing read-write contracts:', err);
        setError('Failed to initialize read-write contracts: ' + (err.message || 'Unknown error'));
        
        if (retryCount < MAX_RETRY_COUNT) {
          console.log(`Retrying read-write contract initialization (attempt ${retryCount + 1} of ${MAX_RETRY_COUNT})...`);
          setTimeout(() => {
            setRetryCount(prev => prev + 1);
          }, 1500); // 1.5 second delay between retries
        }
      } finally {
        setIsLoading(false);
      }
    };

    initReadWriteContracts();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, signer, isConnected, account, retryCount]);

  return {
    roseMarketplace,
    roseToken,
    tokenStaking,
    stakeholderRegistry,
    bidEvaluationManager,
    isLoading,
    error,
    allAddresses,
    fetchAllAddresses,
    contractMethods,
    contractsReady
  };
};
