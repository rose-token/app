# Backend Architecture

## Overview

Express API that verifies Gitcoin Passport scores and signs ECDSA approvals for marketplace/governance actions.

**Directory**: `backend/signer/`

## API Endpoints

### Passport Routes

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/passport/verify` | Verify passport & get signature |
| GET | `/api/passport/score/:address` | Get current passport score |
| GET | `/api/passport/signer` | Get signer wallet address |
| GET | `/api/passport/thresholds` | Get action thresholds |

### Governance Routes

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/governance/vp/:address` | Get VP breakdown |
| GET | `/api/governance/total-vp` | Get total system voting power |
| GET | `/api/governance/available/:address` | Get available VP |
| GET | `/api/governance/delegations/:address` | Get outgoing delegations |
| GET | `/api/governance/received/:delegate` | Get incoming delegations |
| GET | `/api/governance/reputation/:address` | Get reputation score |
| POST | `/api/governance/vote-signature` | Get direct vote signature |
| POST | `/api/governance/refresh-vp` | Get VP refresh signature |
| GET | `/api/governance/signer` | Get governance signer address |

### Delegation Routes

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/delegation/vote-signature` | Get delegated vote signature |
| GET | `/api/delegation/available-power/:delegate/:proposalId` | Get available delegated power |
| POST | `/api/delegation/claim-signature` | Get reward claim signature |
| GET | `/api/delegation/claimable/:user` | Get claimable rewards |
| GET | `/api/delegation/signer` | Get delegation signer address |

### Profile Routes

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/profile` | Create/update with EIP-712 signature |
| GET | `/api/profile/:address` | Fetch single profile |
| GET | `/api/profile?addresses=...` | Batch fetch (max 100) |

## Services

### signer.ts
```javascript
getSignerAddress()                    // Returns wallet address
signApproval(address, action, expiry) // ECDSA signature for passport
```

### gitcoin.ts
```javascript
getPassportScore(address)  // Fetch from Gitcoin API, returns 0 if not found
// Whitelist fallback for testing (hot-reloads from whitelist.json)
```

### governance.ts
```javascript
getUserVP(address)                      // Complete VP breakdown
getTotalSystemVP()                      // Total voting power
getUserDelegations(address)             // Outgoing multi-delegations
getReceivedDelegations(delegate)        // Incoming delegations
getReputation(address)                  // On-chain reputation score
calculateVotePower(amount, reputation)  // sqrt(amount) × (rep/100)
```

### delegation.ts
```javascript
computeAllocations(delegate, proposalId, amount)  // Two-pass proportional allocation
signDelegatedVote(...)                            // Sign delegated vote approval
isProposalActive(proposalId)                      // Check if voting open
getAvailableDelegatedPower(delegate, proposalId)  // Available VP per proposal
getClaimableRewards(user)                         // Query events for rewards
signClaimApproval(user, claims, expiry)           // Sign batch reward claim
```

### profile.ts
```javascript
createOrUpdateProfile(message, signature)  // Validate + UPSERT to PostgreSQL
getProfile(address)                        // Single profile fetch
getProfiles(addresses)                     // Batch fetch (max 100)
```

### eip712.ts
```javascript
verifyProfileSignature(message, signature, chainIds)  // Multi-chain verification
isTimestampValid(timestamp)                           // TTL check (5 min)
```

## Signature Formats

All signatures use ECDSA with ethers.js, Ethereum signed message prefix:

| Type | Message Format |
|------|---------------|
| Passport | `keccak256(address, action, expiry)` |
| Direct Vote | `keccak256("vote", voter, proposalId, vpAmount, support, expiry)` |
| Delegated Vote | `keccak256("delegatedVote", delegate, proposalId, amount, support, allocationsHash, expiry)` |
| Voter Rewards | `keccak256("claimVoterRewards", user, encodedClaims, expiry)` |
| VP Refresh | `keccak256("refreshVP", user, newRep, expiry)` |
| Profile (EIP-712) | Domain-separated with chainId, typed struct |

## Database Schema (PostgreSQL)

```sql
CREATE TABLE profiles (
  address VARCHAR(42) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  bio TEXT,
  avatar VARCHAR(200),
  skills TEXT[],              -- PostgreSQL array
  github VARCHAR(100),
  twitter VARCHAR(100),
  website VARCHAR(200),
  signature TEXT NOT NULL,    -- EIP-712 signature
  signed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);
```

## Scheduled Jobs

### Monthly Treasury Rebalance (`src/cron/rebalance.ts`)
- Schedule: `0 0 1 * *` (1st of month at 00:00 UTC)
- Calls: `treasury.forceRebalance()` via ethers.js
- Retry: Every 6 hours on failure, max 10 attempts
- Logs transaction hash and gas used

## Security

- CORS whitelist
- Rate limiting (30 requests/minute)
- Helmet headers
- Address validation

## Deployment

### Local Development
```bash
cd backend/signer
npm install && cp .env.example .env
npm run dev  # tsx watch mode
```

### Docker Compose
```bash
docker-compose up --build  # Port 3000
```
- PostgreSQL 16 (alpine): Port 5432, healthcheck via pg_isready
- Node.js signer: Port 3000, healthcheck via wget /health

### Akash Deployment
- Container: `ghcr.io/.../passport-signer:latest`
- Resources: 0.75 CPU, 1GB RAM, 5GB persistent storage
- Domain: signer.rose-token.com

### PostgreSQL Connection
- Pool: 2-10 connections, 30s idle timeout
- Retry: Exponential backoff, max 15 retries
- Migrations: Auto-applied on startup

## Key Files

| File | Purpose |
|------|---------|
| `src/routes/passport.ts` | Passport API handlers |
| `src/routes/delegation.ts` | Delegation API handlers |
| `src/routes/governance.ts` | Governance API handlers |
| `src/routes/profile.ts` | Profile API handlers |
| `src/services/signer.ts` | ECDSA signing |
| `src/services/delegation.ts` | Delegation computations |
| `src/services/governance.ts` | VP calculations |
| `src/services/gitcoin.ts` | Gitcoin Passport API |
| `src/services/profile.ts` | Profile CRUD |
| `src/services/eip712.ts` | EIP-712 verification |
| `src/services/whitelist.ts` | Test whitelist |
| `src/services/treasury.ts` | Treasury operations |
| `src/config.ts` | Environment config |
| `src/db/pool.ts` | PostgreSQL pool |
