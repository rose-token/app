import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Layout from './components/layout/Layout';
import TasksPage from './pages/TasksPage';
import CreateTaskPage from './pages/CreateTaskPage';
import TaskDetailPage from './pages/TaskDetailPage';
import ProfilePage from './pages/ProfilePage';
import HelpPage from './pages/HelpPage';
import VaultPage from './pages/VaultPage';
import GovernancePage from './pages/GovernancePage';
import ProposalDetailPage from './pages/ProposalDetailPage';
import ProposalCreatePage from './pages/ProposalCreatePage';
import DelegatesPage from './pages/DelegatesPage';
import MyVotesPage from './pages/MyVotesPage';
import AdminPage from './pages/AdminPage';
import AdminDisputesPage from './pages/AdminDisputesPage';
import AdminAnalyticsPage from './pages/AdminAnalyticsPage';
import ProtectedRoutes from './components/routing/ProtectedRoutes';
import { RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { config } from './wagmi.config';
import { ProfileProvider } from './hooks/useProfile';
import { PassportProvider } from './hooks/usePassport';
import { PassportVerifyProvider } from './hooks/usePassportVerify';
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
          theme={darkTheme({
            accentColor: '#d4af8c',
            accentColorForeground: '#1a1a1f',
            borderRadius: 'medium',
            fontStack: 'system',
            overlayBlur: 'small',
          })}
        >
          <ProfileProvider>
            <PassportProvider>
              <PassportVerifyProvider>
                <Router basename="/">
                  <Layout>
                    <ProtectedRoutes>
                      <Routes>
                        <Route path="/" element={<TasksPage />} />
                        <Route path="/create-task" element={<CreateTaskPage />} />
                        <Route path="/task/:id" element={<TaskDetailPage />} />
                        <Route path="/vault" element={<VaultPage />} />
                        <Route path="/governance" element={<GovernancePage />} />
                        <Route path="/governance/propose" element={<ProposalCreatePage />} />
                        <Route path="/governance/my-votes" element={<MyVotesPage />} />
                        <Route path="/governance/:id" element={<ProposalDetailPage />} />
                        <Route path="/delegates" element={<DelegatesPage />} />
                        <Route path="/profile" element={<ProfilePage />} />
                        <Route path="/admin" element={<AdminPage />} />
                        <Route path="/admin/disputes" element={<AdminDisputesPage />} />
                        <Route path="/admin/analytics" element={<AdminAnalyticsPage />} />
                        <Route path="/help" element={<HelpPage />} />
                      </Routes>
                    </ProtectedRoutes>
                  </Layout>
                </Router>
              </PassportVerifyProvider>
            </PassportProvider>
          </ProfileProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

export default App;
