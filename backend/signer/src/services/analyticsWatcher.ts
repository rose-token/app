/**
 * Analytics Watcher Service
 *
 * Watches blockchain events from Marketplace, Governance, and Treasury contracts.
 * Populates analytics tables for the admin dashboard.
 *
 * Events watched:
 * - Marketplace: TaskCreated, StakeholderStaked, TaskClaimed, TaskCompleted,
 *                TaskReadyForPayment, TaskDisputed, TaskCancelled
 * - Governance: ProposalCreated, VoteCastFast, VoteCastSlow, ProposalFinalized,
 *               Deposited, Withdrawn
 * - Treasury: Deposited, Redeemed
 */

import { ethers } from 'ethers';
import { config } from '../config';
import { query } from '../db/pool';
import { getWsProvider, onReconnect, removeReconnectCallback } from '../utils/wsProvider';

// ============================================================
// Contract ABIs (events only)
// ============================================================

const MARKETPLACE_ABI = [
  'event TaskCreated(uint256 taskId, address indexed customer, uint256 deposit)',
  'event StakeholderStaked(uint256 taskId, address indexed stakeholder, uint256 stakeholderDeposit)',
  'event TaskClaimed(uint256 taskId, address indexed worker)',
  'event TaskCompleted(uint256 taskId, string prUrl)',
  'event TaskReadyForPayment(uint256 taskId, address indexed worker, uint256 amount)',
  'event TaskDisputed(uint256 indexed taskId, address indexed initiator, string reasonHash, uint256 timestamp)',
  'event TaskCancelled(uint256 indexed taskId, address indexed cancelledBy, uint256 customerRefund, uint256 stakeholderRefund)',
];

const GOVERNANCE_ABI = [
  'event ProposalCreated(uint256 indexed proposalId, address indexed proposer, uint8 track, uint256 treasuryAmount)',
  'event VoteCastFast(uint256 indexed proposalId, address indexed voter, bool support, uint256 vpAmount)',
  'event VoteCastSlow(uint256 indexed proposalId, address indexed voter, bool support, uint256 vpAmount, uint256 nonce)',
  'event ProposalFinalized(uint256 indexed proposalId, uint8 status)',
  'event Deposited(address indexed user, uint256 amount)',
  'event Withdrawn(address indexed user, uint256 amount)',
];

const TREASURY_ABI = [
  'event Deposited(address indexed user, uint256 usdcIn, uint256 roseMinted)',
  'event Redeemed(address indexed user, uint256 roseBurned, uint256 usdcOut)',
];

// ============================================================
// Types
// ============================================================

export interface AnalyticsWatcherStats {
  isRunning: boolean;
  startedAt: Date | null;
  // Marketplace
  tasksCreated: number;
  tasksClaimed: number;
  tasksCompleted: number;
  tasksDisputed: number;
  // Governance
  proposalsCreated: number;
  votesRecorded: number;
  stakingEvents: number;
  // Treasury
  depositsRecorded: number;
  redemptionsRecorded: number;
  // Meta
  lastEventBlock: number;
  lastError: string | null;
}

// ============================================================
// State
// ============================================================

let provider: ethers.JsonRpcProvider | null = null;
let marketplaceContract: ethers.Contract | null = null;
let governanceContract: ethers.Contract | null = null;
let treasuryContract: ethers.Contract | null = null;
let wsMarketplace: ethers.Contract | null = null;
let wsGovernance: ethers.Contract | null = null;
let wsTreasury: ethers.Contract | null = null;
let reconnectHandler: (() => void) | null = null;

const stats: AnalyticsWatcherStats = {
  isRunning: false,
  startedAt: null,
  tasksCreated: 0,
  tasksClaimed: 0,
  tasksCompleted: 0,
  tasksDisputed: 0,
  proposalsCreated: 0,
  votesRecorded: 0,
  stakingEvents: 0,
  depositsRecorded: 0,
  redemptionsRecorded: 0,
  lastEventBlock: 0,
  lastError: null,
};

// ============================================================
// Provider & Contract Helpers
// ============================================================

function getProvider(): ethers.JsonRpcProvider {
  if (!provider) {
    provider = new ethers.JsonRpcProvider(config.rpc.url);
  }
  return provider;
}

function getMarketplaceContract(): ethers.Contract {
  if (!marketplaceContract) {
    marketplaceContract = new ethers.Contract(
      config.contracts.marketplace!,
      MARKETPLACE_ABI,
      getProvider()
    );
  }
  return marketplaceContract;
}

function getGovernanceContract(): ethers.Contract {
  if (!governanceContract) {
    governanceContract = new ethers.Contract(
      config.contracts.governance!,
      GOVERNANCE_ABI,
      getProvider()
    );
  }
  return governanceContract;
}

