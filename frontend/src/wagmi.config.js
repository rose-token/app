import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { arbitrumSepolia } from 'wagmi/chains';
import { http } from 'wagmi';

const arbitrumSepoliaRpcUrl = process.env.RPC_ARBITRUM_SEPOLIA_URL || 'https://sepolia-rollup.arbitrum.io/rpc';

// Simple default configuration that includes all popular wallets automatically
export const config = getDefaultConfig({
  appName: 'Rose Token',
  projectId: '95be0fbf27f06934c74d670d57f44939',
  chains: [arbitrumSepolia],
  transports: {
    [arbitrumSepolia.id]: http(arbitrumSepoliaRpcUrl, {
      batch: {
        wait: 100,
      },
      retryCount: 3,
      timeout: 30_000,
    }),
  },
  ssr: false, // Disable server-side rendering for client-only app
});
