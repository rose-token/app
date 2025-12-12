import { Router, Request, Response } from 'express';
import { ethers } from 'ethers';
import { config } from '../config';
import { getPassportScore } from '../services/gitcoin';
import { signApproval, getSignerAddress } from '../services/signer';
import { Action, VerifyRequest, VerifyResponse, ErrorResponse } from '../types';

const router = Router();

// Get threshold for action
function getThreshold(action: Action): number {
  switch (action) {
    case 'createTask':
      return config.thresholds.createTask;
    case 'stake':
      return config.thresholds.stake;
    case 'claim':
      return config.thresholds.claim;
    case 'propose':
      return config.thresholds.propose;
    case 'deposit':
      return config.thresholds.deposit;
    case 'redeem':
      return config.thresholds.redeem;
    default:
      return 20;
  }
}

// Validate Ethereum address
function isValidAddress(address: string): boolean {
  return ethers.isAddress(address);
}

// Validate action
function isValidAction(action: string): action is Action {
  return ['createTask', 'stake', 'claim', 'propose', 'deposit', 'redeem'].includes(action);
}

/**
 * POST /api/passport/verify
 * Check passport score and return signed approval if sufficient
 */
router.post('/verify', async (req: Request, res: Response) => {
  try {
    const { address, action } = req.body as VerifyRequest;

    // Validate inputs
    if (!address || !isValidAddress(address)) {
      return res.status(400).json({ error: 'Invalid address' } as ErrorResponse);
    }

    if (!action || !isValidAction(action)) {
      return res.status(400).json({ error: 'Invalid action' } as ErrorResponse);
    }

    // Get passport score from Gitcoin API
    const score = await getPassportScore(address);
    const threshold = getThreshold(action);

    // Check if score meets threshold
    if (score < threshold) {
      return res.status(403).json({
        error: 'Passport score too low',
        score,
        threshold,
      } as ErrorResponse);
    }

    // Generate expiry timestamp
    const expiry = Math.floor(Date.now() / 1000) + config.signatureTtl;

    // Sign approval
    const signature = await signApproval(address, action, expiry);

    const response: VerifyResponse = {
      address,
      action,
      score,
      threshold,
      expiry,
      signature,
    };

    return res.json(response);
  } catch (error) {
    console.error('Verify error:', error);
    return res.status(500).json({ error: 'Internal server error' } as ErrorResponse);
  }
});

/**
 * GET /api/passport/score/:address
 * Get passport score without signing (public info)
 */
router.get('/score/:address', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;

    if (!isValidAddress(address)) {
      return res.status(400).json({ error: 'Invalid address' });
    }

    const score = await getPassportScore(address);

    return res.json({
      address,
      score,
      thresholds: config.thresholds,
    });
  } catch (error) {
    console.error('Score error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/passport/signer
 * Get signer address (for contract configuration)
 */
router.get('/signer', (_req: Request, res: Response) => {
  res.json({ signer: getSignerAddress() });
});

/**
 * GET /api/passport/thresholds
 * Get current score thresholds
 */
router.get('/thresholds', (_req: Request, res: Response) => {
  res.json(config.thresholds);
});

export default router;
