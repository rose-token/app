import React from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';

const Header = ({ toggleSidebar }) => {
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
          <ConnectButton
            showBalance={false}
            accountStatus="address"
            chainStatus="icon"
          />
        </div>
      </div>
    </header>
  );
};

export default Header;