function getTreasuryContract(): ethers.Contract {
  if (!treasuryContract) {
    treasuryContract = new ethers.Contract(
      config.contracts.treasury!,
      TREASURY_ABI,
      getProvider()
    );
  }
  return treasuryContract;
}

// ============================================================
// Helper Functions
// ============================================================

function extractLog(event: ethers.Log | ethers.ContractEventPayload): ethers.Log {
  return 'log' in event ? event.log : event;
}

async function getBlockTimestamp(blockNumber: number): Promise<Date> {
  const block = await getProvider().getBlock(blockNumber);
  return new Date((block?.timestamp || 0) * 1000);
}

async function ensureUser(address: string, timestamp: Date): Promise<void> {
  await query(`
    INSERT INTO analytics_users (address, first_seen_at, last_active_at)
    VALUES ($1, $2, $2)
    ON CONFLICT (address) DO UPDATE SET
      last_active_at = GREATEST(analytics_users.last_active_at, EXCLUDED.last_active_at)
  `, [address.toLowerCase(), timestamp.toISOString()]);
}

// ============================================================
// Marketplace Event Handlers
// ============================================================

async function handleTaskCreated(
  taskId: bigint,
  customer: string,
  deposit: bigint,
  event: ethers.Log | ethers.ContractEventPayload
): Promise<void> {
  const log = extractLog(event);
  const timestamp = await getBlockTimestamp(log.blockNumber);

  console.log(`[AnalyticsWatcher] TaskCreated: taskId=${taskId}, customer=${customer}`);

  try {
    await query(`
      INSERT INTO analytics_tasks (task_id, customer, deposit, status, created_at, created_block, last_event_block)
      VALUES ($1, $2, $3, 'Created', $4, $5, $5)
      ON CONFLICT (task_id) DO UPDATE SET
        customer = EXCLUDED.customer,
        deposit = EXCLUDED.deposit,
        last_event_block = GREATEST(analytics_tasks.last_event_block, EXCLUDED.last_event_block)
    `, [Number(taskId), customer.toLowerCase(), deposit.toString(), timestamp.toISOString(), log.blockNumber]);

    await ensureUser(customer, timestamp);
    await query(`
      UPDATE analytics_users SET
        tasks_created = tasks_created + 1,
        total_spent_wei = total_spent_wei + $2
      WHERE address = $1
    `, [customer.toLowerCase(), deposit.toString()]);

    stats.tasksCreated++;
    stats.lastEventBlock = log.blockNumber;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    stats.lastError = msg;
    console.error(`[AnalyticsWatcher] TaskCreated error:`, error);
  }
}

async function handleStakeholderStaked(
  taskId: bigint,
  stakeholder: string,
  _stakeholderDeposit: bigint,
  event: ethers.Log | ethers.ContractEventPayload
): Promise<void> {
  const log = extractLog(event);
  const timestamp = await getBlockTimestamp(log.blockNumber);

  console.log(`[AnalyticsWatcher] StakeholderStaked: taskId=${taskId}, stakeholder=${stakeholder}`);

  try {
    await query(`
      UPDATE analytics_tasks SET
        stakeholder = $2,
        status = 'Staked',
        staked_at = $3,
        last_event_block = $4
      WHERE task_id = $1
    `, [Number(taskId), stakeholder.toLowerCase(), timestamp.toISOString(), log.blockNumber]);

    await ensureUser(stakeholder, timestamp);
    await query(`
      UPDATE analytics_users SET tasks_staked = tasks_staked + 1
      WHERE address = $1
    `, [stakeholder.toLowerCase()]);

    stats.lastEventBlock = log.blockNumber;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    stats.lastError = msg;
    console.error(`[AnalyticsWatcher] StakeholderStaked error:`, error);
  }
}

async function handleTaskClaimed(
  taskId: bigint,
  worker: string,
  event: ethers.Log | ethers.ContractEventPayload
): Promise<void> {
  const log = extractLog(event);
  const timestamp = await getBlockTimestamp(log.blockNumber);

  console.log(`[AnalyticsWatcher] TaskClaimed: taskId=${taskId}, worker=${worker}`);

  try {
    await query(`
      UPDATE analytics_tasks SET
        worker = $2,
        status = 'Claimed',
        claimed_at = $3,
        last_event_block = $4
      WHERE task_id = $1
    `, [Number(taskId), worker.toLowerCase(), timestamp.toISOString(), log.blockNumber]);

    await ensureUser(worker, timestamp);
    stats.tasksClaimed++;
    stats.lastEventBlock = log.blockNumber;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    stats.lastError = msg;
    console.error(`[AnalyticsWatcher] TaskClaimed error:`, error);
  }
}

