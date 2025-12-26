import { Router, Request, Response } from 'express';
import { ethers } from 'ethers';
import { config } from '../config';
import { getPassportScore } from '../services/gitcoin';
import governanceService from '../services/governance';
import { getStoredMerkleProof } from '../services/vpSnapshot';
import { getAvailableVP, getSlowTrackAttestation } from '../services/allocations';
import {
  VPDataResponse,
  TotalVPResponse,
  DelegationsResponse,
  ReceivedDelegationsResponse,
  VoteSignatureRequest,
  VoteSignatureResponse,
  RefreshVPRequest,
  RefreshVPResponse,
  ErrorResponse,
  MerkleProofResponse,
  MerkleProofErrorResponse,
  VPAvailableResponse,
  VPAttestationRequest,
  VPAttestationResponse,
} from '../types';

const router = Router();

// Get signer for signing
const wallet = new ethers.Wallet(config.signer.privateKey);

// Threshold for voting - passport score required to vote
const THRESHOLD_VOTE = config.thresholds.vote;

// ============================================================
// Slow Track VP Endpoints (Aliases for /api/slow-track/*)
// IMPORTANT: These must be registered BEFORE /vp/:address to avoid
// Express matching "available" as an address parameter
// ============================================================

/**
 * GET /api/governance/vp/available/:address
 * Get user's available VP for Slow Track voting.
 * Alias for /api/slow-track/available/:address
 *
 * Backend calculates total VP including received delegations.
 *
 * Response:
 *   - user: Checksummed address
 *   - ownVP: User's own VP from staking (as string)
 *   - receivedVP: VP delegated to user by others (as string)
 *   - totalVP: ownVP + receivedVP (as string)
 *   - allocatedVP: VP already allocated to proposals (as string)
 *   - availableVP: VP available for new votes (as string)
 */
router.get('/vp/available/:address', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;

    if (!ethers.isAddress(address)) {
      return res.status(400).json({ error: 'Invalid address' } as ErrorResponse);
    }

    // Fetch user's own VP from stakers table
    const vpData = await governanceService.getUserVP(address);
    const ownVP = BigInt(vpData.votingPower);

    // Fetch VP delegated to this user from delegations table
    const receivedVPStr = await governanceService.getTotalReceivedVP(address);
    const receivedVP = BigInt(receivedVPStr);

    // Calculate total VP = own + received
    const totalVP = ownVP + receivedVP;

    // Get available VP (subtracts allocations from total)
    const result = await getAvailableVP(address, totalVP);

    return res.json({
      user: ethers.getAddress(address),
      ownVP: ownVP.toString(),
      receivedVP: receivedVP.toString(),
      totalVP: result.totalVP.toString(),
      allocatedVP: result.allocatedVP.toString(),
      availableVP: result.availableVP.toString(),
      allocations: result.allocations.map(alloc => ({
        proposalId: alloc.proposalId,
        vpAmount: alloc.vpAmount.toString(),
        support: alloc.support,
        deadline: alloc.deadline,
      })),
    } as VPAvailableResponse);
  } catch (error) {
    console.error('Error fetching available VP:', error);
    return res.status(500).json({ error: 'Failed to fetch available VP' } as ErrorResponse);
  }
});

/**
 * POST /api/governance/vp/attestation
 * Get signed attestation for voteSlow() contract call.
 * Alias for /api/slow-track/attestation
 *
 * Backend calculates total VP including received delegations.
 *
 * Request body:
 *   - user: Voter address
 *   - proposalId: Proposal to vote on
 *   - support: true for For, false for Against
 *   - vpAmount: Amount of VP to allocate (as string)
 *   - totalVP: (optional) User's total VP - if not provided, backend calculates
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
router.post('/vp/attestation', async (req: Request, res: Response) => {
  try {
    const { user, proposalId, support, vpAmount, totalVP } = req.body as VPAttestationRequest;

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

    // Parse vpAmount
    let vpAmountBigInt: bigint;
    try {
      vpAmountBigInt = BigInt(vpAmount);
    } catch {
      return res.status(400).json({ error: 'Invalid vpAmount value' } as ErrorResponse);
    }

    if (vpAmountBigInt <= 0n) {
      return res.status(400).json({ error: 'vpAmount must be positive' } as ErrorResponse);
    }

    // Calculate total VP: use provided value or fetch from backend
    let totalVPBigInt: bigint;
    if (totalVP && typeof totalVP === 'string') {
      try {
        totalVPBigInt = BigInt(totalVP);
      } catch {
        return res.status(400).json({ error: 'Invalid totalVP value' } as ErrorResponse);
      }
    } else {
      // Backend calculates total VP including received delegations
      const vpData = await governanceService.getUserVP(user);
      const ownVP = BigInt(vpData.votingPower);
      const receivedVPStr = await governanceService.getTotalReceivedVP(user);
      const receivedVP = BigInt(receivedVPStr);
      totalVPBigInt = ownVP + receivedVP;
    }

    // Get attestation
    const attestation = await getSlowTrackAttestation(
      user,
      proposalId,
      support,
      vpAmountBigInt,
      totalVPBigInt
    );

    return res.json(attestation as VPAttestationResponse);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('Attestation error:', errorMsg);

    // Return specific error message for insufficient VP
    if (errorMsg.includes('Insufficient available VP')) {
      return res.status(400).json({ error: errorMsg } as ErrorResponse);
    }

    return res.status(500).json({ error: 'Failed to generate attestation' } as ErrorResponse);
  }
});

/**
 * GET /api/governance/vp/:address
 * Get user's VP breakdown
 */
