# Frontend Constants - Detailed Documentation

**Parent**: [frontend.md](../../frontend.md) | **Location**: `frontend/src/constants/`

---

## contracts.js

Contract addresses and governance utilities.

### Contract Addresses

```javascript
export const CONTRACTS = {
  TOKEN: import.meta.env.VITE_TOKEN_ADDRESS,
  TREASURY: import.meta.env.VITE_TREASURY_ADDRESS,
  MARKETPLACE: import.meta.env.VITE_MARKETPLACE_ADDRESS,
  GOVERNANCE: import.meta.env.VITE_GOVERNANCE_ADDRESS,
  VROSE: import.meta.env.VITE_VROSE_ADDRESS,
  USDC: import.meta.env.VITE_USDC_ADDRESS,
};
```

### Governance Constants

```javascript
export const GOVERNANCE_CONSTANTS = {
  VOTING_PERIOD: 14 * 24 * 60 * 60,  // 2 weeks in seconds
  QUORUM_THRESHOLD: 3300,             // 33% in basis points
  PASS_THRESHOLD: 5833,               // 7/12 = 58.33% in basis points
  MAX_EDIT_CYCLES: 4,
  COLD_START_TASKS: 10,
  DEFAULT_REPUTATION: 6000,           // 60% in basis points
  PROPOSER_REP_THRESHOLD: 9000,       // 90%
  VOTER_REP_THRESHOLD: 7000,          // 70%
  DELEGATE_REP_THRESHOLD: 9000,       // 90%
  // Reward percentages (basis points)
  YAY_VOTER_REWARD: 200,              // 2%
  NAY_VOTER_REWARD: 200,              // 2%
  PROPOSER_REWARD: 100,               // 1%
  DAO_MINT_PERCENT: 200,              // 2%
};
```

### Proposal Status Enum

```javascript
export const ProposalStatus = {
  Active: 0,
  Passed: 1,
  Failed: 2,
  Executed: 3,
  Cancelled: 4,
};

export const ProposalStatusLabels = {
  [ProposalStatus.Active]: 'Active',
  [ProposalStatus.Passed]: 'Passed',
  [ProposalStatus.Failed]: 'Failed',
  [ProposalStatus.Executed]: 'Executed',
  [ProposalStatus.Cancelled]: 'Cancelled',
};

export const ProposalStatusColors = {
  [ProposalStatus.Active]: 'var(--accent)',
  [ProposalStatus.Passed]: 'var(--success)',
  [ProposalStatus.Failed]: 'var(--error)',
  [ProposalStatus.Executed]: 'var(--success)',
  [ProposalStatus.Cancelled]: 'var(--text-muted)',
};
```

### Vote Power Calculation

```javascript
/**
 * Calculate vote power using quadratic voting formula
 * votePower = sqrt(stakedAmount) * (reputation / 100)
 * @param {bigint|string} stakedAmount - Amount of ROSE staked (in wei)
 * @param {number} reputation - Reputation score as percentage (0-100)
 * @returns {number} Vote power
 */
export const calculateVotePower = (stakedAmount, reputation) => {
  const staked = typeof stakedAmount === 'bigint' ? stakedAmount : BigInt(stakedAmount || 0);
  // Convert to number for sqrt calculation
  const stakedNumber = Number(staked) / 1e18;
  const sqrtStaked = Math.sqrt(stakedNumber);
  const repMultiplier = (reputation || 0) / 100;
  return sqrtStaked * repMultiplier;
};

/**
 * Format vote power for display
 * @param {number} votePower - Raw vote power
 * @returns {string} Formatted vote power (e.g., "1.2k")
 */
export const formatVotePower = (votePower) => {
  if (votePower >= 1000) {
    return `${(votePower / 1000).toFixed(1)}k`;
  }
  return votePower.toFixed(2);
};
```

---

## passport.js

Gitcoin Passport configuration.

### Thresholds

```javascript
export const PASSPORT_THRESHOLDS = {
  CREATE_TASK: 20,   // Min score to create tasks
  STAKE: 20,         // Min score to stake as stakeholder
  CLAIM_TASK: 20,    // Min score to claim tasks
  PROPOSE: 25,       // Min score to create governance proposals
};
```

### Configuration

```javascript
export const PASSPORT_CONFIG = {
  API_URL: 'https://api.passport.xyz/v2/stamps',
  CACHE_TTL_MS: 60 * 60 * 1000,  // 1 hour cache
  API_TIMEOUT_MS: 10000,          // 10 second timeout
  CACHE_KEY_PREFIX: 'gitcoin_passport_cache',
};
```

### Passport Levels

```javascript
export const PASSPORT_LEVELS = {
  HIGH: { min: 30, label: 'Verified', color: 'var(--success, #10b981)' },
  MEDIUM: { min: 20, label: 'Basic', color: 'var(--warning, #f59e0b)' },
  LOW: { min: 1, label: 'Low', color: 'var(--error, #ef4444)' },
  NONE: { min: 0, label: 'Not Verified', color: 'var(--text-muted, #6b7280)' },
};

/**
 * Get the passport level for a given score
 */
export const getPassportLevel = (score) => {
  if (score >= PASSPORT_LEVELS.HIGH.min) return PASSPORT_LEVELS.HIGH;
  if (score >= PASSPORT_LEVELS.MEDIUM.min) return PASSPORT_LEVELS.MEDIUM;
  if (score >= PASSPORT_LEVELS.LOW.min) return PASSPORT_LEVELS.LOW;
  return PASSPORT_LEVELS.NONE;
};
```

