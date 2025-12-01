import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { arbitrumSepolia } from 'wagmi/chains';
import { http, fallback } from 'viem';

const arbitrumSepoliaRpcUrl = 'https://arb-sepolia.g.alchemy.com/v2/4ZaJ9-kd_vP5HWvCYJlPn';

export const config = getDefaultConfig({
  appName: 'Rose Token',
  projectId: '95be0fbf27f06934c74d670d57f44939',
  chains: [arbitrumSepolia],
  pollingInterval: 30_000,
  transports: {
    [arbitrumSepolia.id]: fallback([
      http(arbitrumSepoliaRpcUrl, {
        batch: { wait: 100 },
        retryCount: 2,
        timeout: 15_000,
      }),
      http('https://sepolia-rollup.arbitrum.io/rpc', {
        batch: { wait: 100 },
        retryCount: 2,
        timeout: 15_000,
      }),
      http('https://arbitrum-sepolia.gateway.tenderly.co', {
        batch: { wait: 100 },
        retryCount: 2,
        timeout: 20_000,
      }),
      http('https://api.zan.top/arb-sepolia', {
        batch: { wait: 100 },
        retryCount: 2,
        timeout: 20_000,
      }),
    ], {
      rank: true,
      retryCount: 3,
    }),
  },
  ssr: false,
});
