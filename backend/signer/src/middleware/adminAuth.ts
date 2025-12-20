/**
 * Admin Authentication Middleware
 *
 * Centralized signature verification for admin endpoints.
 * Replaces per-route verifyOwner() functions with a DRY middleware factory.
 *
 * Security model:
 * - Frontend signs: keccak256(abi.encodePacked(callerAddress, action, timestamp))
 * - Backend verifies signature proves caller controls Treasury.owner() wallet
 * - Timestamp prevents replay attacks (5-min window)
 * - Each signature can only be used once
 */

import { Request, Response, NextFunction } from 'express';
import { ethers } from 'ethers';
import { config } from '../config';
import { getWsProvider } from '../utils/wsProvider';

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

export interface AdminAuthBody {
  callerAddress: string;
  timestamp: number;
  signature: string;
}

/**
 * Middleware factory to verify admin (Treasury owner) signature.
 *
 * Message format: keccak256(abi.encodePacked(callerAddress, action, timestamp))
 *
 * @param action - Action string for the endpoint (e.g., 'backup-create', 'whitelist-add')
 * @returns Express middleware that verifies owner signature
 */
export function createAdminAuth(action: string) {
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

      // Get Treasury owner
      const treasuryAddress = config.contracts?.treasury || process.env.TREASURY_ADDRESS;
      if (!treasuryAddress) {
        return res.status(500).json({ error: 'TREASURY_ADDRESS not configured' });
      }

      const provider = getWsProvider();
      const treasury = new ethers.Contract(
        treasuryAddress,
        ['function owner() view returns (address)'],
        provider
      );
      const ownerAddress = await treasury.owner();

      // Verify caller claims to be owner
      if (callerAddress.toLowerCase() !== ownerAddress.toLowerCase()) {
        console.log(`[AdminAuth] Caller is not owner for ${action}:`, {
          caller: callerAddress,
          owner: ownerAddress,
        });
        return res.status(403).json({ error: 'Caller is not owner' });
      }

      // Verify signature
      const messageHash = ethers.solidityPackedKeccak256(
        ['address', 'string', 'uint256'],
        [callerAddress, action, ts]
      );

      const recovered = ethers.verifyMessage(ethers.getBytes(messageHash), signature);

      if (recovered.toLowerCase() !== ownerAddress.toLowerCase()) {
        console.log(`[AdminAuth] Signature verification failed for ${action}:`, {
          expected: ownerAddress,
          recovered,
        });
        return res.status(403).json({ error: 'Invalid signature' });
      }

      // Mark signature as used (only after successful verification)
      usedSignatures.set(signature, now);

      // Attach verified address to request
      req.verifiedOwner = callerAddress;

      next();
    } catch (error) {
      console.error(`[AdminAuth] Error verifying ${action}:`, error);
      return res.status(500).json({ error: 'Authentication failed' });
    }
  };
}

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      verifiedOwner?: string;
    }
  }
}
