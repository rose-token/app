/**
 * Auction Routes
 *
 * REST API endpoints for the reverse auction system.
 * Workers submit bids off-chain, customers view bids and select winners,
 * then execute on-chain with backend signature.
 */

import { Router, Request, Response } from 'express';
import { ethers } from 'ethers';
import {
  registerAuctionTask,
  submitBid,
  getBidsForTask,
  getBidCount,
  getWorkerBid,
  signWinnerSelection,
  concludeAuction,
  auctionExists,
  getAuctionTask,
  syncAuctionFromChain,
} from '../services/auction';
import {
  RegisterAuctionTaskRequest,
  RegisterAuctionTaskResponse,
  SubmitBidRequest,
  SubmitBidResponse,
  SelectWinnerRequest,
  SelectWinnerResponse,
  ConfirmWinnerRequest,
  ConfirmWinnerResponse,
  AuctionErrorResponse,
} from '../types';
import { createSignerAuth } from '../middleware/signerAuth';

const router = Router();

// Validate Ethereum address
function isValidAddress(address: string): boolean {
  return ethers.isAddress(address);
}

/**
 * POST /api/auction/register
 * Register an auction task after it's created on-chain.
 * Called by watcher after AuctionTaskCreated event.
 *
 * Requires signer authentication.
 */
router.post('/register', createSignerAuth('auction-register'), async (req: Request, res: Response) => {
  try {
    const { taskId, maxBudget } = req.body as RegisterAuctionTaskRequest;

    // Validate taskId
    if (taskId === undefined || taskId <= 0) {
      return res.status(400).json({
        error: 'Invalid taskId',
      } as AuctionErrorResponse);
    }

    // Validate maxBudget
    if (!maxBudget) {
      return res.status(400).json({
        error: 'maxBudget is required',
      } as AuctionErrorResponse);
    }

    await registerAuctionTask(taskId, maxBudget);

    const response: RegisterAuctionTaskResponse = {
      success: true,
      taskId,
      maxBudget,
    };

    return res.json(response);
  } catch (error) {
    console.error('Register auction error:', error);

    if (error instanceof Error) {
      return res.status(400).json({
        error: error.message,
      } as AuctionErrorResponse);
    }

    return res.status(500).json({
      error: 'Internal server error',
    } as AuctionErrorResponse);
  }
});

/**
 * POST /api/auction/bid
 * Submit or update a bid for an auction task.
 * Worker must sign to prove address ownership.
 */
router.post('/bid', async (req: Request, res: Response) => {
  try {
    const { taskId, worker, bidAmount, message, signature } = req.body as SubmitBidRequest;

    // Validate taskId
    if (taskId === undefined || taskId <= 0) {
      return res.status(400).json({
        error: 'Invalid taskId',
      } as AuctionErrorResponse);
    }

    // Validate worker address
    if (!worker || !isValidAddress(worker)) {
      return res.status(400).json({
        error: 'Invalid worker address',
      } as AuctionErrorResponse);
    }

    // Validate bidAmount
    if (!bidAmount) {
      return res.status(400).json({
        error: 'bidAmount is required',
      } as AuctionErrorResponse);
    }

    // Validate signature
    if (!signature) {
      return res.status(400).json({
        error: 'signature is required',
      } as AuctionErrorResponse);
    }

    const result = await submitBid(taskId, worker, bidAmount, message || null, signature);

    const response: SubmitBidResponse = {
      success: true,
      taskId,
      worker,
      bidAmount,
      isUpdate: result.isUpdate,
    };

    return res.json(response);
  } catch (error) {
    console.error('Submit bid error:', error);

    if (error instanceof Error) {
      // Return specific error messages
      if (
        error.message.includes('Invalid') ||
        error.message.includes('Auction') ||
        error.message.includes('Bid')
      ) {
        return res.status(400).json({
          error: error.message,
        } as AuctionErrorResponse);
      }
    }

    return res.status(500).json({
      error: 'Internal server error',
    } as AuctionErrorResponse);
  }
});

/**
 * GET /api/auction/:taskId/bids
 * Get all bids for an auction task.
 * Returns bids sorted by amount (lowest first).
 *
 * NOTE: In production, this should verify the caller is the task customer.
 * Currently public for MVP - frontend should only call this for task customers.
 */
