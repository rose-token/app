import { ethers } from 'ethers';
import { config } from '../config';
import { computeVPSnapshot, storeVPSnapshot, signMerkleRoot, signSlowTrackFinalization } from '../services/vpSnapshot';
import { getWsProvider, onReconnect, removeReconnectCallback } from '../utils/wsProvider';

// Governance contract ABI
const GOVERNANCE_ABI = [
  'event ProposalCreated(uint256 indexed proposalId, address indexed proposer, uint8 track, uint256 treasuryAmount)',
  'function proposals(uint256 proposalId) external view returns (tuple(address proposer, uint8 track, uint256 snapshotBlock, bytes32 vpMerkleRoot, uint256 votingStartsAt, uint256 votingEndsAt, uint256 forVotes, uint256 againstVotes, uint256 treasuryAmount, uint8 status, string title, string descriptionHash, uint256 deadline, string deliverables, uint256 editCount, uint256 taskId))',
  'function setVPMerkleRoot(uint256 proposalId, bytes32 merkleRoot, uint256 totalVP, uint256 expiry, bytes calldata signature) external',
  'function finalizeProposal(uint256 proposalId) external',
  'function finalizeSlowProposal(uint256 proposalId, bytes32 merkleRoot, uint256 totalVP, uint256 expiry, bytes calldata signature) external',
  'function snapshotDelay() external view returns (uint256)',
  'function proposalCounter() external view returns (uint256)',
];

// Track enum from contract
enum Track {
  Fast = 0,
  Slow = 1,
}

// ProposalStatus enum from contract
enum ProposalStatus {
  Pending = 0,
  Active = 1,
  Passed = 2,
  Failed = 3,
  Executed = 4,
  Cancelled = 5,
}

// Types
interface ProposalData {
  proposer: string;
  track: number;
  snapshotBlock: number;
  vpMerkleRoot: string;
  votingStartsAt: number;
  votingEndsAt: number;
  forVotes: bigint;
  againstVotes: bigint;
  treasuryAmount: bigint;
  status: number;
  title: string;
  descriptionHash: string;
  deadline: number;
  deliverables: string;
  editCount: number;
  taskId: number;
}

export interface SnapshotWatcherStats {
  isRunning: boolean;
  startedAt: Date | null;
  proposalsDetected: number;
  snapshotsComputed: number;
  snapshotsSubmitted: number;
  pendingSnapshots: number;
  fastFinalized: number;
  slowFinalized: number;
  lastError: string | null;
  lastEventBlock: number;
}

// State
let provider: ethers.JsonRpcProvider | null = null;
let governanceContract: ethers.Contract | null = null;
let wsContract: ethers.Contract | null = null;
let reconnectHandler: (() => void) | null = null;
let wallet: ethers.Wallet | null = null;

const stats: SnapshotWatcherStats = {
  isRunning: false,
  startedAt: null,
  proposalsDetected: 0,
  snapshotsComputed: 0,
  snapshotsSubmitted: 0,
  pendingSnapshots: 0,
  fastFinalized: 0,
  slowFinalized: 0,
  lastError: null,
  lastEventBlock: 0,
};

// Pending snapshot timers
const pendingTimers: Map<number, NodeJS.Timeout> = new Map();

// Finalization check interval
let finalizationInterval: NodeJS.Timeout | null = null;
const FINALIZATION_CHECK_INTERVAL = 900000; // Check every 15 minute

function getProvider(): ethers.JsonRpcProvider {
  if (!provider) {
    provider = new ethers.JsonRpcProvider(config.rpc.url);
  }
  return provider;
}

function getWallet(): ethers.Wallet {
  if (!wallet) {
    wallet = new ethers.Wallet(config.signer.privateKey, getProvider());
  }
  return wallet;
}

function getGovernanceContract(withSigner = false): ethers.Contract {
  if (!governanceContract || withSigner) {
    if (!config.contracts.governance) {
      throw new Error('GOVERNANCE_ADDRESS not configured');
    }
    governanceContract = new ethers.Contract(
      config.contracts.governance,
      GOVERNANCE_ABI,
      withSigner ? getWallet() : getProvider()
    );
  }
  return governanceContract;
}

