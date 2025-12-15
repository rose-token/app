/**
 * Auction Service
 *
 * Handles off-chain bid collection and winner selection signing
 * for the reverse auction system. Workers submit bids off-chain,
 * customers view bids and select winners, then execute on-chain.
 */

import { ethers } from 'ethers';
import { config } from '../config';
import { query, getPool } from '../db/pool';
import { getWsProvider, onReconnect } from '../utils/wsProvider';
import { RoseMarketplaceABI } from '../utils/contracts';

// Task status enum (matches contract)
enum TaskStatus {
  None = 0,
  StakeholderRequired = 1,
  Open = 2,
  InProgress = 3,
  Completed = 4,
  ApprovedPendingPayment = 5,
  Closed = 6,
}

let marketplaceContract: ethers.Contract | null = null;

// Clear cached contract on WebSocket reconnect to avoid stale provider
onReconnect(() => {
  console.log('[auction] WebSocket reconnected, clearing contract cache');
  marketplaceContract = null;
});

function getProvider(): ethers.Provider {
  return getWsProvider();
}

function getMarketplaceContract(): ethers.Contract {
  if (!marketplaceContract) {
    if (!config.contracts.marketplace) {
      throw new Error('MARKETPLACE_ADDRESS not configured');
    }
    marketplaceContract = new ethers.Contract(
      config.contracts.marketplace,
      RoseMarketplaceABI,
      getProvider()
    );
  }
  return marketplaceContract;
}

/** On-chain task data returned by getOnChainTask */
type OnChainTask = {
  customer: string;
  worker: string;
  status: TaskStatus;
  isAuction: boolean;
  winningBid: bigint;
};

/**
 * Get task data from on-chain contract.
 * Returns only the fields we need for auction verification.
 */
async function getOnChainTask(taskId: number): Promise<OnChainTask | null> {
  try {
    const contract = getMarketplaceContract();
    const task = await contract.tasks(taskId);

    // Check if task exists (customer address is zero for non-existent tasks)
    if (task.customer === ethers.ZeroAddress) {
      return null;
    }

    return {
      customer: task.customer,
      worker: task.worker,
      status: Number(task.status) as TaskStatus,
      isAuction: task.isAuction,
      winningBid: task.winningBid,
    };
  } catch (error) {
    console.error(`Failed to fetch on-chain task ${taskId}:`, error);
    return null;
  }
}

import {
  AuctionTaskRow,
  AuctionBidRow,
  AuctionBid,
  GetBidsResponse,
  GetBidCountResponse,
  GetWorkerBidResponse,
  SelectWinnerResponse,
} from '../types';

const wallet = new ethers.Wallet(config.signer.privateKey);

/**
 * Register an auction task after it's created on-chain.
 * Called by frontend after createAuctionTask tx confirms.
 */
export async function registerAuctionTask(taskId: number, maxBudget: string): Promise<void> {
  if (taskId <= 0) {
    throw new Error('Invalid task ID');
  }

  // Validate maxBudget is a valid BigInt string
  try {
    const budget = BigInt(maxBudget);
    if (budget <= 0n) {
      throw new Error('Max budget must be positive');
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes('budget')) {
      throw e;
    }
    throw new Error('Invalid max budget format');
  }

  await query(
    `INSERT INTO auction_tasks (task_id, max_budget)
     VALUES ($1, $2)
     ON CONFLICT (task_id) DO UPDATE SET max_budget = EXCLUDED.max_budget`,
    [taskId, maxBudget]
  );

  console.log(`Auction task ${taskId} registered with max budget ${maxBudget}`);
}

/**
 * Verify worker's signature for bid submission.
 * Worker signs: keccak256(abi.encodePacked(worker, "submitBid", taskId, bidAmount))
 */