router.get('/:taskId/bids', async (req: Request, res: Response) => {
  try {
    const taskId = parseInt(req.params.taskId);

    if (isNaN(taskId) || taskId <= 0) {
      return res.status(400).json({
        error: 'Invalid taskId',
      } as AuctionErrorResponse);
    }

    const response = await getBidsForTask(taskId);
    return res.json(response);
  } catch (error) {
    console.error('Get bids error:', error);

    if (error instanceof Error) {
      if (error.message.includes('not found')) {
        return res.status(404).json({
          error: error.message,
        } as AuctionErrorResponse);
      }
    }

    return res.status(500).json({
      error: 'Internal server error',
    } as AuctionErrorResponse);
  }
});

/**
 * GET /api/auction/:taskId/count
 * Get bid count for a task (public).
 */
router.get('/:taskId/count', async (req: Request, res: Response) => {
  try {
    const taskId = parseInt(req.params.taskId);

    if (isNaN(taskId) || taskId <= 0) {
      return res.status(400).json({
        error: 'Invalid taskId',
      } as AuctionErrorResponse);
    }

    const response = await getBidCount(taskId);
    return res.json(response);
  } catch (error) {
    console.error('Get bid count error:', error);

    if (error instanceof Error) {
      if (error.message.includes('not found')) {
        return res.status(404).json({
          error: error.message,
        } as AuctionErrorResponse);
      }
    }

    return res.status(500).json({
      error: 'Internal server error',
    } as AuctionErrorResponse);
  }
});

/**
 * GET /api/auction/:taskId/my-bid/:worker
 * Get a worker's own bid for a task.
 */
router.get('/:taskId/my-bid/:worker', async (req: Request, res: Response) => {
  try {
    const taskId = parseInt(req.params.taskId);
    const { worker } = req.params;

    if (isNaN(taskId) || taskId <= 0) {
      return res.status(400).json({
        error: 'Invalid taskId',
      } as AuctionErrorResponse);
    }

    if (!worker || !isValidAddress(worker)) {
      return res.status(400).json({
        error: 'Invalid worker address',
      } as AuctionErrorResponse);
    }

    const response = await getWorkerBid(taskId, worker);
    return res.json(response);
  } catch (error) {
    console.error('Get worker bid error:', error);

    if (error instanceof Error) {
      if (error.message.includes('Invalid')) {
        return res.status(400).json({
          error: error.message,
        } as AuctionErrorResponse);
      }
    }

    return res.status(500).json({
      error: 'Internal server error',
    } as AuctionErrorResponse);
  }
});

/**
 * POST /api/auction/select-winner
 * Sign winner selection for on-chain execution.
 * Customer calls this to get a signature for selectAuctionWinner.
 */
router.post('/select-winner', async (req: Request, res: Response) => {
  try {
    const { taskId, customer, worker, winningBid } = req.body as SelectWinnerRequest;

    // Validate taskId
    if (taskId === undefined || taskId <= 0) {
      return res.status(400).json({
        error: 'Invalid taskId',
      } as AuctionErrorResponse);
    }

    // Validate customer address
    if (!customer || !isValidAddress(customer)) {
      return res.status(400).json({
        error: 'Invalid customer address',
      } as AuctionErrorResponse);
    }

    // Validate worker address
    if (!worker || !isValidAddress(worker)) {
      return res.status(400).json({
        error: 'Invalid worker address',
      } as AuctionErrorResponse);
    }

    // Validate winningBid
    if (!winningBid) {
      return res.status(400).json({
        error: 'winningBid is required',
      } as AuctionErrorResponse);
    }

    const response = await signWinnerSelection(taskId, customer, worker, winningBid);
    return res.json(response);
  } catch (error) {
    console.error('Select winner error:', error);

    if (error instanceof Error) {
      // Return specific error messages
      if (
        error.message.includes('Invalid') ||
        error.message.includes('Auction') ||
        error.message.includes('No bid') ||
        error.message.includes('exceeds') ||
        error.message.includes('match')
      ) {
        return res.status(400).json({
          error: error.message,
        } as AuctionErrorResponse);
      }
    }

    return res.status(500).json({
      error: 'Internal server error',
    } as AuctionErrorResponse);
  }
});

