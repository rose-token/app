import { config as dotenv } from 'dotenv';
dotenv();

export const config = {
  port: parseInt(process.env.PORT || '3000'),

  signer: {
    privateKey: process.env.SIGNER_PRIVATE_KEY || process.env.PRIVATE_KEY || '',
  },

  gitcoin: {
    scorerId: process.env.GITCOIN_SCORER_ID || '',
    apiKey: process.env.GITCOIN_API_KEY || '',
    baseUrl: 'https://api.scorer.gitcoin.co',
  },

  thresholds: {
    createTask: parseInt(process.env.THRESHOLD_CREATE_TASK || '20'),
    stake: parseInt(process.env.THRESHOLD_STAKE || '20'),
    claim: parseInt(process.env.THRESHOLD_CLAIM || '20'),
  },

  signatureTtl: parseInt(process.env.SIGNATURE_TTL || '3600'),

  allowedOrigins: (process.env.ALLOWED_ORIGINS || 'http://localhost:5173').split(','),

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'),
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '30'),
  },
};

// Validate required env vars
const required = ['SIGNER_PRIVATE_KEY', 'GITCOIN_SCORER_ID', 'GITCOIN_API_KEY'];
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
