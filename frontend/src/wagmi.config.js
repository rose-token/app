import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { arbitrum, arbitrumSepolia } from 'wagmi/chains';
import { webSocket } from 'viem';

// Determine chain based on environment
// Use array.find to prevent Vite from dead-code eliminating either chain at build time
const chainId = import.meta.env.VITE_CHAIN_ID || '__VITE_CHAIN_ID__';
console.log('VITE_CHAIN_ID:', chainId);

// RPC WebSocket URLs
const arbitrumWsUrl = import.meta.env.VITE_RPC_WS_URL || '__VITE_RPC_WS_URL__';
const arbitrumSepoliaWsUrl = 'wss://arb-sepolia.g.alchemy.com/v2/4ZaJ9-kd_vP5HWvCYJlPn';

// Select chain at runtime using find() to prevent build-time optimization
const chains = [arbitrum, arbitrumSepolia];
const chain = chains.find(c => c.id == chainId) || arbitrumSepolia;
const wsUrl = chain.id == 42161 ? arbitrumWsUrl : arbitrumSepoliaWsUrl;
console.log('Selected chain:', chain.name, '| chainId:', chain.id);

export const config = getDefaultConfig({
  appName: 'Rose Token',
  projectId: '95be0fbf27f06934c74d670d57f44939',
  chains: [chain],
  pollingInterval: 30_000,
  transports: {
    [chain.id]: webSocket(wsUrl),
  },
  ssr: false,
});
