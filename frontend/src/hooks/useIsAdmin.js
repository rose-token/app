import { useAccount, useReadContract } from 'wagmi';
import { CONTRACTS } from '../constants/contracts';
import RoseTreasuryABI from '../contracts/RoseTreasuryABI.json';

/**
 * Hook to check if the connected wallet is the Treasury contract owner (admin).
 * Reads the owner() function from the Treasury contract and compares to connected address.
 *
 * @returns {Object} Admin status
 * @returns {boolean} isAdmin - True if connected wallet is the contract owner
 * @returns {boolean} isLoading - True while fetching owner from contract
 * @returns {string} ownerAddress - The owner address from Treasury.owner()
 */
export const useIsAdmin = () => {
  const { address, isConnected } = useAccount();

  const { data: ownerAddress, isLoading } = useReadContract({
    address: CONTRACTS.TREASURY,
    abi: RoseTreasuryABI,
    functionName: 'owner',
    query: {
      enabled: isConnected && !!CONTRACTS.TREASURY,
    },
  });

  const isAdmin =
    isConnected &&
    ownerAddress &&
    address?.toLowerCase() === ownerAddress?.toLowerCase();

  return {
    isAdmin: !!isAdmin,
    isLoading,
    ownerAddress,
  };
};

export default useIsAdmin;
