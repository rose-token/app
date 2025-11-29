/**
 * Profile cache for efficient lookups
 * Uses in-memory Map with TTL for other users' profiles
 * and localStorage for own profile
 */

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes for other users
const OWN_PROFILE_CACHE_KEY = 'rose_own_profile';
const OWN_PROFILE_TTL_MS = 30 * 60 * 1000; // 30 minutes for own profile

// In-memory cache for other users' profiles
const profileCache = new Map();

/**
 * Cache entry structure
 * @typedef {Object} CacheEntry
 * @property {Object} profile - Profile data
 * @property {string} streamId - Document stream ID
 * @property {number} fetchedAt - Timestamp when fetched
 */

/**
 * Get profile from cache
 * @param {string} address - Ethereum address
 * @returns {Object|null} Cached profile or null if not found/expired
 */
export const getCachedProfile = (address) => {
  const key = address.toLowerCase();
  const entry = profileCache.get(key);

  if (!entry) {
    return null;
  }

  const isExpired = Date.now() - entry.fetchedAt > CACHE_TTL_MS;

  if (isExpired) {
    profileCache.delete(key);
    return null;
  }

  return entry.profile;
};

/**
 * Set profile in cache
 * @param {string} address - Ethereum address
 * @param {Object} profile - Profile data
 */
export const setCachedProfile = (address, profile) => {
  const key = address.toLowerCase();

  profileCache.set(key, {
    profile,
    streamId: profile?.streamId,
    fetchedAt: Date.now(),
  });
};

/**
 * Invalidate cached profile
 * @param {string} address - Ethereum address
 */
export const invalidateCache = (address) => {
  const key = address.toLowerCase();
  profileCache.delete(key);
};

/**
 * Clear all cached profiles
 */
export const clearAllCache = () => {
  profileCache.clear();
};

/**
 * Get cache size
 * @returns {number} Number of cached profiles
 */
export const getCacheSize = () => {
  return profileCache.size;
};

// Own profile cache (localStorage)

/**
 * Get own profile from localStorage cache
 * @param {string} address - Ethereum address
 * @returns {Object|null} Cached own profile or null if not found/expired
 */
export const getCachedOwnProfile = (address) => {
  try {
    const key = `${OWN_PROFILE_CACHE_KEY}_${address.toLowerCase()}`;
    const stored = localStorage.getItem(key);

    if (!stored) {
      return null;
    }

    const { profile, fetchedAt } = JSON.parse(stored);
    const isExpired = Date.now() - fetchedAt > OWN_PROFILE_TTL_MS;

    if (isExpired) {
      localStorage.removeItem(key);
      return null;
    }

    return profile;
  } catch (err) {
    console.error('Error reading own profile cache:', err);
    return null;
  }
};

/**
 * Set own profile in localStorage cache
 * @param {string} address - Ethereum address
 * @param {Object} profile - Profile data
 */
export const setCachedOwnProfile = (address, profile) => {
  try {
    const key = `${OWN_PROFILE_CACHE_KEY}_${address.toLowerCase()}`;

    localStorage.setItem(key, JSON.stringify({
      profile,
      fetchedAt: Date.now(),
    }));

    // Also update in-memory cache
    setCachedProfile(address, profile);
  } catch (err) {
    console.error('Error caching own profile:', err);
  }
};

/**
 * Invalidate own profile cache
 * @param {string} address - Ethereum address
 */
export const invalidateOwnProfileCache = (address) => {
  try {
    const key = `${OWN_PROFILE_CACHE_KEY}_${address.toLowerCase()}`;
    localStorage.removeItem(key);
    invalidateCache(address);
  } catch (err) {
    console.error('Error invalidating own profile cache:', err);
  }
};

/**
 * Batch get profiles from cache
 * @param {string[]} addresses - Array of Ethereum addresses
 * @returns {Map<string, Object|null>} Map of address to profile (null if not cached)
 */
export const getBatchCachedProfiles = (addresses) => {
  const result = new Map();

  addresses.forEach((address) => {
    result.set(address.toLowerCase(), getCachedProfile(address));
  });

  return result;
};

/**
 * Get addresses that are not in cache
 * @param {string[]} addresses - Array of Ethereum addresses
 * @returns {string[]} Addresses not in cache
 */
export const getMissingFromCache = (addresses) => {
  return addresses.filter((address) => getCachedProfile(address) === null);
};