---

## skills.js

Profile skills configuration.

### Skills List

```javascript
export const SKILLS = [
  // Blockchain
  { id: 'solidity', label: 'Solidity', category: 'blockchain' },
  { id: 'rust', label: 'Rust', category: 'blockchain' },
  { id: 'smart-contracts', label: 'Smart Contracts', category: 'blockchain' },
  { id: 'security', label: 'Security Auditing', category: 'blockchain' },

  // Frontend
  { id: 'typescript', label: 'TypeScript', category: 'frontend' },
  { id: 'react', label: 'React', category: 'frontend' },
  { id: 'frontend', label: 'Frontend Development', category: 'frontend' },

  // Backend
  { id: 'node', label: 'Node.js', category: 'backend' },
  { id: 'python', label: 'Python', category: 'backend' },
  { id: 'backend', label: 'Backend Development', category: 'backend' },
  { id: 'data', label: 'Data Engineering', category: 'backend' },

  // Other
  { id: 'design', label: 'UI/UX Design', category: 'design' },
  { id: 'devops', label: 'DevOps', category: 'infrastructure' },
  { id: 'testing', label: 'Testing/QA', category: 'quality' },
  { id: 'documentation', label: 'Documentation', category: 'quality' },
];
```

### Category Configuration

```javascript
export const SKILL_CATEGORIES = {
  blockchain: { label: 'Blockchain', color: 'var(--rose-pink)' },
  frontend: { label: 'Frontend', color: 'var(--info)' },
  backend: { label: 'Backend', color: 'var(--success)' },
  design: { label: 'Design', color: 'var(--warning)' },
  infrastructure: { label: 'Infrastructure', color: 'var(--rose-gold)' },
  quality: { label: 'Quality', color: 'var(--text-secondary)' },
};

export const MAX_SKILLS = 10;
```

### Utility Functions

```javascript
/**
 * Get a skill by its ID
 */
export const getSkillById = (id) => SKILLS.find((s) => s.id === id);

/**
 * Get multiple skills by their IDs
 */
export const getSkillsByIds = (ids) => ids.map(getSkillById).filter(Boolean);

/**
 * Get skills grouped by category
 */
export const getSkillsByCategory = () => {
  return SKILLS.reduce((acc, skill) => {
    if (!acc[skill.category]) {
      acc[skill.category] = [];
    }
    acc[skill.category].push(skill);
    return acc;
  }, {});
};

/**
 * Validate skill IDs array
 */
export const validateSkills = (ids) => {
  if (!Array.isArray(ids)) return false;
  if (ids.length > MAX_SKILLS) return false;
  return ids.every((id) => getSkillById(id) !== undefined);
};
```

---

## gas.js

Default gas settings for transactions.

```javascript
import { parseGwei } from 'viem';

export const GAS_SETTINGS = {
  gas: 500_000n,                        // Gas limit
  maxFeePerGas: parseGwei('0.1'),       // 0.1 gwei
  maxPriorityFeePerGas: parseGwei('0.01'), // 0.01 gwei
};
```

**Usage**:

```javascript
const hash = await writeContractAsync({
  address: CONTRACTS.GOVERNANCE,
  abi: RoseGovernanceABI,
  functionName: 'deposit',
  args: [amountWei],
  ...GAS_SETTINGS,
});
```

**Note**: These are Arbitrum-optimized values. L2s have much lower gas costs than mainnet.

---

## networks.js

Network configuration.

```javascript
export const NETWORK_IDS = {
  ARBITRUM: 42161,
  ARBITRUM_SEPOLIA: 421614,
};

export const DEFAULT_NETWORK = NETWORK_IDS.ARBITRUM_SEPOLIA;

export const NETWORKS = {
  [NETWORK_IDS.ARBITRUM]: {
    name: 'Arbitrum One',
    explorer: 'https://arbiscan.io',
    rpc: 'https://arb1.arbitrum.io/rpc',
  },
  [NETWORK_IDS.ARBITRUM_SEPOLIA]: {
    name: 'Arbitrum Sepolia',
    explorer: 'https://sepolia.arbiscan.io',
    rpc: 'https://sepolia-rollup.arbitrum.io/rpc',
  },
};
```

---

## Token Decimals Reference

Used throughout the frontend for formatting:

| Token | Decimals | formatUnits Usage |
|-------|----------|-------------------|
| ROSE | 18 | `formatUnits(value, 18)` |
| vROSE | 18 | `formatUnits(value, 18)` |
| USDC | 6 | `formatUnits(value, 6)` |
| Prices | 6 | `formatUnits(value, 6)` |
| VP | 18 | `formatUnits(value, 18)` |

**Chainlink feeds return 8 decimals, Treasury normalizes to 6.**