async function handleTaskCompleted(
  taskId: bigint,
  _prUrl: string,
  event: ethers.Log | ethers.ContractEventPayload
): Promise<void> {
  const log = extractLog(event);
  const timestamp = await getBlockTimestamp(log.blockNumber);

  console.log(`[AnalyticsWatcher] TaskCompleted: taskId=${taskId}`);

  try {
    await query(`
      UPDATE analytics_tasks SET
        status = 'Completed',
        completed_at = $2,
        last_event_block = $3
      WHERE task_id = $1
    `, [Number(taskId), timestamp.toISOString(), log.blockNumber]);

    stats.tasksCompleted++;
    stats.lastEventBlock = log.blockNumber;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    stats.lastError = msg;
    console.error(`[AnalyticsWatcher] TaskCompleted error:`, error);
  }
}

async function handleTaskReadyForPayment(
  taskId: bigint,
  worker: string,
  amount: bigint,
  event: ethers.Log | ethers.ContractEventPayload
): Promise<void> {
  const log = extractLog(event);
  const timestamp = await getBlockTimestamp(log.blockNumber);

  console.log(`[AnalyticsWatcher] TaskReadyForPayment: taskId=${taskId}, worker=${worker}, amount=${amount}`);

  try {
    await query(`
      UPDATE analytics_tasks SET
        status = 'Approved',
        approved_at = $2,
        last_event_block = $3
      WHERE task_id = $1
    `, [Number(taskId), timestamp.toISOString(), log.blockNumber]);

    // Update worker earnings
    await query(`
      UPDATE analytics_users SET
        tasks_completed_as_worker = tasks_completed_as_worker + 1,
        total_earned_wei = total_earned_wei + $2
      WHERE address = $1
    `, [worker.toLowerCase(), amount.toString()]);

    stats.lastEventBlock = log.blockNumber;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    stats.lastError = msg;
    console.error(`[AnalyticsWatcher] TaskReadyForPayment error:`, error);
  }
}

async function handleTaskDisputed(
  taskId: bigint,
  initiator: string,
  _reasonHash: string,
  _eventTimestamp: bigint,
  event: ethers.Log | ethers.ContractEventPayload
): Promise<void> {
  const log = extractLog(event);
  const timestamp = await getBlockTimestamp(log.blockNumber);

  console.log(`[AnalyticsWatcher] TaskDisputed: taskId=${taskId}, initiator=${initiator}`);

  try {
    await query(`
      UPDATE analytics_tasks SET
        status = 'Disputed',
        disputed_at = $2,
        last_event_block = $3
      WHERE task_id = $1
    `, [Number(taskId), timestamp.toISOString(), log.blockNumber]);

    stats.tasksDisputed++;
    stats.lastEventBlock = log.blockNumber;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    stats.lastError = msg;
    console.error(`[AnalyticsWatcher] TaskDisputed error:`, error);
  }
}

async function handleTaskCancelled(
  taskId: bigint,
  _cancelledBy: string,
  _customerRefund: bigint,
  _stakeholderRefund: bigint,
  event: ethers.Log | ethers.ContractEventPayload
): Promise<void> {
  const log = extractLog(event);
  const timestamp = await getBlockTimestamp(log.blockNumber);

  console.log(`[AnalyticsWatcher] TaskCancelled: taskId=${taskId}`);

  try {
    await query(`
      UPDATE analytics_tasks SET
        status = 'Cancelled',
        cancelled_at = $2,
        closed_at = $2,
        last_event_block = $3
      WHERE task_id = $1
    `, [Number(taskId), timestamp.toISOString(), log.blockNumber]);

    stats.lastEventBlock = log.blockNumber;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    stats.lastError = msg;
    console.error(`[AnalyticsWatcher] TaskCancelled error:`, error);
  }
}

// ============================================================
// Governance Event Handlers
// ============================================================

async function handleProposalCreated(
  proposalId: bigint,
  proposer: string,
  track: number,
  treasuryAmount: bigint,
  event: ethers.Log | ethers.ContractEventPayload
): Promise<void> {
  const log = extractLog(event);
  const timestamp = await getBlockTimestamp(log.blockNumber);

  console.log(`[AnalyticsWatcher] ProposalCreated: id=${proposalId}, proposer=${proposer}, track=${track}`);

  try {
    await query(`
      INSERT INTO analytics_proposals (proposal_id, proposer, track, treasury_amount, status, created_at, created_block, last_event_block)
      VALUES ($1, $2, $3, $4, 'Active', $5, $6, $6)
      ON CONFLICT (proposal_id) DO UPDATE SET
        proposer = EXCLUDED.proposer,
        track = EXCLUDED.track,
        treasury_amount = EXCLUDED.treasury_amount,
        last_event_block = GREATEST(analytics_proposals.last_event_block, EXCLUDED.last_event_block)
    `, [Number(proposalId), proposer.toLowerCase(), track, treasuryAmount.toString(), timestamp.toISOString(), log.blockNumber]);

    await ensureUser(proposer, timestamp);
    await query(`
      UPDATE analytics_users SET proposals_created = proposals_created + 1
      WHERE address = $1
    `, [proposer.toLowerCase()]);

    stats.proposalsCreated++;
    stats.lastEventBlock = log.blockNumber;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    stats.lastError = msg;
    console.error(`[AnalyticsWatcher] ProposalCreated error:`, error);
  }
}

