import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { sepolia } from 'wagmi/chains';
import { http } from 'wagmi';

const sepoliaRpcUrl = process.env.RPC_SEPOLIA_URL || 'https://ethereum-sepolia-rpc.publicnode.com';
const hoodiRpcUrl = process.env.RPC_HOODI_URL || 'https://rpc.hoodi.ethpandaops.io';

// Define Hoodi testnet chain (not yet in wagmi/chains)
const hoodi = {
  id: 560048,
  name: 'Hoodi Testnet',
  nativeCurrency: {
    decimals: 18,
    name: 'Ether',
    symbol: 'ETH',
  },
  rpcUrls: {
    default: { http: ['https://rpc.hoodi.ethpandaops.io'] },
  },
  blockExplorers: {
    default: { name: 'Etherscan', url: 'https://hoodi.etherscan.io' },
  },
  testnet: true,
};

// Simple default configuration that includes all popular wallets automatically
export const config = getDefaultConfig({
  appName: 'Rose Token',
  projectId: '95be0fbf27f06934c74d670d57f44939',
  chains: [hoodi, sepolia],
  transports: {
    [hoodi.id]: http(hoodiRpcUrl, {
      batch: {
        wait: 100,
      },
      retryCount: 3,
      timeout: 30_000,
    }),
    [sepolia.id]: http(sepoliaRpcUrl, {
      batch: {
        wait: 100,
      },
      retryCount: 3,
      timeout: 30_000,
    }),
  },
  ssr: false, // Disable server-side rendering for client-only app
});
