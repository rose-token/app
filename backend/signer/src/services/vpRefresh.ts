import { ethers } from 'ethers';
import { config } from '../config';
import { query } from '../db/pool';
import {
  getReputationNew,
  calculateVotePower,
} from './governance';
import { getWsProvider, onReconnect, removeReconnectCallback } from '../utils/wsProvider';

// Marketplace ABI for reputation events
const MARKETPLACE_ABI = [
  'event ReputationChanged(address indexed user, uint256 taskValue)',
  'event PaymentReleased(uint256 taskId, address indexed worker, uint256 amount)',
  'event StakeholderFeeEarned(uint256 taskId, address indexed stakeholder, uint256 fee)',
];

// Governance ABI - only stakedRose exists on-chain
// NOTE: VP is computed off-chain and stored in the 'stakers' database table
const GOVERNANCE_ABI = [
  'function stakedRose(address user) external view returns (uint256)',
];

// Types
export interface VPRefreshCandidate {
  address: string;
  currentVP: bigint;
  currentRep: number;
  newRep: number;
  expectedVP: bigint;
  vpDifference: bigint;
  repDifference: number;
  stakedRose: bigint;
  eventBlock: number;
  eventTx: string;
}

export interface VPRefreshResult {
  address: string;
  success: boolean;
  txHash?: string;
  error?: string;
  oldVP: string;
  newVP: string;
  oldRep: number;
  newRep: number;
}

export interface VPRefreshStats {
  isRunning: boolean;
  startedAt: Date | null;
  eventsProcessed: number;
  usersQueued: number;
  refreshesExecuted: number;
  refreshesSkipped: number;
  lastError: string | null;
  lastEventBlock: number;
  pendingUsers: string[];
}

// State
let provider: ethers.JsonRpcProvider | null = null;
let marketplaceContract: ethers.Contract | null = null;
let governanceContract: ethers.Contract | null = null;
let wsContract: ethers.Contract | null = null;
let reconnectHandler: (() => void) | null = null;

const pendingUsers: Map<string, { block: number; tx: string; addedAt: number }> = new Map();
let debounceTimer: NodeJS.Timeout | null = null;
let isProcessing = false;

const stats: VPRefreshStats = {
  isRunning: false,
  startedAt: null,
  eventsProcessed: 0,
  usersQueued: 0,
  refreshesExecuted: 0,
  refreshesSkipped: 0,
  lastError: null,
  lastEventBlock: 0,
  pendingUsers: [],
};

function getProvider(): ethers.JsonRpcProvider {
  if (!provider) {
    provider = new ethers.JsonRpcProvider(config.rpc.url);
  }
  return provider;
}

function getMarketplaceContract(): ethers.Contract {
  if (!marketplaceContract) {
    if (!config.contracts.marketplace) {
      throw new Error('MARKETPLACE_ADDRESS not configured');
    }
    marketplaceContract = new ethers.Contract(
      config.contracts.marketplace,
      MARKETPLACE_ABI,
      getProvider()
    );
  }
  return marketplaceContract;
}

function getGovernanceContract(): ethers.Contract {
  if (!governanceContract) {
    if (!config.contracts.governance) {
      throw new Error('GOVERNANCE_ADDRESS not configured');
    }
    governanceContract = new ethers.Contract(
      config.contracts.governance,
      GOVERNANCE_ABI,
      getProvider()
    );
  }
  return governanceContract;
}

/**
 * Check if a user needs VP refresh based on VP difference only.
 *
 * Note: We only compare VP values, not reputation values directly.
 * The on-chain getReputation() uses a simplified formula that intentionally
 * differs from the backend's ^0.6 sublinear formula. Comparing them would
 * always show a difference even when nothing changed.
 *
 * Instead, we calculate what the VP *should* be using backend reputation,
 * and compare that to the current on-chain VP.
 */
