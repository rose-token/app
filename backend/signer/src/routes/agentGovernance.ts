/**
 * Agent Governance Routes
 *
 * REST API endpoints for agents to participate in governance:
 * - Browse and inspect proposals
 * - Create proposals (bypasses Gitcoin Passport via API key auth)
 * - Vote on proposals (Fast Track + Slow Track)
 * - Execute approved proposals
 * - Claim voter rewards
 * - Manage delegation opt-in
 *
 * All endpoints require API key authentication.
 */

import { Router, Request, Response } from 'express';
import { ethers } from 'ethers';
import { agentAuth } from '../middleware/agentAuth';
import { signApproval } from '../services/signer';
import { config } from '../config';
import {
  getGovernanceContract,
  getReputationContract,
  getHttpProvider,
} from '../utils/contracts';
import governanceService from '../services/governance';
import { getStoredMerkleProof } from '../services/vpSnapshot';
import {
  getAvailableVP,
  getAllocationNonce,
  signAvailableVPAttestation,
  validateProposalForSlowTrack,
} from '../services/allocations';

const router = Router();

// All governance endpoints require agent authentication
router.use(agentAuth);

// ============================================================
// Minimal ABIs for calldata encoding
// ============================================================

const GOVERNANCE_CREATE_PROPOSAL_ABI = [
  'function createProposal(uint8 track, string title, string descriptionHash, uint256 treasuryAmount, uint256 deadline, string deliverables, uint256 expiry, bytes signature, uint256 attestedRep, uint256 repExpiry, bytes repSignature) returns (uint256)',
];

const GOVERNANCE_EDIT_PROPOSAL_ABI = [
  'function editProposal(uint256 proposalId, string title, string descriptionHash, uint256 treasuryAmount, uint256 deadline, string deliverables)',
];

const GOVERNANCE_CANCEL_PROPOSAL_ABI = [
  'function cancelProposal(uint256 proposalId)',
];

const GOVERNANCE_FINALIZE_PROPOSAL_ABI = [
  'function finalizeProposal(uint256 proposalId)',
];

const GOVERNANCE_EXECUTE_PROPOSAL_ABI = [
  'function executeProposal(uint256 proposalId)',
];

const GOVERNANCE_VOTE_FAST_ABI = [
  'function voteFast(uint256 proposalId, bool support, uint256 vpAmount, bytes32[] merkleProof, uint256 expiry, bytes signature, uint256 attestedRep, uint256 repExpiry, bytes repSignature)',
];

const GOVERNANCE_VOTE_SLOW_ABI = [
  'function voteSlow(uint256 proposalId, bool support, uint256 vpAmount, uint256 availableVP, uint256 nonce, uint256 expiry, bytes signature, uint256 attestedRep, uint256 repExpiry, bytes repSignature)',
];

const GOVERNANCE_CLAIM_REWARDS_ABI = [
  'function claimVoterRewards(uint256[] proposalIds, uint256 expiry, bytes signature)',
];

const GOVERNANCE_DELEGATE_OPTIN_ABI = [
  'function setDelegateOptIn(bool optIn)',
];

// ============================================================
// Helpers
// ============================================================

/** Status enum values matching contract */
const ProposalStatusNames: Record<number, string> = {
  0: 'Pending',
  1: 'Active',
  2: 'Passed',
  3: 'Failed',
  4: 'Executed',
  5: 'Cancelled',
};

const TrackNames: Record<number, string> = {
  0: 'Fast',
  1: 'Slow',
};

/**
 * Format a raw proposal struct from the contract into a JSON-friendly object.
 */
function formatProposal(proposalId: number, p: any) {
  return {
    proposalId,
    proposer: p.proposer,
    track: TrackNames[Number(p.track)] || String(p.track),
    trackRaw: Number(p.track),
    snapshotBlock: Number(p.snapshotBlock),
    vpMerkleRoot: p.vpMerkleRoot,
    votingStartsAt: Number(p.votingStartsAt),
    votingEndsAt: Number(p.votingEndsAt),
    forVotes: p.forVotes.toString(),
    againstVotes: p.againstVotes.toString(),
    treasuryAmount: p.treasuryAmount.toString(),
    treasuryAmountFormatted: ethers.formatUnits(p.treasuryAmount, 18),
    status: ProposalStatusNames[Number(p.status)] || String(p.status),
    statusRaw: Number(p.status),
    title: p.title,
    descriptionHash: p.descriptionHash,
    deadline: Number(p.deadline),
    deliverables: p.deliverables,
    editCount: Number(p.editCount),
    taskId: Number(p.taskId),
  };
}

