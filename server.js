const express = require('express');
const path = require('path');
const fs = require('fs');
const { Octokit } = require('@octokit/rest');
const { ethers } = require('ethers');
require('dotenv').config();

const app = express();
app.use(express.json());

// Initialize GitHub client
const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN
});

/**
 * Get marketplace contract address from environment variable or deployment artifacts
 * Priority: 1) MARKETPLACE_ADDRESS env var, 2) deployment-output.json
 * @returns {string|null} - Marketplace address (lowercase) or null
 */
function getMarketplaceAddress() {
  // First try environment variable
  if (process.env.MARKETPLACE_ADDRESS) {
    return process.env.MARKETPLACE_ADDRESS.toLowerCase();
  }

  // Fall back to deployment-output.json
  const deploymentFile = path.join(__dirname, 'deployment-output.json');

  try {
    if (fs.existsSync(deploymentFile)) {
      const deploymentData = JSON.parse(fs.readFileSync(deploymentFile, 'utf8'));

      if (deploymentData.roseMarketplace) {
        console.log('📄 Loaded marketplace address from deployment-output.json');
        return deploymentData.roseMarketplace.toLowerCase();
      }
    }
  } catch (error) {
    console.warn('⚠️  Could not read deployment-output.json:', error.message);
  }

  return null;
}

// Expected marketplace contract address (lowercase for comparison)
// This can be updated after deployment via environment variable or deployment artifacts
const EXPECTED_MARKETPLACE_ADDRESS = getMarketplaceAddress();

// ABI for TaskApproved event
const TASK_APPROVED_EVENT_ABI = [
  "event TaskApproved(uint256 indexed taskId, address indexed worker, string githubPrUrl)"
];

// Create interface for decoding events
const iface = new ethers.Interface(TASK_APPROVED_EVENT_ABI);

/**
 * Verify that the event came from the expected marketplace contract
 * @param {string} contractAddress - Address from the webhook log
 * @returns {boolean} - True if address matches or no verification configured
 */
function verifyContractAddress(contractAddress) {
  if (!EXPECTED_MARKETPLACE_ADDRESS) {
    console.warn('⚠️  WARNING: MARKETPLACE_ADDRESS not configured - accepting events from ANY contract');
    console.warn('   Set MARKETPLACE_ADDRESS environment variable to enable verification');
    return true; // Accept all if not configured (for initial setup)
  }

  const normalizedAddress = contractAddress.toLowerCase();
  const isValid = normalizedAddress === EXPECTED_MARKETPLACE_ADDRESS;

  if (!isValid) {
    console.error('❌ Contract address mismatch!');
    console.error(`   Expected: ${EXPECTED_MARKETPLACE_ADDRESS}`);
    console.error(`   Received: ${normalizedAddress}`);
  }

  return isValid;
}

/**
 * Parse GitHub PR URL to extract owner, repo, and pull number
 * Expected format: https://github.com/{owner}/{repo}/pull/{number}
 * @param {string} url - GitHub PR URL
 * @returns {Object|null} - {owner, repo, pull_number} or null if invalid
 */
function parseGitHubPrUrl(url) {
  try {
    const regex = /^https?:\/\/github\.com\/([^\/]+)\/([^\/]+)\/pull\/(\d+)/;
    const match = url.match(regex);

    if (!match) {
      return null;
    }

    return {
      owner: match[1],
      repo: match[2],
      pull_number: parseInt(match[3], 10)
    };
  } catch (error) {
    console.error('Error parsing GitHub PR URL:', error);
    return null;
  }
}

/**
 * Decode Alchemy webhook activity log to extract TaskApproved event data
 * @param {Object} activity - Alchemy activity object
 * @returns {Object|null} - {taskId, worker, githubPrUrl} or null if invalid
 */
function decodeTaskApprovedEvent(activity) {
  try {
    if (!activity.log || !activity.log.topics || !activity.log.data) {
      console.log('Invalid activity structure - missing log data');
      return null;
    }

    const log = activity.log;

    // Decode the event using ethers.js
    const decodedLog = iface.parseLog({
      topics: log.topics,
      data: log.data
    });

    if (!decodedLog || decodedLog.name !== 'TaskApproved') {
      console.log('Not a TaskApproved event');
      return null;
    }

    return {
      taskId: decodedLog.args.taskId.toString(),
      worker: decodedLog.args.worker,
      githubPrUrl: decodedLog.args.githubPrUrl
    };
  } catch (error) {
    console.error('Error decoding event:', error);
    return null;
  }
}

/**
 * Merge a GitHub pull request
 * @param {Object} prDetails - {owner, repo, pull_number}
 * @param {string} workerAddress - Worker's Ethereum address
 * @returns {Promise<Object>} - GitHub API merge response
 */
