import { Router, Request, Response } from 'express';
import { ethers } from 'ethers';
import { config } from '../config';
import {
  getDelegateScore,
  getAllDelegateScores,
  validateDelegateEligibility,
  scoreProposal,
  getScoringStats,
} from '../services/delegateScoring';
import {
  getLastDelegateScoringResult,
  triggerDelegateScoring,
} from '../cron/delegateScoring';
import { createSignerAuth } from '../middleware/signerAuth';

const router = Router();

// Validate Ethereum address
function isValidAddress(address: string): boolean {
  return ethers.isAddress(address);
}

/**
 * GET /api/delegate-scoring/score/:delegate
 * Get delegate's voting score
 */
router.get('/score/:delegate', async (req: Request, res: Response) => {
  try {
    const { delegate } = req.params;

    if (!isValidAddress(delegate)) {
      return res.status(400).json({ error: 'Invalid delegate address' });
    }

    const score = await getDelegateScore(delegate);

    if (!score) {
      return res.json({
        delegate,
        hasScore: false,
        message: 'No voting history',
      });
    }

    return res.json({
      delegate,
      hasScore: true,
      totalDelegatedVotes: score.totalDelegatedVotes,
      winningVotes: score.winningVotes,
      missedVotes: score.missedVotes,
      winRate: score.winRate,
      winRatePercent: `${(score.winRate * 100).toFixed(1)}%`,
      participationRate: score.participationRate,
      participationRatePercent: `${(score.participationRate * 100).toFixed(1)}%`,
      createdAt: score.createdAt.toISOString(),
      updatedAt: score.updatedAt.toISOString(),
    });
  } catch (error) {
    console.error('Get delegate score error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/delegate-scoring/eligibility/:delegate
 * Check if delegate is eligible to cast delegated votes
 */
router.get('/eligibility/:delegate', async (req: Request, res: Response) => {
  try {
    const { delegate } = req.params;

    if (!isValidAddress(delegate)) {
      return res.status(400).json({ error: 'Invalid delegate address' });
    }

    const result = await validateDelegateEligibility(delegate);

    return res.json({
      delegate,
      eligible: result.eligible,
      reason: result.reason || null,
      gateEnabled: config.delegateScoring.gateOnScore,
      minVotesRequired: config.delegateScoring.minVotesForWinRate,
      minWinRate: config.delegateScoring.minWinRate,
      score: result.score ? {
        totalDelegatedVotes: result.score.totalDelegatedVotes,
        winningVotes: result.score.winningVotes,
        winRate: result.score.winRate,
      } : null,
    });
  } catch (error) {
    console.error('Check delegate eligibility error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/delegate-scoring/leaderboard
 * Get delegate leaderboard sorted by win rate
 */
router.get('/leaderboard', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const cappedLimit = Math.min(limit, 100);

    const scores = await getAllDelegateScores(cappedLimit);

    return res.json({
      delegates: scores.map((score, index) => ({
        rank: index + 1,
        delegate: score.delegateAddress,
        totalDelegatedVotes: score.totalDelegatedVotes,
        winningVotes: score.winningVotes,
        winRate: score.winRate,
        winRatePercent: `${(score.winRate * 100).toFixed(1)}%`,
        participationRate: score.participationRate,
        updatedAt: score.updatedAt.toISOString(),
      })),
      total: scores.length,
      minVotesForRanking: config.delegateScoring.minVotesForWinRate,
    });
  } catch (error) {
    console.error('Get delegate leaderboard error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/delegate-scoring/stats
 * Get delegate scoring statistics
 */
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const stats = await getScoringStats();

    return res.json({
      totalDelegatesScored: stats.totalDelegatesScored,
      totalProposalsScored: stats.totalProposalsScored,
      averageWinRate: stats.averageWinRate,
      averageWinRatePercent: `${(stats.averageWinRate * 100).toFixed(1)}%`,
      topDelegate: stats.topDelegate ? {
        address: stats.topDelegate.delegateAddress,
        winRate: stats.topDelegate.winRate,
        totalVotes: stats.topDelegate.totalDelegatedVotes,
      } : null,
      config: {
        enabled: config.delegateScoring.enabled,
        gateOnScore: config.delegateScoring.gateOnScore,
        minVotesForWinRate: config.delegateScoring.minVotesForWinRate,
        minWinRate: config.delegateScoring.minWinRate,
      },
    });
  } catch (error) {
    console.error('Get scoring stats error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/delegate-scoring/last
 * Get the last scoring cron run result
 */
router.get('/last', (_req: Request, res: Response) => {
  const lastResult = getLastDelegateScoringResult();

  if (!lastResult) {
    return res.json({
      hasRun: false,
      message: 'No scoring run completed yet',
    });
  }

  return res.json({
    hasRun: true,
    proposalsProcessed: lastResult.proposalsProcessed,
    totalDelegatesUpdated: lastResult.totalDelegatesUpdated,
    errors: lastResult.errors,
    completedAt: lastResult.completedAt.toISOString(),
  });
});

/**
 * POST /api/delegate-scoring/run
 * Manually trigger delegate scoring
 *
 * Requires signer authentication.
 */
router.post('/run', createSignerAuth('delegate-scoring-run'), async (_req: Request, res: Response) => {
  try {
    const result = await triggerDelegateScoring();

    return res.json({
      success: true,
      proposalsProcessed: result?.proposalsProcessed || 0,
      totalDelegatesUpdated: result?.totalDelegatesUpdated || 0,
      errors: result?.errors || [],
      completedAt: result?.completedAt?.toISOString() || new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('already in progress')) {
      return res.status(409).json({ error: 'Scoring already in progress' });
    }
    console.error('Trigger delegate scoring error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/delegate-scoring/score-proposal/:id
 * Manually score a specific proposal
 *
 * Requires signer authentication.
 */
router.post('/score-proposal/:id', createSignerAuth('delegate-scoring-score-proposal'), async (req: Request, res: Response) => {
  try {
    const proposalId = parseInt(req.params.id);

    if (isNaN(proposalId) || proposalId < 1) {
      return res.status(400).json({ error: 'Invalid proposal ID' });
    }

    const result = await scoreProposal(proposalId);

    if (!result.scored) {
      return res.status(400).json({
        success: false,
        error: result.error || 'Unable to score proposal',
      });
    }

    return res.json({
      success: true,
      proposalId,
      delegatesUpdated: result.delegatesUpdated,
    });
  } catch (error) {
    console.error('Score proposal error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
