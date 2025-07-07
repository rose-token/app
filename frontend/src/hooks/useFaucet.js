import { useState } from 'react';
import { ethers } from 'ethers';
import { useContract } from './useContract';
import { useEthereum } from './useEthereum';

export const useFaucet = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const { roseMarketplace, contractsReady } = useContract();
  const { isConnected } = useEthereum();

  const claimTokens = async () => {
    if (!isConnected || !roseMarketplace || !contractsReady.readWrite) {
      setError('Wallet not connected or contracts not loaded');
      return { success: false, message: 'Wallet not connected or contracts not loaded' };
    }

    try {
      setIsLoading(true);
      setError('');
      
      const amount = ethers.utils.parseEther("100");
      const tx = await roseMarketplace.claimFaucetTokens(amount);
      await tx.wait();
      
      return { success: true, message: "Successfully claimed 100 ROSE tokens!" };
    } catch (err) {
      console.error("Error claiming tokens:", err);
      const errorMessage = err.message || "Failed to claim tokens";
      setError(errorMessage);
      return { success: false, message: errorMessage };
    } finally {
      setIsLoading(false);
    }
  };

  return {
    claimTokens,
    isLoading,
    error,
    canClaim: isConnected && roseMarketplace && contractsReady.readWrite
  };
};
