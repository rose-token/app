import React from 'react';

const ProviderDebug = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  const debugInfo = {
    hasEthereum: !!window.ethereum,
    hasProvidersArray: !!(window.ethereum && window.ethereum.providers),
    providersCount: window.ethereum?.providers?.length || 0,
    ethereumFlags: window.ethereum ? {
      isMetaMask: window.ethereum.isMetaMask,
      isBraveWallet: window.ethereum.isBraveWallet,
      isCoinbaseWallet: window.ethereum.isCoinbaseWallet,
      isPhantom: window.ethereum.isPhantom,
    } : null,
    providers: window.ethereum?.providers?.map((p, idx) => ({
      index: idx,
      isMetaMask: p.isMetaMask,
      isBraveWallet: p.isBraveWallet,
      isCoinbaseWallet: p.isCoinbaseWallet,
      isPhantom: p.isPhantom,
    })) || [],
  };

  return (
    <div style={{
      position: 'fixed',
      top: '10px',
      right: '10px',
      background: 'rgba(0, 0, 0, 0.8)',
      color: '#0f0',
      padding: '10px',
      borderRadius: '5px',
      fontSize: '10px',
      fontFamily: 'monospace',
      maxWidth: '300px',
      zIndex: 9999,
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
    }}>
      <div style={{ fontWeight: 'bold', marginBottom: '5px', color: '#fff' }}>
        Provider Debug Info
      </div>
      {JSON.stringify(debugInfo, null, 2)}
    </div>
  );
};

export default ProviderDebug;
