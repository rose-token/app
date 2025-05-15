import React from 'react';
import Layout from './components/layout/Layout';
import TasksPage from './pages/TasksPage';
import { MetaMaskProvider } from '@metamask/sdk-react';
import { EthereumProvider } from './hooks/useEthereum';

/**
 * Main App component for Rose Token marketplace
 * Renders the main application layout with TasksPage
 * Connects to Ethereum network via EthereumProvider
 * MetaMask SDK is initialized here
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
        <Layout>
          <TasksPage />
        </Layout>
      </EthereumProvider>
    </MetaMaskProvider>
  );
}

export default App;
