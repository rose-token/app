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

// Helper to get the correct injected provider from window.ethereum
// In multi-provider environments, window.ethereum.providers contains the actual wallets
const getInjectedProvider = () => {
  if (typeof window === 'undefined') return null;
  const eth = window.ethereum;
  if (!eth) return null;

  console.log('getInjectedProvider: Analyzing window.ethereum');
  console.log('  isMetaMask:', eth.isMetaMask);
  console.log('  isBraveWallet:', eth.isBraveWallet);
  console.log('  isCoinbaseWallet:', eth.isCoinbaseWallet);
  console.log('  isPhantom:', eth.isPhantom);
  console.log('  providers array:', eth.providers?.length || 0);

  // If multiple providers exist, pick from the array
  if (Array.isArray(eth.providers) && eth.providers.length > 0) {
    console.log('Multiple providers detected:', eth.providers.length);
    eth.providers.forEach((p, idx) => {
      console.log(`Provider[${idx}] flags:`, {
        isMetaMask: p.isMetaMask,
        isBraveWallet: p.isBraveWallet,
        isCoinbaseWallet: p.isCoinbaseWallet,
        isPhantom: p.isPhantom,
      });
    });

    // Check for specific wallets first (before MetaMask, since many wallets set isMetaMask for compat)
    const preferred =
      eth.providers.find(p => p.isBraveWallet && !p.isPhantom) ||  // Brave (not Phantom pretending)
      eth.providers.find(p => p.isCoinbaseWallet) ||                // Coinbase
      eth.providers.find(p => p.isPhantom) ||                       // Phantom (even if isMetaMask also true)
      eth.providers.find(p => p.isMetaMask && !p.isPhantom && !p.isBraveWallet && !p.isCoinbaseWallet) || // Real MetaMask
      eth.providers[0];                                              // Fallback to first

    console.log('Selected provider from array:', {
      isMetaMask: preferred?.isMetaMask,
      isBraveWallet: preferred?.isBraveWallet,
      isCoinbaseWallet: preferred?.isCoinbaseWallet,
      isPhantom: preferred?.isPhantom,
    });

    return preferred;
  }

  // Single provider: Check for specific wallet identifiers first
  // Note: Phantom sets isMetaMask=true for compatibility, so check isPhantom first
  if (eth.isPhantom) {
    console.log('Detected: Phantom wallet (may also show isMetaMask for compat)');
    return eth;
  }
  if (eth.isBraveWallet) {
    console.log('Detected: Brave Wallet');
    return eth;
  }
  if (eth.isCoinbaseWallet) {
    console.log('Detected: Coinbase Wallet');
    return eth;
  }
  if (eth.isMetaMask) {
    console.log('Detected: MetaMask (or wallet claiming to be MetaMask)');
    return eth;
  }

  // Fallback: return whatever window.ethereum is
  console.log('Using fallback: window.ethereum with no specific wallet flags');
  return eth;
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

  // Set up event listeners for injected provider on mobile devices
  useEffect(() => {
    const isMobile = isMobileDevice();
    if (!isMobile || typeof window === 'undefined') return;

    const injectedProvider = getInjectedProvider();
    if (!injectedProvider) return;

    const handleDisconnect = () => {
      console.log('Wallet disconnected (injected provider)');
      setAccount(null);
      setSigner(null);
      setIsConnected(false);
      setProvider(null);
    };

    console.log('Setting up event listeners for injected provider');

    // Add event listeners to the selected injected provider
    injectedProvider.on('accountsChanged', handleAccountsChanged);
    injectedProvider.on('chainChanged', handleChainChanged);
    injectedProvider.on('disconnect', handleDisconnect);

    // Clean up event listeners
    return () => {
      if (injectedProvider.removeListener) {
        injectedProvider.removeListener('accountsChanged', handleAccountsChanged);
        injectedProvider.removeListener('chainChanged', handleChainChanged);
        injectedProvider.removeListener('disconnect', handleDisconnect);
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

    try {
      console.log('Connecting wallet...');
      setIsConnecting(true);
      setError(null);

      const SEPOLIA_CHAIN_ID = '0xaa36a7'; // Sepolia testnet

      // Try injected provider first (works for both desktop extensions and mobile in-app browsers)
      const injected = getInjectedProvider();

      if (injected) {
        console.log('Using injected provider');
        console.log('Injected provider flags:', {
          isMetaMask: injected.isMetaMask,
          isBraveWallet: injected.isBraveWallet,
          isCoinbaseWallet: injected.isCoinbaseWallet,
          isPhantom: injected.isPhantom,
        });

        // CRITICAL: Call eth_requestAccounts IMMEDIATELY to preserve user gesture context
        const accounts = await injected.request({ method: 'eth_requestAccounts' });
        console.log('Accounts received from injected provider:', accounts);

        if (!accounts || accounts.length === 0) {
          throw new Error('No accounts returned from wallet');
        }

        // Check and switch to Sepolia if needed
        const ethersProvider = new ethers.providers.Web3Provider(injected);
        const network = await ethersProvider.getNetwork();
        const currentChainId = '0x' + network.chainId.toString(16);

        console.log('Current network:', network.chainId, '(', currentChainId, ')');
        console.log('Required network: Sepolia (11155111 / 0xaa36a7)');

        if (currentChainId !== SEPOLIA_CHAIN_ID) {
          console.log('Wrong network detected, requesting switch to Sepolia...');
          try {
            await injected.request({
              method: 'wallet_switchEthereumChain',
              params: [{ chainId: SEPOLIA_CHAIN_ID }],
            });
            console.log('Network switched to Sepolia');
          } catch (switchError) {
            // This error code indicates that the chain has not been added to MetaMask
            if (switchError.code === 4902) {
              console.log('Sepolia not in wallet, attempting to add it...');
              try {
                await injected.request({
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
                console.log('Sepolia network added and switched');
              } catch (addError) {
                console.error('Failed to add Sepolia network:', addError);
                throw new Error('Please add Sepolia network to your wallet and try again');
              }
            } else {
              console.error('Failed to switch network:', switchError);
              throw new Error('Please switch to Sepolia network in your wallet');
            }
          }
        }

        // Get fresh provider after potential network switch
        const finalProvider = new ethers.providers.Web3Provider(injected);
        const ethSigner = finalProvider.getSigner();
        const finalNetwork = await finalProvider.getNetwork();

        setProvider(finalProvider);
        setSigner(ethSigner);
        setChainId('0x' + finalNetwork.chainId.toString(16));
        setAccount(accounts[0]);
        setIsConnected(true);

        console.log('Injected wallet connection complete');
        console.log('Connected account:', accounts[0]);
        console.log('Connected network:', finalNetwork.chainId);
        return;
      }

      // Fall back to MetaMask SDK if no injected provider
      if (!sdk) {
        throw new Error(
          'Wallet connection not available. Install MetaMask or open this page in a wallet browser.'
        );
      }

      console.log('No injected provider found, using MetaMask SDK');
      let accounts;

      if (metamaskProvider) {
        accounts = await metamaskProvider.request({ method: 'eth_requestAccounts' });
        console.log('SDK provider requested accounts');
      } else {
        accounts = await sdk.connect();
        console.log('SDK connect called');
      }

      if (!accounts || accounts.length === 0) {
        throw new Error('No accounts found after connection');
      }

      setAccount(accounts[0]);
      setIsConnected(true);
      console.log('Wallet connection complete via SDK');
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

      // Use injected provider if available (mobile), otherwise use SDK provider
      const injected = getInjectedProvider();
      const providerToUse = injected || metamaskProvider;

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
    if (isMobile && !isConnecting && !isConnected && typeof window !== 'undefined') {
      const attemptMobileAutoConnect = async () => {
        try {
          // Use a short delay to let the page fully initialize
          await new Promise(resolve => setTimeout(resolve, 500));

          const injected = getInjectedProvider();
          if (injected) {
            console.log('Mobile wallet browser detected, attempting auto-connect...');

            const accounts = await injected.request({ method: 'eth_accounts' });

            if (accounts && accounts.length > 0) {
              console.log('Found previously connected accounts, auto-connecting...');
              // Set up provider with existing accounts
              const ethersProvider = new ethers.providers.Web3Provider(injected);
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
