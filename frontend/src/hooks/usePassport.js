import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAccount } from 'wagmi';
import { PASSPORT_CONFIG } from '../constants/passport';

const PassportContext = createContext();

const SCORER_ID = import.meta.env.VITE_GITCOIN_SCORER_ID;
const API_KEY = import.meta.env.VITE_GITCOIN_API_KEY;

/**
 * Get cached passport score from localStorage
 * @param {string} address - Wallet address
 * @returns {Object|null} Cached data with score and timestamp, or null if expired/missing
 */
const getCachedScore = (address) => {
  if (!address) return null;

  try {
    const cached = localStorage.getItem(`${PASSPORT_CONFIG.CACHE_KEY_PREFIX}_${address.toLowerCase()}`);
    if (!cached) return null;

    const { score, timestamp } = JSON.parse(cached);
    const isExpired = Date.now() - timestamp > PASSPORT_CONFIG.CACHE_TTL_MS;

    if (isExpired) {
      return { score, timestamp, isStale: true };
    }

    return { score, timestamp, isStale: false };
  } catch (err) {
    console.error('Error reading passport cache:', err);
    return null;
  }
};

/**
 * Save passport score to localStorage
 * @param {string} address - Wallet address
 * @param {number} score - Passport score
 */
const cacheScore = (address, score) => {
  if (!address) return;

  try {
    localStorage.setItem(
      `${PASSPORT_CONFIG.CACHE_KEY_PREFIX}_${address.toLowerCase()}`,
      JSON.stringify({ score, timestamp: Date.now() })
    );
  } catch (err) {
    console.error('Error caching passport score:', err);
  }
};

/**
 * Fetch passport score from Gitcoin Scorer API
 * @param {string} address - Wallet address
 * @returns {Promise<number>} Passport score
 */
const fetchPassportScore = async (address) => {
  if (!SCORER_ID || !API_KEY) {
    throw new Error('Gitcoin Passport API not configured');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PASSPORT_CONFIG.API_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${PASSPORT_CONFIG.API_URL}/${SCORER_ID}/score/${address}`,
      {
        headers: {
          'X-API-KEY': API_KEY,
        },
        signal: controller.signal,
      }
    );

    if (response.status === 401 || response.status === 403) {
      throw new Error('Passport API authentication failed');
    }

    if (response.status === 429) {
      throw new Error('Rate limited');
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    // Handle case where address is not registered
    if (!data.score && data.status !== 'DONE') {
      return 0;
    }

    return data.score ? parseFloat(data.score) : 0;
  } finally {
    clearTimeout(timeoutId);
  }
};

export const PassportProvider = ({ children }) => {
  const { address, isConnected } = useAccount();
  const [state, setState] = useState({
    score: null,
    loading: false,
    error: null,
    lastUpdated: null,
    isCached: false,
  });

  /**
   * Load passport score (from cache or API)
   */
  const loadScore = useCallback(async (forceRefresh = false) => {
    if (!address || !isConnected) {
      setState({
        score: null,
        loading: false,
        error: null,
        lastUpdated: null,
        isCached: false,
      });
      return;
    }

    // Check cache first (unless forcing refresh)
    if (!forceRefresh) {
      const cached = getCachedScore(address);
      if (cached && !cached.isStale) {
        setState({
          score: cached.score,
          loading: false,
          error: null,
          lastUpdated: new Date(cached.timestamp),
          isCached: true,
        });
        return;
      }
    }

    // Fetch from API
    setState(prev => ({ ...prev, loading: true, error: null }));

    try {
      const score = await fetchPassportScore(address);
      cacheScore(address, score);

      setState({
        score,
        loading: false,
        error: null,
        lastUpdated: new Date(),
        isCached: false,
      });
    } catch (err) {
      console.error('Error fetching passport score:', err);

      // On error, try to use stale cache
      const staleCache = getCachedScore(address);
      if (staleCache) {
        setState({
          score: staleCache.score,
          loading: false,
          error: err.name === 'AbortError' ? 'Request timed out' : err.message,
          lastUpdated: new Date(staleCache.timestamp),
          isCached: true,
        });
      } else {
        setState(prev => ({
          ...prev,
          loading: false,
          error: err.name === 'AbortError' ? 'Request timed out' : err.message,
        }));
      }
    }
  }, [address, isConnected]);

  // Load score when address changes
  useEffect(() => {
    loadScore();
  }, [loadScore]);

  /**
   * Manual refresh function
   */
  const refetch = useCallback(() => {
    return loadScore(true);
  }, [loadScore]);

  /**
   * Check if score meets a threshold
   * @param {number} threshold - Minimum required score
   * @returns {boolean} True if score meets or exceeds threshold
   */
  const meetsThreshold = useCallback((threshold) => {
    return state.score !== null && state.score >= threshold;
  }, [state.score]);

  const value = {
    score: state.score,
    loading: state.loading,
    error: state.error,
    lastUpdated: state.lastUpdated,
    isCached: state.isCached,
    refetch,
    meetsThreshold,
    isConfigured: Boolean(SCORER_ID && API_KEY),
  };

  return (
    <PassportContext.Provider value={value}>
      {children}
    </PassportContext.Provider>
  );
};

export const usePassport = () => {
  const context = useContext(PassportContext);
  if (!context) {
    throw new Error('usePassport must be used within a PassportProvider');
  }
  return context;
};
