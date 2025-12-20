/**
 * Signer Request Utility
 *
 * Utility for the backend to create signed requests for signerAuth-protected endpoints.
 * Useful for:
 * - Testing signerAuth endpoints manually
 * - Internal service-to-service calls (if ever needed via HTTP)
 * - Debugging authentication issues
 *
 * Note: Most backend operations call service functions directly (in-process).
 * This utility is primarily for testing and debugging.
 */

import { ethers } from 'ethers';
import { config } from '../config';

/**
 * Create a signed request payload for signerAuth endpoints.
 *
 * @param action - Action string matching the endpoint (e.g., 'delegate-scoring-run')
 * @returns Signed request payload with callerAddress, timestamp, and signature
 */
export async function createSignerRequest(action: string): Promise<{
  callerAddress: string;
  timestamp: number;
  signature: string;
}> {
  if (!config.signer.privateKey) {
    throw new Error('SIGNER_PRIVATE_KEY not configured');
  }

  const wallet = new ethers.Wallet(config.signer.privateKey);
  const timestamp = Math.floor(Date.now() / 1000);

  // Create message hash matching signerAuth format
  const messageHash = ethers.solidityPackedKeccak256(
    ['address', 'string', 'uint256'],
    [wallet.address, action, timestamp]
  );

  // Sign the message
  const signature = await wallet.signMessage(ethers.getBytes(messageHash));

  return {
    callerAddress: wallet.address,
    timestamp,
    signature,
  };
}

/**
 * Create a signed fetch options object for calling signerAuth endpoints.
 *
 * @param action - Action string matching the endpoint
 * @param body - Additional body fields to include
 * @returns Fetch options with signed body
 */
export async function createSignedFetchOptions(
  action: string,
  body: Record<string, unknown> = {}
): Promise<RequestInit> {
  const signedRequest = await createSignerRequest(action);

  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, ...signedRequest }),
  };
}
