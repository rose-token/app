import { Router, Request, Response } from 'express';
import { ethers } from 'ethers';
import { config } from '../config';
import {
  computeAllocations,
  signDelegatedVote,
  isProposalActive,
  getAvailableDelegatedPower,
  getSignerAddress,
} from '../services/delegation';
import {
  DelegationVoteRequest,
  DelegationVoteResponse,
  DelegationErrorResponse,
} from '../types';

const router = Router();

// Validate Ethereum address
function isValidAddress(address: string): boolean {
  return ethers.isAddress(address);
}

/**
 * POST /api/delegation/vote-signature
 * Compute allocations and return signed approval for delegated vote
 */
router.post('/vote-signature', async (req: Request, res: Response) => {
  try {
    const { delegate, proposalId, amount, support } = req.body as DelegationVoteRequest;

    // Validate inputs
    if (!delegate || !isValidAddress(delegate)) {
      return res.status(400).json({ error: 'Invalid delegate address' } as DelegationErrorResponse);
    }

    if (proposalId === undefined || proposalId < 1) {
      return res.status(400).json({ error: 'Invalid proposalId' } as DelegationErrorResponse);
    }

    if (!amount) {
      return res.status(400).json({ error: 'Amount is required' } as DelegationErrorResponse);
    }

    let amountBigInt: bigint;
    try {
      amountBigInt = BigInt(amount);
      if (amountBigInt <= 0n) {
        return res.status(400).json({ error: 'Amount must be positive' } as DelegationErrorResponse);
      }
    } catch {
      return res.status(400).json({ error: 'Invalid amount format' } as DelegationErrorResponse);
    }

    if (typeof support !== 'boolean') {
      return res.status(400).json({ error: 'Support must be a boolean' } as DelegationErrorResponse);
    }

    // Check if governance contract is configured
    if (!config.contracts.governance) {
      return res.status(500).json({ error: 'Governance contract not configured' } as DelegationErrorResponse);
    }

    // Check if proposal is active
    const active = await isProposalActive(proposalId);
    if (!active) {
      return res.status(400).json({ error: 'Proposal is not active or voting has ended' } as DelegationErrorResponse);
    }

    // Check available power
    const availablePower = await getAvailableDelegatedPower(delegate, proposalId);
    if (amountBigInt > availablePower) {
      return res.status(400).json({
        error: 'Insufficient delegated power',
        availablePower: availablePower.toString(),
        requestedAmount: amount,
      } as DelegationErrorResponse);
    }

    // Compute allocations
    const { allocations, allocationsHash } = await computeAllocations(
      delegate,
      proposalId,
      amountBigInt
    );

    // Generate expiry timestamp
    const expiry = Math.floor(Date.now() / 1000) + config.signatureTtl;

    // Sign the vote approval
    const signature = await signDelegatedVote(
      delegate,
      proposalId,
      amountBigInt,
      support,
      allocationsHash,
      expiry
    );

    const response: DelegationVoteResponse = {
      delegate,
      proposalId,
      amount,
      support,
      allocationsHash,
      allocations,
      expiry,
      signature,
    };

    return res.json(response);
  } catch (error) {
    console.error('Delegation vote signature error:', error);

    if (error instanceof Error) {
      // Return user-friendly error messages
      if (error.message.includes('No delegators found')) {
        return res.status(400).json({ error: 'No delegators found for this delegate' } as DelegationErrorResponse);
      }
      if (error.message.includes('No delegated power')) {
        return res.status(400).json({ error: 'No delegated power available' } as DelegationErrorResponse);
      }
      if (error.message.includes('Insufficient delegated power')) {
        return res.status(400).json({ error: error.message } as DelegationErrorResponse);
      }
    }

    return res.status(500).json({ error: 'Internal server error' } as DelegationErrorResponse);
  }
});

/**
 * GET /api/delegation/available-power/:delegate/:proposalId
 * Get available delegated power for a delegate on a proposal
 */
router.get('/available-power/:delegate/:proposalId', async (req: Request, res: Response) => {
  try {
    const { delegate, proposalId } = req.params;

    if (!isValidAddress(delegate)) {
      return res.status(400).json({ error: 'Invalid delegate address' });
    }

    const propId = parseInt(proposalId);
    if (isNaN(propId) || propId < 1) {
      return res.status(400).json({ error: 'Invalid proposalId' });
    }

    if (!config.contracts.governance) {
      return res.status(500).json({ error: 'Governance contract not configured' });
    }

    const availablePower = await getAvailableDelegatedPower(delegate, propId);

    return res.json({
      delegate,
      proposalId: propId,
      availablePower: availablePower.toString(),
    });
  } catch (error) {
    console.error('Get available power error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/delegation/signer
 * Get delegation signer address (for contract configuration)
 */
router.get('/signer', (_req: Request, res: Response) => {
  res.json({ signer: getSignerAddress() });
});

export default router;
