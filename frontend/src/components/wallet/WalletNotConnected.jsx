import React from 'react';
import { useEthereum } from '../../hooks/useEthereum';

const WalletNotConnected = () => {
  const { connectWallet } = useEthereum();
  
  return (
    <div className="bg-white rounded-lg shadow-md p-6 mb-6 border border-gray-200 text-center">
      <h2 className="text-xl font-semibold mb-4">Connect Your Wallet</h2>
      <p className="mb-4 text-gray-600">
        Connect your wallet to create tasks, claim work, and earn ROSE tokens
      </p>
      <button
        onClick={connectWallet}
        className="bg-primary hover:bg-primary/90 text-white px-6 py-3 rounded-md font-medium"
      >
        Connect Wallet
      </button>
    </div>
  );
};

export default WalletNotConnected;
