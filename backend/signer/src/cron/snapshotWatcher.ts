import { ethers } from 'ethers';
import { config } from '../config';
import { computeVPSnapshot, storeVPSnapshot, signMerkleRoot } from '../services/vpSnapshot';

// Governance contract ABI
const GOVERNANCE_ABI = [
  'event ProposalCreated(uint256 indexed proposalId, address indexed proposer, uint8 track, uint256 treasuryAmount)',
  'function proposals(uint256 proposalId) external view returns (tuple(address proposer, uint8 track, uint256 snapshotBlock, bytes32 vpMerkleRoot, uint256 votingStartsAt, uint256 votingEndsAt, uint256 forVotes, uint256 againstVotes, uint256 treasuryAmount, uint8 status, string title, string descriptionHash, uint256 deadline, string deliverables, uint256 editCount, uint256 taskId))',
  'function setVPMerkleRoot(uint256 proposalId, bytes32 merkleRoot, uint256 totalVP, uint256 expiry, bytes calldata signature) external',
  'function snapshotDelay() external view returns (uint256)',
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
  lastError: string | null;
  lastEventBlock: number;
}

// State
let provider: ethers.JsonRpcProvider | null = null;
let governanceContract: ethers.Contract | null = null;
let wallet: ethers.Wallet | null = null;

const stats: SnapshotWatcherStats = {
  isRunning: false,
  startedAt: null,
  proposalsDetected: 0,
  snapshotsComputed: 0,
  snapshotsSubmitted: 0,
  pendingSnapshots: 0,
  lastError: null,
  lastEventBlock: 0,
};

// Pending snapshot timers
const pendingTimers: Map<number, NodeJS.Timeout> = new Map();

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
    const governance = getGovernanceContract();

    // Listen for new proposals
    governance.on('ProposalCreated', (proposalId, proposer, track, treasuryAmount, event) => {
      handleProposalCreated(proposalId, proposer, track, treasuryAmount, event);
    });

    stats.isRunning = true;
    stats.startedAt = new Date();

    console.log('[SnapshotWatcher] Listening for ProposalCreated events...');

    // Catch up on pending proposals
    await catchUpPendingProposals();

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
  if (governanceContract) {
    governanceContract.removeAllListeners('ProposalCreated');
  }

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