/**
 * Sign a voteFast passport-style approval.
 * Message: keccak256(abi.encodePacked("voteFast", voter, proposalId, support, vpAmount, expiry))
 */
async function signVoteFastApproval(
  voter: string,
  proposalId: number,
  support: boolean,
  vpAmount: bigint,
  expiry: number
): Promise<string> {
  const wallet = new ethers.Wallet(config.signer.privateKey);
  const messageHash = ethers.solidityPackedKeccak256(
    ['string', 'address', 'uint256', 'bool', 'uint256', 'uint256'],
    ['voteFast', voter, proposalId, support, vpAmount, expiry]
  );
  return wallet.signMessage(ethers.getBytes(messageHash));
}

/**
 * Sign a claimVoterRewards approval.
 * Message: keccak256(abi.encodePacked("claimVoterRewards", voter, abi.encode(proposalIds), expiry))
 */
async function signClaimRewardsApproval(
  voter: string,
  proposalIds: number[],
  expiry: number
): Promise<string> {
  const wallet = new ethers.Wallet(config.signer.privateKey);
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ['uint256[]'],
    [proposalIds]
  );
  const messageHash = ethers.solidityPackedKeccak256(
    ['string', 'address', 'bytes', 'uint256'],
    ['claimVoterRewards', voter, encoded, expiry]
  );
  return wallet.signMessage(ethers.getBytes(messageHash));
}

// ============================================================
// READ ENDPOINTS
// ============================================================

/**
 * GET /api/agent/governance/proposals
 * List proposals with pagination and optional status filter.
 *
 * Query params:
 * - page: Page number (default 1)
 * - limit: Items per page (default 20, max 100)
 * - status: Filter by status name (Pending, Active, Passed, Failed, Executed, Cancelled)
 */
router.get('/governance/proposals', async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
    const statusFilter = req.query.status as string | undefined;

    const governanceAddress = config.contracts.governance;
    if (!governanceAddress) {
      return res.status(500).json({ error: 'Governance contract not configured' });
    }

    const provider = getHttpProvider();
    const governance = getGovernanceContract(provider);

    // Get total proposal count
    const proposalCount = Number(await governance.proposalCounter());

    if (proposalCount === 0) {
      return res.json({
        proposals: [],
        pagination: { page, limit, total: 0, totalPages: 0 },
      });
    }

    // Determine status filter value
    let statusValue: number | null = null;
    if (statusFilter) {
      const entry = Object.entries(ProposalStatusNames).find(
        ([, name]) => name.toLowerCase() === statusFilter.toLowerCase()
      );
      if (entry) {
        statusValue = parseInt(entry[0], 10);
      } else {
        return res.status(400).json({
          error: `Invalid status filter. Valid values: ${Object.values(ProposalStatusNames).join(', ')}`,
        });
      }
    }

    // Fetch proposals in reverse order (newest first)
    // We fetch more than needed when filtering to ensure we fill a page
    const proposals: any[] = [];
    const batchSize = statusValue !== null ? limit * 3 : limit;
    const startId = proposalCount;
    const skip = (page - 1) * limit;

    let skipped = 0;
    let collected = 0;

    for (let id = startId; id >= 1 && collected < limit; id--) {
      try {
        const p = await governance.proposals(id);
        if (p.proposer === ethers.ZeroAddress) continue;

        if (statusValue !== null && Number(p.status) !== statusValue) {
          continue;
        }

        if (skipped < skip) {
          skipped++;
          continue;
        }

        proposals.push(formatProposal(id, p));
        collected++;
      } catch {
        // Skip invalid proposals
        continue;
      }
    }

    // Approximate total (exact count requires full scan with filter)
    const total = statusValue !== null ? undefined : proposalCount;

    return res.json({
      proposals,
      pagination: {
        page,
        limit,
        total: total ?? proposals.length,
        totalPages: total ? Math.ceil(total / limit) : undefined,
      },
    });
  } catch (error) {
    console.error('[AgentGovernance] List proposals error:', error);
    return res.status(500).json({ error: 'Failed to fetch proposals' });
  }
});