async function mergeGitHubPr(prDetails, workerAddress) {
  const { owner, repo, pull_number } = prDetails;

  console.log(`Attempting to merge PR: ${owner}/${repo}#${pull_number}`);

  try {
    // First, check if PR is mergeable
    const { data: pr } = await octokit.pulls.get({
      owner,
      repo,
      pull_number
    });

    console.log(`PR state: ${pr.state}, mergeable: ${pr.mergeable}, merged: ${pr.merged}`);

    // Check if PR is already merged
    if (pr.merged) {
      console.log('PR is already merged');
      return { success: true, message: 'PR already merged', alreadyMerged: true };
    }

    // Check if PR is closed
    if (pr.state === 'closed') {
      console.log('PR is closed without being merged');
      return { success: false, message: 'PR is closed without being merged' };
    }

    // Check if PR is mergeable
    if (pr.mergeable === false) {
      console.log('PR has conflicts and cannot be merged');
      return { success: false, message: 'PR has conflicts and cannot be merged' };
    }

    // Merge the PR
    const mergeResponse = await octokit.pulls.merge({
      owner,
      repo,
      pull_number,
      merge_method: 'merge',
      commit_title: `Merged via Rose Token on-chain approval`,
      commit_message: `Task approved on-chain.\n\nWorker: ${workerAddress}\nAutomatic merge triggered by Rose Token smart contract approval event.`
    });

    console.log('PR merged successfully:', mergeResponse.data);
    return { success: true, message: 'PR merged successfully', data: mergeResponse.data };
  } catch (error) {
    console.error('Error merging PR:', error);

    // Handle specific GitHub API errors
    if (error.status === 404) {
      return { success: false, message: 'PR not found or insufficient permissions' };
    } else if (error.status === 405) {
      return { success: false, message: 'PR is not mergeable (may have required checks pending)' };
    } else if (error.status === 409) {
      return { success: false, message: 'PR has merge conflicts' };
    }

    return { success: false, message: error.message };
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'rose-token-webhook-server'
  });
});

// Webhook endpoint for Alchemy TaskApproved events
app.post('/webhook/task-approved', async (req, res) => {
  console.log('\n=== Webhook received ===');
  console.log('Timestamp:', new Date().toISOString());
  console.log('Webhook ID:', req.body.webhookId);
  console.log('Event type:', req.body.type);

  try {
    // Log full payload for debugging
    console.log('Full payload:', JSON.stringify(req.body, null, 2));

    // Validate webhook payload structure
    if (!req.body.event || !req.body.event.activity || !Array.isArray(req.body.event.activity)) {
      console.log('Invalid webhook payload structure');
      return res.status(200).send('OK');
    }

    // Process each activity in the webhook
    for (const activity of req.body.event.activity) {
      console.log('\n--- Processing activity ---');
      console.log('Transaction hash:', activity.hash);
      console.log('Block number:', activity.blockNum);

      // Verify contract address if configured
      if (activity.log && activity.log.address) {
        console.log('Contract address:', activity.log.address);

        if (!verifyContractAddress(activity.log.address)) {
          console.log('Skipping event from unexpected contract address');
          continue;
        }
      }

      // Decode the TaskApproved event
      const eventData = decodeTaskApprovedEvent(activity);

      if (!eventData) {
        console.log('Could not decode TaskApproved event, skipping');
        continue;
      }

      console.log('Decoded event data:');
      console.log('  Task ID:', eventData.taskId);
      console.log('  Worker:', eventData.worker);
      console.log('  GitHub PR URL:', eventData.githubPrUrl);

      // Parse GitHub PR URL
      const prDetails = parseGitHubPrUrl(eventData.githubPrUrl);

      if (!prDetails) {
        console.error('Invalid GitHub PR URL format:', eventData.githubPrUrl);
        continue;
      }

      console.log('Parsed PR details:');
      console.log('  Owner:', prDetails.owner);
      console.log('  Repo:', prDetails.repo);
      console.log('  PR Number:', prDetails.pull_number);

      // Merge the PR
      const mergeResult = await mergeGitHubPr(prDetails, eventData.worker);

      if (mergeResult.success) {
        console.log('✓ SUCCESS:', mergeResult.message);
      } else {
        console.error('✗ FAILED:', mergeResult.message);
      }
    }

    console.log('=== Webhook processing complete ===\n');

    // Always return 200 to Alchemy to prevent retries
    res.status(200).send('OK');
  } catch (error) {
    console.error('Webhook processing error:', error);
    // Still return 200 to prevent Alchemy retries on permanent failures
    res.status(200).send('OK');
  }
});

// Serve frontend static files
app.use(express.static(path.join(__dirname, 'frontend/build')));

// Frontend routing - serve index.html for all other routes
// This must be AFTER all API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend/build/index.html'));
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('=================================');
  console.log('Rose Token Webhook Server');
  console.log('=================================');
  console.log(`Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Webhook endpoint: http://localhost:${PORT}/webhook/task-approved`);
  console.log(`Frontend: http://localhost:${PORT}`);
  console.log('---------------------------------');

  if (EXPECTED_MARKETPLACE_ADDRESS) {
    console.log(`✅ Marketplace address: ${EXPECTED_MARKETPLACE_ADDRESS}`);
    console.log('   (Contract address verification ENABLED)');
  } else {
    console.log('⚠️  Marketplace address: NOT CONFIGURED');
    console.log('   (Accepting events from ANY contract)');
    console.log('   Set MARKETPLACE_ADDRESS in .env to enable verification');
  }

  console.log('=================================\n');
});