router.get('/vp/:address', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;

    if (!ethers.isAddress(address)) {
      return res.status(400).json({ error: 'Invalid address' } as ErrorResponse);
    }

    const vpData = await governanceService.getUserVP(address);
    return res.json(vpData as VPDataResponse);
  } catch (error) {
    console.error('Error fetching VP data:', error);
    return res.status(500).json({ error: 'Failed to fetch VP data' } as ErrorResponse);
  }
});

/**
 * GET /api/governance/total-vp
 * Get total system VP
 */
router.get('/total-vp', async (req: Request, res: Response) => {
  try {
    const totalVP = await governanceService.getTotalSystemVP();
    return res.json({ totalVP } as TotalVPResponse);
  } catch (error) {
    console.error('Error fetching total VP:', error);
    return res.status(500).json({ error: 'Failed to fetch total VP' } as ErrorResponse);
  }
});

/**
 * GET /api/governance/available/:address
 * Get available VP (not delegated, not on proposals)
 */
router.get('/available/:address', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;

    if (!ethers.isAddress(address)) {
      return res.status(400).json({ error: 'Invalid address' } as ErrorResponse);
    }

    const vpData = await governanceService.getUserVP(address);
    return res.json({ availableVP: vpData.availableVP });
  } catch (error) {
    console.error('Error fetching available VP:', error);
    return res.status(500).json({ error: 'Failed to fetch available VP' } as ErrorResponse);
  }
});

/**
 * GET /api/governance/delegations/:address
 * Get user's delegations (multi-delegation)
 */
router.get('/delegations/:address', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;

    if (!ethers.isAddress(address)) {
      return res.status(400).json({ error: 'Invalid address' } as ErrorResponse);
    }

    const delegations = await governanceService.getUserDelegations(address);
    return res.json({ delegations } as DelegationsResponse);
  } catch (error) {
    console.error('Error fetching delegations:', error);
    return res.status(500).json({ error: 'Failed to fetch delegations' } as ErrorResponse);
  }
});

/**
 * GET /api/governance/received/:delegate
 * Get VP delegated to delegate (received delegations)
 */
router.get('/received/:delegate', async (req: Request, res: Response) => {
  try {
    const { delegate } = req.params;

    if (!ethers.isAddress(delegate)) {
      return res.status(400).json({ error: 'Invalid address' } as ErrorResponse);
    }

    const delegators = await governanceService.getReceivedDelegations(delegate);
    return res.json({ delegators } as ReceivedDelegationsResponse);
  } catch (error) {
    console.error('Error fetching received delegations:', error);
    return res.status(500).json({ error: 'Failed to fetch received delegations' } as ErrorResponse);
  }
});

/**
 * GET /api/governance/reputation/:address
 * Get user's reputation score (legacy - uses old formula)
 */
router.get('/reputation/:address', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;

    if (!ethers.isAddress(address)) {
      return res.status(400).json({ error: 'Invalid address' } as ErrorResponse);
    }

    const reputation = await governanceService.getReputation(address);
    return res.json({ address, reputation });
  } catch (error) {
    console.error('Error fetching reputation:', error);
    return res.status(500).json({ error: 'Failed to fetch reputation' } as ErrorResponse);
  }
});

/**
 * GET /api/governance/reputation-signed/:address
 * Get user's reputation with signed attestation (uses new ^0.6 formula)
 * Returns signed message that can be validated on-chain
 */
router.get('/reputation-signed/:address', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;

    if (!ethers.isAddress(address)) {
      return res.status(400).json({ error: 'Invalid address' } as ErrorResponse);
    }

    const attestation = await governanceService.getSignedReputation(address);
    return res.json(attestation);
  } catch (error) {
    console.error('Error fetching signed reputation:', error);
    return res.status(500).json({ error: 'Failed to fetch signed reputation' } as ErrorResponse);
  }
});

/**
 * GET /api/governance/reputation-new/:address
 * Get user's reputation using new formula (without signature)
 * For display purposes only
 */
router.get('/reputation-new/:address', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;

    if (!ethers.isAddress(address)) {
      return res.status(400).json({ error: 'Invalid address' } as ErrorResponse);
    }

    const reputation = await governanceService.getReputationNew(address);
    return res.json({ address, reputation });
  } catch (error) {
    console.error('Error fetching new reputation:', error);
    return res.status(500).json({ error: 'Failed to fetch new reputation' } as ErrorResponse);
  }
});

