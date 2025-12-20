/**
 * GitHub Repository Management Routes
 *
 * Allows customers to authorize specific repositories for auto-merge.
 * Only repos where the user has admin access can be authorized.
 */

import { Router, Request, Response } from 'express';
import { query } from '../db/pool';
import { getOctokitForRepo } from '../services/github';
import { createUserAuth } from '../middleware/userAuth';

const router = Router();

/**
 * GET /api/github/repos
 *
 * List authorized repos for a wallet.
 */
router.get('/repos', async (req: Request, res: Response) => {
  const wallet = req.query.wallet as string;

  if (!wallet) {
    return res.status(400).json({ error: 'Wallet required' });
  }

  try {
    const result = await query(
      `SELECT repo_owner, repo_name, authorized_at
       FROM authorized_repos
       WHERE LOWER(wallet_address) = LOWER($1)
       ORDER BY authorized_at DESC`,
      [wallet]
    );

    return res.json({ repos: result.rows });
  } catch (error) {
    console.error('[GitHub Repos] List error:', error);
    return res.status(500).json({ error: 'Failed to fetch repos' });
  }
});

/**
 * POST /api/github/repos/authorize
 *
 * Authorize a repo for auto-merge.
 * Verifies that the linked GitHub user has admin access to the repo.
 *
 * Requires signature verification to prove caller controls the wallet.
 */
router.post('/repos/authorize', createUserAuth('github-repo-authorize'), async (req: Request, res: Response) => {
  const wallet = req.verifiedUser!; // Cryptographically verified
  const { repoOwner, repoName } = req.body;

  if (!repoOwner || !repoName) {
    return res.status(400).json({ error: 'repoOwner and repoName required' });
  }

  try {
    // Verify wallet has linked GitHub account
    const linkResult = await query(
      'SELECT github_username FROM github_links WHERE LOWER(wallet_address) = LOWER($1)',
      [wallet]
    );

    if (linkResult.rows.length === 0) {
      return res.status(403).json({ error: 'Must link GitHub account first' });
    }

    const githubUsername = linkResult.rows[0].github_username;

    // Verify user has admin access to the repo
    try {
      const octokit = await getOctokitForRepo(repoOwner);

      // Check if the linked GitHub user has admin access (required to authorize repos)
      const { data: permission } = await octokit.rest.repos.getCollaboratorPermissionLevel({
        owner: repoOwner,
        repo: repoName,
        username: githubUsername,
      });

      if (permission.permission !== 'admin') {
        return res.status(403).json({
          error: `GitHub user @${githubUsername} is not an admin of ${repoOwner}/${repoName}. Only repository admins can authorize repos for GitHub integration.`,
        });
      }
    } catch (error: unknown) {
      const err = error as Error & { status?: number };

      if (err.message?.includes('not installed')) {
        return res.status(404).json({
          error: `Rose Protocol GitHub App is not installed for ${repoOwner}. Please install the app first.`,
        });
      }

      if (err.status === 404) {
        return res.status(404).json({ error: 'Repository not found or app not installed' });
      }

      console.error('[GitHub Repos] Permission check failed:', error);
      return res.status(500).json({ error: 'Failed to verify repository access' });
    }

    // Add authorization
    await query(
      `INSERT INTO authorized_repos (wallet_address, github_username, repo_owner, repo_name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (wallet_address, repo_owner, repo_name) DO NOTHING`,
      [wallet.toLowerCase(), githubUsername, repoOwner.toLowerCase(), repoName.toLowerCase()]
    );

    console.log(`[GitHub Repos] Authorized ${wallet} for ${repoOwner}/${repoName}`);
    return res.json({ success: true });
  } catch (error) {
    console.error('[GitHub Repos] Authorize error:', error);
    return res.status(500).json({ error: 'Failed to authorize repo' });
  }
});

/**
 * DELETE /api/github/repos/revoke
 *
 * Revoke authorization for a repo.
 *
 * Requires signature verification to prove caller controls the wallet.
 */
router.delete('/repos/revoke', createUserAuth('github-repo-revoke'), async (req: Request, res: Response) => {
  const wallet = req.verifiedUser!; // Cryptographically verified
  const { repoOwner, repoName } = req.body;

  if (!repoOwner || !repoName) {
    return res.status(400).json({ error: 'repoOwner and repoName required' });
  }

  try {
    await query(
      `DELETE FROM authorized_repos
       WHERE LOWER(wallet_address) = LOWER($1)
       AND LOWER(repo_owner) = LOWER($2)
       AND LOWER(repo_name) = LOWER($3)`,
      [wallet, repoOwner, repoName]
    );

    console.log(`[GitHub Repos] Revoked ${wallet} for ${repoOwner}/${repoName}`);
    return res.json({ success: true });
  } catch (error) {
    console.error('[GitHub Repos] Revoke error:', error);
    return res.status(500).json({ error: 'Failed to revoke repo' });
  }
});

/**
 * GET /api/github/repos/check
 *
 * Check if a specific repo is authorized for a wallet.
 */
router.get('/repos/check', async (req: Request, res: Response) => {
  const { wallet, repoOwner, repoName } = req.query;

  if (!wallet || !repoOwner || !repoName) {
    return res.status(400).json({ error: 'wallet, repoOwner, and repoName required' });
  }

  try {
    const result = await query(
      `SELECT id FROM authorized_repos
       WHERE LOWER(wallet_address) = LOWER($1)
       AND LOWER(repo_owner) = LOWER($2)
       AND LOWER(repo_name) = LOWER($3)`,
      [wallet as string, repoOwner as string, repoName as string]
    );

    return res.json({ authorized: result.rows.length > 0 });
  } catch (error) {
    console.error('[GitHub Repos] Check error:', error);
    return res.status(500).json({ error: 'Failed to check authorization' });
  }
});

export default router;
