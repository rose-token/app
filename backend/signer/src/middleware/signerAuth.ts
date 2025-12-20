/**
 * Signer Authentication Middleware
 *
 * Centralized signature verification for backend-only mutation endpoints.
 * Verifies that the caller is the backend signer (derived from SIGNER_PRIVATE_KEY).
 *
 * Security model:
 * - Message format: keccak256(abi.encodePacked(callerAddress, action, timestamp))
 * - Backend verifies signature proves caller controls the signer wallet
 * - Timestamp prevents replay attacks (5-min window)
 * - Each signature can only be used once
 *
 * Key difference from adminAuth/userAuth:
 * - adminAuth: Verifies caller == Treasury.owner() (for admin panel)
 * - userAuth: Verifies caller controls claimed wallet (self-attestation)
 * - signerAuth: Verifies caller == backend signer address (for internal ops)
 */

import { Request, Response, NextFunction } from 'express';
import { ethers } from 'ethers';
import { config } from '../config';

// Track used signatures to prevent replay attacks
const usedSignatures = new Map<string, number>(); // signature -> timestamp used
const SIGNATURE_TTL = 300; // 5 minutes

// Clean up expired signatures periodically (every minute)
setInterval(() => {
  const now = Math.floor(Date.now() / 1000);
  for (const [sig, timestamp] of usedSignatures.entries()) {
    if (now - timestamp > SIGNATURE_TTL) {
      usedSignatures.delete(sig);
    }
  }
}, 60000);

// Derive signer address once on startup (cached)
let signerAddress: string | null = null;

/**
 * Get the backend signer address (derived from SIGNER_PRIVATE_KEY).
 * Cached after first call.
 */
export function getSignerAddress(): string {
  if (!signerAddress) {
    if (!config.signer.privateKey) {
      throw new Error('SIGNER_PRIVATE_KEY not configured');
    }
    const wallet = new ethers.Wallet(config.signer.privateKey);
    signerAddress = wallet.address;
  }
  return signerAddress;
}

export interface SignerAuthBody {
  callerAddress: string;
  timestamp: number;
  signature: string;
}

/**
 * Middleware factory to verify backend signer signature.
 *
 * Message format: keccak256(abi.encodePacked(callerAddress, action, timestamp))
 *
 * @param action - Action string for the endpoint (e.g., 'delegate-scoring-run')
 * @returns Express middleware that verifies signer signature
 */
export function createSignerAuth(action: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { callerAddress, timestamp, signature } = req.body;

      // Validate required fields
      if (!callerAddress || !timestamp || !signature) {
        return res.status(400).json({
          error: 'Missing required auth fields',
          required: ['callerAddress', 'timestamp', 'signature'],
        });
      }

      // Validate address format
      if (!/^0x[a-fA-F0-9]{40}$/.test(callerAddress)) {
        return res.status(400).json({ error: 'Invalid wallet address format' });
      }

      // Validate timestamp format
      const ts = parseInt(timestamp);
      if (isNaN(ts)) {
        return res.status(400).json({ error: 'Invalid timestamp format' });
      }

      // Get expected signer address
      let expectedSigner: string;
      try {
        expectedSigner = getSignerAddress();
      } catch (error) {
        console.error('[SignerAuth] Failed to get signer address:', error);
        return res.status(500).json({ error: 'Signer not configured' });
      }

      // Verify caller claims to be signer
      if (callerAddress.toLowerCase() !== expectedSigner.toLowerCase()) {
        console.log(`[SignerAuth] Caller is not signer for ${action}:`, {
          caller: callerAddress,
          signer: expectedSigner,
        });
        return res.status(403).json({ error: 'Caller is not signer' });
      }

      // Check timestamp freshness (5 min window)
      const now = Math.floor(Date.now() / 1000);
      if (Math.abs(now - ts) > SIGNATURE_TTL) {
        return res.status(403).json({ error: 'Signature expired' });
      }

      // Check replay protection
      if (usedSignatures.has(signature)) {
        return res.status(403).json({ error: 'Signature already used' });
      }

      // Verify signature
      const messageHash = ethers.solidityPackedKeccak256(
        ['address', 'string', 'uint256'],
        [callerAddress, action, ts]
      );

      const recovered = ethers.verifyMessage(ethers.getBytes(messageHash), signature);

      if (recovered.toLowerCase() !== expectedSigner.toLowerCase()) {
        console.log(`[SignerAuth] Signature verification failed for ${action}:`, {
          expected: expectedSigner,
          recovered,
        });
        return res.status(403).json({ error: 'Invalid signature' });
      }

      // Mark signature as used (only after successful verification)
      usedSignatures.set(signature, now);

      // Attach verified address to request
      req.verifiedSigner = callerAddress;

      next();
    } catch (error) {
      console.error(`[SignerAuth] Error verifying ${action}:`, error);
      return res.status(500).json({ error: 'Authentication failed' });
    }
  };
}

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      verifiedSigner?: string;
    }
  }
}
