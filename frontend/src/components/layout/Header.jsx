import React from 'react';
import { NavLink } from 'react-router-dom';
import TokenBalance from '../wallet/TokenBalance';
import NetworkSelector from '../wallet/NetworkSelector';
import { useEthereum } from '../../hooks/useEthereum';

const Header = () => {
  const { isConnected, connectWallet, account } = useEthereum();

  return (
    <header className="bg-primary text-primary-foreground py-4">
      <div className="container mx-auto flex justify-between items-center px-4">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <svg 
              xmlns="http://www.w3.org/2000/svg" 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="2" 
              strokeLinecap="round" 
              strokeLinejoin="round" 
              className="h-6 w-6"
            >
              <path d="M12 2s.35-.008 8 9c0 0-7.5 13-8 13-.5 0-8-13-8-13 7.65-9.008 8-9 8-9Z" />
            </svg>
            <h1 className="text-xl font-bold">Rose Token</h1>
          </div>
          
          {/* Add navigation links */}
          <nav className="hidden md:flex space-x-4">
            <NavLink 
              to="/" 
              className={({ isActive }) => 
                isActive ? "font-medium text-white underline" : "text-white/80 hover:text-white"
              }
            >
              Marketplace
            </NavLink>
            <NavLink 
              to="/analytics" 
              className={({ isActive }) => 
                isActive ? "font-medium text-white underline" : "text-white/80 hover:text-white"
              }
            >
              Worker Analytics
            </NavLink>
            <NavLink 
              to="/bugs" 
              className={({ isActive }) => 
                isActive ? "font-medium text-white underline" : "text-white/80 hover:text-white"
              }
            >
              Bug Reports
            </NavLink>
            <NavLink 
              to="/help" 
              className={({ isActive }) => 
                isActive ? "font-medium text-white underline" : "text-white/80 hover:text-white"
              }
            >
              Help
            </NavLink>
            {isConnected && (
              <NavLink 
                to="/profile" 
                className={({ isActive }) => 
                  isActive ? "font-medium text-white underline" : "text-white/80 hover:text-white"
                }
              >
                Profile
              </NavLink>
            )}
          </nav>
        </div>
        
        <div className="flex items-center space-x-4">
          {isConnected && <TokenBalance />}
          {isConnected && <NetworkSelector />}
          <button 
            onClick={connectWallet} 
            className="bg-white text-primary hover:bg-opacity-90 px-4 py-2 rounded-md font-medium"
          >
            {isConnected && account ? `${account.slice(0, 6)}...${account.slice(-4)}` : 'Connect Wallet'}
          </button>
        </div>
      </div>
    </header>
  );
};

export default Header;
