import React, { useState } from 'react';
import NetworkSelector from '../wallet/NetworkSelector';
import { useEthereum } from '../../hooks/useEthereum';
import { useFaucet } from '../../hooks/useFaucet';

const Header = ({ toggleSidebar }) => {
  const { isConnected, connectWallet, account } = useEthereum();
  const { claimTokens, isLoading, error, canClaim } = useFaucet();
  const [successMessage, setSuccessMessage] = useState('');

  const handleFaucetClaim = async () => {
    const result = await claimTokens();
    if (result.success) {
      setSuccessMessage(result.message);
      setTimeout(() => setSuccessMessage(''), 3000);
    }
  };

  return (
    <header className="bg-white border-b border-gray-200 py-4 shadow-sm">
      <div className="container mx-auto flex justify-between items-center px-4">
        <div className="flex items-center">
          {/* Sidebar toggle button */}
          <button 
            onClick={toggleSidebar} 
            className="mr-4 md:hidden text-gray-700 hover:text-gray-900"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          Help Fund Us! bc1qq554ytglmsjay5dmw6zqy0q7np8kqx4lule83j
        </div>
          
        <div className="flex items-center space-x-4">
          {isConnected && <NetworkSelector />}
          
          {/* Faucet Button - only show when wallet is connected */}
          {isConnected && (
            <button
              onClick={handleFaucetClaim}
              disabled={!canClaim || isLoading}
              className={`px-4 py-2 rounded-md font-medium text-white ${
                !canClaim || isLoading
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-green-600 hover:bg-green-700'
              }`}
            >
              {isLoading ? 'Claiming...' : 'Claim 100 ROSE'}
            </button>
          )}
          
          <button 
            onClick={connectWallet} 
            className="bg-primary text-white hover:bg-opacity-90 px-4 py-2 rounded-md font-medium"
          >
            {isConnected && account ? `${account.slice(0, 6)}...${account.slice(-4)}` : 'Connect Wallet'}
          </button>
        </div>
      </div>
      
      {/* Success/Error Messages */}
      {successMessage && (
        <div className="bg-green-100 text-green-700 p-2 text-center text-sm">
          {successMessage}
        </div>
      )}
      {error && (
        <div className="bg-red-100 text-red-700 p-2 text-center text-sm">
          {error}
        </div>
      )}
    </header>
  );
};

export default Header;
