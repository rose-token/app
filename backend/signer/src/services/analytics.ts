/**
 * Analytics Service
 *
 * Query and aggregation functions for the analytics dashboard.
 * Data is populated by analyticsWatcher from blockchain events.
 */

import { query } from '../db/pool';

// ============================================================
// Types
// ============================================================

export interface OverviewResponse {
  marketplace: {
    totalTasks: number;
    openTasks: number;
    completedTasks: number;
    disputedTasks: number;
    totalVolumeWei: string;
  };
  governance: {
    totalProposals: number;
    activeProposals: number;
    passedProposals: number;
    totalVotes: number;
    totalStakedRose: string;
  };
  treasury: {
    rosePrice: string;
    totalAssetsUsd: string;
    circulatingRose: string;
    totalDepositsUsd: string;
    totalRedemptionsUsd: string;
  };
  users: {
    totalUsers: number;
    activeUsers30d: number;
    newUsers7d: number;
  };
  lastUpdated: string;
}

export interface MarketplaceResponse {
  summary: {
    totalTasks: number;
    byStatus: Record<string, number>;
    auctionTasks: number;
    regularTasks: number;
    totalVolumeWei: string;
    avgTaskValueWei: string;
  };
  topCustomers: Array<{
    address: string;
    tasksCreated: number;
    totalSpentWei: string;
  }>;
  topWorkers: Array<{
    address: string;
    tasksCompleted: number;
    totalEarnedWei: string;
  }>;
  recentActivity: Array<{
    taskId: number;
    status: string;
    customer: string;
    worker: string | null;
    deposit: string;
    createdAt: string;
  }>;
}

export interface GovernanceResponse {
  summary: {
    totalProposals: number;
    byTrack: { fast: number; slow: number };
    byStatus: Record<string, number>;
    totalVotes: number;
    totalVPUsed: string;
    totalStaked: string;
  };
  topVoters: Array<{
    address: string;
    votesCount: number;
    totalVPUsed: string;
  }>;
  recentProposals: Array<{
    proposalId: number;
    proposer: string;
    track: number;
    status: string;
    yayVotes: number;
    nayVotes: number;
    createdAt: string;
  }>;
}

export interface TreasuryResponse {
  current: {
    rosePrice: string;
    totalAssetsUsd: string;
    circulatingRose: string;
    allocations: {
      btc: number;
      gold: number;
      usdc: number;
      rose: number;
    };
  };
  activity: {
    totalDeposits: number;
    totalDepositsUsd: string;
    totalRedemptions: number;
    totalRedemptionsUsd: string;
    netFlowUsd: string;
  };
  history: Array<{
    date: string;
    rosePrice: string;
    totalAssetsUsd: string;
    depositsUsd: string;
    redemptionsUsd: string;
  }>;
}

export interface UsersResponse {
  summary: {
    totalUsers: number;
    activeUsers30d: number;
    activeUsers7d: number;
    newUsers7d: number;
  };
  topByActivity: Array<{
    address: string;
    tasksCreated: number;
    tasksCompleted: number;
    votesCount: number;
    totalVPUsed: string;
    lastActiveAt: string;
  }>;
  topByStake: Array<{
    address: string;
    stakedRose: string;
    votingPower: string;
  }>;
}

export interface DailyDataPoint {
  date: string;
  // Marketplace
  tasksCreated: number;
  tasksCompleted: number;
  tasksDisputed: number;
  taskVolumeWei: string;
  // Governance
  proposalsCreated: number;
  votesCast: number;
  stakesDepositedWei: string;
  stakesWithdrawnWei: string;
  // Treasury
  depositsCount: number;
  depositsUsd: string;
  redemptionsCount: number;
  redemptionsUsd: string;
  roseMinted: string;
  roseBurned: string;
  // Users
  newUsers: number;
  activeUsers: number;
}

export interface DailyResponse {
  days: number;
  data: DailyDataPoint[];
}

// ============================================================
// Query Functions
// ============================================================

/**
 * Get overview statistics for the dashboard summary cards
 */
