import React from 'react';
import Layout from './components/layout/Layout';
import TasksPage from './pages/TasksPage';
import { EthereumProvider } from './hooks/useEthereum';

/**
 * Main App component for Rose Token marketplace
 * Renders the main application layout with TasksPage
 * Connects to Ethereum network via EthereumProvider
 * Web3Modal is initialized in useEthereum.js
 */
function App() {
  return (
    <EthereumProvider>
      <Layout>
        <TasksPage />
      </Layout>
    </EthereumProvider>
  );
}

export default App;
