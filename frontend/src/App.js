import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Layout from './components/layout/Layout';
import TasksPage from './pages/TasksPage';
import ProfilePage from './pages/ProfilePage';
import HelpPage from './pages/HelpPage';
import { RainbowKitProvider, lightTheme } from '@rainbow-me/rainbowkit';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { config } from './wagmi.config';
import { ProfileProvider } from './hooks/useProfile';
import '@rainbow-me/rainbowkit/styles.css';

// Create a client for react-query
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

/**
 * Main App component for Rose Token marketplace
 * Renders the main application layout with TasksPage
 * Connects to Ethereum network via RainbowKit + wagmi
 * Uses React Router for navigation between pages
 */
function App() {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          modalSize="compact"
          theme={lightTheme({
            accentColor: '#B1452C', // Deep Rose from theme
            accentColorForeground: '#F6E8D5', // Cream from theme
            borderRadius: 'medium',
            fontStack: 'system',
          })}
        >
          <ProfileProvider>
            <Router basename="/">
              <Layout>
                <Routes>
                  <Route path="/" element={<TasksPage />} />
                  <Route path="/profile" element={<ProfilePage />} />
                  <Route path="/help" element={<HelpPage />} />
                </Routes>
              </Layout>
            </Router>
          </ProfileProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

export default App;
