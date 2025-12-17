import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { arbitrum, arbitrumSepolia } from 'wagmi/chains';
import { webSocket } from 'viem';

// Determine chain based on environment
const chainId = import.meta.env.VITE_CHAIN_ID || '__VITE_CHAIN_ID__';
console.log('VITE_CHAIN_ID:', chainId);
const isMainnet = chainId === '42161' || chainId === 42161;
console.log('isMainnet:', isMainnet, '| Expected chain:', isMainnet ? 'Arbitrum One (42161)' : 'Arbitrum Sepolia (421614)');

// RPC WebSocket URLs
const arbitrumWsUrl = import.meta.env.VITE_RPC_WS_URL || '__VITE_RPC_WS_URL__';
const arbitrumSepoliaWsUrl = 'wss://arb-sepolia.g.alchemy.com/v2/4ZaJ9-kd_vP5HWvCYJlPn';

// Select chain and transport based on environment
const chain = isMainnet ? arbitrum : arbitrumSepolia;
const wsUrl = isMainnet ? arbitrumWsUrl : arbitrumSepoliaWsUrl;

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
