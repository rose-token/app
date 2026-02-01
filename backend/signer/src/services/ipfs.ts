/**
 * IPFS Upload Service
 *
 * Uploads text content (task descriptions, dispute reasons, etc.) to IPFS via Pinata.
 * Returns the CID for on-chain reference.
 */

import { PinataSDK } from 'pinata';
import { config } from '../config';

const PINATA_GATEWAY = config.backup.pinataGateway || 'https://coffee-glad-felidae-720.mypinata.cloud';

let pinataInstance: PinataSDK | null = null;

function getPinata(): PinataSDK {
  if (!pinataInstance) {
    const jwt = config.backup.pinataJwt;
    if (!jwt) {
      throw new Error('PINATA_JWT not configured — cannot upload to IPFS');
    }
    pinataInstance = new PinataSDK({
      pinataJwt: jwt,
      pinataGateway: new URL(PINATA_GATEWAY).hostname,
    });
  }
  return pinataInstance;
}

/**
 * Upload text content to IPFS and return the CID.
 *
 * @param content - Text content to upload
 * @param name - Optional name/label for the pin (for Pinata dashboard)
 * @returns IPFS CID string
 */
export async function uploadToIPFS(content: string, name?: string): Promise<string> {
  const pinata = getPinata();

  // Upload as a private JSON object with the description
  const result = await pinata.upload.private.json({
    content,
    timestamp: new Date().toISOString(),
  }, {
    metadata: {
      name: name || 'rose-token-description',
    },
  });

  return result.cid;
}

/**
 * Fetch content from IPFS by CID via the Pinata private gateway.
 * Returns the text content or null on failure.
 */
export async function fetchFromIPFS(cid: string): Promise<string | null> {
  if (!cid || !isIPFSConfigured()) return null;

  try {
    const pinata = getPinata();
    const response = await pinata.gateways.private.get(cid);
    const data = response.data;

    // Handle JSON-wrapped content (our upload format: { content, timestamp })
    if (typeof data === 'object' && data !== null && 'content' in data) {
      return (data as { content: string }).content;
    }

    // Raw text content
    if (typeof data === 'string') {
      return data;
    }

    return JSON.stringify(data);
  } catch (err) {
    console.warn(`[IPFS] Failed to fetch CID ${cid}:`, err);
    return null;
  }
}

/**
 * Check if IPFS/Pinata is configured and available.
 */
export function isIPFSConfigured(): boolean {
  return Boolean(config.backup.pinataJwt);
}

/**
 * Get the gateway URL for an IPFS CID.
 */
export function getIPFSUrl(cid: string): string {
  return `${PINATA_GATEWAY}/ipfs/${cid}`;
}
