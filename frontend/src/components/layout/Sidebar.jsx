import React from 'react';
import { NavLink } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { useIsAdmin } from '../../hooks/useIsAdmin';
import TokenBalance from '../wallet/TokenBalance';
import ExchangeRate from '../wallet/ExchangeRate';

const Sidebar = ({ isOpen, toggleSidebar }) => {
  const { isConnected } = useAccount();
  const { isAdmin } = useIsAdmin();

  const navLinkBaseClasses = "flex items-center gap-3 px-4 py-3 rounded-xl text-[0.9375rem] font-medium transition-all duration-200";

  const getNavLinkClasses = (isActive) => {
    if (isActive) {
      return `${navLinkBaseClasses} text-[var(--bg-primary)]`;
    }
    return `${navLinkBaseClasses} hover:bg-[rgba(255,255,255,0.05)]`;
  };

  const getNavLinkStyle = (isActive) => {
    if (isActive) {
      return {
        background: 'linear-gradient(135deg, var(--rose-pink) 0%, var(--rose-gold) 100%)'
      };
    }
    return {
      color: 'var(--text-secondary)'
    };
  };

  return (
    <>
      {/* Overlay for mobile when sidebar is open */}
      <div
        className={`fixed inset-0 bg-black/60 z-50 transition-opacity duration-300 md:hidden ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={toggleSidebar}
      />

      {/* Sidebar */}
      <div
        className={`fixed top-0 left-0 h-full w-64 z-[60] transform transition-transform duration-300 ease-in-out flex flex-col backdrop-blur-[20px] ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        } md:translate-x-0`}
        style={{
          background: 'linear-gradient(180deg, rgba(32, 32, 38, 0.97) 0%, rgba(26, 26, 31, 0.99) 100%)',
          borderRight: '1px solid rgba(255, 255, 255, 0.08)'
        }}
      >
        {/* Logo and close button */}
        <div className="flex items-center justify-between p-6" style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.08)' }}>
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center font-display text-xl font-semibold"
             
            >
              <svg width="100%" height="100%" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg"  style={{
                filter: 'drop-shadow(0 0 15px rgba(212, 165, 165, 0.55))'
              }}>
                        <defs>
                            <linearGradient id="roseGoldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                                <stop offset="0%" stop-color="#d4a5a5"/>
                                <stop offset="100%" stop-color="#d4af8c"/>
                            </linearGradient>
                        </defs>
                        
                        <path d="M256 0L478.71 128.57V383.43L256 512L33.29 383.43V128.57L256 0Z" fill="url(#roseGoldGrad)" opacity="0.4"/>
                        
                        <path d="M256 85.33L404.48 170.67V341.33L256 426.67L107.52 341.33V170.67L256 85.33Z" fill="url(#roseGoldGrad)" opacity="0.7"/>

                        <path d="M256 170.67L330.24 213.33V298.67L256 341.33L181.76 298.67V213.33L256 170.67Z" fill="url(#roseGoldGrad)"/>
                    </svg>
            </div>
            <span
              className="text-2xl font-display font-semibold"
              style={{
                background: 'linear-gradient(135deg, var(--rose-pink-light) 0%, var(--rose-gold) 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
                letterSpacing: '-0.02em'
              }}
            >
              Rose Token
            </span>
          </div>
          <button
            onClick={toggleSidebar}
            className="md:hidden p-2 rounded-lg transition-colors"
            style={{ color: 'var(--text-secondary)' }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Navigation links */}
        <nav className="flex-1 flex flex-col p-4 space-y-2">
          <NavLink
            to="/"
            className={({ isActive }) => getNavLinkClasses(isActive)}
            style={({ isActive }) => getNavLinkStyle(isActive)}
            onClick={() => window.innerWidth < 768 && toggleSidebar()}
          >
             <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 opacity-80">
              <path d="M1 9l3-7h16l3 7" />
              <path d="M3 9v12h18V9" />
              <path d="M9 21V14h6v7" />
              <path d="M3 9c0 1.5 1.5 3 3 3s3-1.5 3-3" />
              <path d="M9 9c0 1.5 1.5 3 3 3s3-1.5 3-3" />
              <path d="M15 9c0 1.5 1.5 3 3 3s3-1.5 3-3" />
            </svg>
            Marketplace
          </NavLink>

          <NavLink
            to="/vault"
            className={({ isActive }) => getNavLinkClasses(isActive)}
            style={({ isActive }) => getNavLinkStyle(isActive)}
            onClick={() => window.innerWidth < 768 && toggleSidebar()}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5 opacity-80">
              <path d="M6 3h12l4 6-10 12L2 9l4-6z" />
              <path d="M2 9h20" />
              <path d="M12 21L6 9l6-6 6 6-6 12" />
            </svg>
            Vault
          </NavLink>

          <NavLink
            to="/governance"
            className={({ isActive }) => getNavLinkClasses(isActive)}
            style={({ isActive }) => getNavLinkStyle(isActive)}
            onClick={() => window.innerWidth < 768 && toggleSidebar()}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"  className="w-5 h-5 opacity-80">
                <path d="M12 3v18" />
                <path d="M3 7h18" />
                <path d="M4 7L2 12a3 1.5 0 0 0 6 0L6 7" />
                <path d="M20 7L22 12a3 1.5 0 0 1 -6 0L18 7" />
                <path d="M9 21h6" />
            </svg>
            Governance
          </NavLink>

          {isConnected && (
            <NavLink
              to="/profile"
              className={({ isActive }) => getNavLinkClasses(isActive)}
              style={({ isActive }) => getNavLinkStyle(isActive)}
              onClick={() => window.innerWidth < 768 && toggleSidebar()}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5 opacity-80">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              Profile
            </NavLink>
          )}

          {isAdmin && (
            <NavLink
              to="/admin"
              className={({ isActive }) => getNavLinkClasses(isActive)}
              style={({ isActive }) => getNavLinkStyle(isActive)}
              onClick={() => window.innerWidth < 768 && toggleSidebar()}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 opacity-80">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              Admin
            </NavLink>
          )}

          <NavLink
            to="/help"
            className={({ isActive }) => getNavLinkClasses(isActive)}
            style={({ isActive }) => getNavLinkStyle(isActive)}
            onClick={() => window.innerWidth < 768 && toggleSidebar()}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-5 h-5 opacity-80">
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            Help
          </NavLink>
        </nav>

        {/* Stats section at bottom */}
        {isConnected && (
          <div className="p-4 space-y-3" style={{ borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}>
            <TokenBalance />
            <ExchangeRate />
          </div>
        )}
      </div>
    </>
  );
};

export default Sidebar;
