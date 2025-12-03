# Backend Services - Detailed Documentation

**Parent**: [backend.md](../../backend.md) | **Location**: `backend/signer/src/services/`

---

## governance.ts

VP calculations and contract queries.

### Functions

#### getUserVP(address)

Get complete VP breakdown for a user.

```typescript
interface VPData {
  stakedRose: string;
  votingPower: string;
  availableVP: string;
  delegatedOut: string;
  proposalVPLocked: string;
  activeProposal: number;
}

async function getUserVP(address: string): Promise<VPData>
```

**Implementation**:
```typescript
const [stakedRose, votingPower, delegatedOut, proposalVPLocked, activeProposal] =
  await Promise.all([
    governance.stakedRose(address),
    governance.votingPower(address),
    governance.totalDelegatedOut(address),
    governance.proposalVPLocked(address),
    governance.allocatedToProposal(address),
  ]);

const availableVP = votingPower - delegatedOut - proposalVPLocked;
```

#### getTotalSystemVP()

Get total voting power across all users.

```typescript
async function getTotalSystemVP(): Promise<string> {
  const totalVP = await governance.totalVotingPower();
  return totalVP.toString();
}
```

#### getUserDelegations(address)

Get user's outgoing multi-delegations.

```typescript
interface DelegationInfo {
  delegate: string;
  vpAmount: string;
}

async function getUserDelegations(address: string): Promise<DelegationInfo[]> {
  const [delegates, amounts] = await governance.getUserDelegations(address);
  return delegates.map((d: string, i: number) => ({
    delegate: d,
    vpAmount: amounts[i].toString(),
  }));
}
```

#### getReceivedDelegations(delegate)

Get VP delegated TO a delegate.

```typescript
interface ReceivedDelegationInfo {
  delegator: string;
  vpAmount: string;
}

async function getReceivedDelegations(delegateAddr: string): Promise<ReceivedDelegationInfo[]> {
  // Get list of delegators
  const delegatorList: string[] = await governance.delegators(delegateAddr);

  // Get VP amounts for each
  const delegations: ReceivedDelegationInfo[] = [];
  for (const delegator of delegatorList) {
    const vpAmount = await governance.delegatedVP(delegator, delegateAddr);
    if (vpAmount > 0n) {
      delegations.push({ delegator, vpAmount: vpAmount.toString() });
    }
  }
  return delegations;
}
```

#### getReputation(address)

Get on-chain reputation score.

```typescript
async function getReputation(address: string): Promise<number> {
  const rep = await governance.getReputation(address);
  return Number(rep);  // 0-100
}
```

#### calculateVotePower(amount, reputation)

Mirror contract's VP calculation.

```typescript
function calculateVotePower(amount: bigint, reputation: number): bigint {
  if (amount === 0n || reputation === 0) return 0n;
  const sqrtAmount = sqrt(amount);
  return (sqrtAmount * BigInt(reputation)) / 100n;
}

// Babylonian square root
function sqrt(x: bigint): bigint {
  if (x === 0n) return 0n;
  let z = (x + 1n) / 2n;
  let y = x;
  while (z < y) {
    y = z;
    z = (x / z + z) / 2n;
  }
  return y;
}
```

---

## delegation.ts

Delegated voting and reward claims.

### Allocation Computation

#### getDelegatorVPAmounts(delegate)

Get all delegators and their VP amounts.

```typescript
async function getDelegatorVPAmounts(delegate: string): Promise<Map<string, bigint>> {
  const delegatorList: string[] = await contract.delegators(delegate);
  const vpMap = new Map<string, bigint>();

  await Promise.all(
    delegatorList.map(async (delegator) => {
      const vp = await contract.delegatedVP(delegator, delegate);
      if (BigInt(vp) > 0n) {
        vpMap.set(delegator, BigInt(vp));
      }
    })
  );

  return vpMap;
}
```

#### computeAllocations(delegate, proposalId, amount)

Two-pass proportional allocation algorithm.

```typescript
interface DelegationAllocation {
  delegator: string;
  powerUsed: string;
}

async function computeAllocations(
  delegate: string,
  proposalId: number,
  amount: bigint
): Promise<{ allocations: DelegationAllocation[]; allocationsHash: string }>
```

**Algorithm**:

1. **Get delegator VP map**
2. **Get already used VP per delegator for this proposal**
3. **First pass: Proportional allocation**
   ```typescript
   for (const [delegator, delegatorVP] of delegatorVPs) {
     // Proportional share based on delegator's contribution
     const proportionalShare = (amount * delegatorVP) / totalReceivedVP;

     // Check what's still available
     const availableFromDelegator = delegatorVP - alreadyUsedFromDelegator;

     // Use min of proportional share and available
     const toUse = Math.min(proportionalShare, availableFromDelegator, remainingToAllocate);
   }
   ```
4. **Second pass: Handle rounding remainder**
5. **Create deterministic hash for on-chain verification**

#### Hash Generation

```typescript
// Sort for deterministic hashing
const sortedAllocations = [...allocations].sort((a, b) =>
  a.delegator.toLowerCase().localeCompare(b.delegator.toLowerCase())
);

// Encode and hash
const allocationsHash = ethers.keccak256(
  abiCoder.encode(
    ['uint256', 'address', 'tuple(address,uint256)[]'],
    [proposalId, delegate, sortedAllocations.map(a => [a.delegator, BigInt(a.powerUsed)])]
  )
);
```

### Signing Functions

#### signDelegatedVote(...)

Sign delegated vote approval.

```typescript
async function signDelegatedVote(
  delegate: string,
  proposalId: number,
  amount: bigint,
  support: boolean,
  allocationsHash: string,
  expiry: number
): Promise<string> {
  const messageHash = ethers.solidityPackedKeccak256(
    ['string', 'address', 'uint256', 'uint256', 'bool', 'bytes32', 'uint256'],
    ['delegatedVote', delegate, proposalId, amount, support, allocationsHash, expiry]
  );

  return await wallet.signMessage(ethers.getBytes(messageHash));
}
```

### Claim Functions

#### getClaimableRewards(user)

Get all claimable voter rewards.

```typescript
interface ClaimData {
  proposalId: number;
  claimType: ClaimType;  // DirectVoter = 0, Delegator = 1
  delegate: string;
  votePower: string;
}

async function getClaimableRewards(user: string): Promise<ClaimData[]>
```

**Algorithm**:

1. **Check direct votes**:
   - Iterate all proposals with reward pools
   - Check if user voted on winning side
   - Check if not already claimed

2. **Check delegated votes**:
   - Get all delegates user has delegated to (via events)
   - For each delegate, get proposals they voted on
   - Check if user's VP was used in that vote
   - Check if not already claimed

#### signClaimApproval(user, claims, expiry)

Sign batch reward claim.

```typescript
async function signClaimApproval(
  user: string,
  claims: ClaimData[],
  expiry: number
): Promise<string> {
  const encodedClaims = abiCoder.encode(
    ['tuple(uint256,uint8,address,uint256)[]'],
    [claims.map(c => [c.proposalId, c.claimType, c.delegate, BigInt(c.votePower)])]
  );

  const messageHash = ethers.solidityPackedKeccak256(
    ['string', 'address', 'bytes', 'uint256'],
    ['claimVoterRewards', user, encodedClaims, expiry]
  );

  return await wallet.signMessage(ethers.getBytes(messageHash));
}
```

---

## gitcoin.ts

Gitcoin Passport API integration.

### getPassportScore(address)

```typescript
async function getPassportScore(address: string): Promise<number> {
  // Check whitelist first
  const whitelisted = getWhitelistedScore(address);
  if (whitelisted !== null) return whitelisted;

  // Fetch from Gitcoin API
  const response = await fetch(
    `https://api.passport.xyz/v2/stamps/${SCORER_ID}/score/${address}`,
    {
      headers: { 'X-API-KEY': API_KEY },
    }
  );

  if (!response.ok) return 0;

  const data = await response.json();
  return data.score ? parseFloat(data.score) : 0;
}
```

---

## signer.ts

ECDSA signing for passport approvals.

```typescript
const wallet = new ethers.Wallet(config.signer.privateKey);

function getSignerAddress(): string {
  return wallet.address;
}

