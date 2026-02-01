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
  
  // Upload as a JSON object with the description
  const result = await pinata.upload.json({
    content,
    timestamp: new Date().toISOString(),
  }, {
    metadata: {
      name: name || 'rose-token-description',
    },
  });

  return result.IpfsHash;
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
