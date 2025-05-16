import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Layout from './components/layout/Layout';
import TasksPage from './pages/TasksPage';
import AnalyticsPage from './pages/AnalyticsPage'; // New import
import { MetaMaskProvider } from '@metamask/sdk-react';
import { EthereumProvider } from './hooks/useEthereum';

/**
 * Main App component for Rose Token marketplace
 * Renders the main application layout with TasksPage and AnalyticsPage
 * Connects to Ethereum network via EthereumProvider
 * MetaMask SDK is initialized here
 * Uses React Router for navigation between pages
 */
function App() {
  return (
    <MetaMaskProvider
      sdkOptions={{
        dappMetadata: {
          name: "Rose Token",
          description: "A decentralized task marketplace with a socialist token distribution model",
          url: window.location.origin,
        },
        checkInstallationImmediately: false,
        defaultNetworkId: "0xaa36a7", // Sepolia chain ID in hex
      }}
    >
      <EthereumProvider>
        <Router>
          <Layout>
            <Routes>
              <Route path="/" element={<TasksPage />} />
              <Route path="/analytics" element={<AnalyticsPage />} />
            </Routes>
          </Layout>
        </Router>
      </EthereumProvider>
    </MetaMaskProvider>
  );
}

export default App;
