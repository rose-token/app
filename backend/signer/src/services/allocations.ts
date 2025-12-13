/**
 * Allocations Service
 *
 * Manages VP allocations for Slow Track proposals.
 * Slow Track uses "scarce VP" - users have a budget they must allocate across proposals.
 * This service tracks allocations in the database and generates attestations for voteSlow().
 */

import { ethers } from 'ethers';
import { config } from '../config';
import { query } from '../db/pool';
import { getWsProvider } from '../utils/wsProvider';

// Governance contract ABI - minimal for allocation queries
const GOVERNANCE_ABI = [
  'function allocationNonce(address user) external view returns (uint256)',
  'function proposals(uint256 proposalId) external view returns (tuple(address proposer, uint8 track, uint256 snapshotBlock, bytes32 vpMerkleRoot, uint256 votingStartsAt, uint256 votingEndsAt, uint256 forVotes, uint256 againstVotes, uint256 treasuryAmount, uint8 status, string title, string descriptionHash, uint256 deadline, string deliverables, uint256 editCount, uint256 taskId))',
];

// Contract enums
enum Track {
  Fast = 0,
  Slow = 1,
}

enum ProposalStatus {
  Pending = 0,
  Active = 1,
  Passed = 2,
  Failed = 3,
  Executed = 4,
  Cancelled = 5,
}

