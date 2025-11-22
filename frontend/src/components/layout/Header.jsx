import React from 'react';
import NetworkSelector from '../wallet/NetworkSelector';
import { useEthereum } from '../../hooks/useEthereum';

const Header = ({ toggleSidebar }) => {
  const { isConnected, connectWallet, account, isConnecting } = useEthereum();

  return (
    <header className="bg-background border-b border-border py-4 shadow-sm">
      <div className="container mx-auto flex justify-between items-center px-4">
        <div className="flex items-center">
          {/* Sidebar toggle button */}
          <button
            onClick={toggleSidebar}
            className="mr-4 md:hidden text-foreground hover:text-primary"
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
            disabled={isConnecting}
            className="bg-primary text-primary-foreground hover:bg-primary px-4 py-2 rounded-md font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isConnecting ? (
              <>
                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Connecting...
              </>
            ) : isConnected && account ? (
              `${account.slice(0, 6)}...${account.slice(-4)}`
            ) : (
              'Connect Wallet'
            )}
          </button>
        </div>
      </div>
    </header>
  );
};

export default Header;
