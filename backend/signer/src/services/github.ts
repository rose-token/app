/**
 * GitHub Service
 *
 * Handles GitHub App authentication and PR operations (approve, merge).
 * Used by taskWatcher to auto-merge PRs when tasks are approved.
 */

import { App } from '@octokit/app';
import { Octokit } from '@octokit/rest';
import { config } from '../config';
import { query } from '../db/pool';

// Types
export interface ParsedPrUrl {
  owner: string;
  repo: string;
  pull_number: number;
}

export interface GitHubResult {
  success: boolean;
  error?: string;
  mergeSha?: string;
}

export interface ValidatePrResult {
  valid: boolean;
  error?: string;
  state?: string;  // 'open', 'closed', 'merged'
  title?: string;
  mergeable?: boolean;
}

// Singleton GitHub App instance (configured with @octokit/rest for .rest endpoint access)
type AppWithRest = App<{ Octokit: typeof Octokit }>;
let app: AppWithRest | null = null;

// Cache installation IDs per owner to reduce API calls
const installationCache = new Map<string, number>();

/**
 * Get or create the GitHub App instance
 */
function getApp(): AppWithRest {
  if (!app) {
    if (!config.github.appId || !config.github.privateKey) {
      throw new Error('GitHub App credentials not configured (GITHUB_APP_ID, GITHUB_PRIVATE_KEY)');
    }

    app = new App({
      appId: config.github.appId,
      privateKey: config.github.privateKey,
      Octokit: Octokit,
    });
  }
  return app;
}

/**
 * Get an authenticated Octokit instance for a specific repo owner.
 * Caches installation IDs to reduce API calls.
 */
async function getOctokitForRepo(owner: string): Promise<InstanceType<typeof Octokit>> {
  const ghApp = getApp();

  // Check cache first
  const cachedId = installationCache.get(owner.toLowerCase());
  if (cachedId) {
    return ghApp.getInstallationOctokit(cachedId);
  }

  // Find installation for this owner
  for await (const { installation } of ghApp.eachInstallation.iterator()) {
    const account = installation.account;
    const accountLogin = account && 'login' in account ? account.login : undefined;
    if (accountLogin && accountLogin.toLowerCase() === owner.toLowerCase()) {
      installationCache.set(owner.toLowerCase(), installation.id);
      return ghApp.getInstallationOctokit(installation.id);
    }
  }

  throw new Error(`GitHub App not installed for org/user: ${owner}`);
}

/**
 * Parse a GitHub PR URL into its components.
 * Supports formats:
 *   - https://github.com/owner/repo/pull/123
 *   - https://github.com/owner/repo/pull/123/
 */
export function parsePrUrl(prUrl: string): ParsedPrUrl | null {
  if (!prUrl || typeof prUrl !== 'string') {
    return null;
  }

  const trimmed = prUrl.trim();

  // Validate domain is github.com
  if (!trimmed.startsWith('https://github.com/')) {
    return null;
  }

  const regex = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)\/?$/;
  const match = trimmed.match(regex);

  if (!match) {
    return null;
  }

  return {
    owner: match[1],
    repo: match[2],
    pull_number: parseInt(match[3], 10),
  };
}

/**
 * Validate a PR URL by checking if:
 * - URL is valid format
 * - App has access to the repo
 * - PR exists
 * - PR is open (not already merged/closed)
 */
export async function validatePrUrl(prUrl: string): Promise<ValidatePrResult> {
  const pr = parsePrUrl(prUrl);
  if (!pr) {
    return { valid: false, error: 'Invalid GitHub PR URL format' };
  }

  try {
    const octokit = await getOctokitForRepo(pr.owner);

    const { data } = await octokit.rest.pulls.get({
      owner: pr.owner,
      repo: pr.repo,
      pull_number: pr.pull_number,
    });

    if (data.state !== 'open') {
      return {
        valid: false,
        error: data.merged ? 'PR is already merged' : 'PR is closed',
        state: data.merged ? 'merged' : 'closed',
        title: data.title,
      };
    }

    return {
      valid: true,
      state: 'open',
      title: data.title,
      mergeable: data.mergeable ?? undefined,
    };
  } catch (err: unknown) {
    const error = err as Error & { status?: number };

    if (error.message?.includes('not installed')) {
      return { valid: false, error: error.message };
    }

    if (error.status === 404) {
      return { valid: false, error: 'PR not found or app lacks access to this repository' };
    }

    return { valid: false, error: error.message || 'Failed to validate PR' };
  }
}

/**
 * Create an approval review on a PR.
 */
