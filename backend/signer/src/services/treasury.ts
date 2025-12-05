import { ethers } from 'ethers';
import { config } from '../config';
import { query } from '../db/pool';
import { fetchNavSnapshot, storeNavSnapshot } from './nav';

const TREASURY_ABI = [
  'function forceRebalance() external',
  'function getVaultBreakdown() external view returns (uint256 btcValue, uint256 goldValue, uint256 usdcValue, uint256 roseValue, uint256 totalHardAssets, uint256 currentRosePrice, uint256 circulatingRose, bool rebalanceNeeded)',
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

  // Record rebalance in database if DATABASE_URL is configured
  if (config.database.url) {
    try {
      const breakdown = await treasury.getVaultBreakdown();
      await query(
        `
        INSERT INTO rebalance_events (
          tx_hash, block_number, log_index,
          btc_value_usd, gold_value_usd, usdc_value_usd, rose_value_usd,
          total_hard_assets_usd, rebalanced_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
        ON CONFLICT (tx_hash) DO NOTHING
      `,
        [
          receipt.hash,
          receipt.blockNumber,
          0, // log_index not needed when recording directly
          ethers.formatUnits(breakdown.btcValue, 6),
          ethers.formatUnits(breakdown.goldValue, 6),
          ethers.formatUnits(breakdown.usdcValue, 6),
          ethers.formatUnits(breakdown.roseValue, 6),
          ethers.formatUnits(breakdown.totalHardAssets, 6),
        ]
      );
      console.log(`[Treasury] Rebalance event recorded in database`);

      // Also capture full NAV snapshot at rebalance time
      const snapshot = await fetchNavSnapshot();
      const snapshotId = await storeNavSnapshot(snapshot);
      console.log(`[Treasury] NAV snapshot #${snapshotId} recorded at block ${snapshot.blockNumber}`);
    } catch (dbError) {
      console.error(`[Treasury] Failed to record rebalance in database:`, dbError);
      // Don't throw - rebalance succeeded, DB recording is secondary
    }
  }

  return { txHash: receipt.hash };
}
