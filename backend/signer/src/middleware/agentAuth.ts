/**
 * Agent Authentication Middleware
 *
 * API key-based authentication for AI agents interacting with the marketplace.
 * Agents use Bearer token auth instead of wallet signatures for simplicity.
 *
 * Security model:
 * - API keys are sha256-hashed in the database (never stored in plaintext)
 * - Rate limited to 100 requests per minute per API key
 * - Agents bypass Gitcoin Passport (economic sybil resistance via staking instead)
 * - All agent actions are labeled as agent_type='agent' for transparency
 *
 * Key difference from userAuth/signerAuth:
 * - userAuth: Verifies wallet signature (self-attestation for humans)
 * - signerAuth: Verifies backend signer identity
 * - agentAuth: Verifies API key for programmatic agent access
 */

import { Request, Response, NextFunction } from 'express';
import { createHash } from 'crypto';
import { query } from '../db/pool';

// ============================================================
// Rate Limiting (per API key)
// ============================================================

const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 100; // 100 requests per minute

// Track requests per API key hash: hash -> { count, windowStart }
const rateLimitMap = new Map<string, { count: number; windowStart: number }>();

// Clean up stale rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap.entries()) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS * 2) {
      rateLimitMap.delete(key);
    }
  }
}, 5 * 60 * 1000);

/**
 * Check rate limit for an API key hash.
 * Returns true if within limits, false if exceeded.
 */
function checkRateLimit(apiKeyHash: string): { allowed: boolean; remaining: number; resetMs: number } {
  const now = Date.now();
  const entry = rateLimitMap.get(apiKeyHash);

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    // New window
    rateLimitMap.set(apiKeyHash, { count: 1, windowStart: now });
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1, resetMs: RATE_LIMIT_WINDOW_MS };
  }

  entry.count++;
  const remaining = Math.max(0, RATE_LIMIT_MAX - entry.count);
  const resetMs = RATE_LIMIT_WINDOW_MS - (now - entry.windowStart);

  if (entry.count > RATE_LIMIT_MAX) {
    return { allowed: false, remaining: 0, resetMs };
  }

  return { allowed: true, remaining, resetMs };
}

// ============================================================
// Helpers
// ============================================================

/**
 * Hash an API key using SHA-256 (matches registration format).
 */
export function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex');
}

// ============================================================
// Middleware
// ============================================================

/**
 * Agent authentication middleware.
 *
 * Extracts Bearer token from Authorization header, hashes it,
 * looks up the agent in the database, and attaches agent info to the request.
 *
 * Usage:
 *   router.get('/endpoint', agentAuth, handler);
 */
export async function agentAuth(req: Request, res: Response, next: NextFunction) {
  try {
    // Extract Bearer token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Missing or invalid Authorization header',
        hint: 'Use: Authorization: Bearer <api_key>',
      });
    }

    const apiKey = authHeader.slice(7).trim();
    if (!apiKey) {
      return res.status(401).json({ error: 'Empty API key' });
    }

    // Hash the API key
    const apiKeyHash = hashApiKey(apiKey);

    // Check rate limit
    const rateLimit = checkRateLimit(apiKeyHash);
    res.setHeader('X-RateLimit-Limit', RATE_LIMIT_MAX);
    res.setHeader('X-RateLimit-Remaining', rateLimit.remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil(rateLimit.resetMs / 1000));

    if (!rateLimit.allowed) {
      return res.status(429).json({
        error: 'Rate limit exceeded',
        retryAfter: Math.ceil(rateLimit.resetMs / 1000),
      });
    }

    // Look up agent by API key hash
    const result = await query<{
      id: number;
      wallet_address: string;
      name: string | null;
      agent_type: string;
      is_active: boolean;
    }>(
      'SELECT id, wallet_address, name, agent_type, is_active FROM agents WHERE api_key_hash = $1',
      [apiKeyHash]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid API key' });
    }

    const agent = result.rows[0];

    // Check if agent is active
    if (!agent.is_active) {
      return res.status(403).json({ error: 'Agent account is deactivated' });
    }

    // Attach agent info to request
    req.agent = {
      id: agent.id,
      walletAddress: agent.wallet_address,
      name: agent.name,
      agentType: agent.agent_type,
    };

    next();
  } catch (error) {
    console.error('[AgentAuth] Error:', error);
    return res.status(500).json({ error: 'Authentication failed' });
  }
}

// ============================================================
// Type Extensions
// ============================================================

declare global {
  namespace Express {
    interface Request {
      agent?: {
        id: number;
        walletAddress: string;
        name: string | null;
        agentType: string;
      };
    }
  }
}