async function checkUserForRefresh(
  userAddress: string,
  eventBlock: number,
  eventTx: string
): Promise<VPRefreshCandidate | null> {
  try {
    const governance = getGovernanceContract();
    const normalizedAddress = userAddress.toLowerCase();

    // Get stakedRose from contract and current VP from database
    // (VP is computed off-chain and stored in 'stakers' table)
    const [stakedRose, stakerResult] = await Promise.all([
      governance.stakedRose(userAddress),
      query('SELECT voting_power FROM stakers WHERE address = $1', [normalizedAddress]),
    ]);
    const currentVP = stakerResult.rows.length > 0
      ? BigInt(stakerResult.rows[0].voting_power)
      : 0n;

    // Skip users with no stake
    if (stakedRose === 0n) {
      console.log(`[VPRefresh] User ${userAddress} has no stake, skipping`);
      return null;
    }

    // Calculate new reputation using backend ^0.6 formula
    const newRep = await getReputationNew(userAddress);

    // Calculate expected VP with new reputation
    const expectedVP = calculateVotePower(stakedRose, newRep);

    // Calculate VP difference only
    const vpDifference = expectedVP > currentVP
      ? expectedVP - currentVP
      : currentVP - expectedVP;

    // Derive what reputation was used for current VP (for logging only)
    // VP = sqrt(staked) * rep / 100, so rep = VP * 100 / sqrt(staked)
    const sqrtStaked = sqrt(stakedRose);
    const impliedCurrentRep = sqrtStaked > 0n
      ? Number((currentVP * 100n) / sqrtStaked)
      : 0;

    // Check if VP difference exceeds threshold
    if (vpDifference < config.vpRefresh.minVpDifference) {
      console.log(
        `[VPRefresh] User ${userAddress} below threshold: VP diff=${vpDifference} (current=${currentVP}, expected=${expectedVP})`
      );
      return null;
    }

    return {
      address: userAddress,
      currentVP,
      currentRep: impliedCurrentRep,
      newRep,
      expectedVP,
      vpDifference,
      repDifference: Math.abs(newRep - impliedCurrentRep),
      stakedRose,
      eventBlock,
      eventTx,
    };
  } catch (error) {
    console.error(`[VPRefresh] Error checking user ${userAddress}:`, error);
    stats.lastError = error instanceof Error ? error.message : String(error);
    return null;
  }
}

/**
 * Integer square root using Babylonian method
 */
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
 * Execute VP refresh for a user by updating the database
 * (VP is stored off-chain in the 'stakers' table)
 */
async function executeRefresh(candidate: VPRefreshCandidate): Promise<VPRefreshResult> {
  const result: VPRefreshResult = {
    address: candidate.address,
    success: false,
    oldVP: candidate.currentVP.toString(),
    newVP: candidate.expectedVP.toString(),
    oldRep: candidate.currentRep,
    newRep: candidate.newRep,
  };

  try {
    if (!config.vpRefresh.executeOnChain) {
      // Dry run - log only
      console.log(
        `[VPRefresh] DRY RUN - Would refresh ${candidate.address}: ` +
        `VP ${candidate.currentVP} → ${candidate.expectedVP}, ` +
        `Rep ${candidate.currentRep} → ${candidate.newRep}`
      );
      result.success = true;
      stats.refreshesSkipped++;
      return result;
    }

    const normalizedAddress = candidate.address.toLowerCase();

    console.log(
      `[VPRefresh] Updating VP for ${candidate.address}: ` +
      `VP ${candidate.currentVP} → ${candidate.expectedVP}`
    );

    // Update VP in database (upsert pattern)
    await query(
      `INSERT INTO stakers (address, staked_rose, voting_power, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (address)
       DO UPDATE SET voting_power = $3, updated_at = NOW()`,
      [normalizedAddress, candidate.stakedRose.toString(), candidate.expectedVP.toString()]
    );

    result.success = true;
    stats.refreshesExecuted++;

    console.log(
      `[VPRefresh] VP updated for ${candidate.address}: ${candidate.expectedVP}`
    );

    return result;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    stats.lastError = result.error;
    console.error(`[VPRefresh] Error refreshing ${candidate.address}:`, error);
    return result;
  }
}

/**
 * Process pending users batch
 */
