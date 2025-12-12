/**
 * Slow Track Routes
 *
 * HTTP endpoints for Slow Track VP allocation management.
 * Provides attestations for voteSlow() contract calls and allocation queries.
 */

import { Router, Request, Response } from 'express';
import { ethers } from 'ethers';
import {
  getActiveAllocations,
  getAvailableVP,
  getSlowTrackAttestation,
  getAllocationStats,
} from '../services/allocations';
import { getSlowTrackWatcherStats } from '../services/slowTrackWatcher';

const router = Router();

// Types for request/response
interface AttestationRequest {
  user: string;
  proposalId: number;
  support: boolean;
  vpAmount: string;
  totalVP: string;
}

interface ErrorResponse {
  error: string;
}

/**
 * POST /api/slow-track/attestation
 * Get signed attestation for voteSlow() contract call.
 *
 * Request body:
 *   - user: Voter address
 *   - proposalId: Proposal to vote on
 *   - support: true for For, false for Against
 *   - vpAmount: Amount of VP to allocate (as string)
 *   - totalVP: User's total VP (as string, from frontend calculation)
 *
 * Response:
 *   - user: Checksummed voter address
 *   - proposalId: Proposal ID
 *   - support: Vote direction
 *   - vpAmount: Amount allocated (as string)
 *   - availableVP: User's available VP after existing allocations (as string)
 *   - nonce: Current allocation nonce (as string)
 *   - expiry: Signature expiration timestamp
 *   - signature: Backend signature for contract verification
 */
router.post('/attestation', async (req: Request, res: Response) => {
  try {
    const { user, proposalId, support, vpAmount, totalVP } = req.body as AttestationRequest;

    // Validate inputs
    if (!user || !ethers.isAddress(user)) {
      return res.status(400).json({ error: 'Invalid user address' } as ErrorResponse);
    }

    if (typeof proposalId !== 'number' || proposalId < 0) {
      return res.status(400).json({ error: 'Invalid proposalId' } as ErrorResponse);
    }

    if (typeof support !== 'boolean') {
      return res.status(400).json({ error: 'Invalid support value (must be boolean)' } as ErrorResponse);
    }

    if (!vpAmount || typeof vpAmount !== 'string') {
      return res.status(400).json({ error: 'Invalid vpAmount (must be string)' } as ErrorResponse);
    }

    if (!totalVP || typeof totalVP !== 'string') {
      return res.status(400).json({ error: 'Invalid totalVP (must be string)' } as ErrorResponse);
    }

    // Parse BigInt values
    let vpAmountBigInt: bigint;
    let totalVPBigInt: bigint;

    try {
      vpAmountBigInt = BigInt(vpAmount);
      totalVPBigInt = BigInt(totalVP);
    } catch {
      return res.status(400).json({ error: 'Invalid numeric values' } as ErrorResponse);
    }

    if (vpAmountBigInt <= 0n) {
      return res.status(400).json({ error: 'vpAmount must be positive' } as ErrorResponse);
    }

    // Get attestation
    const attestation = await getSlowTrackAttestation(
      user,
      proposalId,
      support,
      vpAmountBigInt,
      totalVPBigInt
    );

    return res.json(attestation);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[SlowTrack] Attestation error:', errorMsg);

    // Return specific error message for insufficient VP
    if (errorMsg.includes('Insufficient available VP')) {
      return res.status(400).json({ error: errorMsg } as ErrorResponse);
    }

    return res.status(500).json({ error: 'Failed to generate attestation' } as ErrorResponse);
  }
});

/**
 * GET /api/slow-track/allocations/:address
 * Get user's active VP allocations for Slow Track proposals.
 *
 * Response:
 *   - user: Checksummed address
 *   - allocations: Array of active allocations
 *   - totalAllocated: Sum of all active allocations (as string)
 */
router.get('/allocations/:address', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;

    if (!ethers.isAddress(address)) {
      return res.status(400).json({ error: 'Invalid address' } as ErrorResponse);
    }

    const allocations = await getActiveAllocations(address);

    // Calculate total allocated
    const totalAllocated = allocations.reduce((sum, a) => sum + a.vpAmount, 0n);

    // Format allocations for response
    const formattedAllocations = allocations.map((a) => ({
      proposalId: a.proposalId,
      vpAmount: a.vpAmount.toString(),
      support: a.support,
      deadline: a.deadline,
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
    }));

    return res.json({
      user: ethers.getAddress(address),
      allocations: formattedAllocations,
      totalAllocated: totalAllocated.toString(),
    });
  } catch (error) {
    console.error('[SlowTrack] Error fetching allocations:', error);
    return res.status(500).json({ error: 'Failed to fetch allocations' } as ErrorResponse);
  }
});

/**
 * GET /api/slow-track/available/:address
 * Get user's available VP for Slow Track voting.
 *
 * Query params:
 *   - totalVP: User's total VP (required, as string)
 *
 * Response:
 *   - user: Checksummed address
 *   - totalVP: User's total VP (as string)
 *   - allocatedVP: VP already allocated to proposals (as string)
 *   - availableVP: VP available for new votes (as string)
 */
router.get('/available/:address', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;
    const { totalVP } = req.query;

    if (!ethers.isAddress(address)) {
      return res.status(400).json({ error: 'Invalid address' } as ErrorResponse);
    }

    if (!totalVP || typeof totalVP !== 'string') {
      return res.status(400).json({ error: 'totalVP query parameter required' } as ErrorResponse);
    }

    let totalVPBigInt: bigint;
    try {
      totalVPBigInt = BigInt(totalVP);
    } catch {
      return res.status(400).json({ error: 'Invalid totalVP value' } as ErrorResponse);
    }

    const result = await getAvailableVP(address, totalVPBigInt);

    return res.json({
      user: ethers.getAddress(address),
      totalVP: result.totalVP.toString(),
      allocatedVP: result.allocatedVP.toString(),
      availableVP: result.availableVP.toString(),
      allocations: result.allocations.map(alloc => ({
        proposalId: alloc.proposalId,
        vpAmount: alloc.vpAmount.toString(),
        support: alloc.support,
        deadline: alloc.deadline,
      })),
    });
  } catch (error) {
    console.error('[SlowTrack] Error fetching available VP:', error);
    return res.status(500).json({ error: 'Failed to fetch available VP' } as ErrorResponse);
  }
});

/**
 * GET /api/slow-track/stats
 * Get allocation and watcher statistics for monitoring.
 *
 * Response:
 *   - allocations: Allocation stats (total, active, unique users/proposals)
 *   - watcher: Watcher stats (running, events processed, last error)
 */
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const [allocationStats, watcherStats] = await Promise.all([
      getAllocationStats(),
      Promise.resolve(getSlowTrackWatcherStats()),
    ]);

    return res.json({
      allocations: allocationStats,
      watcher: watcherStats,
    });
  } catch (error) {
    console.error('[SlowTrack] Error fetching stats:', error);
    return res.status(500).json({ error: 'Failed to fetch stats' } as ErrorResponse);
  }
});

export default router;
