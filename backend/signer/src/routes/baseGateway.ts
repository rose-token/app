/**
 * Base Gateway Routes
 *
 * API endpoints for agents to track cross-chain deposit/redeem progress
 * through the Base Gateway.
 *
 * All endpoints require agent authentication (API key).
 */

import { Router, Request, Response } from 'express';
import { ethers } from 'ethers';
import { agentAuth } from '../middleware/agentAuth';
import {
  getBaseGatewayStats,
  getDepositByBaseTxHash,
  getRedeemByBaseTxHash,
  getPendingDepositByNonce,
  getPendingRedeemById,
  getAllPendingDeposits,
  getAllPendingRedeems,
  retryDeposit,
  retryRedeem,
  PendingDepositInfo,
  PendingRedeemInfo,
} from '../services/baseGateway';

const router = Router();

// All gateway endpoints require agent authentication
router.use(agentAuth);

// ──────────────────────────────────────────────
//  Serialization helpers
// ──────────────────────────────────────────────

function serializeDeposit(d: PendingDepositInfo) {
  return {
    cctpNonce: d.cctpNonce.toString(),
    agent: d.agent,
    usdcAmount: d.usdcAmount.toString(),
    usdcAmountFormatted: ethers.formatUnits(d.usdcAmount, 6),
    status: d.status,
    baseTxHash: d.baseTxHash,
    arbReceiveTxHash: d.arbReceiveTxHash || null,
    arbDepositTxHash: d.arbDepositTxHash || null,
    baseCompleteTxHash: d.baseCompleteTxHash || null,
    roseAmount: d.roseAmount?.toString() || null,
    roseAmountFormatted: d.roseAmount ? ethers.formatUnits(d.roseAmount, 18) : null,
    error: d.error || null,
    startedAt: new Date(d.startedAt).toISOString(),
    updatedAt: new Date(d.updatedAt).toISOString(),
    // Step tracking for UI
    steps: {
      initiated: true,
      bridging: ['bridging', 'attested', 'receiving', 'executing', 'completing', 'completed'].includes(d.status),
      attested: ['attested', 'receiving', 'executing', 'completing', 'completed'].includes(d.status),
      usdcReceived: ['executing', 'completing', 'completed'].includes(d.status),
      deposited: ['completing', 'completed'].includes(d.status),
      completed: d.status === 'completed',
    },
  };
}

function serializeRedeem(r: PendingRedeemInfo) {
  return {
    redeemId: r.redeemId.toString(),
    agent: r.agent,
    roseAmount: r.roseAmount.toString(),
    roseAmountFormatted: ethers.formatUnits(r.roseAmount, 18),
    status: r.status,
    baseTxHash: r.baseTxHash,
    usdcAmount: r.usdcAmount?.toString() || null,
    usdcAmountFormatted: r.usdcAmount ? ethers.formatUnits(r.usdcAmount, 6) : null,
    arbRedeemTxHash: r.arbRedeemTxHash || null,
    baseReceiveTxHash: r.baseReceiveTxHash || null,
    baseCompleteTxHash: r.baseCompleteTxHash || null,
    error: r.error || null,
    startedAt: new Date(r.startedAt).toISOString(),
    updatedAt: new Date(r.updatedAt).toISOString(),
    steps: {
      requested: true,
      redeemed: ['bridging', 'attested', 'receiving', 'completing', 'completed'].includes(r.status),
      bridging: ['bridging', 'attested', 'receiving', 'completing', 'completed'].includes(r.status),
      attested: ['attested', 'receiving', 'completing', 'completed'].includes(r.status),
      usdcReceived: ['completing', 'completed'].includes(r.status),
      completed: r.status === 'completed',
    },
  };
}

// ──────────────────────────────────────────────
//  Routes
// ──────────────────────────────────────────────

/**
 * GET /api/agent/gateway/status
 *
 * Returns the overall status of the Base Gateway watcher service,
 * including counts of pending/completed/failed operations.
 */
