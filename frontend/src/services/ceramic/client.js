/**
 * Ceramic/ComposeDB client singleton
 * Provides connection to Ceramic node for decentralized profile storage
 *
 * The runtime definition is fetched from the Ceramic server at /api/definition
 * This ensures the frontend always uses the correct schema that matches the deployed composites
 */

import { ComposeClient } from '@composedb/client';

const CERAMIC_ENDPOINT = import.meta.env.VITE_CERAMIC_URL || 'https://ceramic.rose-token.com';

let composeClient = null;
let connectionError = null;
let definitionPromise = null;
let cachedDefinition = null;

/**
 * Fetch the runtime definition from the Ceramic server
 * @returns {Promise<Object>} The runtime definition
 */
async function fetchDefinition() {
  const defUrl = `${CERAMIC_ENDPOINT}/api/definition`;

  console.log('[Ceramic] Fetching runtime definition from:', defUrl);

  const response = await fetch(defUrl, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch definition: ${response.status} - ${errorText}`);
  }

  const definition = await response.json();
  console.log('[Ceramic] Runtime definition loaded successfully');
  return definition;
}

/**
 * Get or create the ComposeDB client singleton (async)
 * Fetches the runtime definition from the server on first call
 * @returns {Promise<ComposeClient|null>} ComposeDB client instance or null if unavailable
 */
export const getComposeClient = async () => {
  if (composeClient) {
    return composeClient;
  }

  try {
    // Fetch definition if not cached
    if (!cachedDefinition) {
      if (!definitionPromise) {
        definitionPromise = fetchDefinition();
      }
      cachedDefinition = await definitionPromise;
    }

    composeClient = new ComposeClient({
      ceramic: CERAMIC_ENDPOINT,
      definition: cachedDefinition,
    });
    connectionError = null;
    console.log('[Ceramic] ComposeDB client initialized');
    return composeClient;
  } catch (err) {
    console.error('[Ceramic] Failed to initialize ComposeDB client:', err);
    connectionError = err;
    definitionPromise = null; // Allow retry
    return null;
  }
};

/**
 * Get the ComposeDB client synchronously (for use after initialization)
 * Throws if client not yet initialized - use getComposeClient() first
 * @returns {ComposeClient} ComposeDB client instance
 */
export const getComposeClientSync = () => {
  if (!composeClient) {
    throw new Error('ComposeDB client not initialized. Call await getComposeClient() first.');
  }
  return composeClient;
};

/**
 * Check if the Ceramic client is available
 * Note: This is now async and will attempt to initialize the client
 * @returns {Promise<boolean>} True if client is available
 */
export const isCeramicAvailable = async () => {
  const client = await getComposeClient();
  return client !== null;
};

/**
 * Check if the client is already initialized (sync check)
 * @returns {boolean} True if client is already initialized
 */
export const isClientInitialized = () => {
  return composeClient !== null;
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
  definitionPromise = null;
  cachedDefinition = null;
};

/**
 * Set DID on the compose client for authenticated operations
 * @param {DID} did - The DID instance from did-session
 */
export const setClientDID = async (did) => {
  const client = await getComposeClient();
  if (client && did) {
    client.setDID(did);
  }
};

export default getComposeClient;
