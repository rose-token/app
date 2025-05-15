import { useState, useEffect, createContext, useContext } from 'react';
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

  useEffect(() => {
    console.log('Checking for Ethereum provider...');
    console.log('window.ethereum:', window.ethereum);
    
    if (typeof window.ethereum !== 'undefined') {
      console.log('Ethereum provider found!');
      const provider = new ethers.BrowserProvider(window.ethereum);
      setProvider(provider);

      window.ethereum.on('accountsChanged', handleAccountsChanged);
      
      window.ethereum.on('chainChanged', handleChainChanged);

      checkConnection();
    } else {
      console.error('No Ethereum provider detected');
      setError('Please install MetaMask to use this application');
    }

    return () => {
      if (window.ethereum) {
        window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
        window.ethereum.removeListener('chainChanged', handleChainChanged);
      }
    };
  }, []);

  const checkConnection = async () => {
    try {
      const accounts = await window.ethereum.request({ method: 'eth_accounts' });
      if (accounts.length > 0) {
        const provider = new ethers.BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();
        const chainId = await window.ethereum.request({ method: 'eth_chainId' });
        
        setAccount(accounts[0]);
        setSigner(signer);
        setChainId(chainId);
        setIsConnected(true);
      }
    } catch (error) {
      console.error('Error checking connection:', error);
    }
  };

  const handleAccountsChanged = async (accounts) => {
    if (accounts.length === 0) {
      setAccount(null);
      setSigner(null);
      setIsConnected(false);
    } else {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      
      setAccount(accounts[0]);
      setSigner(signer);
      setIsConnected(true);
    }
  };

  const handleChainChanged = (chainId) => {
    setChainId(chainId);
    window.location.reload();
  };

  const connectWallet = async () => {
    if (!provider) return;
    
    try {
      setIsConnecting(true);
      setError(null);
      
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      const signer = await provider.getSigner();
      const chainId = await window.ethereum.request({ method: 'eth_chainId' });
      
      setAccount(accounts[0]);
      setSigner(signer);
      setChainId(chainId);
      setIsConnected(true);
      
      if (chainId !== SEPOLIA_CHAIN_ID) {
        await switchToSepolia();
      }
    } catch (error) {
      console.error('Error connecting wallet:', error);
      setError('Failed to connect wallet');
    } finally {
      setIsConnecting(false);
    }
  };

  const switchToSepolia = async () => {
    try {
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
  };

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
