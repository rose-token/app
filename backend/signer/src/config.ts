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
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '30'),
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
    treasury: process.env.TREASURY_ADDRESS || '',
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