/**
 * Schedule snapshot computation for a proposal
 * Computes snapshot at votingStartsAt - buffer (5 minutes before voting starts)
 */
function scheduleSnapshot(proposalId: number, votingStartsAt: number): void {
  // Cancel any existing timer
  const existingTimer = pendingTimers.get(proposalId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  const now = Math.floor(Date.now() / 1000);
  const buffer = config.snapshotWatcher?.computeBuffer ?? 300; // 5 minutes default
  const computeAt = votingStartsAt - buffer;

  if (computeAt <= now) {
    // Should compute immediately
    console.log(`[SnapshotWatcher] Computing snapshot immediately for proposal ${proposalId}`);
    processSnapshot(proposalId).catch((err) => {
      console.error(`[SnapshotWatcher] Error processing snapshot for proposal ${proposalId}:`, err);
    });
  } else {
    // Schedule for later
    const delayMs = (computeAt - now) * 1000;
    console.log(`[SnapshotWatcher] Scheduling snapshot for proposal ${proposalId} in ${delayMs / 1000}s`);

    const timer = setTimeout(() => {
      pendingTimers.delete(proposalId);
      processSnapshot(proposalId).catch((err) => {
        console.error(`[SnapshotWatcher] Error processing scheduled snapshot for proposal ${proposalId}:`, err);
      });
    }, delayMs);

    pendingTimers.set(proposalId, timer);
    stats.pendingSnapshots = pendingTimers.size;
  }
}

/**
 * Process snapshot for a proposal
 * 1. Compute VP snapshot
 * 2. Store in database
 * 3. Submit merkle root on-chain
 */
async function processSnapshot(proposalId: number): Promise<void> {
  console.log(`[SnapshotWatcher] Processing snapshot for proposal ${proposalId}`);

  try {
    // Get proposal data
    const governance = getGovernanceContract();
    const proposal: ProposalData = await governance.proposals(proposalId);

    // Verify proposal is still pending
    if (proposal.status !== ProposalStatus.Pending) {
      console.log(`[SnapshotWatcher] Proposal ${proposalId} is no longer pending (status: ${proposal.status}), skipping`);
      return;
    }

    // Get current block number for snapshot
    const currentBlock = await getProvider().getBlockNumber();

    // Compute VP snapshot
    const snapshot = await computeVPSnapshot(proposalId, currentBlock);

    // Store in database
    await storeVPSnapshot(snapshot);
    stats.snapshotsComputed++;

    // Submit to chain if enabled
    if (config.snapshotWatcher?.executeOnChain !== false) {
      await submitMerkleRoot(proposalId, snapshot.merkleRoot, snapshot.totalVP);
      stats.snapshotsSubmitted++;
    } else {
      console.log(`[SnapshotWatcher] DRY RUN - Would submit merkle root for proposal ${proposalId}`);
    }

    console.log(`[SnapshotWatcher] Snapshot processed for proposal ${proposalId}`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    stats.lastError = errorMsg;
    console.error(`[SnapshotWatcher] Error processing snapshot for proposal ${proposalId}:`, error);
    throw error;
  }
}

/**
 * Submit merkle root to governance contract
 */
async function submitMerkleRoot(proposalId: number, merkleRoot: string, totalVP: bigint): Promise<void> {
  console.log(`[SnapshotWatcher] Submitting merkle root for proposal ${proposalId}`);

  const expiry = Math.floor(Date.now() / 1000) + config.signatureTtl;
  const signature = await signMerkleRoot(proposalId, merkleRoot, totalVP, expiry);

  const governance = getGovernanceContract(true); // With signer

  const tx = await governance.setVPMerkleRoot(
    proposalId,
    merkleRoot,
    totalVP,
    expiry,
    signature
  );

  console.log(`[SnapshotWatcher] Transaction submitted: ${tx.hash}`);
  await tx.wait();
  console.log(`[SnapshotWatcher] Transaction confirmed for proposal ${proposalId}`);
}

/**
 * Handle ProposalCreated event
 */
function handleProposalCreated(
  proposalId: bigint,
  proposer: string,
  track: number,
  treasuryAmount: bigint,
  event: ethers.Log
): void {
  const id = Number(proposalId);
  console.log(`[SnapshotWatcher] ProposalCreated: id=${id}, track=${track === Track.Fast ? 'Fast' : 'Slow'}, proposer=${proposer}`);

  stats.proposalsDetected++;
  stats.lastEventBlock = Math.max(stats.lastEventBlock, event.blockNumber);

  // Only process Fast Track proposals (they need merkle root)
  if (track !== Track.Fast) {
    console.log(`[SnapshotWatcher] Slow track proposal ${id}, skipping snapshot scheduling`);
    return;
  }

  // Get proposal to find votingStartsAt
  getGovernanceContract().proposals(id).then((proposal: ProposalData) => {
    scheduleSnapshot(id, Number(proposal.votingStartsAt));
  }).catch((err: Error) => {
    console.error(`[SnapshotWatcher] Error fetching proposal ${id}:`, err);
    stats.lastError = err.message;
  });
}

/**
 * Check for pending proposals that need snapshots (startup catch-up)
 */
async function catchUpPendingProposals(): Promise<void> {
  console.log('[SnapshotWatcher] Checking for pending proposals...');

  const governance = getGovernanceContract();

  // Get recent ProposalCreated events
  const lookbackBlocks = config.snapshotWatcher?.startupBlockLookback ?? 10000;
  const currentBlock = await getProvider().getBlockNumber();
  const fromBlock = Math.max(0, currentBlock - lookbackBlocks);

  const filter = governance.filters.ProposalCreated();
  const events = await governance.queryFilter(filter, fromBlock, currentBlock);

  console.log(`[SnapshotWatcher] Found ${events.length} recent proposal events`);

  for (const event of events) {
    if (!('args' in event) || !event.args) continue;

    const args = event.args as unknown as {
      proposalId: bigint;
      proposer: string;
      track: number;
      treasuryAmount: bigint;
    };

    // Only process Fast Track
    if (args.track !== Track.Fast) continue;

    const proposalId = Number(args.proposalId);

    // Check if proposal is still pending
    try {
      const proposal: ProposalData = await governance.proposals(proposalId);

      if (proposal.status === ProposalStatus.Pending) {
        console.log(`[SnapshotWatcher] Found pending proposal ${proposalId}, scheduling snapshot`);
        scheduleSnapshot(proposalId, Number(proposal.votingStartsAt));
      }
    } catch (error) {
      console.error(`[SnapshotWatcher] Error checking proposal ${proposalId}:`, error);
    }
  }
}

/**
 * Setup event listeners using WebSocket provider
 */
function setupEventListeners(): void {
  // Clean up previous listeners if any
  if (wsContract) {
    wsContract.removeAllListeners('ProposalCreated');
  }

  // Create new contract instance with WebSocket provider for event listening
  wsContract = new ethers.Contract(
    config.contracts.governance!,
    GOVERNANCE_ABI,
    getWsProvider()
  );

  // Listen for new proposals
  wsContract.on('ProposalCreated', (proposalId, proposer, track, treasuryAmount, event) => {
    handleProposalCreated(proposalId, proposer, track, treasuryAmount, event);
  });

  console.log('[SnapshotWatcher] Event listeners setup on WebSocket provider');
}

/**
 * Start the snapshot watcher
 */
export async function startSnapshotWatcher(): Promise<void> {
  // Check configuration
  if (!config.contracts.governance) {
    console.log('[SnapshotWatcher] GOVERNANCE_ADDRESS not configured, skipping');
    return;
  }

  if (config.snapshotWatcher?.enabled === false) {
    console.log('[SnapshotWatcher] Disabled via config');
    return;
  }

  console.log('[SnapshotWatcher] Starting snapshot watcher...');
  console.log(`[SnapshotWatcher] Governance: ${config.contracts.governance}`);
  console.log(`[SnapshotWatcher] Execute on-chain: ${config.snapshotWatcher?.executeOnChain !== false}`);

  try {
    // Setup event listeners using WebSocket provider
    setupEventListeners();

    // Register reconnect handler to re-setup listeners on WebSocket reconnection
    reconnectHandler = () => {
      console.log('[SnapshotWatcher] Reconnecting event listeners...');
      setupEventListeners();
    };
    onReconnect(reconnectHandler);

    stats.isRunning = true;
    stats.startedAt = new Date();

    console.log('[SnapshotWatcher] Listening for ProposalCreated events...');

    // Catch up on pending proposals
    await catchUpPendingProposals();

    // Start the finalization watcher
    startFinalizationWatcher();

    console.log(`[SnapshotWatcher] Startup complete. Pending snapshots: ${pendingTimers.size}`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    stats.lastError = errorMsg;
    console.error('[SnapshotWatcher] Failed to start:', error);
    throw error;
  }
}

/**
 * Stop the snapshot watcher
 */
export function stopSnapshotWatcher(): void {
  // Remove reconnect callback
  if (reconnectHandler) {
    removeReconnectCallback(reconnectHandler);
    reconnectHandler = null;
  }
  // Clean up WebSocket contract listeners
  if (wsContract) {
    wsContract.removeAllListeners('ProposalCreated');
    wsContract = null;
  }

  // Stop finalization watcher
  stopFinalizationWatcher();

  // Clear all pending timers
  for (const timer of pendingTimers.values()) {
    clearTimeout(timer);
  }
  pendingTimers.clear();

  stats.isRunning = false;
  stats.pendingSnapshots = 0;
  console.log('[SnapshotWatcher] Stopped');
}

/**
 * Get snapshot watcher stats
 */
export function getSnapshotWatcherStats(): SnapshotWatcherStats {
  return {
    ...stats,
    pendingSnapshots: pendingTimers.size,
  };
}

/**
 * Get list of pending proposal IDs
 */
export function getPendingSnapshotProposals(): number[] {
  return Array.from(pendingTimers.keys());
}

/**
 * Manually trigger snapshot computation for a proposal
 */
export async function triggerSnapshot(proposalId: number): Promise<void> {
  // Cancel any scheduled timer
  const timer = pendingTimers.get(proposalId);
  if (timer) {
    clearTimeout(timer);
    pendingTimers.delete(proposalId);
  }

  await processSnapshot(proposalId);
}

// ============================================================
// Proposal Finalization (Phase 14)
// ============================================================

interface ProposalToFinalize {
  id: number;
  track: Track;
  votingEndsAt: number;
}

/**
 * Get all Active proposals that have passed their voting deadline
 */
async function getProposalsPastDeadline(): Promise<ProposalToFinalize[]> {
  const governance = getGovernanceContract();
  const now = Math.floor(Date.now() / 1000);
  const proposals: ProposalToFinalize[] = [];

  // Get proposal count
  const proposalCount = await governance.proposalCounter();

  // Check each proposal
  for (let i = 1; i <= Number(proposalCount); i++) {
    try {
      const proposal: ProposalData = await governance.proposals(i);

      // Only Active proposals that have ended
      if (proposal.status === ProposalStatus.Active && Number(proposal.votingEndsAt) < now) {
        proposals.push({
          id: i,
          track: proposal.track as Track,
          votingEndsAt: Number(proposal.votingEndsAt),
        });
      }
    } catch (error) {
      console.error(`[SnapshotWatcher] Error checking proposal ${i}:`, error);
    }
  }

  return proposals;
}

/**
 * Submit Fast Track finalization
 * Fast Track uses permissionless finalizeProposal()
 */
async function submitFastTrackFinalization(proposalId: number): Promise<void> {
  console.log(`[SnapshotWatcher] Finalizing Fast Track proposal ${proposalId}`);

  try {
    const governance = getGovernanceContract(true); // With signer

    const tx = await governance.finalizeProposal(proposalId);
    console.log(`[SnapshotWatcher] Fast finalization tx submitted: ${tx.hash}`);

    await tx.wait();
    console.log(`[SnapshotWatcher] Fast Track proposal ${proposalId} finalized`);

    stats.fastFinalized++;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    stats.lastError = errorMsg;
    console.error(`[SnapshotWatcher] Error finalizing Fast Track proposal ${proposalId}:`, error);
    throw error;
  }
}

/**
 * Submit Slow Track finalization
 * Slow Track requires VP snapshot at deadline + signature
 */
async function submitSlowTrackFinalization(proposalId: number): Promise<void> {
  console.log(`[SnapshotWatcher] Finalizing Slow Track proposal ${proposalId}`);

  try {
    // Get current block for snapshot
    const currentBlock = await getProvider().getBlockNumber();

    // Compute VP snapshot at deadline
    const snapshot = await computeVPSnapshot(proposalId, currentBlock);

    // Store in database for future proof generation
    await storeVPSnapshot(snapshot);

    // Sign the finalization
    const expiry = Math.floor(Date.now() / 1000) + config.signatureTtl;
    const signature = await signSlowTrackFinalization(
      proposalId,
      snapshot.merkleRoot,
      snapshot.totalVP,
      expiry
    );

    // Submit to chain
    const governance = getGovernanceContract(true); // With signer

    const tx = await governance.finalizeSlowProposal(
      proposalId,
      snapshot.merkleRoot,
      snapshot.totalVP,
      expiry,
      signature
    );

    console.log(`[SnapshotWatcher] Slow finalization tx submitted: ${tx.hash}`);
    await tx.wait();
    console.log(`[SnapshotWatcher] Slow Track proposal ${proposalId} finalized`);

    stats.slowFinalized++;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    stats.lastError = errorMsg;
    console.error(`[SnapshotWatcher] Error finalizing Slow Track proposal ${proposalId}:`, error);
    throw error;
  }
}

/**
 * Watch for proposals past deadline and auto-finalize
 */
async function watchProposalDeadlines(): Promise<void> {
  console.log('[SnapshotWatcher] Checking for proposals to finalize...');

  try {
    const proposalsToFinalize = await getProposalsPastDeadline();

    if (proposalsToFinalize.length === 0) {
      console.log('[SnapshotWatcher] No proposals need finalization');
      return;
    }

    console.log(`[SnapshotWatcher] Found ${proposalsToFinalize.length} proposals to finalize`);

    for (const proposal of proposalsToFinalize) {
      // Check if execution is enabled
      if (config.snapshotWatcher?.executeOnChain === false) {
        console.log(`[SnapshotWatcher] DRY RUN - Would finalize ${proposal.track === Track.Fast ? 'Fast' : 'Slow'} Track proposal ${proposal.id}`);
        continue;
      }

      try {
        if (proposal.track === Track.Fast) {
          await submitFastTrackFinalization(proposal.id);
        } else {
          await submitSlowTrackFinalization(proposal.id);
        }
      } catch (error) {
        // Log error but continue with other proposals
        console.error(`[SnapshotWatcher] Failed to finalize proposal ${proposal.id}:`, error);
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    stats.lastError = errorMsg;
    console.error('[SnapshotWatcher] Error in watchProposalDeadlines:', error);
  }
}

/**
 * Start the finalization watcher loop
 */
function startFinalizationWatcher(): void {
  if (finalizationInterval) {
    clearInterval(finalizationInterval);
  }

  console.log('[SnapshotWatcher] Starting finalization watcher (checking every 60s)');

  // Run immediately on startup
  watchProposalDeadlines().catch((err) => {
    console.error('[SnapshotWatcher] Error in initial finalization check:', err);
  });

  // Then run periodically
  finalizationInterval = setInterval(() => {
    watchProposalDeadlines().catch((err) => {
      console.error('[SnapshotWatcher] Error in periodic finalization check:', err);
    });
  }, FINALIZATION_CHECK_INTERVAL);
}

/**
 * Stop the finalization watcher
 */
function stopFinalizationWatcher(): void {
  if (finalizationInterval) {
    clearInterval(finalizationInterval);
    finalizationInterval = null;
  }
}
