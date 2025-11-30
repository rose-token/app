/**
 * Contract addresses and configuration
 * Addresses are loaded from environment variables set during deployment
 */

// Contract addresses
export const CONTRACTS = {
  TOKEN: import.meta.env.VITE_TOKEN_ADDRESS,
  TREASURY: import.meta.env.VITE_TREASURY_ADDRESS,
  MARKETPLACE: import.meta.env.VITE_MARKETPLACE_ADDRESS,
  GOVERNANCE: import.meta.env.VITE_GOVERNANCE_ADDRESS,
  VROSE: import.meta.env.VITE_VROSE_ADDRESS,
  USDC: import.meta.env.VITE_USDC_ADDRESS,
};

// Governance constants (match contract values)
export const GOVERNANCE_CONSTANTS = {
  VOTING_PERIOD: 14 * 24 * 60 * 60, // 2 weeks in seconds
  QUORUM_THRESHOLD: 3300, // 33% in basis points
  PASS_THRESHOLD: 5833, // 7/12 = 58.33% in basis points
  MAX_EDIT_CYCLES: 4,
  COLD_START_TASKS: 10,
  DEFAULT_REPUTATION: 6000, // 60% in basis points
  PROPOSER_REP_THRESHOLD: 9000, // 90%
  VOTER_REP_THRESHOLD: 7000, // 70%
  DELEGATE_REP_THRESHOLD: 9000, // 90%
  // Reward percentages (basis points)
  YAY_VOTER_REWARD: 200, // 2%
  NAY_VOTER_REWARD: 200, // 2%
  PROPOSER_REWARD: 100, // 1%
  DAO_MINT_PERCENT: 200, // 2%
};

// Proposal status enum (matches contract)
export const ProposalStatus = {
  Active: 0,
  Passed: 1,
  Failed: 2,
  Executed: 3,
  Cancelled: 4,
};

// Status labels for display
export const ProposalStatusLabels = {
  [ProposalStatus.Active]: 'Active',
  [ProposalStatus.Passed]: 'Passed',
  [ProposalStatus.Failed]: 'Failed',
  [ProposalStatus.Executed]: 'Executed',
  [ProposalStatus.Cancelled]: 'Cancelled',
};

// Status colors for UI
export const ProposalStatusColors = {
  [ProposalStatus.Active]: 'var(--accent)',
  [ProposalStatus.Passed]: 'var(--success)',
  [ProposalStatus.Failed]: 'var(--error)',
  [ProposalStatus.Executed]: 'var(--success)',
  [ProposalStatus.Cancelled]: 'var(--text-muted)',
};

/**
 * Calculate vote power using quadratic voting formula
 * votePower = sqrt(stakedAmount) * (reputation / 100)
 * @param {bigint|string} stakedAmount - Amount of ROSE staked (in wei)
 * @param {number} reputation - Reputation score as percentage (0-100)
 * @returns {number} Vote power
 */
export const calculateVotePower = (stakedAmount, reputation) => {
  const staked = typeof stakedAmount === 'bigint' ? stakedAmount : BigInt(stakedAmount || 0);
  // Convert to number for sqrt calculation (lose precision for very large amounts)
  const stakedNumber = Number(staked) / 1e18;
  const sqrtStaked = Math.sqrt(stakedNumber);
  const repMultiplier = (reputation || 0) / 100;
  return sqrtStaked * repMultiplier;
};

/**
 * Format vote power for display
 * @param {number} votePower - Raw vote power
 * @returns {string} Formatted vote power
 */
export const formatVotePower = (votePower) => {
  if (votePower >= 1000) {
    return `${(votePower / 1000).toFixed(1)}k`;
  }
  return votePower.toFixed(2);
};
