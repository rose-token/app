import React, { useState } from 'react';
import Header from './Header';
import Sidebar from './Sidebar';

const Layout = ({ children }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
    
  const toggleSidebar = () => {
    setSidebarOpen(!sidebarOpen);
  };

  return (
    <div className="min-h-screen flex relative z-[1]">
      <Sidebar isOpen={sidebarOpen} toggleSidebar={toggleSidebar} />

      <div className="flex-1 flex flex-col md:ml-64">
        <Header toggleSidebar={toggleSidebar} />
        <main className="flex-1 py-8 px-4 md:px-8 max-w-[1000px]">
          {children}
        </main>
        <footer className="py-6 text-center text-xs border-t border-[rgba(255,255,255,0.08)]" style={{ color: 'var(--text-muted)' }}>
          <p>© 2025 Rose Labs, Inc. · Licensed under the <a href="#" className="hover:underline" style={{ color: 'var(--rose-pink)' }}>Peer Production License (PPL)</a></p>
        </footer>
      </div>
    </div>
  );
};

export default Layout;