/**
 * POST /api/governance/vote-signature
 * Sign direct vote approval (with passport check)
 */
router.post('/vote-signature', async (req: Request, res: Response) => {
  try {
    const { voter, proposalId, vpAmount, support } = req.body as VoteSignatureRequest;

    // Validate inputs
    if (!voter || !ethers.isAddress(voter)) {
      return res.status(400).json({ error: 'Invalid voter address' } as ErrorResponse);
    }
    if (typeof proposalId !== 'number' || proposalId < 1) {
      return res.status(400).json({ error: 'Invalid proposal ID' } as ErrorResponse);
    }
    if (!vpAmount || BigInt(vpAmount) <= 0n) {
      return res.status(400).json({ error: 'Invalid VP amount' } as ErrorResponse);
    }
    if (typeof support !== 'boolean') {
      return res.status(400).json({ error: 'Invalid support value' } as ErrorResponse);
    }

    // Verify passport score meets threshold
    const score = await getPassportScore(voter);
    if (score < THRESHOLD_VOTE) {
      return res.status(403).json({
        error: 'Insufficient passport score',
        score,
        threshold: THRESHOLD_VOTE,
      } as ErrorResponse);
    }

    // Create signature
    const expiry = Math.floor(Date.now() / 1000) + config.signatureTtl;

    // Message hash must match contract's expectation
    const messageHash = ethers.solidityPackedKeccak256(
      ['string', 'address', 'uint256', 'bool', 'uint256', 'uint256'],
      ['voteFast', voter, proposalId, support, vpAmount, expiry]
    );

    const signature = await wallet.signMessage(ethers.getBytes(messageHash));

    return res.json({
      voter,
      proposalId,
      vpAmount,
      support,
      expiry,
      signature,
    } as VoteSignatureResponse);
  } catch (error) {
    console.error('Error creating vote signature:', error);
    return res.status(500).json({ error: 'Failed to create vote signature' } as ErrorResponse);
  }
});

/**
 * POST /api/governance/refresh-vp
 * Sign VP refresh (backend-triggered when reputation changes)
 */
router.post('/refresh-vp', async (req: Request, res: Response) => {
  try {
    const { user } = req.body as RefreshVPRequest;

    if (!user || !ethers.isAddress(user)) {
      return res.status(400).json({ error: 'Invalid user address' } as ErrorResponse);
    }

    // Use same attestation helper as vpRefresh worker for consistent signature format
    const attestation = await governanceService.getSignedReputation(user);

    return res.json({
      user,
      newRep: attestation.reputation,
      expiry: attestation.expiry,
      signature: attestation.signature,
    } as RefreshVPResponse);
  } catch (error) {
    console.error('Error creating refresh VP signature:', error);
    return res.status(500).json({ error: 'Failed to create refresh VP signature' } as ErrorResponse);
  }
});

/**
 * GET /api/governance/signer
 * Get signer address (for contract configuration)
 */
router.get('/signer', (req: Request, res: Response) => {
  return res.json({ signer: wallet.address });
});

// ============================================================
// Fast Track Merkle Proof Endpoints
// ============================================================

/**
 * GET /api/governance/proposals/:id/proof/:address
 * Get merkle proof for a user's VP in a proposal snapshot (Fast Track voting)
 *
 * Response:
 *   - address: Checksummed voter address
 *   - effectiveVP: VP after delegations applied (as string)
 *   - baseVP: VP before delegations (as string)
 *   - delegatedTo: Primary delegate address (null if not delegating)
 *   - delegatedAmount: Amount delegated out (as string)
 *   - proof: Merkle proof array for on-chain verification
 */
router.get('/proposals/:id/proof/:address', async (req: Request, res: Response) => {
  try {
    const proposalId = parseInt(req.params.id, 10);
    const { address } = req.params;

    // Validate proposal ID
    if (isNaN(proposalId) || proposalId < 0) {
      return res.status(400).json({ error: 'Invalid proposal ID' } as MerkleProofErrorResponse);
    }

    // Validate address
    if (!ethers.isAddress(address)) {
      return res.status(400).json({ error: 'Invalid address' } as MerkleProofErrorResponse);
    }

    // Get merkle proof from stored snapshot
    const proof = await getStoredMerkleProof(proposalId, address);

    if (!proof) {
      return res.status(404).json({
        error: 'No VP snapshot found for this proposal or user not in snapshot',
      } as MerkleProofErrorResponse);
    }

    return res.json(proof as MerkleProofResponse);
  } catch (error) {
    console.error('Error fetching merkle proof:', error);
    return res.status(500).json({ error: 'Failed to fetch merkle proof' } as MerkleProofErrorResponse);
  }
});

export default router;
