import React from 'react';
import Header from './Header';

const Layout = ({ children }) => {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto py-8 px-4">
        {children}
      </main>
      <footer className="py-6 text-center text-sm text-muted-foreground">
        <p>Rose Token - A Socialist Crypto Token Model</p>
      </footer>
    </div>
  );
};

export default Layout;