router.get('/gateway/status', async (_req: Request, res: Response) => {
  try {
    const stats = getBaseGatewayStats();

    return res.json({
      service: 'base-gateway',
      ...stats,
      startedAt: stats.startedAt?.toISOString() || null,
    });
  } catch (error) {
    console.error('[BaseGateway:Route] Status error:', error);
    return res.status(500).json({ error: 'Failed to get gateway status' });
  }
});

/**
 * GET /api/agent/gateway/deposit-status/:txHash
 *
 * Track the progress of a cross-chain deposit by its Base chain transaction hash.
 * This is the primary endpoint agents use to poll for deposit completion.
 */
router.get('/gateway/deposit-status/:txHash', async (req: Request, res: Response) => {
  try {
    const { txHash } = req.params;

    if (!txHash || !txHash.startsWith('0x')) {
      return res.status(400).json({ error: 'Invalid transaction hash' });
    }

    const deposit = getDepositByBaseTxHash(txHash);

    if (!deposit) {
      return res.status(404).json({
        error: 'Deposit not found',
        hint: 'The deposit may not have been detected yet. Try again in a few seconds.',
      });
    }

    return res.json({
      found: true,
      type: 'deposit',
      ...serializeDeposit(deposit),
    });
  } catch (error) {
    console.error('[BaseGateway:Route] Deposit status error:', error);
    return res.status(500).json({ error: 'Failed to get deposit status' });
  }
});

/**
 * GET /api/agent/gateway/redeem-status/:txHash
 *
 * Track the progress of a cross-chain redeem by its Base chain transaction hash.
 */
router.get('/gateway/redeem-status/:txHash', async (req: Request, res: Response) => {
  try {
    const { txHash } = req.params;

    if (!txHash || !txHash.startsWith('0x')) {
      return res.status(400).json({ error: 'Invalid transaction hash' });
    }

    const redeem = getRedeemByBaseTxHash(txHash);

    if (!redeem) {
      return res.status(404).json({
        error: 'Redeem not found',
        hint: 'The redeem request may not have been detected yet. Try again in a few seconds.',
      });
    }

    return res.json({
      found: true,
      type: 'redeem',
      ...serializeRedeem(redeem),
    });
  } catch (error) {
    console.error('[BaseGateway:Route] Redeem status error:', error);
    return res.status(500).json({ error: 'Failed to get redeem status' });
  }
});

/**
 * GET /api/agent/gateway/deposit/:nonce
 *
 * Get deposit details by CCTP nonce.
 */
router.get('/gateway/deposit/:nonce', async (req: Request, res: Response) => {
  try {
    const { nonce } = req.params;
    const deposit = getPendingDepositByNonce(nonce);

    if (!deposit) {
      return res.status(404).json({ error: 'Deposit not found for this nonce' });
    }

    return res.json({
      found: true,
      type: 'deposit',
      ...serializeDeposit(deposit),
    });
  } catch (error) {
    console.error('[BaseGateway:Route] Deposit by nonce error:', error);
    return res.status(500).json({ error: 'Failed to get deposit' });
  }
});

/**
 * GET /api/agent/gateway/redeem/:redeemId
 *
 * Get redeem details by redeem ID.
 */
router.get('/gateway/redeem/:redeemId', async (req: Request, res: Response) => {
  try {
    const { redeemId } = req.params;
    const redeem = getPendingRedeemById(redeemId);

    if (!redeem) {
      return res.status(404).json({ error: 'Redeem not found for this ID' });
    }

    return res.json({
      found: true,
      type: 'redeem',
      ...serializeRedeem(redeem),
    });
  } catch (error) {
    console.error('[BaseGateway:Route] Redeem by ID error:', error);
    return res.status(500).json({ error: 'Failed to get redeem' });
  }
});

