import { useState, useEffect, createContext, useContext, useCallback } from 'react';
import { ethers } from 'ethers';
import { EthereumProvider as WalletConnectProvider } from '@walletconnect/ethereum-provider';

const isMobileDevice = () => {
  return (
    typeof window !== 'undefined' &&
    (
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
      (navigator.maxTouchPoints && navigator.maxTouchPoints > 2)
    )
  );
};

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
    const initProvider = async () => {
      try {
        const projectId = "95be0fbf27f06934c74d670d57f44939";
        
        const provider = await WalletConnectProvider.init({
          projectId: projectId,
          chains: [11155111], // Sepolia chain ID
          showQrModal: true,
          metadata: {
            name: "Rose Token",
            description: "A decentralized task marketplace with a socialist token distribution model",
            url: window.location.origin,
            icons: ["https://walletconnect.com/walletconnect-logo.png"] // Placeholder icon
          },
          optionalMethods: ["eth_signTypedData", "eth_signTypedData_v4", "eth_sign"],
          rpcMap: {
            11155111: "https://sepolia.infura.io/v3/"
          }
        });
        
        setWeb3Modal(provider);
      } catch (error) {
        console.error("Failed to initialize WalletConnect provider:", error);
        setError("Failed to initialize wallet connection");
      }
    };
    
    initProvider();
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

  const handleDisconnect = useCallback(() => {
    console.log('Wallet disconnected');
    setAccount(null);
    setSigner(null);
    setIsConnected(false);
    if (web3Modal) {
      web3Modal.clearCachedProvider();
    }
  }, [web3Modal]);

  const setupProviderEvents = useCallback((provider) => {
    if (provider.on) {
      provider.on('accountsChanged', handleAccountsChanged);
      provider.on('chainChanged', handleChainChanged);
      provider.on('disconnect', handleDisconnect);

      return () => {
        if (provider.removeListener) {
          provider.removeListener('accountsChanged', handleAccountsChanged);
          provider.removeListener('chainChanged', handleChainChanged);
          provider.removeListener('disconnect', handleDisconnect);
        }
      };
    }
  }, [handleAccountsChanged, handleChainChanged, handleDisconnect]);




  const connectWallet = useCallback(async () => {
    if (!web3Modal || isConnecting) return;

    try {
      console.log('Connecting wallet...');
      setIsConnecting(true);
      setError(null);
      
      await web3Modal.connect();
      
      console.log('WalletConnect provider connected:', web3Modal);
      
      const ethersProvider = new ethers.providers.Web3Provider(web3Modal);
      
      let accounts;
      const isMobile = isMobileDevice();
      
      if (isMobile) {
        console.log('Mobile device detected, using explicit account request');
        try {
          await ethersProvider.provider.request({ method: 'eth_requestAccounts' });
          accounts = await ethersProvider.listAccounts();
        } catch (requestError) {
          console.error('Mobile account request failed:', requestError);
          throw new Error('Failed to connect wallet on mobile: ' + (requestError.message || 'Unknown error'));
        }
      } else {
        try {
          try {
            await ethersProvider.provider.request({ method: 'eth_requestAccounts' });
          } catch (requestError) {
            console.log('Direct request failed on desktop, falling back to listAccounts:', requestError);
          }
          accounts = await ethersProvider.listAccounts();
        } catch (error) {
          console.error('Desktop account request failed:', error);
          throw new Error('Failed to get accounts: ' + (error.message || 'Unknown error'));
        }
      }
      
      if (!accounts || accounts.length === 0) {
        throw new Error('No accounts found after connection');
      }
      
      const ethSigner = ethersProvider.getSigner();
      
      const chainIdFromProvider = web3Modal.chains ? `0x${web3Modal.chains[0].toString(16)}` : '0xaa36a7';
      
      setProvider(ethersProvider);
      setSigner(ethSigner);
      setAccount(accounts[0]);
      setChainId(chainIdFromProvider);
      setIsConnected(true);
      
      setupProviderEvents(ethersProvider);
      
    } catch (error) {
      console.error('Error connecting wallet:', error);
      setError('Failed to connect wallet: ' + (error.message || 'Unknown error'));
    } finally {
      setIsConnecting(false);
    }
  }, [web3Modal, setupProviderEvents, isConnecting]);

  const disconnectWallet = useCallback(async () => {
    try {
      if (provider) {
        await provider.disconnect();
      }
      if (web3Modal) {
        web3Modal.clearCachedProvider();
        localStorage.removeItem('walletconnect');
        Object.keys(localStorage).forEach(key => {
          if (key.startsWith('wc@2:')) {
            localStorage.removeItem(key);
          }
        });
      }
      setAccount(null);
      setSigner(null);
      setIsConnected(false);
      setProvider(null);
    } catch (error) {
      console.error("Error disconnecting wallet:", error);
    }
  }, [web3Modal, provider]);
  
  const switchNetwork = useCallback(async (targetChainId) => {
    try {
      setError('');
      if (window.ethereum) {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: targetChainId }],
        });
      } else if (provider) {
        setChainId(targetChainId);
        
        alert('Please switch to the selected network in your wallet app');
      }
    } catch (error) {
      console.error('Error switching network:', error);
      setError('Failed to switch network');
    }
  }, [provider, setChainId, setError]);

  useEffect(() => {
    if (web3Modal && web3Modal.cachedProvider && !isConnecting && !isConnected) {
      connectWallet();
    }
  }, [web3Modal, isConnecting, isConnected, connectWallet]);

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
    switchNetwork,
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
