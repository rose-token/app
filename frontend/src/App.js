import React from 'react';
import Layout from './components/layout/Layout';
import TasksPage from './pages/TasksPage';
import { EthereumProvider } from './hooks/useEthereum';

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