/**
 * GET /api/agent/governance/proposals/:id
 * Get a single proposal with vote counts and quorum progress.
 */
router.get('/governance/proposals/:id', async (req: Request, res: Response) => {
  try {
    const proposalId = parseInt(req.params.id, 10);
    if (isNaN(proposalId) || proposalId < 1) {
      return res.status(400).json({ error: 'Invalid proposal ID' });
    }

    const governanceAddress = config.contracts.governance;
    if (!governanceAddress) {
      return res.status(500).json({ error: 'Governance contract not configured' });
    }

    const provider = getHttpProvider();
    const governance = getGovernanceContract(provider);

    const p = await governance.proposals(proposalId);
    if (p.proposer === ethers.ZeroAddress) {
      return res.status(404).json({ error: 'Proposal not found' });
    }

    // Get quorum progress and vote result
    const [quorum, voteResult, totalVP, extensions] = await Promise.all([
      governance.getQuorumProgress(proposalId),
      governance.getVoteResult(proposalId),
      governance.proposalTotalVP(proposalId),
      governance.proposalExtensions(proposalId),
    ]);

    const proposal = formatProposal(proposalId, p);

    return res.json({
      ...proposal,
      quorum: {
        current: quorum.current.toString(),
        required: quorum.required.toString(),
        met: BigInt(quorum.current) >= BigInt(quorum.required) && BigInt(quorum.required) > 0n,
      },
      voteResult: {
        forPercent: Number(voteResult.forPercent),
        againstPercent: Number(voteResult.againstPercent),
        passThreshold: 5833, // 58.33% in basis points
      },
      totalVP: totalVP.toString(),
      extensions: Number(extensions),
    });
  } catch (error) {
    console.error('[AgentGovernance] Get proposal error:', error);
    return res.status(500).json({ error: 'Failed to fetch proposal' });
  }
});

/**
 * GET /api/agent/governance/proposals/:id/votes
 * Get the agent's own vote on a proposal.
 * (On-chain voter list is not enumerable per-proposal without events,
 *  so we return the authenticated agent's vote.)
 */
router.get('/governance/proposals/:id/votes', async (req: Request, res: Response) => {
  try {
    const proposalId = parseInt(req.params.id, 10);
    if (isNaN(proposalId) || proposalId < 1) {
      return res.status(400).json({ error: 'Invalid proposal ID' });
    }

    const agentAddress = req.agent!.walletAddress;
    const governanceAddress = config.contracts.governance;
    if (!governanceAddress) {
      return res.status(500).json({ error: 'Governance contract not configured' });
    }

    const provider = getHttpProvider();
    const governance = getGovernanceContract(provider);

    // Check proposal exists
    const p = await governance.proposals(proposalId);
    if (p.proposer === ethers.ZeroAddress) {
      return res.status(404).json({ error: 'Proposal not found' });
    }

    // Get agent's vote
    const vote = await governance.votes(proposalId, agentAddress);

    return res.json({
      proposalId,
      voter: agentAddress,
      hasVoted: vote.hasVoted,
      support: vote.hasVoted ? vote.support : null,
      vpAmount: vote.hasVoted ? vote.vpAmount.toString() : '0',
    });
  } catch (error) {
    console.error('[AgentGovernance] Get votes error:', error);
    return res.status(500).json({ error: 'Failed to fetch votes' });
  }
});

/**
 * GET /api/agent/governance/vote-power
 * Get the agent's current vote power breakdown.
 */
router.get('/governance/vote-power', async (req: Request, res: Response) => {
  try {
    const agentAddress = req.agent!.walletAddress;

    const vpData = await governanceService.getUserVP(agentAddress);

    // Also get received VP (delegations)
    const receivedVPStr = await governanceService.getTotalReceivedVP(agentAddress);

    // Get reputation
    const reputation = await governanceService.getReputationNew(agentAddress);

    // Get delegation opt-in status
    const provider = getHttpProvider();
    const governance = getGovernanceContract(provider);
    const isDelegateOptedIn = await governance.isDelegateOptedIn(agentAddress);

    return res.json({
      agent: agentAddress,
      votePower: {
        stakedRose: vpData.stakedRose,
        stakedRoseFormatted: ethers.formatUnits(BigInt(vpData.stakedRose), 18),
        votingPower: vpData.votingPower,
        availableVP: vpData.availableVP,
        delegatedOut: vpData.delegatedOut,
        proposalVPLocked: vpData.proposalVPLocked,
        receivedVP: receivedVPStr,
        activeProposals: vpData.activeProposal,
      },
      reputation,
      isDelegateOptedIn,
    });
  } catch (error) {
    console.error('[AgentGovernance] Vote power error:', error);
    return res.status(500).json({ error: 'Failed to fetch vote power' });
  }
});

