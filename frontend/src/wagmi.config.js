import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { sepolia } from 'wagmi/chains';
import { http } from 'wagmi';

const sepoliaRpcUrl = process.env.RPC_SEPOLIA_URL || 'https://ethereum-sepolia-rpc.publicnode.com';
const hoodiRpcUrl = process.env.RPC_HOODI_URL || 'https://ethereum-hoodi-rpc.publicnode.com';
const tenderlyRpcUrl = 'https://virtual.mainnet.us-west.rpc.tenderly.co/47607c89-e50a-4805-a15c-7d2c55d351f3';

// Define Tenderly virtual testnet
const tenderly = {
  id: 1,
  name: 'Tenderly',
  nativeCurrency: {
    decimals: 18,
    name: 'Ether',
    symbol: 'ETH',
  },
  rpcUrls: {
    default: { http: [tenderlyRpcUrl] },
  },
  blockExplorers: {
    default: { name: 'Tenderly Explorer', url: 'https://dashboard.tenderly.co/explorer/vnet/6e9729a9-2365-49cd-aaa0-4a07f31753d2/transactions' },
  },
  testnet: true,
};

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
    default: { http: ['https://ethereum-hoodi-rpc.publicnode.com'] },
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
  chains: [tenderly, hoodi, sepolia],
  transports: {
    [tenderly.id]: http(tenderlyRpcUrl, {
      batch: {
        wait: 100,
      },
      retryCount: 3,
      timeout: 30_000,
    }),
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