async function handleVoteCast(
  proposalId: bigint,
  voter: string,
  support: boolean,
  vpAmount: bigint,
  event: ethers.Log | ethers.ContractEventPayload
): Promise<void> {
  const log = extractLog(event);
  const timestamp = await getBlockTimestamp(log.blockNumber);

  console.log(`[AnalyticsWatcher] VoteCast: proposalId=${proposalId}, voter=${voter}, support=${support}`);

  try {
    // Update proposal vote counts
    if (support) {
      await query(`
        UPDATE analytics_proposals SET
          total_votes = total_votes + 1,
          yay_votes = yay_votes + 1,
          total_vp = total_vp + $2,
          yay_vp = yay_vp + $2,
          last_event_block = $3
        WHERE proposal_id = $1
      `, [Number(proposalId), vpAmount.toString(), log.blockNumber]);
    } else {
      await query(`
        UPDATE analytics_proposals SET
          total_votes = total_votes + 1,
          nay_votes = nay_votes + 1,
          total_vp = total_vp + $2,
          nay_vp = nay_vp + $2,
          last_event_block = $3
        WHERE proposal_id = $1
      `, [Number(proposalId), vpAmount.toString(), log.blockNumber]);
    }

    // Update user stats
    await ensureUser(voter, timestamp);
    await query(`
      UPDATE analytics_users SET
        votes_cast = votes_cast + 1,
        total_vp_used = total_vp_used + $2
      WHERE address = $1
    `, [voter.toLowerCase(), vpAmount.toString()]);

    stats.votesRecorded++;
    stats.lastEventBlock = log.blockNumber;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    stats.lastError = msg;
    console.error(`[AnalyticsWatcher] VoteCast error:`, error);
  }
}

async function handleProposalFinalized(
  proposalId: bigint,
  status: number,
  event: ethers.Log | ethers.ContractEventPayload
): Promise<void> {
  const log = extractLog(event);
  const timestamp = await getBlockTimestamp(log.blockNumber);

  // Status mapping: 0=Pending, 1=Active, 2=Cancelled, 3=Passed, 4=Failed
  const statusMap: Record<number, string> = {
    0: 'Pending',
    1: 'Active',
    2: 'Cancelled',
    3: 'Passed',
    4: 'Failed',
  };

  console.log(`[AnalyticsWatcher] ProposalFinalized: id=${proposalId}, status=${statusMap[status] || 'Unknown'}`);

  try {
    await query(`
      UPDATE analytics_proposals SET
        status = $2,
        finalized_at = $3,
        last_event_block = $4
      WHERE proposal_id = $1
    `, [Number(proposalId), statusMap[status] || 'Unknown', timestamp.toISOString(), log.blockNumber]);

    stats.lastEventBlock = log.blockNumber;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    stats.lastError = msg;
    console.error(`[AnalyticsWatcher] ProposalFinalized error:`, error);
  }
}

async function handleGovernanceDeposited(
  user: string,
  amount: bigint,
  event: ethers.Log | ethers.ContractEventPayload
): Promise<void> {
  const log = extractLog(event);
  const timestamp = await getBlockTimestamp(log.blockNumber);

  console.log(`[AnalyticsWatcher] Governance.Deposited: user=${user}, amount=${amount}`);

  try {
    await ensureUser(user, timestamp);
    await query(`
      UPDATE analytics_users SET
        staked_rose = staked_rose + $2
      WHERE address = $1
    `, [user.toLowerCase(), amount.toString()]);

    stats.stakingEvents++;
    stats.lastEventBlock = log.blockNumber;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    stats.lastError = msg;
    console.error(`[AnalyticsWatcher] Governance.Deposited error:`, error);
  }
}

async function handleGovernanceWithdrawn(
  user: string,
  amount: bigint,
  event: ethers.Log | ethers.ContractEventPayload
): Promise<void> {
  const log = extractLog(event);
  const timestamp = await getBlockTimestamp(log.blockNumber);

  console.log(`[AnalyticsWatcher] Governance.Withdrawn: user=${user}, amount=${amount}`);

  try {
    await query(`
      UPDATE analytics_users SET
        staked_rose = GREATEST(0, staked_rose - $2)
      WHERE address = $1
    `, [user.toLowerCase(), amount.toString()]);

    stats.stakingEvents++;
    stats.lastEventBlock = log.blockNumber;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    stats.lastError = msg;
    console.error(`[AnalyticsWatcher] Governance.Withdrawn error:`, error);
  }
}