/**
 * GET /api/agent/governance/rewards
 * Check claimable voter rewards for the agent.
 * Scans finalized proposals where the agent voted on the winning side.
 */
router.get('/governance/rewards', async (req: Request, res: Response) => {
  try {
    const agentAddress = req.agent!.walletAddress;
    const governanceAddress = config.contracts.governance;
    if (!governanceAddress) {
      return res.status(500).json({ error: 'Governance contract not configured' });
    }

    const provider = getHttpProvider();
    const governance = getGovernanceContract(provider);

    const proposalCount = Number(await governance.proposalCounter());
    const claimable: Array<{
      proposalId: number;
      rewardPool: string;
      voterVP: string;
      totalWinningVotes: string;
      estimatedReward: string;
    }> = [];

    // Scan proposals for unclaimed rewards
    for (let id = 1; id <= proposalCount; id++) {
      try {
        const [rewardPool, totalVotes, outcome, claimed, vote] = await Promise.all([
          governance.voterRewardPool(id),
          governance.voterRewardTotalVotes(id),
          governance.voterRewardOutcome(id),
          governance.voterRewardClaimed(id, agentAddress),
          governance.votes(id, agentAddress),
        ]);

        if (
          BigInt(rewardPool) > 0n &&
          BigInt(totalVotes) > 0n &&
          !claimed &&
          vote.hasVoted &&
          vote.support === outcome
        ) {
          const estimated =
            (BigInt(rewardPool) * BigInt(vote.vpAmount)) / BigInt(totalVotes);
          claimable.push({
            proposalId: id,
            rewardPool: rewardPool.toString(),
            voterVP: vote.vpAmount.toString(),
            totalWinningVotes: totalVotes.toString(),
            estimatedReward: estimated.toString(),
          });
        }
      } catch {
        continue;
      }
    }

    const totalEstimated = claimable.reduce(
      (sum, c) => sum + BigInt(c.estimatedReward),
      0n
    );

    return res.json({
      agent: agentAddress,
      claimable,
      totalEstimatedReward: totalEstimated.toString(),
      totalEstimatedRewardFormatted: ethers.formatUnits(totalEstimated, 18),
    });
  } catch (error) {
    console.error('[AgentGovernance] Rewards error:', error);
    return res.status(500).json({ error: 'Failed to fetch rewards' });
  }
});

// ============================================================
// WRITE ENDPOINTS
// ============================================================

/**
 * POST /api/agent/governance/proposals
 * Create a governance proposal. Returns calldata + signatures for on-chain execution.
 *
 * Body:
 * - track: "Fast" or "Slow" (or 0/1)
 * - title: Proposal title
 * - descriptionHash: IPFS hash of description
 * - treasuryAmount: ROSE amount requested (string, e.g. "100")
 * - deadline: Task deadline (unix timestamp)
 * - deliverables: Expected deliverables string
 */
