import React from 'react';  
import { NavLink } from 'react-router-dom';  
import { useWallet } from '../../hooks/useWallet';  
import TokenBalance from '../wallet/TokenBalance';
import ExchangeRate from '../wallet/ExchangeRate';
  
const Sidebar = ({ isOpen, toggleSidebar }) => {  
  const { isConnected } = useWallet();
  
  return (  
    <>  
      {/* Overlay for mobile when sidebar is open */}  
      <div   
        className={`fixed inset-0 bg-black bg-opacity-50 z-20 transition-opacity duration-300 md:hidden ${  
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'  
        }`}  
        onClick={toggleSidebar}  
      />  
        
      {/* Sidebar */}  
      <div   
        className={`fixed top-0 left-0 h-full bg-primary text-primary-foreground w-64 z-30 transform transition-transform duration-300 ease-in-out ${  
          isOpen ? 'translate-x-0' : '-translate-x-full'  
        } md:translate-x-0`}  
      >  
        {/* Logo and close button */}  
        <div className="flex items-center justify-between p-4 border-b border-white/20">  
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
          <button   
            onClick={toggleSidebar}  
            className="md:hidden text-white/80 hover:text-white"  
          >  
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">  
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />  
            </svg>  
          </button>  
        </div>  
          
        {/* Navigation links */}
        <nav className="flex flex-col p-4 space-y-3">
          <NavLink
            to="/"
            className={({ isActive }) =>
              isActive
                ? "font-medium text-white px-3 py-2 rounded-md bg-white/10"
                : "text-white/80 hover:text-white px-3 py-2 rounded-md hover:bg-white/5"
            }
            onClick={() => window.innerWidth < 768 && toggleSidebar()}
          >
            Marketplace
          </NavLink>

          {isConnected && (  
            <NavLink   
              to="/profile"   
              className={({ isActive }) =>   
                isActive   
                  ? "font-medium text-white px-3 py-2 rounded-md bg-white/10"   
                  : "text-white/80 hover:text-white px-3 py-2 rounded-md hover:bg-white/5"  
              }  
              onClick={() => window.innerWidth < 768 && toggleSidebar()}  
            >  
              Profile  
            </NavLink>  
          )}
          <NavLink   
            to="/help"   
            className={({ isActive }) =>   
              isActive   
                ? "font-medium text-white px-3 py-2 rounded-md bg-white/10"   
                : "text-white/80 hover:text-white px-3 py-2 rounded-md hover:bg-white/5"  
            }  
            onClick={() => window.innerWidth < 768 && toggleSidebar()}  
          >  
            Help  
          </NavLink>  
          {/* TokenBalance at the bottom of navigation */}
          {isConnected && (
            <div className="mt-4 space-y-2">
              <TokenBalance />
              <ExchangeRate />
            </div>
          )}
        </nav>  
      </div>  
    </>  
  );  
};  
  
export default Sidebar;
