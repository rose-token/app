import React, { useState } from 'react';
import Header from './Header';
import Sidebar from './Sidebar';

const Layout = ({ children }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
    
  const toggleSidebar = () => {
    setSidebarOpen(!sidebarOpen);
  };

  return (
    <div className="min-h-screen bg-background flex">
      <Sidebar isOpen={sidebarOpen} toggleSidebar={toggleSidebar} />
        
      <div className="flex-1 flex flex-col md:ml-64">
        <Header toggleSidebar={toggleSidebar} />
        <main className="flex-1 container mx-auto py-8 px-4">
          {children}
        </main>
        <footer className="py-6 text-center text-xs text-mutedd">
          <p>Copyright © 2025 Rose Labs, Inc. Licensed under the Peer Production License (PPL).</p>
        </footer>
      </div>
    </div>
  );
};

export default Layout;
