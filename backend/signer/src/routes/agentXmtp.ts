/**
 * Agent XMTP Routes
 *
 * REST API endpoints for agents to send and check XMTP messages.
 * Agents can:
 *   - Send DMs to other agents/addresses
 *   - Check if addresses are reachable on XMTP
 *   - Get XMTP service status
 *   - Submit bug reports (auto-sent to the dev team)
 *
 * All endpoints require API key authentication.
 */

import { Router, Request, Response } from 'express';
import { ethers } from 'ethers';
import { agentAuth } from '../middleware/agentAuth';
import {
  sendDm,
  checkReachability,
  getXmtpStatus,
  isXmtpReady,
} from '../services/xmtp';

const router = Router();

// All XMTP endpoints require agent authentication
router.use(agentAuth);

// Dev team address for bug reports
const BUG_REPORT_ADDRESS = process.env.BUG_REPORT_XMTP_ADDRESS || '0x3dbEf3f83bA2248fB500dd537436FC65E6F96BF1';

/**
 * GET /api/agent/xmtp/status
 * Get XMTP service status — whether messaging is available.
 */
router.get('/xmtp/status', async (_req: Request, res: Response) => {
  const status = getXmtpStatus();
  return res.json({
    success: true,
    xmtp: status,
  });
});

/**
 * POST /api/agent/xmtp/send
 * Send a DM to an Ethereum address via XMTP.
 *
 * Body:
 * - to: Recipient Ethereum address (string)
 * - message: Text message to send (string, max 10000 chars)
 */
router.post('/xmtp/send', async (req: Request, res: Response) => {
  if (!isXmtpReady()) {
    return res.status(503).json({ error: 'XMTP service is not available' });
  }

  const { to, message } = req.body;

  if (!to || typeof to !== 'string' || !ethers.isAddress(to)) {
    return res.status(400).json({ error: 'to is required (valid Ethereum address)' });
  }

  if (!message || typeof message !== 'string' || message.length === 0) {
    return res.status(400).json({ error: 'message is required (non-empty string)' });
  }

  if (message.length > 10000) {
    return res.status(400).json({ error: 'message too long (max 10000 characters)' });
  }

  const agentAddress = req.agent!.walletAddress;
  const result = await sendDm(to, `From ${agentAddress}:\n\n${message}`);

  if (result.success) {
    return res.json({
      success: true,
      from: agentAddress,
      to,
      conversationId: result.conversationId,
      messageId: result.messageId,
    });
  } else {
    return res.status(400).json({
      success: false,
      error: result.error,
    });
  }
});

/**
 * POST /api/agent/xmtp/can-message
 * Check if one or more addresses are reachable on XMTP.
 *
 * Body:
 * - addresses: Array of Ethereum addresses (string[], max 50)
 */
router.post('/xmtp/can-message', async (req: Request, res: Response) => {
  if (!isXmtpReady()) {
    return res.status(503).json({ error: 'XMTP service is not available' });
  }

  const { addresses } = req.body;

  if (!addresses || !Array.isArray(addresses) || addresses.length === 0) {
    return res.status(400).json({ error: 'addresses is required (array of Ethereum addresses)' });
  }

  if (addresses.length > 50) {
    return res.status(400).json({ error: 'Maximum 50 addresses per request' });
  }

  const invalidAddrs = addresses.filter((a: any) => !ethers.isAddress(a));
  if (invalidAddrs.length > 0) {
    return res.status(400).json({ error: `Invalid addresses: ${invalidAddrs.join(', ')}` });
  }

  const results = await checkReachability(addresses);

  return res.json({
    success: true,
    results,
  });
});

/**
 * POST /api/agent/xmtp/bug-report
 * Submit a bug report via XMTP to the dev team.
 * Structured format ensures consistent, actionable reports.
 *
 * Body:
 * - endpoint: The API endpoint where the bug occurred (string)
 * - method: HTTP method (string, e.g. "POST")
 * - error: The error message received (string)
 * - stackTrace: Stack trace if available (string, optional)
 * - stepsToReproduce: Steps to reproduce the bug (string)
 * - expectedBehavior: What should have happened (string, optional)
 * - actualBehavior: What actually happened (string, optional)
 * - requestBody: The request body sent (object, optional)
 */
router.post('/xmtp/bug-report', async (req: Request, res: Response) => {
  if (!isXmtpReady()) {
    return res.status(503).json({ error: 'XMTP service is not available' });
  }

  const {
    endpoint,
    method,
    error: errorMsg,
    stackTrace,
    stepsToReproduce,
    expectedBehavior,
    actualBehavior,
    requestBody,
  } = req.body;

  if (!endpoint || typeof endpoint !== 'string') {
    return res.status(400).json({ error: 'endpoint is required (e.g. "/api/agent/marketplace/tasks/42/accept-bid")' });
  }
  if (!method || typeof method !== 'string') {
    return res.status(400).json({ error: 'method is required (e.g. "POST")' });
  }
  if (!errorMsg || typeof errorMsg !== 'string') {
    return res.status(400).json({ error: 'error is required (the error message received)' });
  }
  if (!stepsToReproduce || typeof stepsToReproduce !== 'string') {
    return res.status(400).json({ error: 'stepsToReproduce is required' });
  }

  const agentAddress = req.agent!.walletAddress;
  const timestamp = new Date().toISOString();

  // Format the bug report
  const reportLines = [
    `🐛 Bug Report — ${timestamp}`,
    ``,
    `Agent: ${agentAddress}`,
    `Endpoint: ${method.toUpperCase()} ${endpoint}`,
    ``,
    `Error: ${errorMsg}`,
  ];

  if (stackTrace) {
    reportLines.push(``, `Stack Trace:`, stackTrace);
  }

  reportLines.push(``, `Steps to Reproduce:`, stepsToReproduce);

  if (expectedBehavior) {
    reportLines.push(``, `Expected: ${expectedBehavior}`);
  }
  if (actualBehavior) {
    reportLines.push(`Actual: ${actualBehavior}`);
  }
  if (requestBody) {
    reportLines.push(``, `Request Body:`, JSON.stringify(requestBody, null, 2));
  }

  const report = reportLines.join('\n');

  // Send to dev team
  const result = await sendDm(BUG_REPORT_ADDRESS, report);

  if (result.success) {
    console.log(`[XMTP] Bug report from ${agentAddress}: ${method} ${endpoint}`);
    return res.json({
      success: true,
      message: 'Bug report submitted. Thank you for helping improve Rose Token!',
      reportId: result.messageId,
    });
  } else {
    return res.status(500).json({
      success: false,
      error: `Failed to send bug report: ${result.error}`,
      fallback: `Please send your report manually via XMTP to ${BUG_REPORT_ADDRESS}`,
    });
  }
});

export default router;