export async function getOverviewStats(): Promise<OverviewResponse> {
  // Marketplace stats
  const marketplaceResult = await query<{
    total: string;
    open: string;
    completed: string;
    disputed: string;
    volume: string;
  }>(`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE status IN ('Created', 'Staked', 'Claimed')) as open,
      COUNT(*) FILTER (WHERE status = 'Closed' AND disputed_at IS NULL) as completed,
      COUNT(*) FILTER (WHERE disputed_at IS NOT NULL) as disputed,
      COALESCE(SUM(deposit), 0) as volume
    FROM analytics_tasks
  `);

  // Governance stats
  const governanceResult = await query<{
    total: string;
    active: string;
    passed: string;
    total_votes: string;
    total_staked: string;
  }>(`
    SELECT
      (SELECT COUNT(*) FROM analytics_proposals) as total,
      (SELECT COUNT(*) FROM analytics_proposals WHERE status = 'Active') as active,
      (SELECT COUNT(*) FROM analytics_proposals WHERE status = 'Passed') as passed,
      (SELECT COALESCE(SUM(votes_cast), 0) FROM analytics_users) as total_votes,
      (SELECT COALESCE(SUM(staked_rose), 0) FROM analytics_users) as total_staked
  `);

  // Treasury stats (latest snapshot)
  const treasuryResult = await query<{
    rose_price: string;
    total_assets: string;
    circulating: string;
    total_deposits: string;
    total_redemptions: string;
  }>(`
    SELECT
      COALESCE((SELECT rose_price_usd FROM analytics_treasury ORDER BY snapshot_date DESC LIMIT 1), 0) as rose_price,
      COALESCE((SELECT total_hard_assets_usd FROM analytics_treasury ORDER BY snapshot_date DESC LIMIT 1), 0) as total_assets,
      COALESCE((SELECT circulating_rose FROM analytics_treasury ORDER BY snapshot_date DESC LIMIT 1), 0) as circulating,
      COALESCE((SELECT SUM(deposits_usdc) FROM analytics_treasury), 0) as total_deposits,
      COALESCE((SELECT SUM(redemptions_usdc) FROM analytics_treasury), 0) as total_redemptions
  `);

  // User stats
  const userResult = await query<{
    total: string;
    active_30d: string;
    new_7d: string;
  }>(`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE last_active_at > NOW() - INTERVAL '30 days') as active_30d,
      COUNT(*) FILTER (WHERE first_seen_at > NOW() - INTERVAL '7 days') as new_7d
    FROM analytics_users
  `);

  const mp = marketplaceResult.rows[0] || { total: '0', open: '0', completed: '0', disputed: '0', volume: '0' };
  const gv = governanceResult.rows[0] || { total: '0', active: '0', passed: '0', total_votes: '0', total_staked: '0' };
  const tr = treasuryResult.rows[0] || { rose_price: '0', total_assets: '0', circulating: '0', total_deposits: '0', total_redemptions: '0' };
  const us = userResult.rows[0] || { total: '0', active_30d: '0', new_7d: '0' };

  return {
    marketplace: {
      totalTasks: parseInt(mp.total),
      openTasks: parseInt(mp.open),
      completedTasks: parseInt(mp.completed),
      disputedTasks: parseInt(mp.disputed),
      totalVolumeWei: mp.volume,
    },
    governance: {
      totalProposals: parseInt(gv.total),
      activeProposals: parseInt(gv.active),
      passedProposals: parseInt(gv.passed),
      totalVotes: parseInt(gv.total_votes),
      totalStakedRose: gv.total_staked,
    },
    treasury: {
      rosePrice: tr.rose_price,
      totalAssetsUsd: tr.total_assets,
      circulatingRose: tr.circulating,
      totalDepositsUsd: tr.total_deposits,
      totalRedemptionsUsd: tr.total_redemptions,
    },
    users: {
      totalUsers: parseInt(us.total),
      activeUsers30d: parseInt(us.active_30d),
      newUsers7d: parseInt(us.new_7d),
    },
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Get detailed marketplace statistics
 */
export async function getMarketplaceStats(): Promise<MarketplaceResponse> {
  // Summary stats
  const summaryResult = await query<{
    total: string;
    auctions: string;
    regular: string;
    volume: string;
    avg_value: string;
  }>(`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE is_auction = true) as auctions,
      COUNT(*) FILTER (WHERE is_auction = false) as regular,
      COALESCE(SUM(deposit), 0) as volume,
      COALESCE(AVG(deposit), 0) as avg_value
    FROM analytics_tasks
  `);

  // Status breakdown
  const statusResult = await query<{ status: string; count: string }>(`
    SELECT status, COUNT(*) as count
    FROM analytics_tasks
    GROUP BY status
  `);

  // Top customers
  const customersResult = await query<{
    address: string;
    tasks_created: string;
    total_spent: string;
  }>(`
    SELECT
      address,
      tasks_created,
      total_spent_wei as total_spent
    FROM analytics_users
    WHERE tasks_created > 0
    ORDER BY tasks_created DESC
    LIMIT 10
  `);

  // Top workers
  const workersResult = await query<{
    address: string;
    tasks_completed: string;
    total_earned: string;
  }>(`
    SELECT
      address,
      tasks_completed_as_worker as tasks_completed,
      total_earned_wei as total_earned
    FROM analytics_users
    WHERE tasks_completed_as_worker > 0
    ORDER BY tasks_completed_as_worker DESC
    LIMIT 10
  `);

  // Recent activity
  const recentResult = await query<{
    task_id: number;
    status: string;
    customer: string;
    worker: string | null;
    deposit: string;
    created_at: string;
  }>(`
    SELECT task_id, status, customer, worker, deposit::text, created_at::text
    FROM analytics_tasks
    ORDER BY db_updated_at DESC
    LIMIT 20
  `);

  const summary = summaryResult.rows[0] || { total: '0', auctions: '0', regular: '0', volume: '0', avg_value: '0' };
  const byStatus: Record<string, number> = {};
  for (const row of statusResult.rows) {
    byStatus[row.status] = parseInt(row.count);
  }

  return {
    summary: {
      totalTasks: parseInt(summary.total),
      byStatus,
      auctionTasks: parseInt(summary.auctions),
      regularTasks: parseInt(summary.regular),
      totalVolumeWei: summary.volume,
      avgTaskValueWei: summary.avg_value,
    },
    topCustomers: customersResult.rows.map(r => ({
      address: r.address,
      tasksCreated: parseInt(r.tasks_created),
      totalSpentWei: r.total_spent,
    })),
    topWorkers: workersResult.rows.map(r => ({
      address: r.address,
      tasksCompleted: parseInt(r.tasks_completed),
      totalEarnedWei: r.total_earned,
    })),
    recentActivity: recentResult.rows.map(r => ({
      taskId: r.task_id,
      status: r.status,
      customer: r.customer,
      worker: r.worker,
      deposit: r.deposit,
      createdAt: r.created_at,
    })),
  };
}

/**
 * Get detailed governance statistics
 */
export async function getGovernanceStats(): Promise<GovernanceResponse> {
  // Summary stats
  const summaryResult = await query<{
    total: string;
    fast: string;
    slow: string;
    total_votes: string;
    total_vp: string;
    total_staked: string;
  }>(`
    SELECT
      (SELECT COUNT(*) FROM analytics_proposals) as total,
      (SELECT COUNT(*) FROM analytics_proposals WHERE track = 0) as fast,
      (SELECT COUNT(*) FROM analytics_proposals WHERE track = 1) as slow,
      (SELECT COALESCE(SUM(votes_cast), 0) FROM analytics_users) as total_votes,
      (SELECT COALESCE(SUM(total_vp_used), 0) FROM analytics_users) as total_vp,
      (SELECT COALESCE(SUM(staked_rose), 0) FROM analytics_users) as total_staked
  `);

  // Status breakdown
  const statusResult = await query<{ status: string; count: string }>(`
    SELECT status, COUNT(*) as count
    FROM analytics_proposals
    GROUP BY status
  `);

  // Top voters
  const votersResult = await query<{
    address: string;
    votes: string;
    vp: string;
  }>(`
    SELECT
      address,
      votes_cast as votes,
      total_vp_used as vp
    FROM analytics_users
    WHERE votes_cast > 0
    ORDER BY votes_cast DESC
    LIMIT 10
  `);

  // Recent proposals
  const proposalsResult = await query<{
    proposal_id: number;
    proposer: string;
    track: number;
    status: string;
    yay_votes: number;
    nay_votes: number;
    created_at: string;
  }>(`
    SELECT
      proposal_id, proposer, track, status,
      yay_votes, nay_votes, created_at::text
    FROM analytics_proposals
    ORDER BY created_at DESC
    LIMIT 20
  `);

  const summary = summaryResult.rows[0] || { total: '0', fast: '0', slow: '0', total_votes: '0', total_vp: '0', total_staked: '0' };
  const byStatus: Record<string, number> = {};
  for (const row of statusResult.rows) {
    byStatus[row.status] = parseInt(row.count);
  }

  return {
    summary: {
      totalProposals: parseInt(summary.total),
      byTrack: {
        fast: parseInt(summary.fast),
        slow: parseInt(summary.slow),
      },
      byStatus,
      totalVotes: parseInt(summary.total_votes),
      totalVPUsed: summary.total_vp,
      totalStaked: summary.total_staked,
    },
    topVoters: votersResult.rows.map(r => ({
      address: r.address,
      votesCount: parseInt(r.votes),
      totalVPUsed: r.vp,
    })),
    recentProposals: proposalsResult.rows.map(r => ({
      proposalId: r.proposal_id,
      proposer: r.proposer,
      track: r.track,
      status: r.status,
      yayVotes: r.yay_votes,
      nayVotes: r.nay_votes,
      createdAt: r.created_at,
    })),
  };
}

/**
 * Get detailed treasury statistics
 */
export async function getTreasuryStats(): Promise<TreasuryResponse> {
  // Current snapshot
  const currentResult = await query<{
    rose_price: string;
    total_assets: string;
    circulating: string;
    btc_bps: number;
    gold_bps: number;
    usdc_bps: number;
    rose_bps: number;
  }>(`
    SELECT
      rose_price_usd as rose_price,
      total_hard_assets_usd as total_assets,
      circulating_rose as circulating,
      btc_bps, gold_bps, usdc_bps, rose_bps
    FROM analytics_treasury
    ORDER BY snapshot_date DESC
    LIMIT 1
  `);

  // Activity totals
  const activityResult = await query<{
    total_deposits: string;
    deposits_usdc: string;
    total_redemptions: string;
    redemptions_usdc: string;
  }>(`
    SELECT
      COALESCE(SUM(deposits_count), 0) as total_deposits,
      COALESCE(SUM(deposits_usdc), 0) as deposits_usdc,
      COALESCE(SUM(redemptions_count), 0) as total_redemptions,
      COALESCE(SUM(redemptions_usdc), 0) as redemptions_usdc
    FROM analytics_treasury
  `);

  // History (last 30 days)
  const historyResult = await query<{
    date: string;
    rose_price: string;
    total_assets: string;
    deposits_usdc: string;
    redemptions_usdc: string;
  }>(`
    SELECT
      snapshot_date::text as date,
      rose_price_usd as rose_price,
      total_hard_assets_usd as total_assets,
      deposits_usdc,
      redemptions_usdc
    FROM analytics_treasury
    ORDER BY snapshot_date DESC
    LIMIT 30
  `);

  const current = currentResult.rows[0] || {
    rose_price: '0', total_assets: '0', circulating: '0',
    btc_bps: 0, gold_bps: 0, usdc_bps: 0, rose_bps: 0,
  };
  const activity = activityResult.rows[0] || {
    total_deposits: '0', deposits_usdc: '0',
    total_redemptions: '0', redemptions_usdc: '0',
  };

  const depositsUsd = parseFloat(activity.deposits_usdc);
  const redemptionsUsd = parseFloat(activity.redemptions_usdc);

  return {
    current: {
      rosePrice: current.rose_price,
      totalAssetsUsd: current.total_assets,
      circulatingRose: current.circulating,
      allocations: {
        btc: current.btc_bps / 100,
        gold: current.gold_bps / 100,
        usdc: current.usdc_bps / 100,
        rose: current.rose_bps / 100,
      },
    },
    activity: {
      totalDeposits: parseInt(activity.total_deposits),
      totalDepositsUsd: activity.deposits_usdc,
      totalRedemptions: parseInt(activity.total_redemptions),
      totalRedemptionsUsd: activity.redemptions_usdc,
      netFlowUsd: (depositsUsd - redemptionsUsd).toFixed(6),
    },
    history: historyResult.rows.reverse().map(r => ({
      date: r.date,
      rosePrice: r.rose_price,
      totalAssetsUsd: r.total_assets,
      depositsUsd: r.deposits_usdc,
      redemptionsUsd: r.redemptions_usdc,
    })),
  };
}

/**
 * Get user activity statistics
 */
export async function getUserStats(): Promise<UsersResponse> {
  // Summary stats
  const summaryResult = await query<{
    total: string;
    active_30d: string;
    active_7d: string;
    new_7d: string;
  }>(`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE last_active_at > NOW() - INTERVAL '30 days') as active_30d,
      COUNT(*) FILTER (WHERE last_active_at > NOW() - INTERVAL '7 days') as active_7d,
      COUNT(*) FILTER (WHERE first_seen_at > NOW() - INTERVAL '7 days') as new_7d
    FROM analytics_users
  `);

  // Top by activity
  const activityResult = await query<{
    address: string;
    tasks_created: string;
    tasks_completed: string;
    votes: string;
    vp: string;
    last_active: string;
  }>(`
    SELECT
      address,
      tasks_created,
      tasks_completed_as_worker as tasks_completed,
      votes_cast as votes,
      total_vp_used as vp,
      last_active_at::text as last_active
    FROM analytics_users
    ORDER BY (tasks_created + tasks_completed_as_worker + votes_cast) DESC
    LIMIT 10
  `);

  // Top by stake
  const stakeResult = await query<{
    address: string;
    staked: string;
    vp: string;
  }>(`
    SELECT
      address,
      staked_rose as staked,
      voting_power as vp
    FROM analytics_users
    WHERE staked_rose > 0
    ORDER BY staked_rose DESC
    LIMIT 10
  `);

  const summary = summaryResult.rows[0] || { total: '0', active_30d: '0', active_7d: '0', new_7d: '0' };

  return {
    summary: {
      totalUsers: parseInt(summary.total),
      activeUsers30d: parseInt(summary.active_30d),
      activeUsers7d: parseInt(summary.active_7d),
      newUsers7d: parseInt(summary.new_7d),
    },
    topByActivity: activityResult.rows.map(r => ({
      address: r.address,
      tasksCreated: parseInt(r.tasks_created),
      tasksCompleted: parseInt(r.tasks_completed),
      votesCount: parseInt(r.votes),
      totalVPUsed: r.vp,
      lastActiveAt: r.last_active,
    })),
    topByStake: stakeResult.rows.map(r => ({
      address: r.address,
      stakedRose: r.staked,
      votingPower: r.vp,
    })),
  };
}

/**
 * Get daily time series data for charts
 */
export async function getDailyData(days: number): Promise<DailyResponse> {
  const result = await query<{
    date: string;
    tasks_created: number;
    tasks_completed: number;
    tasks_disputed: number;
    task_volume_wei: string;
    proposals_created: number;
    votes_cast: number;
    stakes_deposited: string;
    stakes_withdrawn: string;
    deposits_count: number;
    deposits_usdc: string;
    redemptions_count: number;
    redemptions_usdc: string;
    rose_minted: string;
    rose_burned: string;
    new_users: number;
    active_users: number;
  }>(`
    SELECT
      date::text,
      tasks_created,
      tasks_completed,
      tasks_disputed,
      task_volume_wei::text,
      proposals_created,
      votes_cast,
      stakes_deposited::text,
      stakes_withdrawn::text,
      deposits_count,
      deposits_usdc::text,
      redemptions_count,
      redemptions_usdc::text,
      rose_minted::text,
      rose_burned::text,
      new_users,
      active_users
    FROM analytics_daily
    WHERE date > NOW() - INTERVAL '1 day' * $1
    ORDER BY date ASC
  `, [days]);

  return {
    days,
    data: result.rows.map(r => ({
      date: r.date,
      tasksCreated: r.tasks_created,
      tasksCompleted: r.tasks_completed,
      tasksDisputed: r.tasks_disputed,
      taskVolumeWei: r.task_volume_wei,
      proposalsCreated: r.proposals_created,
      votesCast: r.votes_cast,
      stakesDepositedWei: r.stakes_deposited,
      stakesWithdrawnWei: r.stakes_withdrawn,
      depositsCount: r.deposits_count,
      depositsUsd: r.deposits_usdc,
      redemptionsCount: r.redemptions_count,
      redemptionsUsd: r.redemptions_usdc,
      roseMinted: r.rose_minted,
      roseBurned: r.rose_burned,
      newUsers: r.new_users,
      activeUsers: r.active_users,
    })),
  };
}
