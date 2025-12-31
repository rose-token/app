import { ethers } from 'ethers';
import { config } from '../config';
import { query, getPool } from '../db/pool';
import { getWsProvider } from '../utils/wsProvider';
import { RoseGovernanceABI } from '../utils/contracts';

// Fallback deployment block for governance contract
// Used when querying historical proposals without stored block info
// This should be set via GOVERNANCE_DEPLOYMENT_BLOCK env var for accuracy
const DEFAULT_DEPLOYMENT_BLOCK = 0;

// Proposal statuses from contract
enum ProposalStatus {
  Pending = 0,
  Active = 1,
  Passed = 2,
  Failed = 3,
  Executed = 4,
  Cancelled = 5,
}

let governanceContract: ethers.Contract | null = null;

function getProvider(): ethers.Provider {
  return getWsProvider();
}

function getGovernanceContract(): ethers.Contract {
  if (!governanceContract) {
    if (!config.contracts.governance) {
      throw new Error('GOVERNANCE_ADDRESS not configured');
    }
    governanceContract = new ethers.Contract(
      config.contracts.governance,
      RoseGovernanceABI,
      getProvider()
    );
  }
  return governanceContract;
}

export interface DelegateScore {
  delegateAddress: string;
  totalDelegatedVotes: number;
  winningVotes: number;
  missedVotes: number;
  winRate: number;
  participationRate: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Get delegate score from database
 */
export async function getDelegateScore(delegate: string): Promise<DelegateScore | null> {
  const result = await query<{
    delegate_address: string;
    total_delegated_votes: number;
    winning_votes: number;
    missed_votes: number;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT * FROM delegate_scores WHERE LOWER(delegate_address) = LOWER($1)`,
    [delegate]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  const totalVotes = row.total_delegated_votes;
  const winRate = totalVotes > 0 ? row.winning_votes / totalVotes : 0;
  const participationRate = totalVotes + row.missed_votes > 0
    ? totalVotes / (totalVotes + row.missed_votes)
    : 1;

  return {
    delegateAddress: row.delegate_address,
    totalDelegatedVotes: totalVotes,
    winningVotes: row.winning_votes,
    missedVotes: row.missed_votes,
    winRate,
    participationRate,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Get all delegate scores for leaderboard
 */
export async function getAllDelegateScores(limit = 50): Promise<DelegateScore[]> {
  const result = await query<{
    delegate_address: string;
    total_delegated_votes: number;
    winning_votes: number;
    missed_votes: number;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT * FROM delegate_scores
     WHERE total_delegated_votes > 0
     ORDER BY
       CASE WHEN total_delegated_votes >= $1 THEN winning_votes::float / total_delegated_votes ELSE 0 END DESC,
       total_delegated_votes DESC
     LIMIT $2`,
    [config.delegateScoring.minVotesForWinRate, limit]
  );

  return result.rows.map(row => {
    const totalVotes = row.total_delegated_votes;
    const winRate = totalVotes > 0 ? row.winning_votes / totalVotes : 0;
    const participationRate = totalVotes + row.missed_votes > 0
      ? totalVotes / (totalVotes + row.missed_votes)
      : 1;

    return {
      delegateAddress: row.delegate_address,
      totalDelegatedVotes: totalVotes,
      winningVotes: row.winning_votes,
      missedVotes: row.missed_votes,
      winRate,
      participationRate,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
}

/**
 * Check if delegate is eligible based on score
 * Returns true if eligible, false if blocked due to poor performance
 */
export async function validateDelegateEligibility(delegate: string): Promise<{
  eligible: boolean;
  reason?: string;
  score?: DelegateScore;
}> {
  const score = await getDelegateScore(delegate);

  // New delegates with no history are eligible
  if (!score) {
    return { eligible: true };
  }

  // Must have minimum votes before win rate is enforced
  if (score.totalDelegatedVotes < config.delegateScoring.minVotesForWinRate) {
    return { eligible: true, score };
  }

  // Check win rate threshold
  if (score.winRate < config.delegateScoring.minWinRate) {
    return {
      eligible: false,
      reason: `Win rate ${(score.winRate * 100).toFixed(1)}% is below minimum ${config.delegateScoring.minWinRate * 100}%`,
      score,
    };
  }

  return { eligible: true, score };
}

/**
 * Get stored block range for a proposal from DB
 */
async function getStoredProposalBlocks(
  proposalId: number
): Promise<{ fromBlock: number; toBlock: number } | null> {
  try {
    const result = await query<{ from_block: number; to_block: number }>(
      `SELECT from_block, to_block FROM proposal_blocks WHERE proposal_id = $1`,
      [proposalId]
    );
    if (result.rows.length > 0) {
      return {
        fromBlock: result.rows[0].from_block,
        toBlock: result.rows[0].to_block,
      };
    }
    return null;
  } catch {
    // Table might not exist yet
    return null;
  }
}

/**
 * Store block range for a proposal after successful event query
 */
async function storeProposalBlocks(
  proposalId: number,
  fromBlock: number,
  toBlock: number
): Promise<void> {
  try {
    await query(
      `INSERT INTO proposal_blocks (proposal_id, from_block, to_block)
       VALUES ($1, $2, $3)
       ON CONFLICT (proposal_id) DO NOTHING`,
      [proposalId, fromBlock, toBlock]
    );
  } catch (error) {
    // Non-fatal - we can query again next time
    console.warn(`[DelegateScoring] Failed to store proposal blocks:`, error);
  }
}

/**
 * Get all delegates who voted on a specific proposal
 * Queries VoteCastFast and VoteCastSlow events, then filters to only opted-in delegates
 */
async function getDelegatesWhoVoted(proposalId: number): Promise<string[]> {
  const contract = getGovernanceContract();

  try {
    const currentBlock = await getProvider().getBlockNumber();

    // Check if we have stored block info for this proposal
    const storedBlocks = await getStoredProposalBlocks(proposalId);

    let fromBlock: number;
    let toBlock: number;

    if (storedBlocks) {
      // Use stored block range (most efficient)
      fromBlock = storedBlocks.fromBlock;
      toBlock = Math.min(storedBlocks.toBlock, currentBlock);
      console.log(
        `[DelegateScoring] Using stored blocks for proposal ${proposalId}: ${fromBlock} to ${toBlock}`
      );
    } else {
      // Fall back to querying from deployment block (handles historical backfill)
      const deploymentBlock = parseInt(process.env.GOVERNANCE_DEPLOYMENT_BLOCK || '0') || DEFAULT_DEPLOYMENT_BLOCK;
      fromBlock = deploymentBlock;
      toBlock = currentBlock;
      console.log(
        `[DelegateScoring] Querying proposal ${proposalId} from deployment block ${fromBlock} to ${toBlock} (no stored range)`
      );
    }

    // Query both vote event types (Fast and Slow track)
    const fastFilter = contract.filters.VoteCastFast(proposalId);
    const slowFilter = contract.filters.VoteCastSlow(proposalId);

    const [fastEvents, slowEvents] = await Promise.all([
      contract.queryFilter(fastFilter, fromBlock, toBlock),
      contract.queryFilter(slowFilter, fromBlock, toBlock),
    ]);

    const allEvents = [...fastEvents, ...slowEvents];
    const voters = new Set<string>();
    let minEventBlock = toBlock;
    let maxEventBlock = fromBlock;

    for (const event of allEvents) {
      if ('args' in event && event.args) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const args = event.args as any;
        voters.add((args.voter as string).toLowerCase());
        // Track actual block range where events occurred
        if (event.blockNumber < minEventBlock) minEventBlock = event.blockNumber;
        if (event.blockNumber > maxEventBlock) maxEventBlock = event.blockNumber;
      }
    }

    // Store discovered block range for future queries (only if we found events)
    if (!storedBlocks && voters.size > 0) {
      await storeProposalBlocks(proposalId, minEventBlock, maxEventBlock);
    }

    // Filter to only opted-in delegates
    const delegates: string[] = [];
    for (const voter of voters) {
      try {
        const isDelegate = await contract.isDelegateOptedIn(voter);
        if (isDelegate) {
          delegates.push(voter);
        }
      } catch {
        // Skip if we can't check delegate status
      }
    }

    return delegates;
  } catch (error) {
    console.error(`Error querying delegates for proposal ${proposalId}:`, error);
    return [];
  }
}

/**
 * Check if a proposal has already been scored
 */
async function isProposalScored(proposalId: number): Promise<boolean> {
  const result = await query<{ proposal_id: number }>(
    `SELECT proposal_id FROM scored_proposals WHERE proposal_id = $1`,
    [proposalId]
  );
  return result.rows.length > 0;
}

/**
 * Mark a proposal as scored
 */
async function markProposalScored(
  proposalId: number,
  outcome: boolean,
  delegatesScored: number
): Promise<void> {
  await query(
    `INSERT INTO scored_proposals (proposal_id, outcome, delegates_scored)
     VALUES ($1, $2, $3)
     ON CONFLICT (proposal_id) DO NOTHING`,
    [proposalId, outcome, delegatesScored]
  );
}

/**
 * Update delegate score for a single proposal outcome
 */
async function updateDelegateScoreForProposal(
  delegate: string,
  proposalId: number,
  outcome: boolean
): Promise<void> {
  const contract = getGovernanceContract();

  // Get the delegate's vote on this proposal using the votes() view function
  const voteRecord = await contract.votes(proposalId, delegate);

  if (!voteRecord.hasVoted) {
    return; // Delegate didn't vote on this proposal
  }

  const votedForWinner = voteRecord.support === outcome;

  await query(
    `INSERT INTO delegate_scores (delegate_address, total_delegated_votes, winning_votes, last_proposal_scored)
     VALUES (LOWER($1), 1, $2, $3)
     ON CONFLICT (delegate_address) DO UPDATE SET
       total_delegated_votes = delegate_scores.total_delegated_votes + 1,
       winning_votes = delegate_scores.winning_votes + $2,
       last_proposal_scored = $3`,
    [delegate, votedForWinner ? 1 : 0, proposalId]
  );
}

/**
 * Process a finalized proposal and update delegate scores
 * Called by cron job when proposals are finalized
 */
export async function scoreProposal(proposalId: number): Promise<{
  scored: boolean;
  delegatesUpdated: number;
  error?: string;
}> {
  try {
    // Check if already scored
    if (await isProposalScored(proposalId)) {
      return { scored: false, delegatesUpdated: 0, error: 'Already scored' };
    }

    const contract = getGovernanceContract();
    const proposal = await contract.proposals(proposalId);

    // Only score finalized proposals (Passed, Failed, Executed)
    const status = Number(proposal.status);
    if (status === ProposalStatus.Active || status === ProposalStatus.Cancelled) {
      return { scored: false, delegatesUpdated: 0, error: 'Proposal not finalized' };
    }

    // Determine outcome: Passed/Executed = true (yay won), Failed = false (nay won)
    const outcome = status === ProposalStatus.Passed || status === ProposalStatus.Executed;

    // Get all delegates who voted on this proposal
    // Uses stored block range or falls back to deployment block for historical backfill
    const delegates = await getDelegatesWhoVoted(proposalId);

    if (delegates.length === 0) {
      // No delegated votes - mark as scored but no updates
      await markProposalScored(proposalId, outcome, 0);
      return { scored: true, delegatesUpdated: 0 };
    }

    // Update each delegate's score
    for (const delegate of delegates) {
      await updateDelegateScoreForProposal(delegate, proposalId, outcome);
    }

    // Mark proposal as scored
    await markProposalScored(proposalId, outcome, delegates.length);

    console.log(`[DelegateScoring] Scored proposal ${proposalId}: ${delegates.length} delegates updated`);

    return { scored: true, delegatesUpdated: delegates.length };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[DelegateScoring] Error scoring proposal ${proposalId}:`, error);
    return { scored: false, delegatesUpdated: 0, error: errMsg };
  }
}

/**
 * Get all finalized proposals that haven't been scored yet
 */
export async function getUnscoredProposals(): Promise<number[]> {
  const contract = getGovernanceContract();
  const proposalCount = Number(await contract.proposalCounter());

  const unscoredProposals: number[] = [];

  for (let i = 1; i <= proposalCount; i++) {
    const proposal = await contract.proposals(i);
    const status = Number(proposal.status);

    // Only check finalized proposals
    if (status !== ProposalStatus.Active && status !== ProposalStatus.Cancelled) {
      const isScored = await isProposalScored(i);
      if (!isScored) {
        unscoredProposals.push(i);
      }
    }
  }

  return unscoredProposals;
}

/**
 * Score all unscored finalized proposals
 */
export async function scoreAllUnscoredProposals(): Promise<{
  proposalsProcessed: number;
  totalDelegatesUpdated: number;
  errors: string[];
}> {
  const unscoredProposals = await getUnscoredProposals();

  let totalDelegatesUpdated = 0;
  const errors: string[] = [];

  for (const proposalId of unscoredProposals) {
    const result = await scoreProposal(proposalId);
    if (result.scored) {
      totalDelegatesUpdated += result.delegatesUpdated;
    } else if (result.error && result.error !== 'Proposal not finalized') {
      errors.push(`Proposal ${proposalId}: ${result.error}`);
    }
  }

  return {
    proposalsProcessed: unscoredProposals.length,
    totalDelegatesUpdated,
    errors,
  };
}

/**
 * Get scoring statistics
 */
export async function getScoringStats(): Promise<{
  totalDelegatesScored: number;
  totalProposalsScored: number;
  averageWinRate: number;
  topDelegate: DelegateScore | null;
}> {
  const delegateCountResult = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM delegate_scores WHERE total_delegated_votes > 0`
  );

  const proposalCountResult = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM scored_proposals`
  );

  const avgWinRateResult = await query<{ avg: string }>(
    `SELECT AVG(winning_votes::float / NULLIF(total_delegated_votes, 0)) as avg
     FROM delegate_scores
     WHERE total_delegated_votes >= $1`,
    [config.delegateScoring.minVotesForWinRate]
  );

  const topDelegates = await getAllDelegateScores(1);

  return {
    totalDelegatesScored: parseInt(delegateCountResult.rows[0]?.count || '0'),
    totalProposalsScored: parseInt(proposalCountResult.rows[0]?.count || '0'),
    averageWinRate: parseFloat(avgWinRateResult.rows[0]?.avg || '0'),
    topDelegate: topDelegates[0] || null,
  };
}

// ============ Phase 2: VP Freeing Functions ============

// Extended ABI for VP freeing (RoseGovernanceABI already contains all methods)
const GOVERNANCE_ABI_WRITE = RoseGovernanceABI;

/**
 * Free pending VP for all delegates on a finalized proposal
 */
export async function freeVPForProposal(proposalId: number): Promise<{
  freed: boolean;
  delegatesFreed: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let delegatesFreed = 0;

  try {
    // Import delegation functions
    const { getDelegatesWithPendingVP, signFreeDelegatedVPFor } = await import('./delegation');

    const contract = getGovernanceContract();
    const proposal = await contract.proposals(proposalId);
    const status = Number(proposal.status);

    // Only process finalized proposals
    if (status === ProposalStatus.Active) {
      return { freed: false, delegatesFreed: 0, errors: ['Proposal still active'] };
    }

    // Get delegates with pending VP
    const delegates = await getDelegatesWithPendingVP(proposalId);

    if (delegates.length === 0) {
      return { freed: true, delegatesFreed: 0, errors: [] };
    }

    console.log(`[VPFreeing] Found ${delegates.length} delegates with pending VP on proposal ${proposalId}`);

    // Create signer for transactions
    const signer = new ethers.Wallet(config.signer.privateKey, getProvider());
    const writableContract = new ethers.Contract(
      config.contracts.governance!,
      GOVERNANCE_ABI_WRITE,
      signer
    );

    for (const delegate of delegates) {
      try {
        const expiry = Math.floor(Date.now() / 1000) + 300; // 5 min expiry
        const signature = await signFreeDelegatedVPFor(proposalId, delegate, expiry);

        const tx = await writableContract.freeDelegatedVPFor(
          proposalId,
          delegate,
          expiry,
          signature
        );
        await tx.wait();
        delegatesFreed++;
        console.log(`[VPFreeing] Freed VP for delegate ${delegate} on proposal ${proposalId}`);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        // Skip if already freed (signature already used)
        if (!errMsg.includes('SignatureAlreadyUsed')) {
          errors.push(`Delegate ${delegate}: ${errMsg}`);
        }
      }
    }

    return { freed: true, delegatesFreed, errors };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return { freed: false, delegatesFreed: 0, errors: [errMsg] };
  }
}

/**
 * Free VP for all finalized proposals
 */
export async function freeAllPendingVP(): Promise<{
  proposalsProcessed: number;
  totalDelegatesFreed: number;
  errors: string[];
}> {
  const contract = getGovernanceContract();
  const proposalCount = Number(await contract.proposalCounter());

  let totalDelegatesFreed = 0;
  const allErrors: string[] = [];
  let proposalsWithPendingVP = 0;

  for (let i = 1; i <= proposalCount; i++) {
    const proposal = await contract.proposals(i);
    const status = Number(proposal.status);

    // Only process finalized proposals (Passed, Failed, Executed)
    if (status !== ProposalStatus.Active && status !== ProposalStatus.Cancelled) {
      const result = await freeVPForProposal(i);
      if (result.delegatesFreed > 0) {
        proposalsWithPendingVP++;
      }
      totalDelegatesFreed += result.delegatesFreed;
      allErrors.push(...result.errors);
    }
  }

  return {
    proposalsProcessed: proposalsWithPendingVP,
    totalDelegatesFreed,
    errors: allErrors,
  };
}