/**
 * GET /api/agent/gateway/my-deposits
 *
 * List all deposits for the authenticated agent.
 */
router.get('/gateway/my-deposits', async (req: Request, res: Response) => {
  try {
    const agentAddress = req.agent!.walletAddress.toLowerCase();
    const allDeposits = getAllPendingDeposits();

    const myDeposits = allDeposits
      .filter((d) => d.agent.toLowerCase() === agentAddress)
      .sort((a, b) => b.startedAt - a.startedAt)
      .map(serializeDeposit);

    return res.json({
      agent: req.agent!.walletAddress,
      count: myDeposits.length,
      deposits: myDeposits,
    });
  } catch (error) {
    console.error('[BaseGateway:Route] My deposits error:', error);
    return res.status(500).json({ error: 'Failed to get deposits' });
  }
});

/**
 * GET /api/agent/gateway/my-redeems
 *
 * List all redeems for the authenticated agent.
 */
router.get('/gateway/my-redeems', async (req: Request, res: Response) => {
  try {
    const agentAddress = req.agent!.walletAddress.toLowerCase();
    const allRedeems = getAllPendingRedeems();

    const myRedeems = allRedeems
      .filter((r) => r.agent.toLowerCase() === agentAddress)
      .sort((a, b) => b.startedAt - a.startedAt)
      .map(serializeRedeem);

    return res.json({
      agent: req.agent!.walletAddress,
      count: myRedeems.length,
      redeems: myRedeems,
    });
  } catch (error) {
    console.error('[BaseGateway:Route] My redeems error:', error);
    return res.status(500).json({ error: 'Failed to get redeems' });
  }
});

/**
 * POST /api/agent/gateway/retry-deposit/:nonce
 *
 * Retry a failed deposit. Only works if the deposit status is 'failed'.
 */
router.post('/gateway/retry-deposit/:nonce', async (req: Request, res: Response) => {
  try {
    const { nonce } = req.params;

    const deposit = getPendingDepositByNonce(nonce);
    if (!deposit) {
      return res.status(404).json({ error: 'Deposit not found' });
    }

    // Only the agent who initiated the deposit (or any authenticated agent for now) can retry
    if (deposit.status !== 'failed') {
      return res.status(400).json({
        error: `Cannot retry deposit with status '${deposit.status}'. Only 'failed' deposits can be retried.`,
      });
    }

    const success = await retryDeposit(nonce);
    if (!success) {
      return res.status(400).json({ error: 'Failed to enqueue retry' });
    }

    return res.json({
      success: true,
      message: `Deposit nonce ${nonce} queued for retry`,
      status: 'pending',
    });
  } catch (error) {
    console.error('[BaseGateway:Route] Retry deposit error:', error);
    return res.status(500).json({ error: 'Failed to retry deposit' });
  }
});

/**
 * POST /api/agent/gateway/retry-redeem/:redeemId
 *
 * Retry a failed redeem. Only works if the redeem status is 'failed'.
 */
router.post('/gateway/retry-redeem/:redeemId', async (req: Request, res: Response) => {
  try {
    const { redeemId } = req.params;

    const redeem = getPendingRedeemById(redeemId);
    if (!redeem) {
      return res.status(404).json({ error: 'Redeem not found' });
    }

    if (redeem.status !== 'failed') {
      return res.status(400).json({
        error: `Cannot retry redeem with status '${redeem.status}'. Only 'failed' redeems can be retried.`,
      });
    }

    const success = await retryRedeem(redeemId);
    if (!success) {
      return res.status(400).json({ error: 'Failed to enqueue retry' });
    }

    return res.json({
      success: true,
      message: `Redeem ${redeemId} queued for retry`,
      status: 'pending',
    });
  } catch (error) {
    console.error('[BaseGateway:Route] Retry redeem error:', error);
    return res.status(500).json({ error: 'Failed to retry redeem' });
  }
});

export default router;
