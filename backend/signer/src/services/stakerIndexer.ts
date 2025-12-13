import { ethers } from 'ethers';
import { config } from '../config';
import { query } from '../db/pool';
import { getReputationNew } from './governance';
import { getWsProvider, onReconnect, removeReconnectCallback } from '../utils/wsProvider';
import { RoseGovernanceABI } from '../utils/contracts';

// Types
export interface StakerData {
  address: string;
  stakedRose: bigint;
  votingPower: bigint;
  reputation: number;
  firstDepositBlock: number;
  lastUpdatedBlock: number;
}

export interface StakerIndexerStats {
  isRunning: boolean;
  startedAt: Date | null;
  depositsProcessed: number;
  withdrawalsProcessed: number;
  totalStakers: number;
  activeStakers: number;
  lastEventBlock: number;
  lastError: string | null;
}

// State
let governanceContract: ethers.Contract | null = null;
let wsContract: ethers.Contract | null = null;
let reconnectHandler: (() => void) | null = null;

const stats: StakerIndexerStats = {
  isRunning: false,
  startedAt: null,
  depositsProcessed: 0,
  withdrawalsProcessed: 0,
  totalStakers: 0,
  activeStakers: 0,
  lastEventBlock: 0,
  lastError: null,
};

function getProvider(): ethers.Provider {
  return getWsProvider();
}

function getGovernanceContract(): ethers.Contract {
  if (!governanceContract) {
    if (!config.contracts.governance) {
      throw new Error('GOVERNANCE_ADDRESS not configured');
    }
    governanceContract = new ethers.Contract(
      config.contracts.governance,
      RoseGovernanceABI,
      getProvider()
    );
  }
  return governanceContract;
}

/**
 * Calculate voting power: sqrt(stakedRose) * (reputation / 100)
 */
function calculateVotingPower(stakedRose: bigint, reputation: number): bigint {
  if (stakedRose === 0n || reputation === 0) return 0n;
  const sqrtAmount = sqrt(stakedRose);
  return (sqrtAmount * BigInt(reputation)) / 100n;
}

function sqrt(x: bigint): bigint {
  if (x === 0n) return 0n;
  let z = (x + 1n) / 2n;
  let y = x;
  while (z < y) {
    y = z;
    z = (x / z + z) / 2n;
  }
  return y;
}

/**
 * Update staker in database after deposit
 */
