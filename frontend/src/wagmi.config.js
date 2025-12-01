import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { arbitrumSepolia } from 'wagmi/chains';
import { webSocket } from 'viem';

const arbitrumSepoliaWsUrl = 'wss://arb-sepolia.g.alchemy.com/v2/4ZaJ9-kd_vP5HWvCYJlPn';

export const config = getDefaultConfig({
  appName: 'Rose Token',
  projectId: '95be0fbf27f06934c74d670d57f44939',
  chains: [arbitrumSepolia],
  pollingInterval: 30_000,
  transports: {
    [arbitrumSepolia.id]: webSocket(arbitrumSepoliaWsUrl),
  },
  ssr: false,
});
