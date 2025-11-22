import { useAccount, useWalletClient, usePublicClient } from 'wagmi';
import { useMemo } from 'react';
import { ethers } from 'ethers';

/**
 * Compatibility hook that wraps wagmi hooks to provide ethers.js v5 provider and signer
 * This maintains backward compatibility with existing components using the old useEthereum hook
 */
export function useWallet() {
  const { address, isConnected, isConnecting, chain } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();

  // Convert wagmi's publicClient to ethers.js v5 provider
  const provider = useMemo(() => {
    if (!publicClient) return null;

    // Create a provider compatible with ethers v5
    return new ethers.providers.Web3Provider({
      request: async ({ method, params }) => {
        return publicClient.request({ method, params });
      },
    });
  }, [publicClient]);

  // Convert wagmi's walletClient to ethers.js v5 signer
  const signer = useMemo(() => {
    if (!walletClient || !provider) return null;

    // Get the signer from the provider
    return provider.getSigner(address);
  }, [walletClient, provider, address]);

  // Get chainId as number (wagmi returns it as number already)
  const chainId = chain?.id;

  return {
    // Wallet state
    account: address,
    isConnected,
    isConnecting,
    chainId,
    chain,

    // Ethers.js v5 compatibility
    provider,
    signer,

    // Helper methods
    isSepoliaNetwork: chainId === 11155111,
  };
}
