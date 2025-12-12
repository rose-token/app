/**
 * Gitcoin Passport configuration and thresholds
 * Used for sybil resistance in marketplace actions
 */

export const PASSPORT_THRESHOLDS = {
  CREATE_TASK: 20,
  STAKE: 20,
  CLAIM_TASK: 20,
  PROPOSE: 25,
  DEPOSIT: 20,
  REDEEM: 20,
};

export const PASSPORT_CONFIG = {
  API_URL: 'https://api.passport.xyz/v2/stamps',
  CACHE_TTL_MS: 60 * 60 * 1000, // 1 hour
  API_TIMEOUT_MS: 10000, // 10 seconds
  CACHE_KEY_PREFIX: 'gitcoin_passport_cache',
};

export const PASSPORT_LEVELS = {
  HIGH: { min: 30, label: 'Verified', color: 'var(--success, #10b981)' },
  MEDIUM: { min: 20, label: 'Basic', color: 'var(--warning, #f59e0b)' },
  LOW: { min: 1, label: 'Low', color: 'var(--error, #ef4444)' },
  NONE: { min: 0, label: 'Not Verified', color: 'var(--text-muted, #6b7280)' },
};

/**
 * Get the passport level for a given score
 * @param {number} score - The passport score
 * @returns {Object} The level object with min, label, and color
 */
export const getPassportLevel = (score) => {
  if (score >= PASSPORT_LEVELS.HIGH.min) return PASSPORT_LEVELS.HIGH;
  if (score >= PASSPORT_LEVELS.MEDIUM.min) return PASSPORT_LEVELS.MEDIUM;
  if (score >= PASSPORT_LEVELS.LOW.min) return PASSPORT_LEVELS.LOW;
  return PASSPORT_LEVELS.NONE;
};
