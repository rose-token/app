export const NETWORK_IDS = {
  ARBITRUM: 42161,
  ARBITRUM_SEPOLIA: 421614
};

export const NETWORK_NAMES = {
  [NETWORK_IDS.ARBITRUM]: 'Arbitrum One',
  [NETWORK_IDS.ARBITRUM_SEPOLIA]: 'Arbitrum Sepolia'
};

export const SUPPORTED_NETWORKS = [
  { id: NETWORK_IDS.ARBITRUM_SEPOLIA, name: NETWORK_NAMES[NETWORK_IDS.ARBITRUM_SEPOLIA] },
  { id: NETWORK_IDS.ARBITRUM, name: NETWORK_NAMES[NETWORK_IDS.ARBITRUM] }
];

// Determine default network from environment
const chainId = import.meta.env.VITE_CHAIN_ID || '__VITE_CHAIN_ID__';
const isMainnet = chainId == 42161;
export const DEFAULT_NETWORK = isMainnet ? NETWORK_IDS.ARBITRUM : NETWORK_IDS.ARBITRUM_SEPOLIA;
