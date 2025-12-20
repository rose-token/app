/**
 * User Authentication Middleware
 *
 * Centralized signature verification for user-facing mutation endpoints.
 * Verifies that the caller controls the wallet address they claim to be.
 *
 * Security model:
 * - Frontend signs: keccak256(abi.encodePacked(callerAddress, action, timestamp))
 * - Backend verifies signature proves caller controls callerAddress (self-attestation)
 * - Timestamp prevents replay attacks (5-min window)
 * - Each signature can only be used once
 *
 * Key difference from adminAuth:
 * - adminAuth: Verifies caller == Treasury.owner()
 * - userAuth: Verifies caller controls claimed wallet address (self-attestation)
 */

import { Request, Response, NextFunction } from 'express';
import { ethers } from 'ethers';

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

export interface UserAuthBody {
  callerAddress: string;
  timestamp: number;
  signature: string;
}

/**
 * Middleware factory to verify user wallet signature.
 *
 * Message format: keccak256(abi.encodePacked(callerAddress, action, timestamp))
 *
 * Unlike adminAuth which verifies Treasury.owner(), this verifies the caller
 * controls the wallet address they claim to be (self-attestation).
 *
 * @param action - Action string for the endpoint (e.g., 'github-unlink', 'github-repo-authorize')
 * @returns Express middleware that verifies user signature
 */
export function createUserAuth(action: string) {
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

      // Check timestamp freshness (5 min window)
      const now = Math.floor(Date.now() / 1000);
      if (Math.abs(now - ts) > SIGNATURE_TTL) {
        return res.status(403).json({ error: 'Signature expired' });
      }

      // Check replay protection
      if (usedSignatures.has(signature)) {
        return res.status(403).json({ error: 'Signature already used' });
      }

      // Verify signature - proves caller controls callerAddress
      const messageHash = ethers.solidityPackedKeccak256(
        ['address', 'string', 'uint256'],
        [callerAddress, action, ts]
      );

      const recovered = ethers.verifyMessage(ethers.getBytes(messageHash), signature);

      if (recovered.toLowerCase() !== callerAddress.toLowerCase()) {
        console.log(`[UserAuth] Signature verification failed for ${action}:`, {
          claimed: callerAddress,
          recovered,
        });
        return res.status(403).json({ error: 'Invalid signature' });
      }

      // Mark signature as used (only after successful verification)
      usedSignatures.set(signature, now);

      // Attach verified address to request
      req.verifiedUser = callerAddress;

      next();
    } catch (error) {
      console.error(`[UserAuth] Error verifying ${action}:`, error);
      return res.status(500).json({ error: 'Authentication failed' });
    }
  };
}

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      verifiedUser?: string;
    }
  }
}