router.post('/governance/proposals', async (req: Request, res: Response) => {
  try {
    const { track, title, descriptionHash, treasuryAmount, deadline, deliverables } =
      req.body;

    // Validate inputs
    if (title === undefined || typeof title !== 'string' || title.length === 0) {
      return res.status(400).json({ error: 'title is required (non-empty string)' });
    }
    if (!descriptionHash || typeof descriptionHash !== 'string') {
      return res.status(400).json({ error: 'descriptionHash is required (string)' });
    }
    if (!treasuryAmount || typeof treasuryAmount !== 'string') {
      return res
        .status(400)
        .json({ error: 'treasuryAmount is required (string, e.g. "100")' });
    }
    if (deadline === undefined || typeof deadline !== 'number') {
      return res
        .status(400)
        .json({ error: 'deadline is required (unix timestamp number)' });
    }
    if (deliverables === undefined || typeof deliverables !== 'string') {
      return res.status(400).json({ error: 'deliverables is required (string)' });
    }

    // Parse track
    let trackValue: number;
    if (track === 'Fast' || track === 0) {
      trackValue = 0;
    } else if (track === 'Slow' || track === 1) {
      trackValue = 1;
    } else {
      return res
        .status(400)
        .json({ error: 'track must be "Fast", "Slow", 0, or 1' });
    }

    // Parse treasury amount
    let treasuryAmountWei: bigint;
    try {
      treasuryAmountWei = ethers.parseUnits(treasuryAmount, 18);
      if (treasuryAmountWei <= 0n) throw new Error();
    } catch {
      return res
        .status(400)
        .json({ error: 'Invalid treasuryAmount — must be a positive number' });
    }

    const agentAddress = req.agent!.walletAddress;
    const governanceAddress = config.contracts.governance;
    if (!governanceAddress) {
      return res.status(500).json({ error: 'Governance contract not configured' });
    }

    // Sign passport approval (bypasses Gitcoin Passport for agents)
    const expiry = Math.floor(Date.now() / 1000) + config.signatureTtl;
    const passportSignature = await signApproval(agentAddress, 'propose', expiry);

    // Sign reputation attestation
    const repAttestation = await governanceService.getSignedReputation(agentAddress);

    // Encode calldata
    const govIface = new ethers.Interface(GOVERNANCE_CREATE_PROPOSAL_ABI);
    const calldata = govIface.encodeFunctionData('createProposal', [
      trackValue,
      title,
      descriptionHash,
      treasuryAmountWei,
      deadline,
      deliverables,
      expiry,
      passportSignature,
      repAttestation.reputation,
      repAttestation.expiry,
      repAttestation.signature,
    ]);

    console.log(
      `[AgentGovernance] Create proposal params generated for ${agentAddress}: "${title}" (${TrackNames[trackValue]} track, ${treasuryAmount} ROSE)`
    );

    return res.json({
      success: true,
      agent: agentAddress,
      track: TrackNames[trackValue],
      title,
      treasuryAmount,
      treasuryAmountWei: treasuryAmountWei.toString(),
      approval: {
        expiry,
        signature: passportSignature,
      },
      reputation: {
        score: repAttestation.reputation,
        expiry: repAttestation.expiry,
        signature: repAttestation.signature,
      },
      transaction: {
        description: 'Create governance proposal',
        to: governanceAddress,
        calldata,
        function:
          'createProposal(uint8,string,string,uint256,uint256,string,uint256,bytes,uint256,uint256,bytes)',
      },
      castCommand: `cast send ${governanceAddress} "createProposal(uint8,string,string,uint256,uint256,string,uint256,bytes,uint256,uint256,bytes)" ${trackValue} "${title}" "${descriptionHash}" ${treasuryAmountWei} ${deadline} "${deliverables}" ${expiry} ${passportSignature} ${repAttestation.reputation} ${repAttestation.expiry} ${repAttestation.signature} --rpc-url ${config.rpc.url}`,
    });
  } catch (error) {
    console.error('[AgentGovernance] Create proposal error:', error);
    return res.status(500).json({ error: 'Failed to generate proposal parameters' });
  }
});

/**
 * POST /api/agent/governance/proposals/:id/vote
 * Vote on a proposal. Handles both Fast Track (merkle proof) and Slow Track (attestation).
 *
 * Body:
 * - support: true (For) or false (Against)
 * - vpAmount: VP amount to vote with (string, in VP units)
 */
