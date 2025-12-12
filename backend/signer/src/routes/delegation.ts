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
 *
 * NOTE: delegation_allocations table was removed in Governance V2 migration.
 * No DB cleanup needed - allocations tracked on-chain only.
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

    // delegation_allocations table was removed in Governance V2 migration
    // No DB cleanup needed - allocations tracked on-chain only
    console.log(`[Delegation] confirm-undelegate is no-op (Governance V2) - ${validProposalIds.length} proposals`);

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

// ============================================================
// DelegationV2 Endpoints (Off-Chain EIP-712 Delegations)
// ============================================================

import {
  storeDelegation,
  getUserDelegations,
  getReceivedDelegations,
  revokeDelegation,
  getNextNonce,
  getDelegationStats,
  getEIP712Config,
  verifyDelegateOptIn,
  verifyRevocationSignature,
  getEligibleDelegates,
} from '../services/delegationV2';
import {
  DelegationV2Request,
  DelegationV2Response,
  UserDelegationsResponse,
  ReceivedDelegationsV2Response,
  RevokeDelegationRequest,
  RevokeDelegationResponse,
  NextNonceResponse,
  DelegationV2StatsResponse,
  DelegationEIP712ConfigResponse,
  DelegationV2ErrorResponse,
} from '../types';

/**
 * POST /api/delegation/v2/store
 * Store a new EIP-712 signed delegation
 */
router.post('/v2/store', async (req: Request, res: Response) => {
  try {
    const input = req.body as DelegationV2Request;

    // Validate required fields
    if (!input.delegator || !isValidAddress(input.delegator)) {
      return res.status(400).json({ error: 'Invalid delegator address' } as DelegationV2ErrorResponse);
    }

    if (!input.delegate || !isValidAddress(input.delegate)) {
      return res.status(400).json({ error: 'Invalid delegate address' } as DelegationV2ErrorResponse);
    }

    if (input.vpAmount === undefined || input.vpAmount === null) {
      return res.status(400).json({ error: 'vpAmount is required' } as DelegationV2ErrorResponse);
    }

    if (typeof input.nonce !== 'number' || input.nonce < 0) {
      return res.status(400).json({ error: 'Invalid nonce' } as DelegationV2ErrorResponse);
    }

    if (typeof input.expiry !== 'number' || input.expiry <= 0) {
      return res.status(400).json({ error: 'Invalid expiry' } as DelegationV2ErrorResponse);
    }

    if (!input.signature || typeof input.signature !== 'string') {
      return res.status(400).json({ error: 'Signature is required' } as DelegationV2ErrorResponse);
    }

    // Store the delegation
    await storeDelegation(input);

    return res.json({ success: true } as DelegationV2Response);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[DelegationV2] Store error:', errorMsg);

    // Return specific error messages for validation failures
    if (errorMsg.includes('Invalid signature') ||
        errorMsg.includes('Invalid nonce') ||
        errorMsg.includes('has already expired') ||
        errorMsg.includes('not opted in') ||
        errorMsg.includes('vpAmount cannot be negative') ||
        errorMsg.includes('Invalid vpAmount')) {
      return res.status(400).json({ error: errorMsg } as DelegationV2ErrorResponse);
    }

    // RPC errors should be 503 Service Unavailable
    if (errorMsg.includes('Failed to verify delegate opt-in')) {
      return res.status(503).json({ error: errorMsg } as DelegationV2ErrorResponse);
    }

    return res.status(500).json({ error: 'Failed to store delegation' } as DelegationV2ErrorResponse);
  }
});

/**
 * GET /api/delegation/v2/user/:address
 * Get all active delegations FROM a user (delegator perspective)
 */
router.get('/v2/user/:address', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;

    if (!isValidAddress(address)) {
      return res.status(400).json({ error: 'Invalid address' } as DelegationV2ErrorResponse);
    }

    const state = await getUserDelegations(address);

    // Format response
    const hasFullDelegation = state.delegations.some((d) => d.vpAmount === 0n);
    const response: UserDelegationsResponse = {
      delegator: ethers.getAddress(address),
      delegations: state.delegations.map((d) => ({
        delegate: ethers.getAddress(d.delegate),
        vpAmount: d.vpAmount.toString(),
        nonce: d.nonce,
        expiry: d.expiry.toISOString(),
      })),
      totalDelegated: state.totalDelegated.toString(),
      hasFullDelegation,
    };

    return res.json(response);
  } catch (error) {
    console.error('[DelegationV2] Get user delegations error:', error);
    return res.status(500).json({ error: 'Failed to fetch user delegations' } as DelegationV2ErrorResponse);
  }
});

/**
 * GET /api/delegation/v2/received/:delegate
 * Get all active delegations TO a delegate
 */
router.get('/v2/received/:delegate', async (req: Request, res: Response) => {
  try {
    const { delegate } = req.params;

    if (!isValidAddress(delegate)) {
      return res.status(400).json({ error: 'Invalid delegate address' } as DelegationV2ErrorResponse);
    }

    const delegations = await getReceivedDelegations(delegate);

    // Calculate total received (treating 0 as special "full delegation" marker)
    const totalReceived = delegations.reduce((sum, d) => sum + d.vpAmount, 0n);

    const response: ReceivedDelegationsV2Response = {
      delegate: ethers.getAddress(delegate),
      delegations: delegations.map((d) => ({
        delegator: ethers.getAddress(d.delegator),
        vpAmount: d.vpAmount.toString(),
        nonce: d.nonce,
        expiry: d.expiry.toISOString(),
      })),
      totalReceived: totalReceived.toString(),
    };

    return res.json(response);
  } catch (error) {
    console.error('[DelegationV2] Get received delegations error:', error);
    return res.status(500).json({ error: 'Failed to fetch received delegations' } as DelegationV2ErrorResponse);
  }
});

