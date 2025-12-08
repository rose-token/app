import { Router, Request, Response } from 'express';
import { ethers } from 'ethers';
import { config } from '../config';
import { getPassportScore } from '../services/gitcoin';
import governanceService from '../services/governance';
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
} from '../types';

const router = Router();

// Get signer for signing
const wallet = new ethers.Wallet(config.signer.privateKey);

// Threshold for voting - passport score required to vote
const THRESHOLD_VOTE = config.thresholds.vote;

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
      ['string', 'address', 'uint256', 'uint256', 'bool', 'uint256'],
      ['vote', voter, proposalId, vpAmount, support, expiry]
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

    // Get reputation using backend ^0.6 formula (consistent with vpRefresh watcher)
    const newRep = await governanceService.getReputationNew(user);

    // Create signature
    const expiry = Math.floor(Date.now() / 1000) + config.signatureTtl;

    const messageHash = ethers.solidityPackedKeccak256(
      ['string', 'address', 'uint256', 'uint256'],
      ['refreshVP', user, newRep, expiry]
    );

    const signature = await wallet.signMessage(ethers.getBytes(messageHash));

    return res.json({
      user,
      newRep,
      expiry,
      signature,
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

export default router;