// Types
export interface VPAllocation {
  userAddress: string;
  proposalId: number;
  vpAmount: bigint;
  support: boolean;
  deadline: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface AvailableVPResult {
  totalVP: bigint;
  allocatedVP: bigint;
  availableVP: bigint;
  allocations: VPAllocation[];
}

export interface AttestationResult {
  user: string;
  proposalId: number;
  support: boolean;
  vpAmount: string;
  availableVP: string;
  nonce: string;
  expiry: number;
  signature: string;
}

// State
let governanceContract: ethers.Contract | null = null;
let wallet: ethers.Wallet | null = null;

function getProvider(): ethers.Provider {
  return getWsProvider();
}

function getWallet(): ethers.Wallet {
  if (!wallet) {
    wallet = new ethers.Wallet(config.signer.privateKey, getProvider());
  }
  return wallet;
}

function getGovernanceContract(): ethers.Contract {
  if (!governanceContract) {
    if (!config.contracts.governance) {
      throw new Error('GOVERNANCE_ADDRESS not configured');
    }
    governanceContract = new ethers.Contract(
      config.contracts.governance,
      GOVERNANCE_ABI,
      getProvider()
    );
  }
  return governanceContract;
}

// ============================================================
// Database Operations
// ============================================================

/**
 * Get all active (non-expired) allocations for a user.
 * Active = deadline has not passed yet.
 */
export async function getActiveAllocations(user: string): Promise<VPAllocation[]> {
  const result = await query(`
    SELECT user_address, proposal_id, vp_amount, support, deadline, created_at, updated_at
    FROM vp_allocations
    WHERE LOWER(user_address) = LOWER($1)
      AND deadline > NOW()
    ORDER BY proposal_id ASC
  `, [user]);

  return result.rows.map((row) => ({
    userAddress: row.user_address,
    proposalId: parseInt(row.proposal_id),
    vpAmount: BigInt(row.vp_amount),
    support: row.support,
    deadline: Math.floor(new Date(row.deadline).getTime() / 1000),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  }));
}

/**
 * Record or update an allocation (UPSERT).
 * Called when VoteCastSlow or VoteUpdated events are processed.
 */
export async function recordAllocation(
  user: string,
  proposalId: number,
  vpAmount: bigint,
  support: boolean,
  deadline: number
): Promise<void> {
  await query(`
    INSERT INTO vp_allocations (user_address, proposal_id, vp_amount, support, deadline)
    VALUES (LOWER($1), $2, $3, $4, to_timestamp($5))
    ON CONFLICT (user_address, proposal_id) DO UPDATE SET
      vp_amount = $3,
      support = $4,
      deadline = to_timestamp($5),
      updated_at = NOW()
  `, [user, proposalId, vpAmount.toString(), support, deadline]);

  console.log(`[Allocations] Recorded allocation: user=${user.slice(0, 10)}..., proposal=${proposalId}, amount=${vpAmount}`);
}

/**
 * Remove allocation for a specific user and proposal.
 * Called when a user's vote is somehow invalidated (rare edge case).
 */
export async function removeAllocation(
  user: string,
  proposalId: number
): Promise<void> {
  const result = await query(`
    DELETE FROM vp_allocations
    WHERE LOWER(user_address) = LOWER($1) AND proposal_id = $2
  `, [user, proposalId]);

  if (result.rowCount && result.rowCount > 0) {
    console.log(`[Allocations] Removed allocation: user=${user.slice(0, 10)}..., proposal=${proposalId}`);
  }
}

/**
 * Remove all allocations for a finalized proposal.
 * Called when ProposalFinalized event is received.
 * Returns the number of allocations deleted.
 */
export async function cleanupProposalAllocations(proposalId: number): Promise<number> {
  const result = await query(`
    DELETE FROM vp_allocations
    WHERE proposal_id = $1
  `, [proposalId]);

  const count = result.rowCount || 0;
  if (count > 0) {
    console.log(`[Allocations] Cleaned up ${count} allocations for proposal ${proposalId}`);
  }
  return count;
}

/**
 * Remove expired allocations (deadline < NOW()).
 * Called periodically as a safety net if event watcher misses something.
 * Returns the number of allocations deleted.
 */
export async function cleanupExpiredAllocations(): Promise<number> {
  const result = await query(`
    DELETE FROM vp_allocations
    WHERE deadline < NOW()
  `);

  const count = result.rowCount || 0;
  if (count > 0) {
    console.log(`[Allocations] Cleaned up ${count} expired allocations`);
  }
  return count;
}

// ============================================================
// VP Calculations
// ============================================================

/**
 * Calculate available VP for a user.
 * Available VP = totalVP - sum(active allocations)
 */
export async function getAvailableVP(user: string, totalVP: bigint): Promise<AvailableVPResult> {
  const allocations = await getActiveAllocations(user);

  const allocatedVP = allocations.reduce((sum, alloc) => sum + alloc.vpAmount, 0n);
  const availableVP = totalVP > allocatedVP ? totalVP - allocatedVP : 0n;

  return {
    totalVP,
    allocatedVP,
    availableVP,
    allocations,
  };
}

// ============================================================
// Contract Queries
// ============================================================

/**
 * Get the current allocation nonce for a user from the contract.
 * The nonce increments on every voteSlow() call to prevent replay attacks.
 */
export async function getAllocationNonce(user: string): Promise<bigint> {
  const governance = getGovernanceContract();
  const nonce = await governance.allocationNonce(user);
  return BigInt(nonce);
}

/**
 * Get proposal voting end time (for deadline calculation).
 */
export async function getProposalDeadline(proposalId: number): Promise<number> {
  const governance = getGovernanceContract();
  const proposal = await governance.proposals(proposalId);
  return Number(proposal.votingEndsAt);
}

/**
 * Validate that a proposal is eligible for Slow Track voting.
 * Checks: track is Slow, status is Active, voting period is open.
 */
export async function validateProposalForSlowTrack(proposalId: number): Promise<void> {
  const governance = getGovernanceContract();
  const proposal = await governance.proposals(proposalId);

  // Check track
  if (Number(proposal.track) !== Track.Slow) {
    throw new Error(`Proposal ${proposalId} is not a Slow Track proposal`);
  }

  // Check status
  if (Number(proposal.status) !== ProposalStatus.Active) {
    throw new Error(`Proposal ${proposalId} is not active (status: ${proposal.status})`);
  }

  // Check voting period
  const now = Math.floor(Date.now() / 1000);
  const votingStartsAt = Number(proposal.votingStartsAt);
  const votingEndsAt = Number(proposal.votingEndsAt);

  if (now < votingStartsAt) {
    throw new Error(`Voting has not started for proposal ${proposalId}`);
  }

  if (now > votingEndsAt) {
    throw new Error(`Voting has ended for proposal ${proposalId}`);
  }
}

// ============================================================
// Attestation Signing
// ============================================================

/**
 * Sign an availability attestation for voteSlow().
 * Message format matches contract verification:
 * keccak256(abi.encodePacked("voteSlow", voter, proposalId, support, vpAmount, availableVP, nonce, expiry))
 */
export async function signAvailableVPAttestation(
  user: string,
  proposalId: number,
  support: boolean,
  vpAmount: bigint,
  availableVP: bigint,
  nonce: bigint
): Promise<{ signature: string; expiry: number }> {
  const expiry = Math.floor(Date.now() / 1000) + config.signatureTtl;

  const messageHash = ethers.solidityPackedKeccak256(
    ['string', 'address', 'uint256', 'bool', 'uint256', 'uint256', 'uint256', 'uint256'],
    ['voteSlow', user, proposalId, support, vpAmount, availableVP, nonce, expiry]
  );

  // Sign the hash (ethers adds "\x19Ethereum Signed Message:\n32" prefix)
  const signature = await getWallet().signMessage(ethers.getBytes(messageHash));

  console.log(`[Allocations] Signed attestation: user=${user.slice(0, 10)}..., proposal=${proposalId}, vpAmount=${vpAmount}, availableVP=${availableVP}, nonce=${nonce}`);

  return { signature, expiry };
}

/**
 * Full attestation flow: get available VP, nonce, and sign.
 * This is the main entry point for the API endpoint.
 */
export async function getSlowTrackAttestation(
  user: string,
  proposalId: number,
  support: boolean,
  vpAmount: bigint,
  totalVP: bigint
): Promise<AttestationResult> {
  // 0. Validate proposal is eligible for Slow Track voting
  await validateProposalForSlowTrack(proposalId);

  // 1. Get current allocations and available VP
  const { availableVP, allocations } = await getAvailableVP(user, totalVP);

  // 2. Validate vpAmount doesn't exceed available VP
  if (vpAmount > availableVP) {
    throw new Error(`Insufficient available VP: requested ${vpAmount}, available ${availableVP}`);
  }

  // 3. Check if this is a vote update (user already has allocation for this proposal)
  const existingAllocation = allocations.find((a) => a.proposalId === proposalId);
  let effectiveAvailable = availableVP;

  if (existingAllocation) {
    // User is updating their vote - their existing allocation should be "freed" first
    // So available VP includes their current allocation on this proposal
    effectiveAvailable = availableVP + existingAllocation.vpAmount;

    if (vpAmount > effectiveAvailable) {
      throw new Error(`Insufficient available VP for update: requested ${vpAmount}, available ${effectiveAvailable}`);
    }

    console.log(`[Allocations] Vote update detected: existing allocation ${existingAllocation.vpAmount}, effective available ${effectiveAvailable}`);
  }

  // 4. Get current nonce from contract
  const nonce = await getAllocationNonce(user);

  // 5. Sign attestation (use effectiveAvailable for signature)
  const { signature, expiry } = await signAvailableVPAttestation(
    user,
    proposalId,
    support,
    vpAmount,
    effectiveAvailable,
    nonce
  );

  return {
    user: ethers.getAddress(user),
    proposalId,
    support,
    vpAmount: vpAmount.toString(),
    availableVP: effectiveAvailable.toString(),
    nonce: nonce.toString(),
    expiry,
    signature,
  };
}

// ============================================================
// Stats
// ============================================================

/**
 * Get allocation stats for monitoring.
 */
export async function getAllocationStats(): Promise<{
  totalAllocations: number;
  activeAllocations: number;
  uniqueUsers: number;
  uniqueProposals: number;
}> {
  const [totalResult, activeResult, usersResult, proposalsResult] = await Promise.all([
    query('SELECT COUNT(*) as count FROM vp_allocations'),
    query('SELECT COUNT(*) as count FROM vp_allocations WHERE deadline > NOW()'),
    query('SELECT COUNT(DISTINCT user_address) as count FROM vp_allocations WHERE deadline > NOW()'),
    query('SELECT COUNT(DISTINCT proposal_id) as count FROM vp_allocations WHERE deadline > NOW()'),
  ]);

  return {
    totalAllocations: parseInt(totalResult.rows[0].count),
    activeAllocations: parseInt(activeResult.rows[0].count),
    uniqueUsers: parseInt(usersResult.rows[0].count),
    uniqueProposals: parseInt(proposalsResult.rows[0].count),
  };
}
