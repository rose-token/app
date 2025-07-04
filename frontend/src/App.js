import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Layout from './components/layout/Layout';
import TasksPage from './pages/TasksPage';
import AnalyticsPage from './pages/AnalyticsPage';
import BugsPage from './pages/BugsPage';
import ProfilePage from './pages/ProfilePage';
import HelpPage from './pages/HelpPage';
import GovernancePage from './pages/GovernancePage';
import { MetaMaskProvider } from '@metamask/sdk-react';
import { EthereumProvider } from './hooks/useEthereum';
import { ProfileProvider } from './hooks/useProfile';

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
          description: "A decentralized task marketplace with a worker token distribution model",
          url: window.location.origin,
        },
        checkInstallationImmediately: false,
        defaultNetworkId: "0xaa36a7", // Sepolia chain ID in hex
      }}
    >
      <EthereumProvider>
        <ProfileProvider>
          <Router basename="/rose-token">
            <Layout>
              <Routes>
                <Route path="/" element={<TasksPage />} />
                <Route path="/analytics" element={<AnalyticsPage />} />
                <Route path="/bugs" element={<BugsPage />} />
                <Route path="/profile" element={<ProfilePage />} />
                <Route path="/help" element={<HelpPage />} />
                <Route path="/governance" element={<GovernancePage />} />
              </Routes>
            </Layout>
          </Router>
        </ProfileProvider>
      </EthereumProvider>
    </MetaMaskProvider>
  );
}

export default App;