async function processPendingUsers(): Promise<VPRefreshResult[]> {
  if (isProcessing) {
    console.log('[VPRefresh] Already processing, skipping');
    return [];
  }

  isProcessing = true;
  const results: VPRefreshResult[] = [];

  try {
    // Take batch of users to process
    const users = Array.from(pendingUsers.entries())
      .slice(0, config.vpRefresh.maxBatchSize);

    if (users.length === 0) {
      return [];
    }

    console.log(`[VPRefresh] Processing ${users.length} pending users`);

    for (const [address, { block, tx }] of users) {
      // Remove from pending
      pendingUsers.delete(address);

      // Check if refresh needed
      const candidate = await checkUserForRefresh(address, block, tx);

      if (candidate) {
        const result = await executeRefresh(candidate);
        results.push(result);
      } else {
        stats.refreshesSkipped++;
      }
    }

    // Update stats
    stats.pendingUsers = Array.from(pendingUsers.keys());

    return results;
  } finally {
    isProcessing = false;
  }
}

/**
 * Queue a user for VP refresh check
 */
function queueUser(address: string, block: number, tx: string): void {
  const normalizedAddress = address.toLowerCase();

  // Add or update user in pending map
  if (!pendingUsers.has(normalizedAddress)) {
    stats.usersQueued++;
  }

  pendingUsers.set(normalizedAddress, {
    block,
    tx,
    addedAt: Date.now(),
  });

  stats.pendingUsers = Array.from(pendingUsers.keys());

  // Reset debounce timer
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  debounceTimer = setTimeout(async () => {
    try {
      await processPendingUsers();
    } catch (error) {
      console.error('[VPRefresh] Error processing pending users:', error);
      stats.lastError = error instanceof Error ? error.message : String(error);
    }
  }, config.vpRefresh.debounceMs);
}

/**
 * Handle ReputationChanged event
 */
function handleReputationChanged(
  user: string,
  taskValue: bigint,
  event: ethers.EventLog
): void {
  console.log(
    `[VPRefresh] ReputationChanged: user=${user}, taskValue=${taskValue}, block=${event.blockNumber}`
  );
  stats.eventsProcessed++;
  stats.lastEventBlock = event.blockNumber;
  queueUser(user, event.blockNumber, event.transactionHash);
}

/**
 * Handle PaymentReleased event (backup - worker reputation)
 */
function handlePaymentReleased(
  taskId: bigint,
  worker: string,
  amount: bigint,
  event: ethers.EventLog
): void {
  console.log(
    `[VPRefresh] PaymentReleased: task=${taskId}, worker=${worker}, amount=${amount}`
  );
  // ReputationChanged should also fire, but queue worker just in case
  stats.eventsProcessed++;
  stats.lastEventBlock = event.blockNumber;
  queueUser(worker, event.blockNumber, event.transactionHash);
}

/**
 * Handle StakeholderFeeEarned event (backup - stakeholder reputation)
 */
function handleStakeholderFeeEarned(
  taskId: bigint,
  stakeholder: string,
  fee: bigint,
  event: ethers.EventLog
): void {
  console.log(
    `[VPRefresh] StakeholderFeeEarned: task=${taskId}, stakeholder=${stakeholder}, fee=${fee}`
  );
  // ReputationChanged should also fire, but queue stakeholder just in case
  stats.eventsProcessed++;
  stats.lastEventBlock = event.blockNumber;
  queueUser(stakeholder, event.blockNumber, event.transactionHash);
}

/**
 * Setup event listeners using WebSocket provider
 */
function setupEventListeners(): void {
  // Clean up previous listeners if any
  if (wsContract) {
    wsContract.removeAllListeners('ReputationChanged');
    wsContract.removeAllListeners('PaymentReleased');
    wsContract.removeAllListeners('StakeholderFeeEarned');
  }

  // Create new contract instance with WebSocket provider for event listening
  wsContract = new ethers.Contract(
    config.contracts.marketplace!,
    MARKETPLACE_ABI,
    getWsProvider()
  );

  // Set up event listeners
  wsContract.on('ReputationChanged', handleReputationChanged);
  wsContract.on('PaymentReleased', handlePaymentReleased);
  wsContract.on('StakeholderFeeEarned', handleStakeholderFeeEarned);

  console.log('[VPRefresh] Event listeners setup on WebSocket provider');
}

