import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { sepolia } from 'wagmi/chains';
import { http } from 'wagmi';
const rpcUrl = process.env.RPC_SEPOLIA_URL || 'https://ethereum-sepolia-rpc.publicnode.com'; // Fallback for local

// Simple default configuration that includes all popular wallets automatically
export const config = getDefaultConfig({
  appName: 'Rose Token',
  projectId: '95be0fbf27f06934c74d670d57f44939',
  chains: [sepolia],
  transports: {
    [sepolia.id]: http(rpcUrl, {
      batch: {
        wait: 100,
      },
      retryCount: 3,
      timeout: 30_000,
    }),
  },
  ssr: false, // Disable server-side rendering for client-only app
});
