import { ethers } from 'ethers';
import { config } from '../config';

const TREASURY_ABI = [
  'function forceRebalance() external',
  'event Rebalanced(uint256 btcValue, uint256 goldValue, uint256 usdcValue, uint256 roseValue, uint256 totalHardAssets)',
];

export async function executeRebalance(): Promise<{ txHash: string }> {
  if (!config.contracts.treasury) {
    throw new Error('TREASURY_ADDRESS not configured');
  }

  const provider = new ethers.JsonRpcProvider(config.rpc.url);
  const wallet = new ethers.Wallet(config.signer.privateKey, provider);
  const treasury = new ethers.Contract(
    config.contracts.treasury,
    TREASURY_ABI,
    wallet
  );

  console.log(`[Treasury] Executing quarterly rebalance...`);
  console.log(`[Treasury] Treasury address: ${config.contracts.treasury}`);
  console.log(`[Treasury] Signer address: ${wallet.address}`);

  const tx = await treasury.forceRebalance();
  console.log(`[Treasury] Transaction submitted: ${tx.hash}`);

  const receipt = await tx.wait();
  console.log(`[Treasury] Rebalance complete. TX: ${receipt.hash}`);
  console.log(`[Treasury] Gas used: ${receipt.gasUsed.toString()}`);

  return { txHash: receipt.hash };
}