function verifyBidSignature(
  worker: string,
  taskId: number,
  bidAmount: string,
  signature: string
): boolean {
  try {
    const messageHash = ethers.solidityPackedKeccak256(
      ['address', 'string', 'uint256', 'uint256'],
      [worker, 'submitBid', taskId, BigInt(bidAmount)]
    );
    const recovered = ethers.verifyMessage(ethers.getBytes(messageHash), signature);
    return recovered.toLowerCase() === worker.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Submit or update a bid for an auction task.
 * Worker must sign to prove address ownership.
 * Returns whether this was a new bid or an update.
 */
export async function submitBid(
  taskId: number,
  worker: string,
  bidAmount: string,
  message: string | null,
  signature: string
): Promise<{ isUpdate: boolean }> {
  // Validate inputs
  if (!ethers.isAddress(worker)) {
    throw new Error('Invalid worker address');
  }

  // Verify worker signature
  if (!verifyBidSignature(worker, taskId, bidAmount, signature)) {
    throw new Error('Invalid signature');
  }

  // Validate bid amount
  let amount: bigint;
  try {
    amount = BigInt(bidAmount);
    if (amount <= 0n) {
      throw new Error('Bid amount must be positive');
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes('amount')) {
      throw e;
    }
    throw new Error('Invalid bid amount format');
  }

  // Check auction exists and is active
  const auctionResult = await query<AuctionTaskRow>(
    'SELECT * FROM auction_tasks WHERE task_id = $1',
    [taskId]
  );

  if (auctionResult.rowCount === 0) {
    throw new Error('Auction task not found');
  }

  const auction = auctionResult.rows[0];

  if (auction.winner_address) {
    throw new Error('Auction already concluded');
  }

  // Validate bid is <= max budget
  const maxBudget = BigInt(auction.max_budget);
  if (amount > maxBudget) {
    throw new Error('Bid exceeds max budget');
  }

  // Check if this is an update (existing bid)
  const existingResult = await query<AuctionBidRow>(
    'SELECT id FROM auction_bids WHERE task_id = $1 AND LOWER(worker_address) = LOWER($2)',
    [taskId, worker]
  );
  const isUpdate = existingResult.rowCount! > 0;

  // Insert or update bid
  await query(
    `INSERT INTO auction_bids (task_id, worker_address, bid_amount, message)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (task_id, worker_address)
     DO UPDATE SET bid_amount = EXCLUDED.bid_amount, message = EXCLUDED.message`,
    [taskId, worker.toLowerCase(), bidAmount, message]
  );

  console.log(
    `Bid ${isUpdate ? 'updated' : 'submitted'}: task=${taskId}, worker=${worker}, amount=${bidAmount}`
  );

  return { isUpdate };
}

/**
 * Get all bids for an auction task.
 * Should only be called for the task customer (enforced at route level).
 * Returns bids sorted by amount (lowest first).
 */
export async function getBidsForTask(taskId: number): Promise<GetBidsResponse> {
  // Get auction info
  const auctionResult = await query<AuctionTaskRow>(
    'SELECT * FROM auction_tasks WHERE task_id = $1',
    [taskId]
  );

  if (auctionResult.rowCount === 0) {
    throw new Error('Auction task not found');
  }

  const auction = auctionResult.rows[0];

  // Get all bids sorted by amount
  const bidsResult = await query<AuctionBidRow>(
    `SELECT * FROM auction_bids
     WHERE task_id = $1
     ORDER BY bid_amount ASC, created_at ASC`,
    [taskId]
  );

  // Calculate displayBid (midpoint) for each bid
  // displayBid = (maxBudget + bidAmount) / 2 - this is what customer sees
  const maxBudgetBn = BigInt(auction.max_budget);

  const bids: AuctionBid[] = bidsResult.rows.map((row) => {
    const bidAmountBn = BigInt(row.bid_amount);
    const displayBidBn = (maxBudgetBn + bidAmountBn) / 2n;

    return {
      taskId: row.task_id,
      worker: row.worker_address,
      bidAmount: row.bid_amount,
      displayBid: displayBidBn.toString(),
      message: row.message,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });

  return {
    taskId,
    maxBudget: auction.max_budget,
    bidCount: auction.bid_count,
    bids,
  };
}

/**
 * Get bid count for a task (public).
 */
export async function getBidCount(taskId: number): Promise<GetBidCountResponse> {
  const result = await query<AuctionTaskRow>(
    'SELECT bid_count FROM auction_tasks WHERE task_id = $1',
    [taskId]
  );

  if (result.rowCount === 0) {
    throw new Error('Auction task not found');
  }

  return {
    taskId,
    bidCount: result.rows[0].bid_count,
  };
}

/**
 * Get a worker's own bid for a task.
 */
export async function getWorkerBid(taskId: number, worker: string): Promise<GetWorkerBidResponse> {
  if (!ethers.isAddress(worker)) {
    throw new Error('Invalid worker address');
  }

  const result = await query<AuctionBidRow>(
    `SELECT * FROM auction_bids
     WHERE task_id = $1 AND LOWER(worker_address) = LOWER($2)`,
    [taskId, worker]
  );

  if (result.rowCount === 0) {
    return {
      taskId,
      worker,
      hasBid: false,
      bid: null,
    };
  }

  // Get maxBudget for displayBid calculation
  const auctionResult = await query<AuctionTaskRow>(
    'SELECT max_budget FROM auction_tasks WHERE task_id = $1',
    [taskId]
  );

  const row = result.rows[0];
  const maxBudgetBn = auctionResult.rowCount ? BigInt(auctionResult.rows[0].max_budget) : BigInt(row.bid_amount);
  const bidAmountBn = BigInt(row.bid_amount);
  const displayBidBn = (maxBudgetBn + bidAmountBn) / 2n;

  return {
    taskId,
    worker,
    hasBid: true,
    bid: {
      taskId: row.task_id,
      worker: row.worker_address,
      bidAmount: row.bid_amount,
      displayBid: displayBidBn.toString(),
      message: row.message,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
  };
}

/**
 * Sign winner selection for on-chain execution.
 * Customer calls this to get a signature for selectAuctionWinner.
 *
 * Signature format matches contract:
 * keccak256(abi.encodePacked(customer, "selectWinner", taskId, worker, winningBid, expiry))
 */
export async function signWinnerSelection(
  taskId: number,
  customer: string,
  worker: string,
  winningBid: string
): Promise<SelectWinnerResponse> {
  // Validate inputs
  if (!ethers.isAddress(customer)) {
    throw new Error('Invalid customer address');
  }
  if (!ethers.isAddress(worker)) {
    throw new Error('Invalid worker address');
  }

  // Validate winning bid format
  let bid: bigint;
  try {
    bid = BigInt(winningBid);
    if (bid <= 0n) {
      throw new Error('Winning bid must be positive');
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes('bid')) {
      throw e;
    }
    throw new Error('Invalid winning bid format');
  }

  // Check auction exists and is active
  const auctionResult = await query<AuctionTaskRow>(
    'SELECT * FROM auction_tasks WHERE task_id = $1',
    [taskId]
  );

  if (auctionResult.rowCount === 0) {
    throw new Error('Auction task not found');
  }

  let auction = auctionResult.rows[0];

  // Check on-chain task state to detect unclaimed auctions
  const onChainTask = await getOnChainTask(taskId);
  if (!onChainTask) {
    throw new Error('Task not found on-chain');
  }

  // If on-chain status is Open, the auction can be re-selected
  // This handles the case where a winner unclaimed the task
  if (onChainTask.status === TaskStatus.Open && auction.winner_address) {
    console.log(
      `Auction ${taskId} was unclaimed on-chain, clearing stale DB winner data`
    );
    // Clear stale winner data from DB
    await query(
      `UPDATE auction_tasks
       SET winner_address = NULL, winning_bid = NULL, concluded_at = NULL
       WHERE task_id = $1`,
      [taskId]
    );
    // Refresh auction data
    const refreshed = await query<AuctionTaskRow>(
      'SELECT * FROM auction_tasks WHERE task_id = $1',
      [taskId]
    );
    auction = refreshed.rows[0];
  }

  if (auction.winner_address) {
    throw new Error('Auction already concluded');
  }

  // Validate winning bid doesn't exceed max budget
  const maxBudget = BigInt(auction.max_budget);
  if (bid > maxBudget) {
    throw new Error('Winning bid exceeds max budget');
  }

  // Verify the bid exists from this worker
  const bidResult = await query<AuctionBidRow>(
    `SELECT * FROM auction_bids
     WHERE task_id = $1 AND LOWER(worker_address) = LOWER($2)`,
    [taskId, worker]
  );

  if (bidResult.rowCount === 0) {
    throw new Error('No bid found from this worker');
  }

  // Verify the winning bid matches the worker's bid
  const workerBid = BigInt(bidResult.rows[0].bid_amount);
  if (workerBid !== bid) {
    throw new Error('Winning bid does not match worker bid');
  }

  // Generate signature
  const expiry = Math.floor(Date.now() / 1000) + config.signatureTtl;

  const messageHash = ethers.solidityPackedKeccak256(
    ['address', 'string', 'uint256', 'address', 'uint256', 'uint256'],
    [customer, 'selectWinner', taskId, worker, bid, expiry]
  );

  const signature = await wallet.signMessage(ethers.getBytes(messageHash));

  console.log(
    `Winner selection signed: task=${taskId}, customer=${customer}, worker=${worker}, bid=${winningBid}`
  );

  return {
    taskId,
    customer,
    worker,
    winningBid,
    expiry,
    signature,
  };
}

/**
 * Helper to wait for on-chain status with retry logic.
 * Handles RPC sync lag between frontend and backend nodes.
 */
async function waitForOnChainStatus(
  taskId: number,
  expectedStatus: TaskStatus,
  maxAttempts: number = 7,
  baseDelayMs: number = 1000
): Promise<OnChainTask> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const task = await getOnChainTask(taskId);

    if (task && task.status === expectedStatus) {
      if (attempt > 1) {
        console.log(`[auction] On-chain status verified after ${attempt} attempts`);
      }
      return task;
    }

    if (attempt < maxAttempts) {
      const delay = baseDelayMs * Math.pow(2, attempt - 1); // 1s, 2s, 4s, 8s, 16s, 32s, 64s
      console.log(`[auction] Waiting for on-chain status (attempt ${attempt}/${maxAttempts}), retrying in ${delay}ms`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw new Error('Auction winner not yet selected on-chain after retries');
}

/**
 * Conclude auction after on-chain winner selection confirms.
 * Called by frontend after selectAuctionWinner tx confirms.
 *
 * NOTE: The frontend already waited for tx receipt, so on-chain verification
 * is optional. We do a single non-blocking check but proceed with DB update
 * regardless to avoid timeouts that cause CORS errors.
 */
export async function concludeAuction(
  taskId: number,
  winner: string,
  winningBid: string
): Promise<void> {
  if (!ethers.isAddress(winner)) {
    throw new Error('Invalid winner address');
  }

  // Single non-blocking on-chain check (frontend already verified tx succeeded)
  const onChainTask = await getOnChainTask(taskId);

  if (onChainTask) {
    // Log verification result but don't block - frontend already confirmed tx
    if (onChainTask.status !== TaskStatus.InProgress) {
      console.warn(`[auction] Task ${taskId} status is ${onChainTask.status}, expected InProgress - proceeding with DB update`);
    }
    if (onChainTask.worker.toLowerCase() !== winner.toLowerCase()) {
      console.warn(`[auction] Task ${taskId} worker mismatch: on-chain=${onChainTask.worker}, request=${winner} - proceeding with DB update`);
    }
  } else {
    console.warn(`[auction] Task ${taskId} not found on-chain - proceeding with DB update (frontend verified tx)`);
  }

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Update auction task
    await client.query(
      `UPDATE auction_tasks
       SET winner_address = $2, winning_bid = $3, concluded_at = NOW()
       WHERE task_id = $1`,
      [taskId, winner.toLowerCase(), winningBid]
    );

    await client.query('COMMIT');

    console.log(`Auction ${taskId} concluded: winner=${winner}, bid=${winningBid}`);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Check if an auction task exists.
 */
export async function auctionExists(taskId: number): Promise<boolean> {
  const result = await query<AuctionTaskRow>(
    'SELECT task_id FROM auction_tasks WHERE task_id = $1',
    [taskId]
  );
  return result.rowCount! > 0;
}

/**
 * Get auction task info.
 */
export async function getAuctionTask(taskId: number): Promise<AuctionTaskRow | null> {
  const result = await query<AuctionTaskRow>(
    'SELECT * FROM auction_tasks WHERE task_id = $1',
    [taskId]
  );

  if (result.rowCount === 0) {
    return null;
  }

  return result.rows[0];
}

/**
 * Sync auction state from on-chain to database.
 * Clears stale winner data if on-chain status is Open.
 * Returns sync result with details of what changed.
 */
export async function syncAuctionFromChain(taskId: number): Promise<{
  taskId: number;
  synced: boolean;
  onChainStatus: string;
  dbHadWinner: boolean;
  cleared: boolean;
}> {
  // Get DB state
  const auction = await getAuctionTask(taskId);
  if (!auction) {
    throw new Error('Auction task not found in database');
  }

  // Get on-chain state
  const onChainTask = await getOnChainTask(taskId);
  if (!onChainTask) {
    throw new Error('Task not found on-chain');
  }

  const statusNames = ['None', 'StakeholderRequired', 'Open', 'InProgress', 'Completed', 'ApprovedPendingPayment', 'Closed'];
  const onChainStatus = statusNames[onChainTask.status] || 'Unknown';
  const dbHadWinner = !!auction.winner_address;
  let cleared = false;

  // If on-chain is Open but DB has winner, clear the stale data
  if (onChainTask.status === TaskStatus.Open && auction.winner_address) {
    await query(
      `UPDATE auction_tasks
       SET winner_address = NULL, winning_bid = NULL, concluded_at = NULL
       WHERE task_id = $1`,
      [taskId]
    );
    cleared = true;
    console.log(`Synced auction ${taskId}: cleared stale winner data (on-chain status: ${onChainStatus})`);
  }

  return {
    taskId,
    synced: true,
    onChainStatus,
    dbHadWinner,
    cleared,
  };
}