export async function approvePR(prUrl: string, taskId: number): Promise<GitHubResult> {
  const pr = parsePrUrl(prUrl);
  if (!pr) {
    return { success: false, error: 'Invalid PR URL' };
  }

  try {
    const octokit = await getOctokitForRepo(pr.owner);

    await octokit.rest.pulls.createReview({
      owner: pr.owner,
      repo: pr.repo,
      pull_number: pr.pull_number,
      event: 'APPROVE',
      body: `Approved by Rose Protocol Bot\n\nTask #${taskId} has been approved by both customer and stakeholder.`,
    });

    console.log(`[GitHub] Approved PR ${prUrl} for task ${taskId}`);
    return { success: true };
  } catch (err: unknown) {
    const error = err as Error;
    console.error(`[GitHub] Failed to approve PR ${prUrl}:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Merge a PR using squash merge.
 */
export async function mergePR(
  prUrl: string,
  taskId: number,
  method: 'squash' | 'merge' | 'rebase' = 'squash'
): Promise<GitHubResult> {
  const pr = parsePrUrl(prUrl);
  if (!pr) {
    return { success: false, error: 'Invalid PR URL' };
  }

  try {
    const octokit = await getOctokitForRepo(pr.owner);

    const result = await octokit.rest.pulls.merge({
      owner: pr.owner,
      repo: pr.repo,
      pull_number: pr.pull_number,
      merge_method: method,
      commit_title: `Merge PR #${pr.pull_number} (Rose Protocol Task #${taskId})`,
    });

    console.log(`[GitHub] Merged PR ${prUrl} for task ${taskId}, SHA: ${result.data.sha}`);
    return { success: true, mergeSha: result.data.sha };
  } catch (err: unknown) {
    const error = err as Error & { status?: number };

    // Handle already merged
    if (error.status === 405 || error.message?.includes('already been merged')) {
      console.log(`[GitHub] PR ${prUrl} already merged`);
      return { success: true };
    }

    // Handle merge conflicts
    if (error.status === 409 || error.message?.includes('conflict')) {
      console.error(`[GitHub] PR ${prUrl} has merge conflicts`);
      return { success: false, error: 'PR has merge conflicts' };
    }

    console.error(`[GitHub] Failed to merge PR ${prUrl}:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Approve and merge a PR in a single operation.
 * Logs the result to the database.
 */
export async function approveAndMergePR(prUrl: string, taskId: number): Promise<GitHubResult> {
  const pr = parsePrUrl(prUrl);
  if (!pr) {
    await logMergeAttempt(taskId, prUrl, 'approve_and_merge', false, 'Invalid PR URL');
    return { success: false, error: 'Invalid PR URL' };
  }

  try {
    const octokit = await getOctokitForRepo(pr.owner);

    // Step 1: Approve
    console.log(`[GitHub] Approving PR ${prUrl} for task ${taskId}...`);
    await octokit.rest.pulls.createReview({
      owner: pr.owner,
      repo: pr.repo,
      pull_number: pr.pull_number,
      event: 'APPROVE',
      body: `Approved by Rose Protocol Bot\n\nTask #${taskId} has been approved by both customer and stakeholder.\n\nAuto-merging...`,
    });

    // Step 2: Merge
    console.log(`[GitHub] Merging PR ${prUrl} for task ${taskId}...`);
    const mergeResult = await octokit.rest.pulls.merge({
      owner: pr.owner,
      repo: pr.repo,
      pull_number: pr.pull_number,
      merge_method: 'squash',
      commit_title: `Merge PR #${pr.pull_number} (Rose Protocol Task #${taskId})`,
    });

    console.log(`[GitHub] Successfully merged PR ${prUrl} for task ${taskId}, SHA: ${mergeResult.data.sha}`);

    await logMergeAttempt(
      taskId,
      prUrl,
      'approve_and_merge',
      true,
      null,
      pr.owner,
      pr.repo,
      pr.pull_number,
      mergeResult.data.sha
    );

    return { success: true, mergeSha: mergeResult.data.sha };
  } catch (err: unknown) {
    const error = err as Error & { status?: number };

    // Handle already merged (treat as success)
    if (error.status === 405 || error.message?.includes('already been merged')) {
      console.log(`[GitHub] PR ${prUrl} already merged (task ${taskId})`);
      await logMergeAttempt(taskId, prUrl, 'approve_and_merge', true, 'Already merged');
      return { success: true };
    }

    const errorMsg = error.message || 'Unknown error';
    console.error(`[GitHub] Failed to approve/merge PR ${prUrl} for task ${taskId}:`, errorMsg);

    await logMergeAttempt(
      taskId,
      prUrl,
      'approve_and_merge',
      false,
      errorMsg,
      pr.owner,
      pr.repo,
      pr.pull_number
    );

    return { success: false, error: errorMsg };
  }
}

/**
 * Log a merge attempt to the database for auditing.
 */
async function logMergeAttempt(
  taskId: number,
  prUrl: string,
  action: string,
  success: boolean,
  errorMessage: string | null,
  prOwner?: string,
  prRepo?: string,
  prNumber?: number,
  mergeSha?: string
): Promise<void> {
  if (!config.database.url) {
    return; // Skip logging if no database configured
  }

  try {
    await query(
      `INSERT INTO github_merge_log (task_id, pr_url, action, success, error_message, pr_owner, pr_repo, pr_number, merge_sha)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [taskId, prUrl, action, success, errorMessage, prOwner || null, prRepo || null, prNumber || null, mergeSha || null]
    );
  } catch (err) {
    console.error('[GitHub] Failed to log merge attempt:', err);
    // Don't throw - logging failure shouldn't break the merge flow
  }
}

/**
 * Check if GitHub integration is properly configured.
 */
export function isGitHubConfigured(): boolean {
  return config.github.enabled && config.github.appId > 0 && config.github.privateKey.length > 0;
}

/**
 * Get GitHub configuration status (for health checks).
 */
export function getGitHubStatus(): {
  enabled: boolean;
  configured: boolean;
  appId: number;
} {
  return {
    enabled: config.github.enabled,
    configured: isGitHubConfigured(),
    appId: config.github.appId,
  };
}