/**
 * POST /api/delegation/v2/revoke
 * Revoke delegation(s) for a delegator.
 * Requires signed authorization proving caller controls the delegator address.
 */
router.post('/v2/revoke', async (req: Request, res: Response) => {
  try {
    const { delegator, delegate, timestamp, signature } = req.body as RevokeDelegationRequest;

    // Validate addresses
    if (!delegator || !isValidAddress(delegator)) {
      return res.status(400).json({ error: 'Invalid delegator address' } as DelegationV2ErrorResponse);
    }

    if (delegate !== null && !isValidAddress(delegate)) {
      return res.status(400).json({ error: 'Invalid delegate address' } as DelegationV2ErrorResponse);
    }

    // Validate timestamp and signature
    if (typeof timestamp !== 'number' || timestamp <= 0) {
      return res.status(400).json({ error: 'Timestamp is required' } as DelegationV2ErrorResponse);
    }

    if (!signature || typeof signature !== 'string') {
      return res.status(400).json({ error: 'Signature is required' } as DelegationV2ErrorResponse);
    }

    // Check timestamp freshness (5 minute window)
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - timestamp) > 300) {
      return res.status(400).json({ error: 'Signature expired or timestamp too far in future' } as DelegationV2ErrorResponse);
    }

    // Verify signature proves caller controls delegator address
    if (!verifyRevocationSignature(delegator, delegate, timestamp, signature)) {
      return res.status(403).json({ error: 'Unauthorized: invalid signature' } as DelegationV2ErrorResponse);
    }

    const revokedCount = await revokeDelegation(delegator, delegate);

    const response: RevokeDelegationResponse = {
      success: true,
      revokedCount,
    };

    return res.json(response);
  } catch (error) {
    console.error('[DelegationV2] Revoke error:', error);
    return res.status(500).json({ error: 'Failed to revoke delegation' } as DelegationV2ErrorResponse);
  }
});

/**
 * GET /api/delegation/v2/nonce/:address
 * Get next nonce for a delegator
 */
router.get('/v2/nonce/:address', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;

    if (!isValidAddress(address)) {
      return res.status(400).json({ error: 'Invalid address' } as DelegationV2ErrorResponse);
    }

    const nextNonce = await getNextNonce(address);

    const response: NextNonceResponse = {
      delegator: ethers.getAddress(address),
      nextNonce,
    };

    return res.json(response);
  } catch (error) {
    console.error('[DelegationV2] Get nonce error:', error);
    return res.status(500).json({ error: 'Failed to fetch nonce' } as DelegationV2ErrorResponse);
  }
});

/**
 * GET /api/delegation/v2/opt-in/:address
 * Check if an address has opted in to receive delegations
 */
router.get('/v2/opt-in/:address', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;

    if (!isValidAddress(address)) {
      return res.status(400).json({ error: 'Invalid address' } as DelegationV2ErrorResponse);
    }

    const optedIn = await verifyDelegateOptIn(address);

    return res.json({
      delegate: ethers.getAddress(address),
      optedIn,
    });
  } catch (error) {
    console.error('[DelegationV2] Check opt-in error:', error);
    return res.status(500).json({ error: 'Failed to check opt-in status' } as DelegationV2ErrorResponse);
  }
});

/**
 * GET /api/delegation/v2/stats
 * Get delegation statistics for monitoring
 */
router.get('/v2/stats', async (req: Request, res: Response) => {
  try {
    const stats = await getDelegationStats();

    const response: DelegationV2StatsResponse = stats;

    return res.json(response);
  } catch (error) {
    console.error('[DelegationV2] Get stats error:', error);
    return res.status(500).json({ error: 'Failed to fetch stats' } as DelegationV2ErrorResponse);
  }
});

/**
 * GET /api/delegation/v2/eip712-config/:chainId
 * Get EIP-712 domain and types for frontend signature generation
 */
router.get('/v2/eip712-config/:chainId', async (req: Request, res: Response) => {
  try {
    const chainId = parseInt(req.params.chainId);

    if (isNaN(chainId) || chainId <= 0) {
      return res.status(400).json({ error: 'Invalid chainId' } as DelegationV2ErrorResponse);
    }

    const eip712Config = getEIP712Config(chainId);

    const response: DelegationEIP712ConfigResponse = eip712Config;

    return res.json(response);
  } catch (error) {
    console.error('[DelegationV2] Get EIP712 config error:', error);
    return res.status(500).json({ error: 'Failed to fetch EIP712 config' } as DelegationV2ErrorResponse);
  }
});

/**
 * GET /api/delegation/v2/delegates
 * Get list of eligible delegates (users who can receive delegations)
 * These are users who have: opted in + stake + meet reputation requirements
 */
router.get('/v2/delegates', async (_req: Request, res: Response) => {
  try {
    const delegates = await getEligibleDelegates();

    return res.json({
      delegates,
      total: delegates.length,
    });
  } catch (error) {
    console.error('[DelegationV2] Get eligible delegates error:', error);
    return res.status(500).json({ error: 'Failed to fetch eligible delegates' } as DelegationV2ErrorResponse);
  }
});

export default router;
