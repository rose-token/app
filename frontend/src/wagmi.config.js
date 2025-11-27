import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { optimismSepolia } from 'wagmi/chains';
import { http } from 'wagmi';

const opSepoliaRpcUrl = process.env.RPC_OP_SEPOLIA_URL || 'https://sepolia.optimism.io';

// Simple default configuration that includes all popular wallets automatically
export const config = getDefaultConfig({
  appName: 'Rose Token',
  projectId: '95be0fbf27f06934c74d670d57f44939',
  chains: [optimismSepolia],
  transports: {
    [optimismSepolia.id]: http(opSepoliaRpcUrl, {
      batch: {
        wait: 100,
      },
      retryCount: 3,
      timeout: 30_000,
    }),
  },
  ssr: false, // Disable server-side rendering for client-only app
});
