import { config as dotenv } from 'dotenv';
dotenv();

export const config = {
  port: parseInt(process.env.PORT || '3000'),

  signer: {
    privateKey: process.env.SIGNER_PRIVATE_KEY || process.env.PRIVATE_KEY || '',
  },

  gitcoin: {
    scorerId: process.env.VITE_GITCOIN_SCORER_ID || '',
    apiKey: process.env.VITE_GITCOIN_API_KEY || '',
    baseUrl: 'https://api.passport.xyz',
  },

  thresholds: {
    createTask: parseInt(process.env.THRESHOLD_CREATE_TASK || '20'),
    stake: parseInt(process.env.THRESHOLD_STAKE || '20'),
    claim: parseInt(process.env.THRESHOLD_CLAIM || '20'),
    propose: parseInt(process.env.THRESHOLD_PROPOSE || '25'),
    vote: parseInt(process.env.THRESHOLD_VOTE || '25'),
    delegate: parseInt(process.env.THRESHOLD_DELEGATE || '25'),
  },

  signatureTtl: parseInt(process.env.SIGNATURE_TTL || '3600'),

  allowedOrigins: (process.env.ALLOWED_ORIGINS || 'http://localhost:5173').split(','),

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'),
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '1000'),
  },

  database: {
    url: process.env.DATABASE_URL || '',
    pool: {
      max: parseInt(process.env.DB_POOL_MAX || '10'),
      min: parseInt(process.env.DB_POOL_MIN || '2'),
      connectionTimeoutMs: parseInt(process.env.DB_CONNECTION_TIMEOUT_MS || '15000'),
    },
    retry: {
      maxRetries: parseInt(process.env.DB_MAX_RETRIES || '15'),
      initialDelayMs: parseInt(process.env.DB_RETRY_INITIAL_DELAY_MS || '2000'),
      maxDelayMs: parseInt(process.env.DB_RETRY_MAX_DELAY_MS || '60000'),
      startupDelayMs: parseInt(process.env.DB_STARTUP_DELAY_MS || '0'),
    },
  },

  profile: {
    chainIds: (process.env.PROFILE_CHAIN_IDS || '42161,421614')
      .split(',')
      .map((id) => parseInt(id.trim()))
      .filter((id) => !isNaN(id)),
    timestampTtl: parseInt(process.env.PROFILE_TIMESTAMP_TTL || '300'), // 5 minutes
  },

  // Blockchain RPC for reading contract data
  rpc: {
    url: process.env.RPC_URL || process.env.ARBITRUM_SEPOLIA_RPC_URL || 'https://sepolia-rollup.arbitrum.io/rpc',
  },

  // Contract addresses
  contracts: {
    governance: process.env.GOVERNANCE_ADDRESS || '',
    reputation: process.env.REPUTATION_ADDRESS || '',
    treasury: process.env.TREASURY_ADDRESS || '',
    marketplace: process.env.MARKETPLACE_ADDRESS || '',
  },

  // NAV history cron configuration
  nav: {
    cronSchedule: process.env.NAV_CRON_SCHEDULE || '0 0 * * *', // Daily at midnight UTC
    snapshotOnStartup: process.env.NAV_SNAPSHOT_ON_STARTUP !== 'false',
  },

  // Delegate scoring configuration (Phase 3)
  delegateScoring: {
    enabled: process.env.DELEGATE_SCORING_ENABLED !== 'false',
    // Minimum votes before win rate is enforced
    minVotesForWinRate: parseInt(process.env.DELEGATE_MIN_VOTES_FOR_WIN_RATE || '5'),
    // Minimum win rate threshold (0.4 = 40%)
    minWinRate: parseFloat(process.env.DELEGATE_MIN_WIN_RATE || '0.4'),
    // Whether to gate delegated vote signatures on score
    gateOnScore: process.env.DELEGATE_GATE_ON_SCORE === 'true',
  },

  // VP refresh configuration (Phase 4)
  vpRefresh: {
    // Enable automatic VP refresh on reputation changes (default: true)
    enabled: process.env.VP_REFRESH_ENABLED !== 'false',
    // Minimum VP difference (in VP decimals, 9) to trigger refresh
    // Default: 1e9 = 1 VP unit
    // Note: We only compare VP values, not reputation values directly,
    // because on-chain getReputation() uses a different formula than backend.
    minVpDifference: BigInt(process.env.VP_REFRESH_MIN_DIFFERENCE || '1000000000'),
    // Debounce time in ms - wait before processing to batch events
    debounceMs: parseInt(process.env.VP_REFRESH_DEBOUNCE_MS || '30000'),
    // Maximum users to process per batch (gas consideration)
    maxBatchSize: parseInt(process.env.VP_REFRESH_MAX_BATCH_SIZE || '10'),
    // Whether to execute on-chain refresh (default: true)
    executeOnChain: process.env.VP_REFRESH_EXECUTE !== 'false',
    // Start watching from this many blocks before current (for startup catch-up)
    startupBlockLookback: parseInt(process.env.VP_REFRESH_STARTUP_LOOKBACK || '1000'),
  },

  // Deposit watcher configuration (Phase 3 LiFi integration)
  depositWatcher: {
    // Enable deposit watching and auto-diversification (default: true)
    enabled: process.env.DEPOSIT_WATCHER_ENABLED !== 'false',
    // Debounce time in ms - wait before processing to batch deposits
    debounceMs: parseInt(process.env.DEPOSIT_WATCHER_DEBOUNCE_MS || '30000'),
    // Whether to execute swaps (default: true when enabled)
    executeSwaps: process.env.DEPOSIT_WATCHER_EXECUTE !== 'false',
    // Slippage tolerance in basis points (default: 100 = 1%)
    slippageBps: parseInt(process.env.DEPOSIT_WATCHER_SLIPPAGE_BPS || '100'),
    // Blocks to look back on startup (default: 0 - don't catch up)
    startupBlockLookback: parseInt(process.env.DEPOSIT_WATCHER_STARTUP_LOOKBACK || '0'),
  },

  // Redemption watcher configuration (On-demand liquidation)
  redemptionWatcher: {
    // Enable redemption watching and auto-fulfillment (default: true)
    enabled: process.env.REDEMPTION_WATCHER_ENABLED !== 'false',
    // Debounce time in ms - wait before processing to batch redemptions (default: 15s - faster than deposits)
    debounceMs: parseInt(process.env.REDEMPTION_WATCHER_DEBOUNCE_MS || '15000'),
    // Whether to execute swaps/fulfillments (default: true when enabled)
    executeSwaps: process.env.REDEMPTION_WATCHER_EXECUTE !== 'false',
    // Slippage tolerance in basis points for liquidation swaps (default: 150 = 1.5%)
    slippageBps: parseInt(process.env.REDEMPTION_WATCHER_SLIPPAGE_BPS || '150'),
    // Blocks to look back on startup (default: 100 - catch up on recent requests)
    startupBlockLookback: parseInt(process.env.REDEMPTION_WATCHER_STARTUP_LOOKBACK || '100'),
  },

  // GitHub Bot configuration (auto-approve and merge PRs on task completion)
  github: {
    // GitHub App ID (provided via secrets)
    appId: parseInt(process.env.MERGEBOT_APP_ID || '0'),
    // GitHub App private key (PEM format, provided via secrets)
    privateKey: (process.env.MERGEBOT_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    // Enable GitHub bot functionality (default: true)
    enabled: process.env.GITHUB_BOT_ENABLED !== 'false',
    // Blocks to look back on startup for TaskReadyForPayment events
    startupBlockLookback: parseInt(process.env.GITHUB_WATCHER_STARTUP_LOOKBACK || '100'),
  },

  // Task watcher configuration (GitHub PR auto-merge on task approval)
  taskWatcher: {
    // Enable task watcher (default: true, follows github.enabled)
    enabled: process.env.TASK_WATCHER_ENABLED !== 'false',
  },

  // Database backup configuration (Pinata Hot Swaps)
  backup: {
    // Enable backup system (default: true)
    enabled: process.env.BACKUP_ENABLED !== 'false',
    // Cron schedule (default: daily at 02:00 UTC)
    cronSchedule: process.env.BACKUP_CRON_SCHEDULE || '0 2 * * *',
    // Run backup on startup (default: false)
    backupOnStartup: process.env.BACKUP_ON_STARTUP === 'true',
    // Pinata JWT for V3 API (required for backups)
    pinataJwt: process.env.PINATA_JWT || '',
    // Pinata Backups group ID
    groupId: process.env.BACKUP_GROUP_ID || '019b0aec-e295-7e9d-8ace-fb5cd077c919',
    // Reference CID for Hot Swaps (set this after first backup)
    referenceCid: process.env.BACKUP_REFERENCE_CID || '',
  },
};

// Validate required env vars
const required = ['SIGNER_PRIVATE_KEY', 'VITE_GITCOIN_SCORER_ID', 'VITE_GITCOIN_API_KEY'];
const missing: string[] = [];

for (const key of required) {
  // Check for SIGNER_PRIVATE_KEY or PRIVATE_KEY fallback
  if (key === 'SIGNER_PRIVATE_KEY') {
    if (!process.env.SIGNER_PRIVATE_KEY && !process.env.PRIVATE_KEY) {
      missing.push('SIGNER_PRIVATE_KEY (or PRIVATE_KEY)');
    }
  } else if (!process.env[key]) {
    missing.push(key);
  }
}

if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}
