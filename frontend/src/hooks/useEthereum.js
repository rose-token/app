import { useState, useEffect, createContext, useContext, useCallback } from 'react';
import { ethers } from 'ethers';
import Web3Modal from 'web3modal';
import WalletConnectProvider from '@walletconnect/web3-provider';

const EthereumContext = createContext();

export const EthereumProvider = ({ children }) => {
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [account, setAccount] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState(null);
  const [web3Modal, setWeb3Modal] = useState(null);

  const SEPOLIA_CHAIN_ID = '0xaa36a7';

  useEffect(() => {
    const providerOptions = {
      walletconnect: {
        package: WalletConnectProvider,
        options: {
          infuraId: "27e484dcd9e3efcfd25a83a78777cdf1" // Replace with your Infura ID
        }
      }
    };

    const newWeb3Modal = new Web3Modal({
      cacheProvider: true,
      providerOptions,
      theme: "light"
    });

    setWeb3Modal(newWeb3Modal);
  }, []);
  
  useEffect(() => {
    if (web3Modal && web3Modal.cachedProvider && connectWallet) {
      connectWallet();
    }
  }, [web3Modal, connectWallet]);

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
        if (provider) {
          const ethSigner = provider.getSigner();
          setSigner(ethSigner);
          setAccount(accounts[0]);
          setIsConnected(true);
        }
      } catch (error) {
        console.error('Error handling account change:', error);
      }
    }
  }, [provider]);

  const handleChainChanged = useCallback((chainId) => {
    console.log('Chain changed:', chainId);
    setChainId(chainId);
    window.location.reload();
  }, []);

  const setupProviderEvents = useCallback((provider) => {
    if (provider.on) {
      provider.on('accountsChanged', handleAccountsChanged);
      provider.on('chainChanged', handleChainChanged);
      provider.on('disconnect', () => {
        console.log('Wallet disconnected');
        setAccount(null);
        setSigner(null);
        setIsConnected(false);
        if (web3Modal) {
          web3Modal.clearCachedProvider();
        }
      });

      return () => {
        if (provider.removeListener) {
          provider.removeListener('accountsChanged', handleAccountsChanged);
          provider.removeListener('chainChanged', handleChainChanged);
          provider.removeListener('disconnect', () => {
            console.log('Wallet disconnected');
          });
        }
      };
    }
  }, [handleAccountsChanged, handleChainChanged, web3Modal]);

  const connectWallet = useCallback(async () => {
    if (!web3Modal) return;

    try {
      console.log('Connecting wallet...');
      setIsConnecting(true);
      setError(null);
      
      const modalProvider = await web3Modal.connect();
      console.log('Web3Modal provider connected:', modalProvider);
      
      const ethersProvider = new ethers.providers.Web3Provider(modalProvider);
      const accounts = await ethersProvider.listAccounts();
      const ethSigner = ethersProvider.getSigner();
      const network = await ethersProvider.getNetwork();
      const currentChainId = '0x' + network.chainId.toString(16);
      
      setProvider(ethersProvider);
      setSigner(ethSigner);
      setAccount(accounts[0]);
      setChainId(currentChainId);
      setIsConnected(true);
      
      setupProviderEvents(modalProvider);
      
      if (currentChainId !== SEPOLIA_CHAIN_ID) {
        await switchToSepolia();
      }
    } catch (error) {
      console.error('Error connecting wallet:', error);
      setError('Failed to connect wallet');
    } finally {
      setIsConnecting(false);
    }
  }, [web3Modal, setupProviderEvents, switchToSepolia]);

  const disconnectWallet = useCallback(async () => {
    if (web3Modal) {
      web3Modal.clearCachedProvider();
    }
    setAccount(null);
    setSigner(null);
    setIsConnected(false);
  }, [web3Modal]);

  const value = {
    provider,
    signer,
    account,
    chainId,
    isConnected,
    isConnecting,
    error,
    connectWallet,
    disconnectWallet,
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
