const API_URL = import.meta.env.VITE_PASSPORT_SIGNER_URL || 'http://localhost:3001';

let whitelist = null;
let loadPromise = null;

/**
 * Load whitelist from backend API
 * Backend is the single source of truth for whitelist data
 */
async function loadWhitelist() {
  try {
    const response = await fetch(`${API_URL}/api/whitelist`);
    if (response.ok) {
      const data = await response.json();
      // Data comes pre-normalized from backend (lowercase addresses, no comments)
      whitelist = data;
      console.log(`Loaded whitelist with ${Object.keys(whitelist).length} addresses`);
    } else {
      console.log('Failed to load whitelist from backend');
      whitelist = {};
    }
  } catch (error) {
    console.log('No whitelist configured or backend unavailable');
    whitelist = {};
  }
}

/**
 * Get whitelisted score for an address
 * @param {string} address - Wallet address
 * @returns {Promise<number|null>} Whitelisted score or null if not whitelisted
 */
export async function getWhitelistedScore(address) {
  if (!loadPromise) {
    loadPromise = loadWhitelist();
  }
  await loadPromise;

  if (!address) return null;

  const normalized = address.toLowerCase();
  const score = whitelist?.[normalized];
  return score !== undefined ? score : null;
}

/**
 * Check if an address is whitelisted
 * @param {string} address - Wallet address
 * @returns {Promise<boolean>} True if address is in whitelist
 */
export async function isWhitelisted(address) {
  const score = await getWhitelistedScore(address);
  return score !== null;
}

/**
 * Force reload the whitelist from the backend
 */
export function reloadWhitelist() {
  loadPromise = null;
  whitelist = null;
  return loadWhitelist();
}
