import React from 'react';
import { NavLink } from 'react-router-dom';
import { useAccount } from 'wagmi';
import TokenBalance from '../wallet/TokenBalance';
import ExchangeRate from '../wallet/ExchangeRate';

const Sidebar = ({ isOpen, toggleSidebar }) => {
  const { isConnected } = useAccount();

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
              style={{
                background: 'linear-gradient(135deg, var(--rose-pink) 0%, var(--rose-gold) 100%)',
                color: 'var(--bg-primary)',
                boxShadow: '0 0 24px rgba(212, 165, 165, 0.35)'
              }}
            >
              R
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
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5 opacity-80">
              <rect x="3" y="3" width="7" height="7" />
              <rect x="14" y="3" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" />
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
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            Vault
          </NavLink>

          <NavLink
            to="/governance"
            className={({ isActive }) => getNavLinkClasses(isActive)}
            style={({ isActive }) => getNavLinkStyle(isActive)}
            onClick={() => window.innerWidth < 768 && toggleSidebar()}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5 opacity-80">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
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

          <NavLink
            to="/help"
            className={({ isActive }) => getNavLinkClasses(isActive)}
            style={({ isActive }) => getNavLinkStyle(isActive)}
            onClick={() => window.innerWidth < 768 && toggleSidebar()}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5 opacity-80">
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
