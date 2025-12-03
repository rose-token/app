# Backend API Endpoints - Detailed Documentation

**Parent**: [backend.md](../../backend.md) | **Location**: `backend/signer/src/routes/`

---

## Passport Routes (`/api/passport`)

### POST /api/passport/verify

Verify passport score and get signed approval for marketplace action.

**Request**:
```json
{
  "address": "0x123...",
  "action": "createTask" | "stake" | "claim"
}
```

**Response** (200):
```json
{
  "address": "0x123...",
  "action": "createTask",
  "expiry": 1699999999,
  "signature": "0x..."
}
```

**Errors**:
- 400: Invalid address
- 403: Insufficient passport score
- 500: Failed to create signature

**Signature Format**:
```typescript
keccak256(abi.encodePacked(address, action, expiry))
// Signed with Ethereum message prefix
```

### GET /api/passport/score/:address

Get current passport score for an address.

**Response**:
```json
{
  "address": "0x123...",
  "score": 25.5
}
```

### GET /api/passport/signer

Get the signer wallet address.

**Response**:
```json
{
  "signer": "0x..."
}
```

### GET /api/passport/thresholds

Get action score thresholds.

**Response**:
```json
{
  "createTask": 20,
  "stake": 20,
  "claim": 20,
  "vote": 20,
  "propose": 25
}
```

---

## Governance Routes (`/api/governance`)

### GET /api/governance/vp/:address

Get complete VP breakdown for a user.

**Response**:
```json
{
  "stakedRose": "1000000000000000000000",
  "votingPower": "31622776601683793319",
  "availableVP": "20000000000000000000",
  "delegatedOut": "10000000000000000000",
  "proposalVPLocked": "1622776601683793319",
  "activeProposal": 1
}
```

**Note**: All values are strings (BigInt serialization).

### GET /api/governance/total-vp

Get total system voting power.

**Response**:
```json
{
  "totalVP": "500000000000000000000"
}
```

### GET /api/governance/available/:address

Get available VP (not delegated, not on proposals).

**Response**:
```json
{
  "availableVP": "20000000000000000000"
}
```

### GET /api/governance/delegations/:address

Get user's outgoing delegations.

**Response**:
```json
{
  "delegations": [
    { "delegate": "0xabc...", "vpAmount": "5000000000000000000" },
    { "delegate": "0xdef...", "vpAmount": "5000000000000000000" }
  ]
}
```

### GET /api/governance/received/:delegate

Get VP delegated to a delegate.

**Response**:
```json
{
  "delegators": [
    { "delegator": "0x123...", "vpAmount": "10000000000000000000" },
    { "delegator": "0x456...", "vpAmount": "5000000000000000000" }
  ]
}
```

### GET /api/governance/reputation/:address

Get user's reputation score.

**Response**:
```json
{
  "address": "0x123...",
  "reputation": 85
}
```

### POST /api/governance/vote-signature

Get signed approval for direct vote.

**Request**:
```json
{
  "voter": "0x123...",
  "proposalId": 1,
  "vpAmount": "10000000000000000000",
  "support": true
}
```

**Response** (200):
```json
{
  "voter": "0x123...",
  "proposalId": 1,
  "vpAmount": "10000000000000000000",
  "support": true,
  "expiry": 1699999999,
  "signature": "0x..."
}
```

**Signature Format**:
```typescript
keccak256(abi.encodePacked("vote", voter, proposalId, vpAmount, support, expiry))
```

### POST /api/governance/refresh-vp

Get signed VP refresh (after reputation change).

**Request**:
```json
{
  "user": "0x123..."
}
```

**Response**:
```json
{
  "user": "0x123...",
  "newRep": 90,
  "expiry": 1699999999,
  "signature": "0x..."
}
```

### GET /api/governance/signer

Get governance signer address.

**Response**:
```json
{
  "signer": "0x..."
}
```

---

## Delegation Routes (`/api/delegation`)

### POST /api/delegation/vote-signature

Get signed approval for delegated vote.

**Request**:
```json
{
  "delegate": "0x123...",
  "proposalId": 1,
  "amount": "10000000000000000000",
  "support": true
}
```

**Response** (200):
```json
{
  "delegate": "0x123...",
  "proposalId": 1,
  "amount": "10000000000000000000",
  "support": true,
  "allocationsHash": "0x...",
  "allocations": [
    { "delegator": "0xabc...", "powerUsed": "6000000000000000000" },
    { "delegator": "0xdef...", "powerUsed": "4000000000000000000" }
  ],
  "expiry": 1699999999,
  "signature": "0x..."
}
```

**Errors**:
- 400: Invalid inputs
- 403: Proposal is not active
- 403: Insufficient delegated VP available