async function signApproval(
  address: string,
  action: string,
  expiry: number
): Promise<string> {
  const messageHash = ethers.solidityPackedKeccak256(
    ['address', 'string', 'uint256'],
    [address, action, expiry]
  );

  return await wallet.signMessage(ethers.getBytes(messageHash));
}
```

---

## profile.ts

Profile CRUD with PostgreSQL.

### createOrUpdateProfile(message, signature)

```typescript
interface ProfileMessage {
  address: string;
  name: string;
  bio?: string;
  avatar?: string;
  skills?: string[];
  github?: string;
  twitter?: string;
  website?: string;
  timestamp: number;
}

async function createOrUpdateProfile(
  message: ProfileMessage,
  signature: string
): Promise<Profile> {
  // 1. Verify EIP-712 signature
  const isValid = await verifyProfileSignature(message, signature, CHAIN_IDS);
  if (!isValid) throw new Error('Invalid signature');

  // 2. Check timestamp (5 min TTL)
  if (!isTimestampValid(message.timestamp)) throw new Error('Signature expired');

  // 3. UPSERT to database
  const result = await pool.query(`
    INSERT INTO profiles (address, name, bio, avatar, skills, github, twitter, website, signature, signed_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT (address) DO UPDATE SET
      name = EXCLUDED.name,
      bio = EXCLUDED.bio,
      avatar = EXCLUDED.avatar,
      skills = EXCLUDED.skills,
      github = EXCLUDED.github,
      twitter = EXCLUDED.twitter,
      website = EXCLUDED.website,
      signature = EXCLUDED.signature,
      signed_at = EXCLUDED.signed_at,
      updated_at = NOW()
    RETURNING *
  `, [message.address, message.name, ...]);

  return result.rows[0];
}
```

---

## eip712.ts

EIP-712 typed data signature verification.

### Domain Separator

```typescript
const DOMAIN = {
  name: 'Rose Token Profile',
  version: '1',
  // chainId is verified against allowed list
};

const PROFILE_TYPES = {
  Profile: [
    { name: 'address', type: 'address' },
    { name: 'name', type: 'string' },
    { name: 'bio', type: 'string' },
    { name: 'avatar', type: 'string' },
    { name: 'skills', type: 'string[]' },
    { name: 'github', type: 'string' },
    { name: 'twitter', type: 'string' },
    { name: 'website', type: 'string' },
    { name: 'timestamp', type: 'uint256' },
  ],
};
```

### verifyProfileSignature(message, signature, chainIds)

```typescript
async function verifyProfileSignature(
  message: ProfileMessage,
  signature: string,
  chainIds: number[]
): Promise<boolean> {
  // Try each allowed chain ID
  for (const chainId of chainIds) {
    const domain = { ...DOMAIN, chainId };

    try {
      const recovered = ethers.verifyTypedData(
        domain,
        PROFILE_TYPES,
        message,
        signature
      );

      if (recovered.toLowerCase() === message.address.toLowerCase()) {
        return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}
```

### isTimestampValid(timestamp)

```typescript
function isTimestampValid(timestamp: number): boolean {
  const now = Math.floor(Date.now() / 1000);
  const ttl = config.profile.timestampTtl;  // 300 seconds (5 min)
  const clockSkew = 60;  // 1 minute tolerance

  return timestamp >= now - ttl && timestamp <= now + clockSkew;
}
```

---

## whitelist.ts

Test whitelist with hot-reload.

```typescript
// whitelist.json hot-reloads on file change
const whitelist: Record<string, number> = {};

fs.watch('src/config/whitelist.json', () => {
  reloadWhitelist();
});

function getWhitelistedScore(address: string): number | null {
  return whitelist[address.toLowerCase()] ?? null;
}
```

**whitelist.json format**:
```json
{
  "0x123...": 50,
  "0xabc...": 25
}
```

---

## treasury.ts

Treasury rebalance operations.

```typescript
async function executeRebalance(): Promise<{ hash: string; gasUsed: bigint }> {
  const treasury = new ethers.Contract(TREASURY_ADDRESS, TREASURY_ABI, wallet);

  const tx = await treasury.forceRebalance();
  const receipt = await tx.wait();

  return {
    hash: receipt.hash,
    gasUsed: receipt.gasUsed,
  };
}
```

Used by the monthly cron job (`src/cron/rebalance.ts`):
- Schedule: `0 0 1 * *` (1st of month at midnight UTC)
- Retry: Every 6 hours on failure, max 10 attempts
