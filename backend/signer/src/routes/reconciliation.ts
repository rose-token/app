import { Router, Request, Response } from 'express';
import {
  runReconciliation,
  reconcileProposal,
  syncAllocationsFromChain,
  getReconciliationStats,
  validateDelegatorClaimPower,
} from '../services/reconciliation';
import {
  getLastReconciliationResult,
  triggerReconciliation,
} from '../cron/reconciliation';
import { config } from '../config';

const router = Router();

// Validate Ethereum address
function isValidAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * GET /api/reconciliation/status
 * Get current reconciliation status and last result
 */
router.get('/status', async (_req: Request, res: Response) => {
  try {
    if (!config.contracts.governance) {
      return res.status(500).json({ error: 'Governance contract not configured' });
    }

    const lastResult = getLastReconciliationResult();
    const stats = await getReconciliationStats();

    return res.json({
      lastReconciliation: lastResult?.checkedAt || null,
      isHealthy: lastResult?.isHealthy ?? null,
      discrepancyCount: lastResult?.discrepancies.length ?? 0,
      stats,
    });
  } catch (error) {
    console.error('Get reconciliation status error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/reconciliation/last
 * Get full last reconciliation result
 */
router.get('/last', (_req: Request, res: Response) => {
  try {
    const lastResult = getLastReconciliationResult();

    if (!lastResult) {
      return res.status(404).json({ error: 'No reconciliation has been run yet' });
    }

    return res.json(lastResult);
  } catch (error) {
    console.error('Get last reconciliation error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/reconciliation/run
 * Manually trigger a full reconciliation
 */
router.post('/run', async (_req: Request, res: Response) => {
  try {
    if (!config.contracts.governance) {
      return res.status(500).json({ error: 'Governance contract not configured' });
    }

    if (!config.database.url) {
      return res.status(500).json({ error: 'Database not configured' });
    }

    const result = await triggerReconciliation();
    return res.json(result);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Internal server error';
    console.error('Run reconciliation error:', error);

    if (errMsg.includes('already in progress')) {
      return res.status(409).json({ error: errMsg });
    }

    return res.status(500).json({ error: errMsg });
  }
});

/**
 * GET /api/reconciliation/proposal/:proposalId
 * Run reconciliation for a specific proposal
 */
router.get('/proposal/:proposalId', async (req: Request, res: Response) => {
  try {
    const proposalId = parseInt(req.params.proposalId);

    if (isNaN(proposalId) || proposalId < 1) {
      return res.status(400).json({ error: 'Invalid proposalId' });
    }

    if (!config.contracts.governance) {
      return res.status(500).json({ error: 'Governance contract not configured' });
    }

    const result = await reconcileProposal(proposalId);
    return res.json(result);
  } catch (error) {
    console.error('Reconcile proposal error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/reconciliation/sync
 * Sync DB allocations from on-chain for a specific proposal/delegate
 */
router.post('/sync', async (req: Request, res: Response) => {
  try {
    const { proposalId, delegate } = req.body;

    if (!proposalId || typeof proposalId !== 'number' || proposalId < 1) {
      return res.status(400).json({ error: 'Invalid proposalId' });
    }

    if (!delegate || !isValidAddress(delegate)) {
      return res.status(400).json({ error: 'Invalid delegate address' });
    }

    if (!config.contracts.governance) {
      return res.status(500).json({ error: 'Governance contract not configured' });
    }

    const result = await syncAllocationsFromChain(proposalId, delegate);
    return res.json(result);
  } catch (error) {
    console.error('Sync allocations error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/reconciliation/validate/:proposalId/:delegate/:delegator
 * Validate a delegator's claimed power against on-chain
 */
router.get(
  '/validate/:proposalId/:delegate/:delegator',
  async (req: Request, res: Response) => {
    try {
      const { proposalId, delegate, delegator } = req.params;
      const claimedPower = req.query.power as string;

      const propId = parseInt(proposalId);
      if (isNaN(propId) || propId < 1) {
        return res.status(400).json({ error: 'Invalid proposalId' });
      }

      if (!isValidAddress(delegate)) {
        return res.status(400).json({ error: 'Invalid delegate address' });
      }

      if (!isValidAddress(delegator)) {
        return res.status(400).json({ error: 'Invalid delegator address' });
      }

      if (!config.contracts.governance) {
        return res.status(500).json({ error: 'Governance contract not configured' });
      }

      const claimedBigInt = claimedPower ? BigInt(claimedPower) : 0n;
      const result = await validateDelegatorClaimPower(
        propId,
        delegate,
        delegator,
        claimedBigInt
      );

      return res.json({
        proposalId: propId,
        delegate,
        delegator,
        claimedPower: claimedPower || '0',
        onChainPower: result.onChainPower.toString(),
        valid: result.valid,
      });
    } catch (error) {
      console.error('Validate claim power error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * GET /api/reconciliation/stats
 * Get statistics about delegation allocations in DB
 */
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    if (!config.database.url) {
      return res.status(500).json({ error: 'Database not configured' });
    }

    const stats = await getReconciliationStats();
    return res.json(stats);
  } catch (error) {
    console.error('Get stats error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
