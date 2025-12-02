import { parseGwei } from 'viem';

export const GAS_SETTINGS = {
  gas: 500_000n,
  maxFeePerGas: parseGwei('0.1'),
  maxPriorityFeePerGas: parseGwei('0.01'),
};