// ============================================================
// Treasury Event Handlers
// ============================================================

async function handleTreasuryDeposited(
  user: string,
  usdcIn: bigint,
  roseMinted: bigint,
  event: ethers.Log | ethers.ContractEventPayload
): Promise<void> {
  const log = extractLog(event);
  const timestamp = await getBlockTimestamp(log.blockNumber);

  // Convert USDC (6 decimals) to human readable
  const usdcAmount = Number(usdcIn) / 1e6;

  console.log(`[AnalyticsWatcher] Treasury.Deposited: user=${user}, usdc=${usdcAmount}`);

  try {
    await ensureUser(user, timestamp);
    await query(`
      UPDATE analytics_users SET
        deposits_count = deposits_count + 1,
        deposits_usdc = deposits_usdc + $2
      WHERE address = $1
    `, [user.toLowerCase(), usdcAmount]);

    // Update today's treasury snapshot
    const today = new Date().toISOString().split('T')[0];
    await query(`
      INSERT INTO analytics_treasury (snapshot_date, rose_price_usd, total_hard_assets_usd, circulating_rose, deposits_count, deposits_usdc)
      VALUES ($1, 0, 0, 0, 1, $2)
      ON CONFLICT (snapshot_date) DO UPDATE SET
        deposits_count = analytics_treasury.deposits_count + 1,
        deposits_usdc = analytics_treasury.deposits_usdc + EXCLUDED.deposits_usdc
    `, [today, usdcAmount]);

    stats.depositsRecorded++;
    stats.lastEventBlock = log.blockNumber;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    stats.lastError = msg;
    console.error(`[AnalyticsWatcher] Treasury.Deposited error:`, error);
  }
}

async function handleTreasuryRedeemed(
  user: string,
  roseBurned: bigint,
  usdcOut: bigint,
  event: ethers.Log | ethers.ContractEventPayload
): Promise<void> {
  const log = extractLog(event);
  const timestamp = await getBlockTimestamp(log.blockNumber);

  // Convert USDC (6 decimals) to human readable
  const usdcAmount = Number(usdcOut) / 1e6;

  console.log(`[AnalyticsWatcher] Treasury.Redeemed: user=${user}, usdc=${usdcAmount}`);

  try {
    await ensureUser(user, timestamp);
    await query(`
      UPDATE analytics_users SET
        redemptions_count = redemptions_count + 1,
        redemptions_usdc = redemptions_usdc + $2
      WHERE address = $1
    `, [user.toLowerCase(), usdcAmount]);

    // Update today's treasury snapshot
    const today = new Date().toISOString().split('T')[0];
    await query(`
      INSERT INTO analytics_treasury (snapshot_date, rose_price_usd, total_hard_assets_usd, circulating_rose, redemptions_count, redemptions_usdc)
      VALUES ($1, 0, 0, 0, 1, $2)
      ON CONFLICT (snapshot_date) DO UPDATE SET
        redemptions_count = analytics_treasury.redemptions_count + 1,
        redemptions_usdc = analytics_treasury.redemptions_usdc + EXCLUDED.redemptions_usdc
    `, [today, usdcAmount]);

    stats.redemptionsRecorded++;
    stats.lastEventBlock = log.blockNumber;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    stats.lastError = msg;
    console.error(`[AnalyticsWatcher] Treasury.Redeemed error:`, error);
  }
}

// ============================================================
// Event Listener Setup
// ============================================================

function setupMarketplaceListeners(): void {
  if (wsMarketplace) {
    wsMarketplace.removeAllListeners();
  }

  wsMarketplace = new ethers.Contract(
    config.contracts.marketplace!,
    MARKETPLACE_ABI,
    getWsProvider()
  );

  wsMarketplace.on('TaskCreated', (taskId, customer, deposit, event) => {
    handleTaskCreated(taskId, customer, deposit, event).catch(err => {
      console.error('[AnalyticsWatcher] TaskCreated handler error:', err);
      stats.lastError = err instanceof Error ? err.message : String(err);
    });
  });

  wsMarketplace.on('StakeholderStaked', (taskId, stakeholder, deposit, event) => {
    handleStakeholderStaked(taskId, stakeholder, deposit, event).catch(err => {
      console.error('[AnalyticsWatcher] StakeholderStaked handler error:', err);
      stats.lastError = err instanceof Error ? err.message : String(err);
    });
  });

  wsMarketplace.on('TaskClaimed', (taskId, worker, event) => {
    handleTaskClaimed(taskId, worker, event).catch(err => {
      console.error('[AnalyticsWatcher] TaskClaimed handler error:', err);
      stats.lastError = err instanceof Error ? err.message : String(err);
    });
  });

  wsMarketplace.on('TaskCompleted', (taskId, prUrl, event) => {
    handleTaskCompleted(taskId, prUrl, event).catch(err => {
      console.error('[AnalyticsWatcher] TaskCompleted handler error:', err);
      stats.lastError = err instanceof Error ? err.message : String(err);
    });
  });

  wsMarketplace.on('TaskReadyForPayment', (taskId, worker, amount, event) => {
    handleTaskReadyForPayment(taskId, worker, amount, event).catch(err => {
      console.error('[AnalyticsWatcher] TaskReadyForPayment handler error:', err);
      stats.lastError = err instanceof Error ? err.message : String(err);
    });
  });

  wsMarketplace.on('TaskDisputed', (taskId, initiator, reasonHash, timestamp, event) => {
    handleTaskDisputed(taskId, initiator, reasonHash, timestamp, event).catch(err => {
      console.error('[AnalyticsWatcher] TaskDisputed handler error:', err);
      stats.lastError = err instanceof Error ? err.message : String(err);
    });
  });

  wsMarketplace.on('TaskCancelled', (taskId, cancelledBy, customerRefund, stakeholderRefund, event) => {
    handleTaskCancelled(taskId, cancelledBy, customerRefund, stakeholderRefund, event).catch(err => {
      console.error('[AnalyticsWatcher] TaskCancelled handler error:', err);
      stats.lastError = err instanceof Error ? err.message : String(err);
    });
  });

  console.log('[AnalyticsWatcher] Marketplace listeners setup');
}

