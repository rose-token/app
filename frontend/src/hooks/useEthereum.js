import { useState, useEffect, createContext, useContext, useCallback } from 'react';
import { ethers } from 'ethers';
import { useSDK } from '@metamask/sdk-react';

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
  
  // Use the MetaMask SDK hook
  const { sdk, connected, connecting, provider: metamaskProvider, chainId: sdkChainId } = useSDK();

  // Set up provider and signer when MetaMask SDK connection changes
  useEffect(() => {
    const setupProviderAndSigner = async () => {
      if (metamaskProvider && connected) {
        try {
          const ethersProvider = new ethers.providers.Web3Provider(metamaskProvider);
          const ethSigner = ethersProvider.getSigner();
          const accounts = await ethersProvider.listAccounts();

          setProvider(ethersProvider);
          setSigner(ethSigner);
          
          if (accounts && accounts.length > 0) {
            setAccount(accounts[0]);
          }
          
          setChainId(sdkChainId || '0xaa36a7'); // Sepolia chain ID if not provided
          setIsConnected(true);
          setIsConnecting(false);
        } catch (error) {
          console.error('Error setting up provider and signer:', error);
          setError('Failed to setup wallet connection: ' + (error.message || 'Unknown error'));
          setIsConnecting(false);
        }
      } else if (!connected) {
        // Clear state when disconnected
        setProvider(null);
        setSigner(null);
        setAccount(null);
        setIsConnected(false);
      }
    };

    setupProviderAndSigner();
  }, [metamaskProvider, connected, sdkChainId]);

  // Handle connection state
  useEffect(() => {
    setIsConnecting(connecting);
  }, [connecting]);

  const handleAccountsChanged = useCallback(async (accounts) => {
    console.log('Accounts changed:', accounts);
    if (!accounts || accounts.length === 0) {
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

  // Set up event listeners for window.ethereum on mobile devices
  useEffect(() => {
    const isMobile = isMobileDevice();
    if (!isMobile || typeof window === 'undefined' || !window.ethereum) return;

    const handleDisconnect = () => {
      console.log('Wallet disconnected (injected provider)');
      setAccount(null);
      setSigner(null);
      setIsConnected(false);
      setProvider(null);
    };

    console.log('Setting up event listeners for injected provider');

    // Add event listeners to window.ethereum
    window.ethereum.on('accountsChanged', handleAccountsChanged);
    window.ethereum.on('chainChanged', handleChainChanged);
    window.ethereum.on('disconnect', handleDisconnect);

    // Clean up event listeners
    return () => {
      if (window.ethereum.removeListener) {
        window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
        window.ethereum.removeListener('chainChanged', handleChainChanged);
        window.ethereum.removeListener('disconnect', handleDisconnect);
      }
    };
  }, [handleAccountsChanged, handleChainChanged]);

  // Set up event listeners when MetaMask SDK provider changes (desktop)
  useEffect(() => {
    if (!metamaskProvider || !connected) return;

    const handleDisconnect = () => {
      console.log('Wallet disconnected (SDK provider)');
      setAccount(null);
      setSigner(null);
      setIsConnected(false);
    };

    console.log('Setting up event listeners for SDK provider');

    // Add event listeners
    metamaskProvider.on('accountsChanged', handleAccountsChanged);
    metamaskProvider.on('chainChanged', handleChainChanged);
    metamaskProvider.on('disconnect', handleDisconnect);

    // Clean up event listeners
    return () => {
      if (metamaskProvider.removeListener) {
        metamaskProvider.removeListener('accountsChanged', handleAccountsChanged);
        metamaskProvider.removeListener('chainChanged', handleChainChanged);
        metamaskProvider.removeListener('disconnect', handleDisconnect);
      }
    };
  }, [metamaskProvider, connected, handleAccountsChanged, handleChainChanged]);

  const connectWallet = useCallback(async () => {
    if (isConnecting) return;

    console.log('Connecting wallet...');
    setIsConnecting(true);
    setError(null);

    const isMobile = isMobileDevice();
    console.log('Device type:', isMobile ? 'Mobile' : 'Desktop');

    try {
      let accounts;

      // On mobile, prioritize window.ethereum (injected by mobile wallet apps)
      // CRITICAL: Call eth_requestAccounts IMMEDIATELY to preserve user gesture context
      if (isMobile && typeof window !== 'undefined' && window.ethereum) {
        console.log('Mobile wallet browser detected');

        try {
          // IMMEDIATELY call eth_requestAccounts - no delays, no waiting, no state updates first
          // This preserves the user gesture context that MetaMask Mobile requires
          console.log('Requesting accounts from mobile wallet (immediate call)...');
          accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
          console.log('Accounts received from mobile wallet:', accounts);

          if (!accounts || accounts.length === 0) {
            throw new Error('No accounts returned from mobile wallet');
          }

          // Now set up provider AFTER we have accounts
          console.log('Setting up ethers provider for mobile...');
          const ethersProvider = new ethers.providers.Web3Provider(window.ethereum);
          const ethSigner = ethersProvider.getSigner();
          const network = await ethersProvider.getNetwork();

          console.log('Network detected:', network);

          setProvider(ethersProvider);
          setSigner(ethSigner);
          setChainId('0x' + network.chainId.toString(16));
          setAccount(accounts[0]);
          setIsConnected(true);

          console.log('Mobile wallet connection complete!');
          console.log('Connected account:', accounts[0]);
          console.log('Connected network:', network.chainId);
          setIsConnecting(false);
          return;
        } catch (error) {
          console.error('Mobile wallet connection failed:', error);
          console.error('Error details:', {
            code: error.code,
            message: error.message,
            data: error.data
          });

          // If user rejected, throw immediately
          if (error.code === 4001 || error.code === 'ACTION_REJECTED') {
            throw new Error('Connection rejected by user');
          }

          // For other errors, try SDK fallback
          console.log('Mobile wallet failed, trying SDK fallback...');
        }
      } else if (isMobile && (!window || !window.ethereum)) {
        // Mobile but no injected provider
        throw new Error('Please open this page in a wallet browser (MetaMask, Brave, Phantom, Trust Wallet, etc.)');
      }

      // For desktop or if mobile injected provider failed, use MetaMask SDK
      if (!sdk) {
        throw new Error('Wallet connection not available. Please install MetaMask or use a wallet browser.');
      }

      console.log('Using MetaMask SDK for connection');

      if (isMobile && metamaskProvider) {
        accounts = await metamaskProvider.request({ method: 'eth_requestAccounts' });
        console.log('Mobile connection requested with SDK provider');
      } else {
        accounts = await sdk.connect();
        console.log('Connection requested through SDK');
      }

      console.log('Waiting for wallet connection...');

      if (!accounts || accounts.length === 0) {
        console.log('No accounts found initially, retrying...');

        // Try to get accounts again if initial attempt returned empty
        if (metamaskProvider) {
          accounts = await metamaskProvider.request({ method: 'eth_requestAccounts' });
        } else {
          accounts = await sdk.connectAndSign();
        }
      }

      console.log('MetaMask connected:', accounts);

      if (!accounts || accounts.length === 0) {
        throw new Error('No accounts found after connection');
      }

      setAccount(accounts[0]);
      setIsConnected(true);
      console.log('Wallet connection complete');
    } catch (error) {
      console.error('Error connecting wallet:', error);
      setError('Failed to connect wallet: ' + (error.message || 'Unknown error'));
    } finally {
      setIsConnecting(false);
    }
  }, [sdk, isConnecting, metamaskProvider]);

  const disconnectWallet = useCallback(async () => {
    try {
      if (sdk) {
        await sdk.disconnect();
      }
      
      // Clear local state
      setAccount(null);
      setSigner(null);
      setIsConnected(false);
      setProvider(null);
      
      // Clear any stored data
      localStorage.removeItem('metamask-sdk:lastUsedChainId');
      
    } catch (error) {
      console.error("Error disconnecting wallet:", error);
    }
  }, [sdk]);
  
  const switchNetwork = useCallback(async (targetChainId) => {
    try {
      setError('');

      // Use window.ethereum if available (mobile), otherwise use SDK provider
      const providerToUse = (typeof window !== 'undefined' && window.ethereum) ? window.ethereum : metamaskProvider;

      if (providerToUse) {
        await providerToUse.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: targetChainId }],
        });
      } else {
        setChainId(targetChainId);
        alert('Please switch to the selected network in your wallet app');
      }
    } catch (error) {
      console.error('Error switching network:', error);
      setError('Failed to switch network');
    }
  }, [metamaskProvider, setChainId, setError]);

  // Auto-connect for mobile wallet browsers
  useEffect(() => {
    const isMobile = isMobileDevice();
    if (isMobile && !isConnecting && !isConnected && typeof window !== 'undefined' && window.ethereum) {
      console.log('Mobile wallet browser detected, attempting auto-connect...');

      const attemptMobileAutoConnect = async () => {
        try {
          // Try to get previously connected accounts (doesn't require user approval)
          // Use a short delay to let the page fully initialize
          await new Promise(resolve => setTimeout(resolve, 500));

          const accounts = await window.ethereum.request({ method: 'eth_accounts' });

          if (accounts && accounts.length > 0) {
            console.log('Found previously connected accounts, auto-connecting...');
            // Set up provider with existing accounts
            const ethersProvider = new ethers.providers.Web3Provider(window.ethereum);
            const ethSigner = ethersProvider.getSigner();
            const network = await ethersProvider.getNetwork();

            setProvider(ethersProvider);
            setSigner(ethSigner);
            setChainId('0x' + network.chainId.toString(16));
            setAccount(accounts[0]);
            setIsConnected(true);

            console.log('Mobile wallet auto-connected successfully!');
          } else {
            console.log('No previously connected accounts found');
          }
        } catch (error) {
          // Silent fail for auto-connect
          console.log('Mobile auto-connect failed, user can connect manually:', error.message);
        }
      };

      attemptMobileAutoConnect();
    }
  }, [isConnecting, isConnected]);

  // Try to reconnect on startup if previously connected (desktop SDK)
  useEffect(() => {
    const isMobile = isMobileDevice();
    if (!isMobile && sdk && !isConnecting && !isConnected) {
      // MetaMask SDK automatically attempts to reconnect if previously connected
      const attemptReconnect = async () => {
        try {
          const accounts = await sdk.connectAndSign();
          if (accounts && accounts.length > 0) {
            console.log('Reconnected to MetaMask');
          }
        } catch (error) {
          // Silent fail for auto-reconnect
          console.log('Auto-reconnect failed, user can connect manually');
        }
      };

      attemptReconnect();
    }
  }, [sdk, isConnecting, isConnected]);

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
