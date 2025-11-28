let whitelist = null;
let loadPromise = null;

async function loadWhitelist() {
  try {
    const response = await fetch('/config/whitelist.json');
    if (response.ok) {
      const data = await response.json();
      // Normalize addresses to lowercase, filter out comments
      whitelist = Object.fromEntries(
        Object.entries(data)
          .filter(([key]) => !key.startsWith('_'))
          .map(([addr, score]) => [addr.toLowerCase(), score])
      );
      console.log(`Loaded whitelist with ${Object.keys(whitelist).length} addresses`);
    } else {
      whitelist = {};
    }
  } catch (error) {
    console.log('No whitelist configured');
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
 * Force reload the whitelist from the server
 */
export function reloadWhitelist() {
  loadPromise = null;
  whitelist = null;
  return loadWhitelist();
}
