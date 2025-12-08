import { Router, Request, Response } from 'express';
import { ethers } from 'ethers';
import { config } from '../config';
import { getPassportScore } from '../services/gitcoin';
import {
  computeAllocations,
  signDelegatedVote,
  isProposalActive,
  getAvailableDelegatedPower,
  getSignerAddress,
  getClaimableRewards,
  signClaimApproval,
  calculateRewardAmount,
  verifyAndStoreAllocations,
  getDelegationNonce,
  getGlobalAvailableDelegatedPower,
  computeVoteReductions,
  signUndelegateWithReduction,
} from '../services/delegation';
import { validateDelegateEligibility } from '../services/delegateScoring';
import {
  DelegationVoteRequest,
  DelegationVoteResponse,
  DelegationErrorResponse,
  ClaimableRewardsRequest,
  ClaimableRewardsResponse,
  ClaimableRewardsDisplayResponse,
  ClaimErrorResponse,
  UndelegateWithReductionRequest,
  UndelegateWithReductionResponse,
  DelegationVoteResponseV2,
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

    // Verify delegate passport score meets threshold
    const passportScore = await getPassportScore(delegate);
    if (passportScore < config.thresholds.delegate) {
      return res.status(403).json({
        error: 'Insufficient passport score for delegation',
        score: passportScore,
        threshold: config.thresholds.delegate,
      } as DelegationErrorResponse);
    }

    // Phase 3: Check delegate eligibility based on voting score
    if (config.delegateScoring.gateOnScore) {
      const eligibility = await validateDelegateEligibility(delegate);
      if (!eligibility.eligible) {
        return res.status(403).json({
          error: 'Delegate ineligible due to poor voting performance',
          reason: eligibility.reason,
          score: eligibility.score ? {
            totalVotes: eligibility.score.totalDelegatedVotes,
            winRate: eligibility.score.winRate,
          } : null,
        } as DelegationErrorResponse);
      }
    }

    // Check if proposal is active
    const active = await isProposalActive(proposalId);
    if (!active) {
      return res.status(400).json({ error: 'Proposal is not active or voting has ended' } as DelegationErrorResponse);
    }

    // Phase 1: Check GLOBAL available power (not just per-proposal)
    const globalAvailablePower = await getGlobalAvailableDelegatedPower(delegate);
    if (amountBigInt > globalAvailablePower) {
      return res.status(400).json({
        error: 'Insufficient global delegated power budget',
        availablePower: globalAvailablePower.toString(),
        requestedAmount: amount,
      } as DelegationErrorResponse);
    }

    // Also check per-proposal availability (for incremental votes)
    const availablePower = await getAvailableDelegatedPower(delegate, proposalId);
    if (amountBigInt > availablePower) {
      return res.status(400).json({
        error: 'Insufficient delegated power for this proposal',
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

    // Phase 1: Get current delegation nonce
    const nonce = await getDelegationNonce(delegate);

    // Generate expiry timestamp
    const expiry = Math.floor(Date.now() / 1000) + config.signatureTtl;

    // Phase 1: Sign the vote approval with nonce
    const signature = await signDelegatedVote(
      delegate,
      proposalId,
      amountBigInt,
      support,
      allocationsHash,
      nonce,
      expiry
    );

    // NOTE: Allocations are NOT stored here - frontend must call /confirm-vote
    // after tx confirmation to store allocations (prevents phantom data from failed txs)

    const response: DelegationVoteResponseV2 = {
      delegate,
      proposalId,
      amount,
      support,
      allocationsHash,
      allocations,
      nonce: nonce.toString(),
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

/**
 * POST /api/delegation/claim-signature
 * Get signed approval for claiming voter rewards
 */
router.post('/claim-signature', async (req: Request, res: Response) => {
  try {
    const { user } = req.body as ClaimableRewardsRequest;

    if (!user || !isValidAddress(user)) {
      return res.status(400).json({ error: 'Invalid user address' } as ClaimErrorResponse);
    }

    // Check if governance contract is configured
    if (!config.contracts.governance) {
      return res.status(500).json({ error: 'Governance contract not configured' } as ClaimErrorResponse);
    }

    // Get all claimable rewards
    const claims = await getClaimableRewards(user);

    if (claims.length === 0) {
      return res.status(400).json({ error: 'No claimable rewards' } as ClaimErrorResponse);
    }

    // Calculate total claimable
    let totalClaimable = 0n;
    for (const claim of claims) {
      totalClaimable += await calculateRewardAmount(claim);
    }

    // Generate expiry and signature
    const expiry = Math.floor(Date.now() / 1000) + config.signatureTtl;
    const signature = await signClaimApproval(user, claims, expiry);

    const response: ClaimableRewardsResponse = {
      user,
      claims,
      totalClaimable: totalClaimable.toString(),
      expiry,
      signature,
    };

    return res.json(response);
  } catch (error) {
    console.error('Claim signature error:', error);
    return res.status(500).json({ error: 'Internal server error' } as ClaimErrorResponse);
  }
});

/**
 * GET /api/delegation/claimable/:user
 * Get list of claimable rewards (no signature - for display only)
 */
router.get('/claimable/:user', async (req: Request, res: Response) => {
  try {
    const { user } = req.params;

    if (!isValidAddress(user)) {
      return res.status(400).json({ error: 'Invalid user address' } as ClaimErrorResponse);
    }

    // Check if governance contract is configured
    if (!config.contracts.governance) {
      return res.status(500).json({ error: 'Governance contract not configured' } as ClaimErrorResponse);
    }

    const claims = await getClaimableRewards(user);

    let totalClaimable = 0n;
    for (const claim of claims) {
      totalClaimable += await calculateRewardAmount(claim);
    }

    const response: ClaimableRewardsDisplayResponse = {
      user,
      claims,
      totalClaimable: totalClaimable.toString(),
    };

    return res.json(response);
  } catch (error) {
    console.error('Get claimable error:', error);
    return res.status(500).json({ error: 'Internal server error' } as ClaimErrorResponse);
  }
});

/**
 * POST /api/delegation/confirm-vote
 * Called by frontend after tx confirmation to store allocations
 * Frontend must pass the ORIGINAL allocations from /vote-signature response
 * This ensures DB reflects the allocations computed at signature time (immune to delegation changes)
 *
 * SECURITY: support value is NOT accepted from client - read from on-chain voteRecord
 */
router.post('/confirm-vote', async (req: Request, res: Response) => {
  try {
    const { delegate, proposalId, allocations } = req.body;

    if (!delegate || !isValidAddress(delegate)) {
      return res.status(400).json({ error: 'Invalid delegate address' });
    }

    if (proposalId === undefined || proposalId < 1) {
      return res.status(400).json({ error: 'Invalid proposalId' });
    }

    if (!Array.isArray(allocations) || allocations.length === 0) {
      return res.status(400).json({ error: 'Allocations array required' });
    }

    // support param NOT accepted - verifyAndStoreAllocations reads from on-chain
    const result = await verifyAndStoreAllocations(
      Number(proposalId),
      delegate,
      allocations
    );

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('Confirm vote error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/delegation/undelegate-signature
 * Phase 1: Compute vote reductions and return signed approval for undelegation
 * This allows delegators to revoke their delegation while proportionally reducing
 * active votes cast by the delegate using their VP
 */
router.post('/undelegate-signature', async (req: Request, res: Response) => {
  try {
    const { delegator, delegate, vpAmount } = req.body as UndelegateWithReductionRequest;

    // Validate inputs
    if (!delegator || !isValidAddress(delegator)) {
      return res.status(400).json({ error: 'Invalid delegator address' });
    }

    if (!delegate || !isValidAddress(delegate)) {
      return res.status(400).json({ error: 'Invalid delegate address' });
    }

    if (!vpAmount) {
      return res.status(400).json({ error: 'VP amount is required' });
    }

    let vpAmountBigInt: bigint;
    try {
      vpAmountBigInt = BigInt(vpAmount);
      if (vpAmountBigInt <= 0n) {
        return res.status(400).json({ error: 'VP amount must be positive' });
      }
    } catch {
      return res.status(400).json({ error: 'Invalid VP amount format' });
    }

    // Check if governance contract is configured
    if (!config.contracts.governance) {
      return res.status(500).json({ error: 'Governance contract not configured' });
    }

    // Compute vote reductions for active proposals
    const reductions = await computeVoteReductions(delegator, delegate, vpAmountBigInt);

    // Generate expiry timestamp
    const expiry = Math.floor(Date.now() / 1000) + config.signatureTtl;

    // Sign the undelegate with reduction approval
    const signature = await signUndelegateWithReduction(
      delegator,
      delegate,
      vpAmountBigInt,
      reductions,
      expiry
    );

    const response: UndelegateWithReductionResponse = {
      delegator,
      delegate,
      vpAmount,
      reductions,
      expiry,
      signature,
    };

    return res.json(response);
  } catch (error) {
    console.error('Undelegate signature error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/delegation/confirm-undelegate
 * Phase 2: Called by frontend after successful undelegateWithVoteReduction tx
 * Clears DB allocations for the affected proposals
 */
router.post('/confirm-undelegate', async (req: Request, res: Response) => {
  try {
    const { delegator, delegate, proposalIds } = req.body;

    if (!delegator || !isValidAddress(delegator)) {
      return res.status(400).json({ error: 'Invalid delegator address' });
    }

    if (!delegate || !isValidAddress(delegate)) {
      return res.status(400).json({ error: 'Invalid delegate address' });
    }

    if (!Array.isArray(proposalIds) || proposalIds.length === 0) {
      // No proposals affected - no cleanup needed
      return res.json({ success: true, cleared: 0 });
    }

    // Validate proposalIds
    const validProposalIds = proposalIds.filter(
      (id: unknown) => typeof id === 'number' && id > 0
    );

    if (validProposalIds.length === 0) {
      return res.json({ success: true, cleared: 0 });
    }

    // Import and call clearDelegatorAllocations
    const { clearDelegatorAllocations } = await import('../services/reconciliation');
    await clearDelegatorAllocations(delegator, delegate, validProposalIds);

    return res.json({ success: true, cleared: validProposalIds.length });
  } catch (error) {
    console.error('Confirm undelegate error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/delegation/global-power/:delegate
 * Phase 1: Get global available delegated power for a delegate
 */
router.get('/global-power/:delegate', async (req: Request, res: Response) => {
  try {
    const { delegate } = req.params;

    if (!isValidAddress(delegate)) {
      return res.status(400).json({ error: 'Invalid delegate address' });
    }

    if (!config.contracts.governance) {
      return res.status(500).json({ error: 'Governance contract not configured' });
    }

    const globalAvailablePower = await getGlobalAvailableDelegatedPower(delegate);
    const nonce = await getDelegationNonce(delegate);

    return res.json({
      delegate,
      globalAvailablePower: globalAvailablePower.toString(),
      nonce: nonce.toString(),
    });
  } catch (error) {
    console.error('Get global power error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
