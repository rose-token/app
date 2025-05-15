import { useState, useEffect, createContext, useContext, useCallback } from 'react';
import { ethers } from 'ethers';

const EthereumContext = createContext();

export const EthereumProvider = ({ children }) => {
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [account, setAccount] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState(null);

  const SEPOLIA_CHAIN_ID = '0xaa36a7';

  const switchToSepolia = useCallback(async () => {
    try {
      if (!window.ethereum) return;
      
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: SEPOLIA_CHAIN_ID }],
      });
    } catch (switchError) {
      if (switchError.code === 4902) {
        try {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: SEPOLIA_CHAIN_ID,
                chainName: 'Sepolia Testnet',
                nativeCurrency: {
                  name: 'Sepolia ETH',
                  symbol: 'ETH',
                  decimals: 18,
                },
                rpcUrls: ['https://sepolia.infura.io/v3/'],
                blockExplorerUrls: ['https://sepolia.etherscan.io'],
              },
            ],
          });
        } catch (addError) {
          console.error('Error adding Sepolia network:', addError);
          setError('Failed to add Sepolia network');
        }
      } else {
        console.error('Error switching to Sepolia:', switchError);
        setError('Failed to switch to Sepolia network');
      }
    }
  }, []);

  const handleAccountsChanged = useCallback(async (accounts) => {
    console.log('Accounts changed:', accounts);
    if (accounts.length === 0) {
      setAccount(null);
      setSigner(null);
      setIsConnected(false);
    } else {
      try {
        const ethersProvider = new ethers.BrowserProvider(window.ethereum);
        const ethSigner = await ethersProvider.getSigner();
        
        setProvider(ethersProvider);
        setSigner(ethSigner);
        setAccount(accounts[0]);
        setIsConnected(true);
      } catch (error) {
        console.error('Error handling account change:', error);
      }
    }
  }, []);

  const handleChainChanged = useCallback((chainId) => {
    console.log('Chain changed:', chainId);
    setChainId(chainId);
    window.location.reload();
  }, []);

  const checkConnection = useCallback(async () => {
    try {
      console.log('Checking wallet connection...');
      console.log('window.ethereum:', window.ethereum);
      
      if (window.ethereum) {
        const accounts = await window.ethereum.request({ method: 'eth_accounts' });
        console.log('Existing accounts:', accounts);
        
        if (accounts.length > 0) {
          const ethersProvider = new ethers.BrowserProvider(window.ethereum);
          const ethSigner = await ethersProvider.getSigner();
          const currentChainId = await window.ethereum.request({ method: 'eth_chainId' });
          
          setProvider(ethersProvider);
          setSigner(ethSigner);
          setAccount(accounts[0]);
          setChainId(currentChainId);
          setIsConnected(true);
          
          console.log('Wallet already connected:', accounts[0]);
        }
      }
    } catch (error) {
      console.error('Error checking connection:', error);
    }
  }, []);

  const connectWallet = useCallback(async () => {
    try {
      console.log('Connecting wallet...');
      setIsConnecting(true);
      setError(null);
      
      if (!window.ethereum) {
        console.error('No Ethereum provider found');
        setError('Please install MetaMask or another Ethereum wallet');
        return;
      }
      
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      console.log('Connected accounts:', accounts);
      
      const ethersProvider = new ethers.BrowserProvider(window.ethereum);
      const ethSigner = await ethersProvider.getSigner();
      const currentChainId = await window.ethereum.request({ method: 'eth_chainId' });
      
      setProvider(ethersProvider);
      setSigner(ethSigner);
      setAccount(accounts[0]);
      setChainId(currentChainId);
      setIsConnected(true);
      
      if (currentChainId !== SEPOLIA_CHAIN_ID) {
        await switchToSepolia();
      }
    } catch (error) {
      console.error('Error connecting wallet:', error);
      setError('Failed to connect wallet');
    } finally {
      setIsConnecting(false);
    }
  }, [SEPOLIA_CHAIN_ID, switchToSepolia]);

  useEffect(() => {
    console.log('Setting up wallet event listeners...');
    
    if (window.ethereum) {
      checkConnection();
      
      window.ethereum.on('accountsChanged', handleAccountsChanged);
      window.ethereum.on('chainChanged', handleChainChanged);
      
      return () => {
        window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
        window.ethereum.removeListener('chainChanged', handleChainChanged);
      };
    } else {
      console.log('No Ethereum provider detected');
    }
  }, [checkConnection, handleAccountsChanged, handleChainChanged]);

  const value = {
    provider,
    signer,
    account,
    chainId,
    isConnected,
    isConnecting,
    error,
    connectWallet,
    switchToSepolia,
  };

  return (
    <EthereumContext.Provider value={value}>
      {children}
    </EthereumContext.Provider>
  );
};

export const useEthereum = () => {
  const context = useContext(EthereumContext);
  if (!context) {
    throw new Error('useEthereum must be used within an EthereumProvider');
  }
  return context;
};