function setupGovernanceListeners(): void {
  if (wsGovernance) {
    wsGovernance.removeAllListeners();
  }

  wsGovernance = new ethers.Contract(
    config.contracts.governance!,
    GOVERNANCE_ABI,
    getWsProvider()
  );

  wsGovernance.on('ProposalCreated', (proposalId, proposer, track, treasuryAmount, event) => {
    handleProposalCreated(proposalId, proposer, track, treasuryAmount, event).catch(err => {
      console.error('[AnalyticsWatcher] ProposalCreated handler error:', err);
      stats.lastError = err instanceof Error ? err.message : String(err);
    });
  });

  wsGovernance.on('VoteCastFast', (proposalId, voter, support, vpAmount, event) => {
    handleVoteCast(proposalId, voter, support, vpAmount, event).catch(err => {
      console.error('[AnalyticsWatcher] VoteCastFast handler error:', err);
      stats.lastError = err instanceof Error ? err.message : String(err);
    });
  });

  wsGovernance.on('VoteCastSlow', (proposalId, voter, support, vpAmount, _nonce, event) => {
    handleVoteCast(proposalId, voter, support, vpAmount, event).catch(err => {
      console.error('[AnalyticsWatcher] VoteCastSlow handler error:', err);
      stats.lastError = err instanceof Error ? err.message : String(err);
    });
  });

  wsGovernance.on('ProposalFinalized', (proposalId, status, event) => {
    handleProposalFinalized(proposalId, status, event).catch(err => {
      console.error('[AnalyticsWatcher] ProposalFinalized handler error:', err);
      stats.lastError = err instanceof Error ? err.message : String(err);
    });
  });

  wsGovernance.on('Deposited', (user, amount, event) => {
    handleGovernanceDeposited(user, amount, event).catch(err => {
      console.error('[AnalyticsWatcher] Governance.Deposited handler error:', err);
      stats.lastError = err instanceof Error ? err.message : String(err);
    });
  });

  wsGovernance.on('Withdrawn', (user, amount, event) => {
    handleGovernanceWithdrawn(user, amount, event).catch(err => {
      console.error('[AnalyticsWatcher] Governance.Withdrawn handler error:', err);
      stats.lastError = err instanceof Error ? err.message : String(err);
    });
  });

  console.log('[AnalyticsWatcher] Governance listeners setup');
}

function setupTreasuryListeners(): void {
  if (wsTreasury) {
    wsTreasury.removeAllListeners();
  }

  wsTreasury = new ethers.Contract(
    config.contracts.treasury!,
    TREASURY_ABI,
    getWsProvider()
  );

  wsTreasury.on('Deposited', (user, usdcIn, roseMinted, event) => {
    handleTreasuryDeposited(user, usdcIn, roseMinted, event).catch(err => {
      console.error('[AnalyticsWatcher] Treasury.Deposited handler error:', err);
      stats.lastError = err instanceof Error ? err.message : String(err);
    });
  });

  wsTreasury.on('Redeemed', (user, roseBurned, usdcOut, event) => {
    handleTreasuryRedeemed(user, roseBurned, usdcOut, event).catch(err => {
      console.error('[AnalyticsWatcher] Treasury.Redeemed handler error:', err);
      stats.lastError = err instanceof Error ? err.message : String(err);
    });
  });

  console.log('[AnalyticsWatcher] Treasury listeners setup');
}

function setupEventListeners(): void {
  setupMarketplaceListeners();
  setupGovernanceListeners();
  setupTreasuryListeners();
}

