/**
 * DID Session management for Ceramic authentication
 * Uses did:pkh (PKH = Public Key Hash) derived from Ethereum wallet
 */

import { DIDSession } from 'did-session';
import { EthereumWebAuth, getAccountId } from '@didtools/pkh-ethereum';
import { getComposeClient, setClientDID } from './client';

const SESSION_KEY_PREFIX = 'rose_ceramic_session';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Get the localStorage key for a session
 * @param {string} address - Ethereum address
 * @returns {string} localStorage key
 */
const getSessionKey = (address) => {
  return `${SESSION_KEY_PREFIX}_${address.toLowerCase()}`;
};

/**
 * Save session to localStorage
 * @param {string} address - Ethereum address
 * @param {DIDSession} session - DID session to save
 */
export const saveSession = (address, session) => {
  try {
    const serialized = session.serialize();
    localStorage.setItem(getSessionKey(address), JSON.stringify({
      session: serialized,
      timestamp: Date.now(),
    }));
  } catch (err) {
    console.error('Failed to save Ceramic session:', err);
  }
};

/**
 * Load session from localStorage
 * @param {string} address - Ethereum address
 * @returns {Object|null} Stored session data or null
 */
export const loadStoredSession = (address) => {
  try {
    const stored = localStorage.getItem(getSessionKey(address));
    if (!stored) return null;

    const { session, timestamp } = JSON.parse(stored);
    const isExpired = Date.now() - timestamp > SESSION_TTL_MS;

    return { session, timestamp, isExpired };
  } catch (err) {
    console.error('Failed to load stored session:', err);
    return null;
  }
};

/**
 * Clear session from localStorage
 * @param {string} address - Ethereum address
 */
export const clearSession = (address) => {
  try {
    localStorage.removeItem(getSessionKey(address));
  } catch (err) {
    console.error('Failed to clear session:', err);
  }
};

/**
 * Check if a session is still valid
 * @param {DIDSession} session - DID session to check
 * @returns {boolean} True if session is valid and not expired
 */
export const isSessionValid = (session) => {
  if (!session) return false;

  try {
    // Check if session has expired
    if (session.hasSession && !session.isExpired) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
};

/**
 * Restore a session from stored serialized data
 * @param {string} serializedSession - Serialized session string
 * @returns {Promise<DIDSession|null>} Restored session or null
 */
export const restoreSession = async (serializedSession) => {
  try {
    const session = await DIDSession.fromSession(serializedSession);

    if (!isSessionValid(session)) {
      return null;
    }

    // Set DID on compose client
    setClientDID(session.did);

    return session;
  } catch (err) {
    console.error('Failed to restore session:', err);
    return null;
  }
};

/**
 * Create a new DID session using wallet signature
 * @param {Object} walletClient - Wagmi wallet client (from useWalletClient)
 * @param {string} address - Ethereum address
 * @param {number} chainId - Chain ID (default: 1 for mainnet)
 * @returns {Promise<DIDSession>} New DID session
 */
export const createSession = async (walletClient, address, chainId = 1) => {
  if (!walletClient || !address) {
    throw new Error('Wallet client and address are required');
  }

  const composeClient = getComposeClient();
  if (!composeClient) {
    throw new Error('Ceramic client not available');
  }

  try {
    // Get account ID for did:pkh format
    const accountId = await getAccountId(walletClient, address);

    // Create auth method that will sign messages with the wallet
    const authMethod = await EthereumWebAuth.getAuthMethod(walletClient, accountId);

    // Create session with 24-hour expiry
    // Resources specify what the session can access
    const session = await DIDSession.authorize(authMethod, {
      resources: composeClient.resources,
      expiresInSecs: 24 * 60 * 60, // 24 hours
    });

    // Set DID on compose client
    setClientDID(session.did);

    // Save session to localStorage
    saveSession(address, session);

    return session;
  } catch (err) {
    console.error('Failed to create DID session:', err);
    throw err;
  }
};

/**
 * Get or create a session for an address
 * @param {Object} walletClient - Wagmi wallet client
 * @param {string} address - Ethereum address
 * @param {number} chainId - Chain ID
 * @param {boolean} forceNew - Force creation of new session
 * @returns {Promise<DIDSession>} DID session
 */
export const getOrCreateSession = async (walletClient, address, chainId = 1, forceNew = false) => {
  // Try to restore existing session unless forcing new
  if (!forceNew) {
    const stored = loadStoredSession(address);

    if (stored && !stored.isExpired) {
      const restored = await restoreSession(stored.session);
      if (restored) {
        return restored;
      }
    }
  }

  // Create new session
  return createSession(walletClient, address, chainId);
};

/**
 * Get the DID string for an address
 * @param {string} address - Ethereum address
 * @param {number} chainId - Chain ID (default: 1)
 * @returns {string} DID string in did:pkh format
 */
export const getDIDForAddress = (address, chainId = 1) => {
  return `did:pkh:eip155:${chainId}:${address.toLowerCase()}`;
};
