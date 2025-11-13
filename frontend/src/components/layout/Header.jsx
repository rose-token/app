import React from 'react';
import NetworkSelector from '../wallet/NetworkSelector';
import { useEthereum } from '../../hooks/useEthereum';

const Header = ({ toggleSidebar }) => {
  const { isConnected, connectWallet, account } = useEthereum();

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
        </div>
          
        <div className="flex items-center space-x-4">
          {isConnected && <NetworkSelector />}

          <button
            onClick={connectWallet}
            className="bg-primary text-white hover:bg-opacity-90 px-4 py-2 rounded-md font-medium"
          >
            {isConnected && account ? `${account.slice(0, 6)}...${account.slice(-4)}` : 'Connect Wallet'}
          </button>
        </div>
      </div>
    </header>
  );
};

export default Header;