// ============================================================
// Startup Catchup
// ============================================================

async function catchUpEvents(fromBlock: number, toBlock: number): Promise<void> {
  console.log(`[AnalyticsWatcher] Catching up from block ${fromBlock} to ${toBlock}`);

  const BATCH_SIZE = 10000;

  for (let start = fromBlock; start <= toBlock; start += BATCH_SIZE) {
    const end = Math.min(start + BATCH_SIZE - 1, toBlock);
    console.log(`[AnalyticsWatcher] Processing blocks ${start} to ${end}`);

    // Marketplace events
    const marketplace = getMarketplaceContract();
    const taskCreatedEvents = await marketplace.queryFilter('TaskCreated', start, end);
    for (const event of taskCreatedEvents) {
      if ('args' in event && event.args) {
        const [taskId, customer, deposit] = event.args as unknown as [bigint, string, bigint];
        await handleTaskCreated(taskId, customer, deposit, event as ethers.EventLog);
      }
    }

    const stakeholderStakedEvents = await marketplace.queryFilter('StakeholderStaked', start, end);
    for (const event of stakeholderStakedEvents) {
      if ('args' in event && event.args) {
        const [taskId, stakeholder, deposit] = event.args as unknown as [bigint, string, bigint];
        await handleStakeholderStaked(taskId, stakeholder, deposit, event as ethers.EventLog);
      }
    }

    const taskClaimedEvents = await marketplace.queryFilter('TaskClaimed', start, end);
    for (const event of taskClaimedEvents) {
      if ('args' in event && event.args) {
        const [taskId, worker] = event.args as unknown as [bigint, string];
        await handleTaskClaimed(taskId, worker, event as ethers.EventLog);
      }
    }

    const taskCompletedEvents = await marketplace.queryFilter('TaskCompleted', start, end);
    for (const event of taskCompletedEvents) {
      if ('args' in event && event.args) {
        const [taskId, prUrl] = event.args as unknown as [bigint, string];
        await handleTaskCompleted(taskId, prUrl, event as ethers.EventLog);
      }
    }

    const taskReadyEvents = await marketplace.queryFilter('TaskReadyForPayment', start, end);
    for (const event of taskReadyEvents) {
      if ('args' in event && event.args) {
        const [taskId, worker, amount] = event.args as unknown as [bigint, string, bigint];
        await handleTaskReadyForPayment(taskId, worker, amount, event as ethers.EventLog);
      }
    }

    const taskDisputedEvents = await marketplace.queryFilter('TaskDisputed', start, end);
    for (const event of taskDisputedEvents) {
      if ('args' in event && event.args) {
        const [taskId, initiator, reasonHash, timestamp] = event.args as unknown as [bigint, string, string, bigint];
        await handleTaskDisputed(taskId, initiator, reasonHash, timestamp, event as ethers.EventLog);
      }
    }

    const taskCancelledEvents = await marketplace.queryFilter('TaskCancelled', start, end);
    for (const event of taskCancelledEvents) {
      if ('args' in event && event.args) {
        const [taskId, cancelledBy, customerRefund, stakeholderRefund] = event.args as unknown as [bigint, string, bigint, bigint];
        await handleTaskCancelled(taskId, cancelledBy, customerRefund, stakeholderRefund, event as ethers.EventLog);
      }
    }

    // Governance events
    const governance = getGovernanceContract();
    const proposalCreatedEvents = await governance.queryFilter('ProposalCreated', start, end);
    for (const event of proposalCreatedEvents) {
      if ('args' in event && event.args) {
        const [proposalId, proposer, track, treasuryAmount] = event.args as unknown as [bigint, string, number, bigint];
        await handleProposalCreated(proposalId, proposer, track, treasuryAmount, event as ethers.EventLog);
      }
    }

    const voteCastFastEvents = await governance.queryFilter('VoteCastFast', start, end);
    for (const event of voteCastFastEvents) {
      if ('args' in event && event.args) {
        const [proposalId, voter, support, vpAmount] = event.args as unknown as [bigint, string, boolean, bigint];
        await handleVoteCast(proposalId, voter, support, vpAmount, event as ethers.EventLog);
      }
    }

    const voteCastSlowEvents = await governance.queryFilter('VoteCastSlow', start, end);
    for (const event of voteCastSlowEvents) {
      if ('args' in event && event.args) {
        const [proposalId, voter, support, vpAmount] = event.args as unknown as [bigint, string, boolean, bigint];
        await handleVoteCast(proposalId, voter, support, vpAmount, event as ethers.EventLog);
      }
    }

    const proposalFinalizedEvents = await governance.queryFilter('ProposalFinalized', start, end);
    for (const event of proposalFinalizedEvents) {
      if ('args' in event && event.args) {
        const [proposalId, status] = event.args as unknown as [bigint, number];
        await handleProposalFinalized(proposalId, status, event as ethers.EventLog);
      }
    }

    const govDepositedEvents = await governance.queryFilter('Deposited', start, end);
    for (const event of govDepositedEvents) {
      if ('args' in event && event.args) {
        const [user, amount] = event.args as unknown as [string, bigint];
        await handleGovernanceDeposited(user, amount, event as ethers.EventLog);
      }
    }

    const govWithdrawnEvents = await governance.queryFilter('Withdrawn', start, end);
    for (const event of govWithdrawnEvents) {
      if ('args' in event && event.args) {
        const [user, amount] = event.args as unknown as [string, bigint];
        await handleGovernanceWithdrawn(user, amount, event as ethers.EventLog);
      }
    }

    // Treasury events
    const treasury = getTreasuryContract();
    const treasuryDepositedEvents = await treasury.queryFilter('Deposited', start, end);
    for (const event of treasuryDepositedEvents) {
      if ('args' in event && event.args) {
        const [user, usdcIn, roseMinted] = event.args as unknown as [string, bigint, bigint];
        await handleTreasuryDeposited(user, usdcIn, roseMinted, event as ethers.EventLog);
      }
    }

    const treasuryRedeemedEvents = await treasury.queryFilter('Redeemed', start, end);
    for (const event of treasuryRedeemedEvents) {
      if ('args' in event && event.args) {
        const [user, roseBurned, usdcOut] = event.args as unknown as [string, bigint, bigint];
        await handleTreasuryRedeemed(user, roseBurned, usdcOut, event as ethers.EventLog);
      }
    }
  }

  console.log('[AnalyticsWatcher] Catchup complete');
}

