/**
 * GitHub OAuth Routes
 *
 * Handles GitHub account linking for repository authorization.
 * Users link their GitHub account to their wallet address, then
 * authorize specific repositories for auto-merge.
 */

import { Router, Request, Response } from 'express';
import { query } from '../db/pool';
import { config } from '../config';
import crypto from 'crypto';
import { createUserAuth } from '../middleware/userAuth';

const router = Router();

// Store pending OAuth states (state -> { wallet, expires })
// In production, consider using Redis for multi-instance support
const pendingStates = new Map<string, { wallet: string; expires: number }>();

// Cleanup expired states periodically (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [state, data] of pendingStates) {
    if (data.expires < now) {
      pendingStates.delete(state);
    }
  }
}, 5 * 60 * 1000);

/**
 * GET /api/github/auth/start
 *
 * Initiates GitHub OAuth flow.
 * Returns the OAuth authorization URL for the frontend to redirect to.
 */
router.get('/auth/start', (req: Request, res: Response) => {
  const wallet = req.query.wallet as string;

  if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    return res.status(400).json({ error: 'Valid wallet address required' });
  }

  if (!config.github.clientId) {
    return res.status(503).json({ error: 'GitHub OAuth not configured' });
  }

  // Generate cryptographically secure state token
  const state = crypto.randomBytes(32).toString('hex');
  pendingStates.set(state, {
    wallet: wallet.toLowerCase(),
    expires: Date.now() + 10 * 60 * 1000, // 10 minute expiry
  });

  const params = new URLSearchParams({
    client_id: config.github.clientId,
    redirect_uri: config.github.callbackUrl,
    scope: 'read:user',
    state,
  });

  return res.json({
    authUrl: `https://github.com/login/oauth/authorize?${params}`,
  });
});

/**
 * GET /api/github/callback
 *
 * OAuth callback endpoint.
 * Exchanges the code for an access token and links the GitHub account.
 */
router.get('/callback', async (req: Request, res: Response) => {
  const { code, state } = req.query;

  if (!code || !state) {
    return res.status(400).send('Missing code or state parameter');
  }

  const pending = pendingStates.get(state as string);
  if (!pending) {
    return res.status(400).send('Invalid or expired state. Please try linking again.');
  }

  if (pending.expires < Date.now()) {
    pendingStates.delete(state as string);
    return res.status(400).send('OAuth session expired. Please try linking again.');
  }

  const wallet = pending.wallet;
  pendingStates.delete(state as string);

  try {
    // Exchange code for access token
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: config.github.clientId,
        client_secret: config.github.clientSecret,
        code,
      }),
    });

    const tokenData = (await tokenRes.json()) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };
    if (tokenData.error) {
      console.error('[GitHub Auth] Token exchange failed:', tokenData.error_description || tokenData.error);
      throw new Error(tokenData.error_description || tokenData.error);
    }

    // Get GitHub user info
    const userRes = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (!userRes.ok) {
      throw new Error('Failed to fetch GitHub user info');
    }

    const userData = (await userRes.json()) as { id: number; login: string };

    // Upsert github_links
    await query(
      `INSERT INTO github_links (wallet_address, github_user_id, github_username, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (wallet_address)
       DO UPDATE SET github_user_id = $2, github_username = $3, updated_at = NOW()`,
      [wallet, userData.id, userData.login]
    );

    console.log(`[GitHub Auth] Linked wallet ${wallet} to GitHub user @${userData.login}`);

    // Redirect to frontend profile page with success
    res.redirect(`${config.frontendUrl}/profile?github=linked&username=${encodeURIComponent(userData.login)}`);
  } catch (error) {
    console.error('[GitHub Auth] OAuth error:', error);
    res.redirect(`${config.frontendUrl}/profile?github=error`);
  }
});

/**
 * GET /api/github/auth/status
 *
 * Check if a wallet has a linked GitHub account.
 */
router.get('/auth/status', async (req: Request, res: Response) => {
  const wallet = req.query.wallet as string;

  if (!wallet) {
    return res.status(400).json({ error: 'Wallet required' });
  }

  try {
    const result = await query(
      'SELECT github_username, linked_at FROM github_links WHERE LOWER(wallet_address) = LOWER($1)',
      [wallet]
    );

    if (result.rows.length === 0) {
      return res.json({ linked: false });
    }

    return res.json({
      linked: true,
      username: result.rows[0].github_username,
      linkedAt: result.rows[0].linked_at,
    });
  } catch (error) {
    console.error('[GitHub Auth] Status check error:', error);
    return res.status(500).json({ error: 'Failed to check GitHub link status' });
  }
});

/**
 * DELETE /api/github/auth/unlink
 *
 * Unlink GitHub account from wallet.
 * Also removes all authorized repos for this wallet.
 *
 * Requires signature verification to prove caller controls the wallet.
 */
router.delete('/auth/unlink', createUserAuth('github-unlink'), async (req: Request, res: Response) => {
  const wallet = req.verifiedUser!; // Cryptographically verified

  try {
    // Remove all authorized repos and the link
    await query('DELETE FROM authorized_repos WHERE LOWER(wallet_address) = LOWER($1)', [wallet]);
    await query('DELETE FROM github_links WHERE LOWER(wallet_address) = LOWER($1)', [wallet]);

    console.log(`[GitHub Auth] Unlinked wallet ${wallet} (verified)`);
    return res.json({ success: true });
  } catch (error) {
    console.error('[GitHub Auth] Unlink error:', error);
    return res.status(500).json({ error: 'Failed to unlink account' });
  }
});

export default router;