/**
 * POST /api/auction/confirm-winner
 * Conclude auction after on-chain winner selection confirms.
 * Called by watcher after AuctionWinnerSelected event.
 *
 * Requires signer authentication.
 */
router.post('/confirm-winner', createSignerAuth('auction-confirm-winner'), async (req: Request, res: Response) => {
  try {
    const { taskId, winner, winningBid } = req.body as ConfirmWinnerRequest;

    // Validate taskId
    if (taskId === undefined || taskId <= 0) {
      return res.status(400).json({
        error: 'Invalid taskId',
      } as AuctionErrorResponse);
    }

    // Validate winner address
    if (!winner || !isValidAddress(winner)) {
      return res.status(400).json({
        error: 'Invalid winner address',
      } as AuctionErrorResponse);
    }

    // Validate winningBid
    if (!winningBid) {
      return res.status(400).json({
        error: 'winningBid is required',
      } as AuctionErrorResponse);
    }

    await concludeAuction(taskId, winner, winningBid);

    const response: ConfirmWinnerResponse = {
      success: true,
      taskId,
    };

    return res.json(response);
  } catch (error) {
    console.error('Confirm winner error:', error);

    if (error instanceof Error) {
      // Return specific error messages for validation failures
      if (
        error.message.includes('Invalid') ||
        error.message.includes('not found') ||
        error.message.includes('not an auction') ||
        error.message.includes('not yet selected') ||
        error.message.includes('does not match')
      ) {
        return res.status(400).json({
          error: error.message,
        } as AuctionErrorResponse);
      }
    }

    return res.status(500).json({
      error: 'Internal server error',
    } as AuctionErrorResponse);
  }
});

/**
 * GET /api/auction/:taskId
 * Get auction task info (public).
 */
router.get('/:taskId', async (req: Request, res: Response) => {
  try {
    const taskId = parseInt(req.params.taskId);

    if (isNaN(taskId) || taskId <= 0) {
      return res.status(400).json({
        error: 'Invalid taskId',
      } as AuctionErrorResponse);
    }

    const auction = await getAuctionTask(taskId);

    if (!auction) {
      return res.status(404).json({
        error: 'Auction task not found',
      } as AuctionErrorResponse);
    }

    return res.json({
      taskId: auction.task_id,
      maxBudget: auction.max_budget,
      bidCount: auction.bid_count,
      winner: auction.winner_address,
      winningBid: auction.winning_bid,
      concludedAt: auction.concluded_at,
      createdAt: auction.created_at,
    });
  } catch (error) {
    console.error('Get auction error:', error);
    return res.status(500).json({
      error: 'Internal server error',
    } as AuctionErrorResponse);
  }
});

/**
 * GET /api/auction/:taskId/exists
 * Check if an auction task exists (public).
 */
router.get('/:taskId/exists', async (req: Request, res: Response) => {
  try {
    const taskId = parseInt(req.params.taskId);

    if (isNaN(taskId) || taskId <= 0) {
      return res.status(400).json({
        error: 'Invalid taskId',
      } as AuctionErrorResponse);
    }

    const exists = await auctionExists(taskId);
    return res.json({ taskId, exists });
  } catch (error) {
    console.error('Check auction exists error:', error);
    return res.status(500).json({
      error: 'Internal server error',
    } as AuctionErrorResponse);
  }
});

/**
 * POST /api/auction/:taskId/sync
 * Sync auction state from on-chain to database.
 * Clears stale winner data if on-chain status is Open (e.g., after unclaim).
 *
 * Requires signer authentication.
 */
router.post('/:taskId/sync', createSignerAuth('auction-sync'), async (req: Request, res: Response) => {
  try {
    const taskId = parseInt(req.params.taskId);

    if (isNaN(taskId) || taskId <= 0) {
      return res.status(400).json({
        error: 'Invalid taskId',
      } as AuctionErrorResponse);
    }

    const result = await syncAuctionFromChain(taskId);
    return res.json(result);
  } catch (error) {
    console.error('Sync auction error:', error);

    if (error instanceof Error) {
      if (
        error.message.includes('not found') ||
        error.message.includes('not configured')
      ) {
        return res.status(404).json({
          error: error.message,
        } as AuctionErrorResponse);
      }
    }

    return res.status(500).json({
      error: 'Internal server error',
    } as AuctionErrorResponse);
  }
});

export default router;