**Signature Format**:
```typescript
keccak256(abi.encodePacked(
  "delegatedVote", delegate, proposalId, amount, support, allocationsHash, expiry
))
```

### GET /api/delegation/available-power/:delegate/:proposalId

Get available delegated VP for a delegate on a specific proposal.

**Response**:
```json
{
  "delegate": "0x123...",
  "proposalId": 1,
  "availablePower": "15000000000000000000"
}
```

### POST /api/delegation/claim-signature

Get signed approval for claiming voter rewards.

**Request**:
```json
{
  "user": "0x123..."
}
```

**Response** (200):
```json
{
  "claims": [
    {
      "proposalId": 1,
      "claimType": 0,
      "delegate": "0x0000000000000000000000000000000000000000",
      "votePower": "10000000000000000000"
    },
    {
      "proposalId": 2,
      "claimType": 1,
      "delegate": "0xabc...",
      "votePower": "5000000000000000000"
    }
  ],
  "expiry": 1699999999,
  "signature": "0x..."
}
```

**ClaimType Enum**:
- 0 = DirectVoter (user voted directly)
- 1 = Delegator (user's VP was used by a delegate)

### GET /api/delegation/claimable/:user

Get claimable rewards (display only, no signature).

**Response**:
```json
{
  "claims": [
    {
      "proposalId": 1,
      "claimType": 0,
      "delegate": "0x0000000000000000000000000000000000000000",
      "votePower": "10000000000000000000",
      "estimatedReward": "200000000000000000"
    }
  ],
  "totalEstimatedReward": "200000000000000000"
}
```

### GET /api/delegation/signer

Get delegation signer address.

**Response**:
```json
{
  "signer": "0x..."
}
```

---

## Profile Routes (`/api/profile`)

### POST /api/profile

Create or update profile with EIP-712 signature.

**Request**:
```json
{
  "message": {
    "address": "0x123...",
    "name": "Alice",
    "bio": "Web3 developer",
    "avatar": "https://...",
    "skills": ["solidity", "react"],
    "github": "alice",
    "twitter": "alice_web3",
    "website": "https://alice.dev",
    "timestamp": 1699999999
  },
  "signature": "0x..."
}
```

**Response** (200):
```json
{
  "success": true,
  "profile": {
    "address": "0x123...",
    "name": "Alice",
    "bio": "Web3 developer",
    "avatar": "https://...",
    "skills": ["solidity", "react"],
    "github": "alice",
    "twitter": "alice_web3",
    "website": "https://alice.dev",
    "created_at": "2023-11-15T10:00:00Z",
    "updated_at": "2023-11-15T10:00:00Z"
  }
}
```

**Validation**:
- name: 1-100 characters
- bio: max 500 characters
- avatar: max 200 characters, valid URL
- skills: max 10, valid IDs
- github/twitter: max 100 characters
- website: max 200 characters, valid URL
- timestamp: within 5 minutes

**Errors**:
- 400: Validation failed
- 401: Invalid signature
- 401: Signature expired

### GET /api/profile/:address

Get single profile.

**Response** (200):
```json
{
  "address": "0x123...",
  "name": "Alice",
  "bio": "Web3 developer",
  ...
}
```

**Response** (200, not found):
```json
null
```

### GET /api/profile?addresses=0x123,0xabc

Batch fetch profiles (max 100).

**Response**:
```json
{
  "profiles": {
    "0x123...": { "name": "Alice", ... },
    "0xabc...": null
  }
}
```

---

## Health Check

### GET /health

**Response** (200):
```json
{
  "status": "ok",
  "timestamp": "2023-11-15T10:00:00Z"
}
```

---

## Error Response Format

All errors follow this format:

```json
{
  "error": "Human-readable error message"
}
```

Common status codes:
- 400: Bad request (invalid input)
- 401: Unauthorized (invalid signature)
- 403: Forbidden (insufficient score/permissions)
- 404: Not found
- 429: Rate limited
- 500: Internal server error

---

## Rate Limiting

Default: 30 requests per minute per IP.

```typescript
const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,  // 60000ms
  max: config.rateLimit.maxRequests,    // 30
});
```

---

## CORS

Configured via `ALLOWED_ORIGINS` environment variable:

```typescript
const corsOptions = {
  origin: config.allowedOrigins,  // ['http://localhost:5173', 'https://app.rose-token.com']
  credentials: true,
};
```

---

## Signature TTL

All signatures expire after `SIGNATURE_TTL` seconds (default: 3600 = 1 hour).

```typescript
const expiry = Math.floor(Date.now() / 1000) + config.signatureTtl;
```
