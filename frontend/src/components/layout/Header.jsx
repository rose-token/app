import React from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount } from 'wagmi';
import PassportStatus from '../passport/PassportStatus';

const Header = ({ toggleSidebar }) => {
  const { isConnected } = useAccount();
  return (
    <header
      className="sticky top-0 z-50 py-4 backdrop-blur-[20px] border-b"
      style={{
        background: 'rgba(26, 26, 31, 0.85)',
        borderColor: 'rgba(255, 255, 255, 0.08)'
      }}
    >
      <div className="flex justify-between items-center px-4 md:px-8">
        <div className="flex items-center">
          {/* Sidebar toggle button */}
          <button
            onClick={toggleSidebar}
            className="mr-4 md:hidden p-3 rounded-xl transition-all"
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-primary)'
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>

        <div className="flex items-center space-x-3">
          {isConnected && <PassportStatus compact showRefresh={false} />}
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