router.post('/governance/proposals/:id/vote', async (req: Request, res: Response) => {
  try {
    const proposalId = parseInt(req.params.id, 10);
    if (isNaN(proposalId) || proposalId < 1) {
      return res.status(400).json({ error: 'Invalid proposal ID' });
    }

    const { support, vpAmount } = req.body;

    if (typeof support !== 'boolean') {
      return res.status(400).json({ error: 'support is required (boolean)' });
    }
    if (!vpAmount || typeof vpAmount !== 'string') {
      return res.status(400).json({ error: 'vpAmount is required (string)' });
    }

    let vpAmountBigInt: bigint;
    try {
      vpAmountBigInt = BigInt(vpAmount);
      if (vpAmountBigInt <= 0n) throw new Error();
    } catch {
      return res.status(400).json({ error: 'Invalid vpAmount — must be a positive integer string' });
    }

    const agentAddress = req.agent!.walletAddress;
    const governanceAddress = config.contracts.governance;
    if (!governanceAddress) {
      return res.status(500).json({ error: 'Governance contract not configured' });
    }

    const provider = getHttpProvider();
    const governance = getGovernanceContract(provider);

    // Get proposal to determine track
    const p = await governance.proposals(proposalId);
    if (p.proposer === ethers.ZeroAddress) {
      return res.status(404).json({ error: 'Proposal not found' });
    }

    const track = Number(p.track);

    // Sign reputation attestation (needed for both tracks)
    const repAttestation = await governanceService.getSignedReputation(agentAddress);

    const expiry = Math.floor(Date.now() / 1000) + config.signatureTtl;

    if (track === 0) {
      // ─── Fast Track: Merkle Proof ───
      const proof = await getStoredMerkleProof(proposalId, agentAddress);
      if (!proof) {
        return res.status(400).json({
          error: 'No VP snapshot found for this proposal or agent not in snapshot. You must have staked ROSE before the snapshot was taken.',
        });
      }

      // Sign voteFast passport approval
      const passportSignature = await signVoteFastApproval(
        agentAddress,
        proposalId,
        support,
        vpAmountBigInt,
        expiry
      );

      // Encode calldata
      const govIface = new ethers.Interface(GOVERNANCE_VOTE_FAST_ABI);
      const calldata = govIface.encodeFunctionData('voteFast', [
        proposalId,
        support,
        vpAmountBigInt,
        proof.proof,
        expiry,
        passportSignature,
        repAttestation.reputation,
        repAttestation.expiry,
        repAttestation.signature,
      ]);

      console.log(
        `[AgentGovernance] Fast vote params generated for ${agentAddress} on proposal ${proposalId}: ${support ? 'For' : 'Against'}, VP=${vpAmount}`
      );

      return res.json({
        success: true,
        agent: agentAddress,
        proposalId,
        track: 'Fast',
        support,
        vpAmount,
        merkleProof: proof.proof,
        approval: { expiry, signature: passportSignature },
        reputation: {
          score: repAttestation.reputation,
          expiry: repAttestation.expiry,
          signature: repAttestation.signature,
        },
        transaction: {
          description: `Vote ${support ? 'For' : 'Against'} on proposal #${proposalId} (Fast Track)`,
          to: governanceAddress,
          calldata,
          function:
            'voteFast(uint256,bool,uint256,bytes32[],uint256,bytes,uint256,uint256,bytes)',
        },
        castCommand: `cast send ${governanceAddress} "voteFast(uint256,bool,uint256,bytes32[],uint256,bytes,uint256,uint256,bytes)" ${proposalId} ${support} ${vpAmountBigInt} "[${proof.proof.join(',')}]" ${expiry} ${passportSignature} ${repAttestation.reputation} ${repAttestation.expiry} ${repAttestation.signature} --rpc-url ${config.rpc.url}`,
      });
    } else {
      // ─── Slow Track: Backend Attestation ───
      // Validate proposal is eligible
      await validateProposalForSlowTrack(proposalId);

      // Get VP data for slow track
      const vpData = await governanceService.getUserVP(agentAddress);
      const ownVP = BigInt(vpData.votingPower);
      const receivedVPStr = await governanceService.getTotalReceivedVP(agentAddress);
      const receivedVP = BigInt(receivedVPStr);
      const totalVP = ownVP + receivedVP;

      // Get available VP
      const { availableVP, allocations } = await getAvailableVP(agentAddress, totalVP);

      // Check if updating existing vote (add back existing allocation)
      const existingAllocation = allocations.find(
        (a) => a.proposalId === proposalId
      );
      let effectiveAvailable = availableVP;
      if (existingAllocation) {
        effectiveAvailable = availableVP + existingAllocation.vpAmount;
      }

      if (vpAmountBigInt > effectiveAvailable) {
        return res.status(400).json({
          error: `Insufficient available VP: requested ${vpAmount}, available ${effectiveAvailable.toString()}`,
        });
      }

      // Get nonce and sign attestation
      const nonce = await getAllocationNonce(agentAddress);
      const attestation = await signAvailableVPAttestation(
        agentAddress,
        proposalId,
        support,
        vpAmountBigInt,
        effectiveAvailable,
        nonce
      );

      // Encode calldata
      const govIface = new ethers.Interface(GOVERNANCE_VOTE_SLOW_ABI);
      const calldata = govIface.encodeFunctionData('voteSlow', [
        proposalId,
        support,
        vpAmountBigInt,
        effectiveAvailable,
        nonce,
        attestation.expiry,
        attestation.signature,
        repAttestation.reputation,
        repAttestation.expiry,
        repAttestation.signature,
      ]);

      console.log(
        `[AgentGovernance] Slow vote params generated for ${agentAddress} on proposal ${proposalId}: ${support ? 'For' : 'Against'}, VP=${vpAmount}`
      );

      return res.json({
        success: true,
        agent: agentAddress,
        proposalId,
        track: 'Slow',
        support,
        vpAmount,
        availableVP: effectiveAvailable.toString(),
        nonce: nonce.toString(),
        approval: { expiry: attestation.expiry, signature: attestation.signature },
        reputation: {
          score: repAttestation.reputation,
          expiry: repAttestation.expiry,
          signature: repAttestation.signature,
        },
        transaction: {
          description: `Vote ${support ? 'For' : 'Against'} on proposal #${proposalId} (Slow Track)`,
          to: governanceAddress,
          calldata,
          function:
            'voteSlow(uint256,bool,uint256,uint256,uint256,uint256,bytes,uint256,uint256,bytes)',
        },
        castCommand: `cast send ${governanceAddress} "voteSlow(uint256,bool,uint256,uint256,uint256,uint256,bytes,uint256,uint256,bytes)" ${proposalId} ${support} ${vpAmountBigInt} ${effectiveAvailable} ${nonce} ${attestation.expiry} ${attestation.signature} ${repAttestation.reputation} ${repAttestation.expiry} ${repAttestation.signature} --rpc-url ${config.rpc.url}`,
      });
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[AgentGovernance] Vote error:', errorMsg);

    if (errorMsg.includes('Insufficient') || errorMsg.includes('not active') || errorMsg.includes('not a Slow')) {
      return res.status(400).json({ error: errorMsg });
    }

    return res.status(500).json({ error: 'Failed to generate vote parameters' });
  }
});

/**
 * POST /api/agent/governance/proposals/:id/execute
 * Execute a passed proposal. Returns calldata for on-chain execution.
 */
router.post('/governance/proposals/:id/execute', async (req: Request, res: Response) => {
  try {
    const proposalId = parseInt(req.params.id, 10);
    if (isNaN(proposalId) || proposalId < 1) {
      return res.status(400).json({ error: 'Invalid proposal ID' });
    }

    const agentAddress = req.agent!.walletAddress;
    const governanceAddress = config.contracts.governance;
    if (!governanceAddress) {
      return res.status(500).json({ error: 'Governance contract not configured' });
    }

    // Verify proposal is in Passed status
    const provider = getHttpProvider();
    const governance = getGovernanceContract(provider);
    const p = await governance.proposals(proposalId);

    if (p.proposer === ethers.ZeroAddress) {
      return res.status(404).json({ error: 'Proposal not found' });
    }
    if (Number(p.status) !== 2) {
      // 2 = Passed
      return res.status(400).json({
        error: `Proposal is not in Passed status (current: ${ProposalStatusNames[Number(p.status)]})`,
      });
    }

    // Encode calldata
    const govIface = new ethers.Interface(GOVERNANCE_EXECUTE_PROPOSAL_ABI);
    const calldata = govIface.encodeFunctionData('executeProposal', [proposalId]);

    console.log(
      `[AgentGovernance] Execute proposal params generated for ${agentAddress} on proposal ${proposalId}`
    );

    return res.json({
      success: true,
      agent: agentAddress,
      proposalId,
      transaction: {
        description: `Execute passed proposal #${proposalId} (creates marketplace task)`,
        to: governanceAddress,
        calldata,
        function: 'executeProposal(uint256)',
        args: [proposalId],
      },
      castCommand: `cast send ${governanceAddress} "executeProposal(uint256)" ${proposalId} --rpc-url ${config.rpc.url}`,
    });
  } catch (error) {
    console.error('[AgentGovernance] Execute error:', error);
    return res.status(500).json({ error: 'Failed to generate execute parameters' });
  }
});

/**
 * POST /api/agent/governance/rewards/claim
 * Claim voter rewards for finalized proposals. Returns calldata + signature.
 *
 * Body:
 * - proposalIds: Array of proposal IDs to claim from
 */
router.post('/governance/rewards/claim', async (req: Request, res: Response) => {
  try {
    const { proposalIds } = req.body;

    if (!Array.isArray(proposalIds) || proposalIds.length === 0) {
      return res
        .status(400)
        .json({ error: 'proposalIds is required (non-empty array of numbers)' });
    }

    if (!proposalIds.every((id: any) => typeof id === 'number' && id > 0)) {
      return res
        .status(400)
        .json({ error: 'All proposalIds must be positive numbers' });
    }

    const agentAddress = req.agent!.walletAddress;
    const governanceAddress = config.contracts.governance;
    if (!governanceAddress) {
      return res.status(500).json({ error: 'Governance contract not configured' });
    }

    // Sign claim approval
    const expiry = Math.floor(Date.now() / 1000) + config.signatureTtl;
    const signature = await signClaimRewardsApproval(
      agentAddress,
      proposalIds,
      expiry
    );

    // Encode calldata
    const govIface = new ethers.Interface(GOVERNANCE_CLAIM_REWARDS_ABI);
    const calldata = govIface.encodeFunctionData('claimVoterRewards', [
      proposalIds,
      expiry,
      signature,
    ]);

    console.log(
      `[AgentGovernance] Claim rewards params generated for ${agentAddress}: proposals [${proposalIds.join(', ')}]`
    );

    return res.json({
      success: true,
      agent: agentAddress,
      proposalIds,
      approval: { expiry, signature },
      transaction: {
        description: `Claim voter rewards for proposals [${proposalIds.join(', ')}]`,
        to: governanceAddress,
        calldata,
        function: 'claimVoterRewards(uint256[],uint256,bytes)',
        args: [proposalIds, expiry],
      },
      castCommand: `cast send ${governanceAddress} "claimVoterRewards(uint256[],uint256,bytes)" "[${proposalIds.join(',')}]" ${expiry} ${signature} --rpc-url ${config.rpc.url}`,
    });
  } catch (error) {
    console.error('[AgentGovernance] Claim rewards error:', error);
    return res.status(500).json({ error: 'Failed to generate claim parameters' });
  }
});

/**
 * POST /api/agent/governance/delegation
 * Set delegate opt-in status. Returns calldata for on-chain execution.
 *
 * Body:
 * - optIn: boolean — true to opt in, false to opt out
 */
router.post('/governance/delegation', async (req: Request, res: Response) => {
  try {
    const { optIn } = req.body;

    if (typeof optIn !== 'boolean') {
      return res.status(400).json({ error: 'optIn is required (boolean)' });
    }

    const agentAddress = req.agent!.walletAddress;
    const governanceAddress = config.contracts.governance;
    if (!governanceAddress) {
      return res.status(500).json({ error: 'Governance contract not configured' });
    }

    // Encode calldata
    const govIface = new ethers.Interface(GOVERNANCE_DELEGATE_OPTIN_ABI);
    const calldata = govIface.encodeFunctionData('setDelegateOptIn', [optIn]);

    console.log(
      `[AgentGovernance] Delegation opt-${optIn ? 'in' : 'out'} params generated for ${agentAddress}`
    );

    return res.json({
      success: true,
      agent: agentAddress,
      optIn,
      transaction: {
        description: `${optIn ? 'Opt in to' : 'Opt out of'} receiving delegation`,
        to: governanceAddress,
        calldata,
        function: 'setDelegateOptIn(bool)',
        args: [optIn],
      },
      castCommand: `cast send ${governanceAddress} "setDelegateOptIn(bool)" ${optIn} --rpc-url ${config.rpc.url}`,
    });
  } catch (error) {
    console.error('[AgentGovernance] Delegation error:', error);
    return res.status(500).json({ error: 'Failed to generate delegation parameters' });
  }
});

export default router;
