/**
 * Ceramic/ComposeDB client singleton
 * Provides connection to Ceramic node for decentralized profile storage
 */

import { ComposeClient } from '@composedb/client';

const CERAMIC_ENDPOINT = import.meta.env.VITE_CERAMIC_URL || 'https://ceramic.rose-token.com';

// ComposeDB runtime definition - generated from schemas
// This will be imported from a generated file after running composedb compile
// For now, we define the structure based on our profile.graphql schema
const definition = {
  models: {
    RoseProfile: {
      id: 'k2t6wzhkhabz1xabnid0dl223iezkf7pdrylm2orjwzhvt0qdu3cl86dzjzu4p',
      accountRelation: { type: 'single' },
    },
  },
  objects: {
    RoseProfile: {
      displayName: { type: 'string', required: false },
      bio: { type: 'string', required: false },
      avatarUrl: { type: 'string', required: false },
      skills: { type: 'list', required: false, item: { type: 'string' } },
      website: { type: 'string', required: false },
      twitter: { type: 'string', required: false },
      github: { type: 'string', required: false },
      walletAddress: { type: 'string', required: true },
      joinedAt: { type: 'datetime', required: true },
      lastActiveAt: { type: 'datetime', required: false },
    },
  },
  enums: {},
  accountData: {
    roseProfile: { type: 'node', name: 'RoseProfile' },
  },
};

let composeClient = null;
let connectionError = null;

/**
 * Get or create the ComposeDB client singleton
 * @returns {ComposeClient|null} ComposeDB client instance or null if unavailable
 */
export const getComposeClient = () => {
  if (composeClient) {
    return composeClient;
  }

  try {
    composeClient = new ComposeClient({
      ceramic: CERAMIC_ENDPOINT,
      definition,
    });
    connectionError = null;
    return composeClient;
  } catch (err) {
    console.error('Failed to initialize ComposeDB client:', err);
    connectionError = err;
    return null;
  }
};

/**
 * Check if the Ceramic client is available
 * @returns {boolean} True if client is available
 */
export const isCeramicAvailable = () => {
  return getComposeClient() !== null;
};

/**
 * Get the last connection error
 * @returns {Error|null} The last error or null
 */
export const getConnectionError = () => connectionError;

/**
 * Get the Ceramic endpoint URL
 * @returns {string} The Ceramic endpoint URL
 */
export const getCeramicEndpoint = () => CERAMIC_ENDPOINT;

/**
 * Reset the client (useful for testing or reconnection)
 */
export const resetClient = () => {
  composeClient = null;
  connectionError = null;
};

/**
 * Set DID on the compose client for authenticated operations
 * @param {DID} did - The DID instance from did-session
 */
export const setClientDID = (did) => {
  const client = getComposeClient();
  if (client && did) {
    client.setDID(did);
  }
};

export default getComposeClient;