// ============================================================
// Public API
// ============================================================

/**
 * Start the analytics watcher
 */
export async function startAnalyticsWatcher(): Promise<void> {
  // Check configuration
  if (!config.contracts.marketplace) {
    console.log('[AnalyticsWatcher] MARKETPLACE_ADDRESS not configured, skipping');
    return;
  }
  if (!config.contracts.governance) {
    console.log('[AnalyticsWatcher] GOVERNANCE_ADDRESS not configured, skipping');
    return;
  }
  if (!config.contracts.treasury) {
    console.log('[AnalyticsWatcher] TREASURY_ADDRESS not configured, skipping');
    return;
  }
  if (!config.database.url) {
    console.log('[AnalyticsWatcher] DATABASE_URL not configured, skipping');
    return;
  }
  if (config.analyticsWatcher?.enabled === false) {
    console.log('[AnalyticsWatcher] Disabled via ANALYTICS_WATCHER_ENABLED=false');
    return;
  }

  console.log('[AnalyticsWatcher] Starting analytics watcher...');
  console.log(`[AnalyticsWatcher] Marketplace: ${config.contracts.marketplace}`);
  console.log(`[AnalyticsWatcher] Governance: ${config.contracts.governance}`);
  console.log(`[AnalyticsWatcher] Treasury: ${config.contracts.treasury}`);

  try {
    // Setup event listeners
    setupEventListeners();

    // Register reconnect handler
    reconnectHandler = () => {
      console.log('[AnalyticsWatcher] Reconnecting event listeners...');
      setupEventListeners();
    };
    onReconnect(reconnectHandler);

    stats.isRunning = true;
    stats.startedAt = new Date();

    console.log('[AnalyticsWatcher] Listening for events...');

    // Catch up on recent events
    const lookbackBlocks = config.analyticsWatcher?.startupBlockLookback ?? 50000;
    if (lookbackBlocks > 0) {
      console.log(`[AnalyticsWatcher] Catching up on last ${lookbackBlocks} blocks...`);
      const currentBlock = await getProvider().getBlockNumber();
      const fromBlock = Math.max(0, currentBlock - lookbackBlocks);
      await catchUpEvents(fromBlock, currentBlock);
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    stats.lastError = errorMsg;
    console.error('[AnalyticsWatcher] Failed to start:', error);
    throw error;
  }
}

/**
 * Stop the analytics watcher
 */
export function stopAnalyticsWatcher(): void {
  if (reconnectHandler) {
    removeReconnectCallback(reconnectHandler);
    reconnectHandler = null;
  }

  if (wsMarketplace) {
    wsMarketplace.removeAllListeners();
    wsMarketplace = null;
  }
  if (wsGovernance) {
    wsGovernance.removeAllListeners();
    wsGovernance = null;
  }
  if (wsTreasury) {
    wsTreasury.removeAllListeners();
    wsTreasury = null;
  }

  stats.isRunning = false;
  console.log('[AnalyticsWatcher] Stopped');
}

/**
 * Get analytics watcher stats
 */
export function getAnalyticsWatcherStats(): AnalyticsWatcherStats {
  return { ...stats };
}