/**
 * Start watching for reputation changes
 */
export async function startVPRefreshWatcher(): Promise<void> {
  if (!config.vpRefresh.enabled) {
    console.log('[VPRefresh] Disabled by configuration');
    return;
  }

  if (!config.contracts.marketplace) {
    console.log('[VPRefresh] MARKETPLACE_ADDRESS not configured, skipping');
    return;
  }

  if (!config.contracts.governance) {
    console.log('[VPRefresh] GOVERNANCE_ADDRESS not configured, skipping');
    return;
  }

  console.log('[VPRefresh] Starting VP refresh watcher...');
  console.log(`[VPRefresh] Config: executeOnChain=${config.vpRefresh.executeOnChain}, ` +
    `minVpDiff=${config.vpRefresh.minVpDifference}`);

  // Setup event listeners using WebSocket provider
  setupEventListeners();

  // Register reconnect handler to re-setup listeners on WebSocket reconnection
  reconnectHandler = () => {
    console.log('[VPRefresh] Reconnecting event listeners...');
    setupEventListeners();
  };
  onReconnect(reconnectHandler);

  stats.isRunning = true;
  stats.startedAt = new Date();

  // Process recent events on startup (catch-up) - uses HTTP provider for queryFilter
  if (config.vpRefresh.startupBlockLookback > 0) {
    try {
      const marketplace = getMarketplaceContract(); // HTTP provider for queryFilter
      const currentBlock = await getProvider().getBlockNumber();
      const fromBlock = Math.max(0, currentBlock - config.vpRefresh.startupBlockLookback);

      console.log(`[VPRefresh] Catching up from block ${fromBlock} to ${currentBlock}`);

      const filter = marketplace.filters.ReputationChanged();
      const events = await marketplace.queryFilter(filter, fromBlock, currentBlock);

      console.log(`[VPRefresh] Found ${events.length} recent ReputationChanged events`);

      for (const event of events) {
        if ('args' in event && event.args) {
          const [user] = event.args;
          queueUser(user, event.blockNumber, event.transactionHash);
        }
      }
    } catch (error) {
      console.error('[VPRefresh] Error during startup catch-up:', error);
      stats.lastError = error instanceof Error ? error.message : String(error);
    }
  }

  console.log('[VPRefresh] Watcher started successfully');
}

/**
 * Stop the VP refresh watcher
 */
export function stopVPRefreshWatcher(): void {
  if (!stats.isRunning) {
    return;
  }

  console.log('[VPRefresh] Stopping watcher...');

  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  // Remove reconnect callback
  if (reconnectHandler) {
    removeReconnectCallback(reconnectHandler);
    reconnectHandler = null;
  }

  // Clean up WebSocket contract listeners
  if (wsContract) {
    wsContract.removeAllListeners('ReputationChanged');
    wsContract.removeAllListeners('PaymentReleased');
    wsContract.removeAllListeners('StakeholderFeeEarned');
    wsContract = null;
  }

  stats.isRunning = false;
  console.log('[VPRefresh] Watcher stopped');
}

/**
 * Get current stats
 */
export function getVPRefreshStats(): VPRefreshStats {
  return { ...stats };
}

/**
 * Manually trigger refresh check for a specific user
 */
export async function checkAndRefreshUser(
  userAddress: string
): Promise<VPRefreshResult | null> {
  const candidate = await checkUserForRefresh(userAddress, 0, 'manual');

  if (!candidate) {
    return null;
  }

  return executeRefresh(candidate);
}

/**
 * Force process all pending users immediately
 */
export async function forceProcessPending(): Promise<VPRefreshResult[]> {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  return processPendingUsers();
}

/**
 * Get pending users list
 */
export function getPendingUsers(): string[] {
  return Array.from(pendingUsers.keys());
}