async function handleDeposit(user: string, amount: bigint, blockNumber: number): Promise<void> {
  const address = user.toLowerCase();

  try {
    // Get current reputation for VP calculation
    const reputation = await getReputationNew(address);

    // Check if staker exists
    const existing = await query(
      'SELECT staked_rose FROM stakers WHERE address = $1',
      [address]
    );

    if (existing.rows.length === 0) {
      // New staker - insert
      const votingPower = calculateVotingPower(amount, reputation);
      await query(
        `INSERT INTO stakers (address, staked_rose, voting_power, reputation, first_deposit_block, last_updated_block)
         VALUES ($1, $2, $3, $4, $5, $5)`,
        [address, amount.toString(), votingPower.toString(), reputation, blockNumber]
      );
      stats.totalStakers++;
      stats.activeStakers++;
    } else {
      // Existing staker - update
      const newStakedRose = BigInt(existing.rows[0].staked_rose) + amount;
      const votingPower = calculateVotingPower(newStakedRose, reputation);
      await query(
        `UPDATE stakers SET
           staked_rose = $2,
           voting_power = $3,
           reputation = $4,
           last_updated_block = $5
         WHERE address = $1`,
        [address, newStakedRose.toString(), votingPower.toString(), reputation, blockNumber]
      );
    }

    stats.depositsProcessed++;
    stats.lastEventBlock = Math.max(stats.lastEventBlock, blockNumber);

    console.log(`[StakerIndexer] Deposit: ${address} +${ethers.formatEther(amount)} ROSE (block ${blockNumber})`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    stats.lastError = errorMsg;
    console.error(`[StakerIndexer] Error handling deposit for ${address}:`, error);
  }
}

/**
 * Update staker in database after withdrawal
 */
async function handleWithdrawal(user: string, amount: bigint, blockNumber: number): Promise<void> {
  const address = user.toLowerCase();

  try {
    // Get current reputation for VP calculation
    const reputation = await getReputationNew(address);

    // Get current staked amount
    const existing = await query(
      'SELECT staked_rose FROM stakers WHERE address = $1',
      [address]
    );

    if (existing.rows.length === 0) {
      console.warn(`[StakerIndexer] Withdrawal for unknown staker ${address}, skipping`);
      return;
    }

    const currentStaked = BigInt(existing.rows[0].staked_rose);
    const newStakedRose = currentStaked > amount ? currentStaked - amount : 0n;
    const votingPower = calculateVotingPower(newStakedRose, reputation);

    await query(
      `UPDATE stakers SET
         staked_rose = $2,
         voting_power = $3,
         reputation = $4,
         last_updated_block = $5
       WHERE address = $1`,
      [address, newStakedRose.toString(), votingPower.toString(), reputation, blockNumber]
    );

    // Update active stakers count if they withdrew everything
    if (newStakedRose === 0n && currentStaked > 0n) {
      stats.activeStakers--;
    }

    stats.withdrawalsProcessed++;
    stats.lastEventBlock = Math.max(stats.lastEventBlock, blockNumber);

    console.log(`[StakerIndexer] Withdrawal: ${address} -${ethers.formatEther(amount)} ROSE (block ${blockNumber})`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    stats.lastError = errorMsg;
    console.error(`[StakerIndexer] Error handling withdrawal for ${address}:`, error);
  }
}

/**
 * Catch up on historical events from a starting block
 */
async function catchUpEvents(fromBlock: number): Promise<void> {
  const governance = getGovernanceContract();
  const currentBlock = await getProvider().getBlockNumber();

  console.log(`[StakerIndexer] Catching up events from block ${fromBlock} to ${currentBlock}`);

  // Query Deposited events
  const depositFilter = governance.filters.Deposited();
  const depositEvents = await governance.queryFilter(depositFilter, fromBlock, currentBlock);

  console.log(`[StakerIndexer] Found ${depositEvents.length} deposit events`);

  for (const event of depositEvents) {
    if ('args' in event && event.args) {
      const args = event.args as unknown as { user: string; amount: bigint };
      await handleDeposit(args.user, args.amount, event.blockNumber);
    }
  }

  // Query Withdrawn events
  const withdrawFilter = governance.filters.Withdrawn();
  const withdrawEvents = await governance.queryFilter(withdrawFilter, fromBlock, currentBlock);

  console.log(`[StakerIndexer] Found ${withdrawEvents.length} withdrawal events`);

  for (const event of withdrawEvents) {
    if ('args' in event && event.args) {
      const args = event.args as unknown as { user: string; amount: bigint };
      await handleWithdrawal(args.user, args.amount, event.blockNumber);
    }
  }
}

/**
 * Setup event listeners using WebSocket provider
 */
function setupEventListeners(): void {
  // Clean up previous listeners if any
  if (wsContract) {
    wsContract.removeAllListeners('Deposited');
    wsContract.removeAllListeners('Withdrawn');
  }

  // Create new contract instance with WebSocket provider for event listening
  wsContract = new ethers.Contract(
    config.contracts.governance!,
    RoseGovernanceABI,
    getWsProvider()
  );

  // Listen for new events
  wsContract.on('Deposited', async (user: string, amount: bigint, event: ethers.EventLog) => {
    try {
      let blockNumber = event.blockNumber;
      if (blockNumber === null || blockNumber === undefined) {
        console.warn(`[StakerIndexer] Block number not available for Deposited event, fetching current block`);
        blockNumber = await getProvider().getBlockNumber();
      }
      await handleDeposit(user, amount, blockNumber);
    } catch (err) {
      console.error('[StakerIndexer] Error in deposit handler:', err);
    }
  });

  wsContract.on('Withdrawn', async (user: string, amount: bigint, event: ethers.EventLog) => {
    try {
      let blockNumber = event.blockNumber;
      if (blockNumber === null || blockNumber === undefined) {
        console.warn(`[StakerIndexer] Block number not available for Withdrawn event, fetching current block`);
        blockNumber = await getProvider().getBlockNumber();
      }
      await handleWithdrawal(user, amount, blockNumber);
    } catch (err) {
      console.error('[StakerIndexer] Error in withdrawal handler:', err);
    }
  });

  console.log('[StakerIndexer] Event listeners setup on WebSocket provider');
}

/**
 * Start the staker indexer
 */
export async function startStakerIndexer(): Promise<void> {
  // Check configuration
  if (!config.contracts.governance) {
    console.log('[StakerIndexer] GOVERNANCE_ADDRESS not configured, skipping');
    return;
  }

  if (config.stakerIndexer?.enabled === false) {
    console.log('[StakerIndexer] Disabled via config');
    return;
  }

  console.log('[StakerIndexer] Starting staker indexer...');
  console.log(`[StakerIndexer] Governance: ${config.contracts.governance}`);

  try {
    // Get current stats from database
    const countResult = await query('SELECT COUNT(*) as total FROM stakers');
    const activeResult = await query('SELECT COUNT(*) as active FROM stakers WHERE staked_rose > 0');
    stats.totalStakers = parseInt(countResult.rows[0].total);
    stats.activeStakers = parseInt(activeResult.rows[0].active);

    // Setup event listeners using WebSocket provider
    setupEventListeners();

    // Register reconnect handler to re-setup listeners on WebSocket reconnection
    reconnectHandler = () => {
      console.log('[StakerIndexer] Reconnecting event listeners...');
      setupEventListeners();
    };
    onReconnect(reconnectHandler);

    stats.isRunning = true;
    stats.startedAt = new Date();

    console.log('[StakerIndexer] Listening for staking events...');

    // Catch up on recent events if configured
    const lookbackBlocks = config.stakerIndexer?.startupBlockLookback ?? 10000;
    if (lookbackBlocks > 0) {
      const currentBlock = await getProvider().getBlockNumber();
      const fromBlock = Math.max(0, currentBlock - lookbackBlocks);
      await catchUpEvents(fromBlock);
    }

    console.log(`[StakerIndexer] Startup complete. Total: ${stats.totalStakers}, Active: ${stats.activeStakers}`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    stats.lastError = errorMsg;
    console.error('[StakerIndexer] Failed to start:', error);
    throw error;
  }
}

/**
 * Stop the staker indexer
 */
export function stopStakerIndexer(): void {
  // Remove reconnect callback
  if (reconnectHandler) {
    removeReconnectCallback(reconnectHandler);
    reconnectHandler = null;
  }
  // Clean up WebSocket contract listeners
  if (wsContract) {
    wsContract.removeAllListeners('Deposited');
    wsContract.removeAllListeners('Withdrawn');
    wsContract = null;
  }
  stats.isRunning = false;
  console.log('[StakerIndexer] Stopped');
}

/**
 * Get staker indexer stats
 */
export function getStakerIndexerStats(): StakerIndexerStats {
  return { ...stats };
}

/**
 * Get all active stakers (for snapshot computation)
 */
export async function getActiveStakers(): Promise<StakerData[]> {
  const result = await query(`
    SELECT address, staked_rose, voting_power, reputation, first_deposit_block, last_updated_block
    FROM stakers
    WHERE staked_rose > 0
    ORDER BY staked_rose DESC
  `);

  return result.rows.map((row) => ({
    address: row.address,
    stakedRose: BigInt(row.staked_rose),
    votingPower: BigInt(row.voting_power),
    reputation: parseInt(row.reputation),
    firstDepositBlock: parseInt(row.first_deposit_block),
    lastUpdatedBlock: parseInt(row.last_updated_block),
  }));
}

/**
 * Get stakers at a specific block (for historical snapshots)
 */
export async function getStakersAtBlock(snapshotBlock: number): Promise<StakerData[]> {
  // Get stakers who had deposited before the snapshot block
  const result = await query(`
    SELECT address, staked_rose, voting_power, reputation, first_deposit_block, last_updated_block
    FROM stakers
    WHERE staked_rose > 0
      AND first_deposit_block <= $1
    ORDER BY staked_rose DESC
  `, [snapshotBlock]);

  return result.rows.map((row) => ({
    address: row.address,
    stakedRose: BigInt(row.staked_rose),
    votingPower: BigInt(row.voting_power),
    reputation: parseInt(row.reputation),
    firstDepositBlock: parseInt(row.first_deposit_block),
    lastUpdatedBlock: parseInt(row.last_updated_block),
  }));
}

/**
 * Validate staker cache against on-chain data
 * Should be run periodically (e.g., weekly)
 */
export async function validateStakerCache(): Promise<{ mismatches: number; validated: number }> {
  console.log('[StakerIndexer] Starting cache validation...');

  const governance = getGovernanceContract();
  const stakers = await query('SELECT address, staked_rose FROM stakers WHERE staked_rose > 0');

  let mismatches = 0;
  let validated = 0;

  for (const { address, staked_rose } of stakers.rows) {
    try {
      const onChainStaked: bigint = await governance.stakedRose(address);
      const cachedStaked = BigInt(staked_rose);
      const wasMismatch = onChainStaked !== cachedStaked;

      // Log validation result
      await query(`
        INSERT INTO staker_validations (address, cached_staked_rose, onchain_staked_rose, was_mismatch)
        VALUES ($1, $2, $3, $4)
      `, [address, staked_rose, onChainStaked.toString(), wasMismatch]);

      if (wasMismatch) {
        console.warn(`[StakerIndexer] Mismatch: ${address} - chain: ${onChainStaked}, cache: ${cachedStaked}`);
        mismatches++;

        // Auto-fix
        const reputation = await getReputationNew(address);
        const votingPower = calculateVotingPower(onChainStaked, reputation);
        const currentBlock = await getProvider().getBlockNumber();

        await query(`
          UPDATE stakers SET
            staked_rose = $2,
            voting_power = $3,
            reputation = $4,
            last_updated_block = $5
          WHERE address = $1
        `, [address, onChainStaked.toString(), votingPower.toString(), reputation, currentBlock]);
      }

      validated++;
    } catch (error) {
      console.error(`[StakerIndexer] Error validating ${address}:`, error);
    }
  }

  console.log(`[StakerIndexer] Validation complete. ${validated} validated, ${mismatches} mismatches fixed.`);
  return { mismatches, validated };
}

/**
 * Ensure a staker exists in the database by reading on-chain stake.
 * Used when a user opts in to delegation but wasn't caught by event indexer.
 * Idempotent - safe to call multiple times.
 * Returns true if staker exists (or was added), false if no stake on-chain.
 */
export async function ensureStakerExists(address: string): Promise<boolean> {
  const normalizedAddress = address.toLowerCase();

  // Check if already exists
  const existing = await query(
    'SELECT 1 FROM stakers WHERE address = $1',
    [normalizedAddress]
  );

  if (existing.rows.length > 0) {
    return true; // Already tracked
  }

  // Read on-chain stake
  const governance = getGovernanceContract();
  const stakedRose: bigint = await governance.stakedRose(address);

  if (stakedRose === 0n) {
    return false; // No stake, no need to track
  }

  // Get reputation and current block
  const reputation = await getReputationNew(normalizedAddress);
  const votingPower = calculateVotingPower(stakedRose, reputation);
  const currentBlock = await getProvider().getBlockNumber();

  // Insert staker (use ON CONFLICT to handle race conditions)
  await query(`
    INSERT INTO stakers (address, staked_rose, voting_power, reputation, first_deposit_block, last_updated_block)
    VALUES ($1, $2, $3, $4, $5, $5)
    ON CONFLICT (address) DO NOTHING
  `, [normalizedAddress, stakedRose.toString(), votingPower.toString(), reputation, currentBlock]);

  console.log(`[StakerIndexer] Added missing staker ${normalizedAddress} (stake: ${ethers.formatEther(stakedRose)} ROSE)`);
  stats.totalStakers++;
  stats.activeStakers++;
  return true;
}

/**
 * Refresh voting power for a specific staker (e.g., after reputation change)
 */
export async function refreshStakerVP(address: string): Promise<void> {
  const normalizedAddress = address.toLowerCase();

  const result = await query('SELECT staked_rose FROM stakers WHERE address = $1', [normalizedAddress]);
  if (result.rows.length === 0) return;

  const stakedRose = BigInt(result.rows[0].staked_rose);
  const reputation = await getReputationNew(normalizedAddress);
  const votingPower = calculateVotingPower(stakedRose, reputation);
  const currentBlock = await getProvider().getBlockNumber();

  await query(`
    UPDATE stakers SET
      voting_power = $2,
      reputation = $3,
      last_updated_block = $4
    WHERE address = $1
  `, [normalizedAddress, votingPower.toString(), reputation, currentBlock]);

  console.log(`[StakerIndexer] Refreshed VP for ${address}: ${votingPower}`);
}
