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
  
  // Create a JSON blob with the description content
  const payload = JSON.stringify({
    content,
    timestamp: new Date().toISOString(),
  });
  
  const filename = `${name || 'rose-token-description'}-${Date.now()}.json`;
  const file = new File([payload], filename, { type: 'application/json' });
  
  const result = await pinata.upload.file(file);

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
