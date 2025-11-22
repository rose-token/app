import React, { useState, useEffect } from 'react';
import { useEthereum } from '../hooks/useEthereum';

const ProviderDebug = () => {
  const { isConnected, isConnecting, account, chainId, error } = useEthereum();
  const [providerInfo, setProviderInfo] = useState({});

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const updateProviderInfo = () => {
      const eth = window.ethereum;
      setProviderInfo({
        hasEthereum: !!eth,
        hasProvidersArray: !!(eth && eth.providers),
        providersCount: eth?.providers?.length || 0,
        ethereumFlags: eth ? {
          isMetaMask: eth.isMetaMask,
          isBraveWallet: eth.isBraveWallet,
          isCoinbaseWallet: eth.isCoinbaseWallet,
          isPhantom: eth.isPhantom,
          hasRequest: typeof eth.request === 'function',
        } : null,
        providers: eth?.providers?.map((p, idx) => ({
          index: idx,
          isMetaMask: p.isMetaMask,
          isBraveWallet: p.isBraveWallet,
          isCoinbaseWallet: p.isCoinbaseWallet,
          isPhantom: p.isPhantom,
        })) || [],
        // Connection state
        reactState: {
          isConnected,
          isConnecting,
          account: account ? `${account.slice(0, 6)}...${account.slice(-4)}` : null,
          chainId,
          error: error ? error.substring(0, 50) : null,
        },
      });
    };

    updateProviderInfo();
    const interval = setInterval(updateProviderInfo, 1000);
    return () => clearInterval(interval);
  }, [isConnected, isConnecting, account, chainId, error]);

  if (typeof window === 'undefined') {
    return null;
  }

  const testDirectConnect = async () => {
    console.log('=== DIRECT CONNECTION TEST ===');
    console.log('1. Checking window.ethereum:', !!window.ethereum);

    if (!window.ethereum) {
      console.error('No window.ethereum found!');
      return;
    }

    console.log('2. window.ethereum.isMetaMask:', window.ethereum.isMetaMask);
    console.log('3. window.ethereum.request type:', typeof window.ethereum.request);

    try {
      console.log('4. Calling eth_requestAccounts...');
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      console.log('5. SUCCESS! Accounts:', accounts);
    } catch (err) {
      console.error('6. ERROR calling eth_requestAccounts:', err);
      console.error('Error code:', err.code);
      console.error('Error message:', err.message);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      top: '10px',
      right: '10px',
      background: 'rgba(0, 0, 0, 0.9)',
      color: '#0f0',
      padding: '10px',
      borderRadius: '5px',
      fontSize: '10px',
      fontFamily: 'monospace',
      maxWidth: '350px',
      maxHeight: '90vh',
      overflow: 'auto',
      zIndex: 9999,
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
    }}>
      <div style={{ fontWeight: 'bold', marginBottom: '5px', color: '#fff' }}>
        Provider Debug Info
      </div>
      <button
        onClick={testDirectConnect}
        style={{
          background: '#f59e0b',
          color: '#000',
          border: 'none',
          padding: '5px 10px',
          borderRadius: '3px',
          fontSize: '10px',
          marginBottom: '10px',
          cursor: 'pointer',
          width: '100%',
        }}
      >
        Test Direct Connect
      </button>
      {JSON.stringify(providerInfo, null, 2)}
    </div>
  );
};

export default ProviderDebug;
