import { usePublicClient } from 'wagmi';
import { parseGwei } from 'viem';

/**
 * Custom hook for gas estimation with optimized fee parameters
 * Prevents MetaMask gas overestimation by using realistic Sepolia values
 *
 * @returns {Object} Gas estimation utilities
 */
export const useGasEstimation = () => {
  const publicClient = usePublicClient();

  /**
   * Estimate gas for a contract function call with hardcoded 2 gwei gas price
   *
   * @param {Object} params - Contract call parameters
   * @param {string} params.address - Contract address
   * @param {Array} params.abi - Contract ABI
   * @param {string} params.functionName - Function to call
   * @param {Array} params.args - Function arguments
   * @param {string} params.account - User's address
   * @param {bigint} params.value - ETH value to send (default: 0n)
   * @returns {Promise<Object>} Gas estimation with overrides
   */
  const estimateGas = async ({
    address,
    abi,
    functionName,
    args,
    account,
    value = 0n
  }) => {
    try {
      // Estimate gas using viem public client
      const estimatedGas = await publicClient.estimateContractGas({
        address,
        abi,
        functionName,
        args,
        account,
        value,
      });

      console.log(`⛽ Estimated gas for ${functionName}:`, estimatedGas.toString());

      // Apply 20% buffer to estimated gas
      const gasWithBuffer = (estimatedGas * 120n) / 100n;

      // HARDCODED gas price at 2 gwei to reduce staking costs
      const overrides = {
        gas: gasWithBuffer,
        gasPrice: parseGwei('2'), // Hardcoded 2 Gwei gas price (legacy)
        maxFeePerGas: parseGwei('2'), // 2 Gwei max fee (EIP-1559)
        maxPriorityFeePerGas: parseGwei('2'), // 2 Gwei priority fee (EIP-1559)
      };

      // Only add value if it's non-zero
      if (value > 0n) {
        overrides.value = value;
      }

      console.log('⛽ Gas overrides (HARDCODED 2 GWEI):', {
        gas: overrides.gas.toString(),
        gasPrice: overrides.gasPrice.toString(),
        maxFeePerGas: overrides.maxFeePerGas.toString(),
        maxPriorityFeePerGas: overrides.maxPriorityFeePerGas.toString(),
      });

      return overrides;
    } catch (error) {
      console.error(`❌ Gas estimation failed for ${functionName}:`, error);

      // Return default overrides with hardcoded 2 gwei if estimation fails
      return {
        gasPrice: parseGwei('2'),
        maxFeePerGas: parseGwei('2'),
        maxPriorityFeePerGas: parseGwei('2'),
      };
    }
  };

  /**
   * Estimate gas and execute a write contract operation
   *
   * @param {Function} writeContractFn - wagmi writeContract function
   * @param {Object} contractParams - Contract call parameters (address, abi, functionName, args, account, value)
   * @returns {Promise<string>} Transaction hash
   */
  const estimateAndWrite = async (writeContractFn, contractParams) => {
    // Get gas estimation with overrides
    const gasOverrides = await estimateGas(contractParams);

    // Execute write with gas overrides
    const hash = await writeContractFn({
      address: contractParams.address,
      abi: contractParams.abi,
      functionName: contractParams.functionName,
      args: contractParams.args,
      ...gasOverrides,
    });

    return hash;
  };

  return {
    estimateGas,
    estimateAndWrite,
  };
};

export default useGasEstimation;
