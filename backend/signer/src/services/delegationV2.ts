/**
 * DelegationV2 Service
 *
 * Handles off-chain EIP-712 signed delegations for the two-track governance system.
 * Users sign delegations off-chain, backend stores them in database.
 * These delegations are used when computing VP snapshots for proposals.
 *
 * Key features:
 * - Multi-delegate support (users can delegate to multiple delegates)
 * - Partial delegation (delegate specific VP amount) or full delegation (vpAmount=0)
 * - Revocation via timestamp (maintains history)
 * - Sequential nonce per delegator for replay protection
 */

import { ethers } from 'ethers';
import { config } from '../config';
import { query } from '../db/pool';
import { getActiveStakers } from './stakerIndexer';
import { getWsProvider } from '../utils/wsProvider';

// ============================================================
// EIP-712 Types
// ============================================================

const EIP712_DOMAIN_NAME = 'Rose Token';
const EIP712_DOMAIN_VERSION = '1';

// EIP-712 domain configuration
function getDomain(chainId: number) {
  return {
    name: EIP712_DOMAIN_NAME,
    version: EIP712_DOMAIN_VERSION,
    chainId,
  };
}

// EIP-712 type definition for Delegation
const DELEGATION_TYPES = {
  Delegation: [
    { name: 'delegator', type: 'address' },
    { name: 'delegate', type: 'address' },
    { name: 'vpAmount', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'expiry', type: 'uint256' },
  ],
};

// Supported chain IDs (mainnet + testnet)
const ALLOWED_CHAIN_IDS = config.profile.chainIds;

// ============================================================
// Types
// ============================================================

export interface DelegationV2 {
  delegator: string;
  delegate: string;
  vpAmount: bigint;
  nonce: number;
  expiry: Date;
  signature: string;
  createdAt: Date;
  revokedAt: Date | null;
}

export interface StoreDelegationInput {
  delegator: string;
  delegate: string;
  vpAmount: string; // BigInt as string, 0 = full delegation
  nonce: number;
  expiry: number; // Unix timestamp
  signature: string;
}

export interface UserDelegationState {
  delegations: Array<{
    delegate: string;
    vpAmount: bigint;
    nonce: number;
    expiry: Date;
  }>;
  totalDelegated: bigint;
}

export interface ReceivedDelegation {
  delegator: string;
  vpAmount: bigint;
  nonce: number;
  expiry: Date;
}

// ============================================================
// Contract Integration
// ============================================================

import { RoseGovernanceABI } from '../utils/contracts';

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

/**
 * Check if delegate has opted in to receive delegations.
 * Queries on-chain canReceiveDelegation(address) function.
 * Returns false if delegate hasn't opted in or has no stake.
 * Throws on RPC errors to distinguish from legitimate "not opted in".
 */
export async function verifyDelegateOptIn(delegate: string): Promise<boolean> {
  try {
    const governance = getGovernanceContract();
    const canReceive = await governance.canReceiveDelegation(delegate);
    return Boolean(canReceive);
  } catch (error) {
    console.error('[DelegationV2] Error checking delegate opt-in:', error);
    // Re-throw RPC errors - don't silently treat as "not opted in"
    throw new Error(`Failed to verify delegate opt-in status: ${error instanceof Error ? error.message : 'RPC error'}`);
  }
}

// ============================================================
// EIP-712 Signature Verification
// ============================================================

/**
 * Verify EIP-712 delegation signature.
 * Recovers signer address and validates it matches delegator.
 * Tries multiple chain IDs for compatibility (mainnet + testnet).
 */
export function verifyDelegationSignature(input: StoreDelegationInput): boolean {
  const value = {
    delegator: ethers.getAddress(input.delegator),
    delegate: ethers.getAddress(input.delegate),
    vpAmount: BigInt(input.vpAmount),
    nonce: BigInt(input.nonce),
    expiry: BigInt(input.expiry),
  };

  console.log('[DelegationV2] Verifying signature:', {
    delegator: input.delegator,
    delegate: input.delegate,
    vpAmount: input.vpAmount,
    nonce: input.nonce,
    expiry: input.expiry,
  });

  // Try each allowed chainId
  for (const chainId of ALLOWED_CHAIN_IDS) {
    try {
      const domain = getDomain(chainId);
      const recoveredAddress = ethers.verifyTypedData(domain, DELEGATION_TYPES, value, input.signature);

      if (recoveredAddress.toLowerCase() === input.delegator.toLowerCase()) {
        console.log(`[DelegationV2] Signature verified for chainId ${chainId}`);
        return true;
      }
    } catch (err) {
      // Continue to next chainId
      continue;
    }
  }

  console.log('[DelegationV2] Signature verification failed for all chain IDs');
  return false;
}

// ============================================================
// Nonce Management
// ============================================================

/**
 * Get next nonce for a delegator.
 * Returns max(nonce) + 1 from delegations table.
 * Returns 0 if no previous delegations.
 */
export async function getNextNonce(delegator: string): Promise<number> {
  const result = await query(`
    SELECT MAX(nonce) as max_nonce
    FROM delegations
    WHERE LOWER(delegator) = LOWER($1)
  `, [delegator]);

  const maxNonce = result.rows[0]?.max_nonce;
  return maxNonce === null ? 0 : parseInt(maxNonce) + 1;
}

// ============================================================
// Storage Operations
// ============================================================

/**
 * Store a new delegation after full verification.
 * Steps:
 * 1. Validate input addresses and amounts
 * 2. Verify EIP-712 signature
 * 3. Check delegate opt-in status on-chain
 * 4. Verify expiry is in future
 * 5. Insert into database (with race condition handling)
 * Throws on any validation failure.
 */
export async function storeDelegation(input: StoreDelegationInput): Promise<void> {
  // 1. Validate addresses
  if (!ethers.isAddress(input.delegator)) {
    throw new Error('Invalid delegator address');
  }
  if (!ethers.isAddress(input.delegate)) {
    throw new Error('Invalid delegate address');
  }

  // 2. Validate vpAmount (BigInt constructor throws on negative string values)
  let vpAmount: bigint;
  try {
    vpAmount = BigInt(input.vpAmount);
  } catch {
    // BigInt throws for invalid formats including negative values
    if (input.vpAmount.startsWith('-')) {
      throw new Error('vpAmount cannot be negative');
    }
    throw new Error('Invalid vpAmount format');
  }

  // 3. Verify EIP-712 signature
  if (!verifyDelegationSignature(input)) {
    throw new Error('Invalid signature');
  }

  // 4. Check delegate opt-in (throws on RPC errors)
  const optedIn = await verifyDelegateOptIn(input.delegate);
  if (!optedIn) {
    throw new Error('Delegate has not opted in to receive delegations');
  }

  // 5. Verify expiry is in future
  const now = Math.floor(Date.now() / 1000);
  if (input.expiry <= now) {
    throw new Error('Delegation has already expired');
  }

  // 6. If new delegation is full (vpAmount=0), revoke existing full delegations first
  // Uses parameterized query for '0' to maintain consistency
  if (vpAmount === 0n) {
    await query(`
      UPDATE delegations
      SET revoked_at = NOW()
      WHERE LOWER(delegator) = LOWER($1)
        AND vp_amount = $2
        AND revoked_at IS NULL
        AND expiry > NOW()
    `, [input.delegator, '0']);
  }

  // 7. Insert delegation - let UNIQUE constraint handle nonce race conditions
  try {
    await query(`
      INSERT INTO delegations (delegator, delegate, vp_amount, nonce, expiry, signature)
      VALUES (LOWER($1), LOWER($2), $3, $4, to_timestamp($5), $6)
    `, [
      input.delegator,
      input.delegate,
      vpAmount.toString(),
      input.nonce,
      input.expiry,
      input.signature,
    ]);
  } catch (error: unknown) {
    // Handle UNIQUE constraint violation (race condition on nonce)
    const pgError = error as { code?: string };
    if (pgError.code === '23505') {
      const expectedNonce = await getNextNonce(input.delegator);
      throw new Error(`Invalid nonce: expected ${expectedNonce}, got ${input.nonce}`);
    }
    throw error;
  }

  console.log(`[DelegationV2] Stored delegation: ${input.delegator.slice(0, 10)}... -> ${input.delegate.slice(0, 10)}... (${vpAmount === 0n ? 'full' : vpAmount.toString()})`);
}

// ============================================================
// Query Operations
// ============================================================

/**
 * Get all active delegations FROM a user (delegator perspective).
 * Active = not revoked AND not expired.
 */
export async function getUserDelegations(user: string): Promise<UserDelegationState> {
  const result = await query(`
    SELECT delegate, vp_amount, nonce, expiry
    FROM delegations
    WHERE LOWER(delegator) = LOWER($1)
      AND revoked_at IS NULL
      AND expiry > NOW()
    ORDER BY nonce DESC
  `, [user]);

  const delegations = result.rows.map((row) => ({
    delegate: row.delegate,
    vpAmount: BigInt(row.vp_amount),
    nonce: parseInt(row.nonce),
    expiry: new Date(row.expiry),
  }));

  // Calculate total delegated (0 = full is special, treat as "all")
  // For display, sum non-zero amounts; if any is 0, show "Full"
  const totalDelegated = delegations.reduce((sum, d) => {
    if (d.vpAmount === 0n) {
      // Full delegation - can't sum, return special marker
      return -1n; // Marker for "full delegation"
    }
    return sum >= 0n ? sum + d.vpAmount : sum;
  }, 0n);

  return {
    delegations,
    totalDelegated: totalDelegated < 0n ? 0n : totalDelegated, // 0n means "full delegation exists"
  };
}

/**
 * Get all active delegations TO a delegate (delegate perspective).
 * Active = not revoked AND not expired.
 */
export async function getReceivedDelegations(delegate: string): Promise<ReceivedDelegation[]> {
  const result = await query(`
    SELECT delegator, vp_amount, nonce, expiry
    FROM delegations
    WHERE LOWER(delegate) = LOWER($1)
      AND revoked_at IS NULL
      AND expiry > NOW()
    ORDER BY created_at DESC
  `, [delegate]);

  return result.rows.map((row) => ({
    delegator: row.delegator,
    vpAmount: BigInt(row.vp_amount),
    nonce: parseInt(row.nonce),
    expiry: new Date(row.expiry),
  }));
}

/**
 * Get a specific delegation record by delegator and delegate.
 */
export async function getDelegation(
  delegator: string,
  delegate: string
): Promise<DelegationV2 | null> {
  const result = await query(`
    SELECT delegator, delegate, vp_amount, nonce, expiry, signature, created_at, revoked_at
    FROM delegations
    WHERE LOWER(delegator) = LOWER($1)
      AND LOWER(delegate) = LOWER($2)
      AND revoked_at IS NULL
      AND expiry > NOW()
    ORDER BY nonce DESC
    LIMIT 1
  `, [delegator, delegate]);

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    delegator: row.delegator,
    delegate: row.delegate,
    vpAmount: BigInt(row.vp_amount),
    nonce: parseInt(row.nonce),
    expiry: new Date(row.expiry),
    signature: row.signature,
    createdAt: new Date(row.created_at),
    revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
  };
}

// ============================================================
// Revocation Operations
// ============================================================

/**
 * Verify revocation signature.
 * User must sign: keccak256("REVOKE_DELEGATION", delegator, delegate, timestamp)
 * to prove they control the delegator address.
 */
export function verifyRevocationSignature(
  delegator: string,
  delegate: string | null,
  timestamp: number,
  signature: string
): boolean {
  try {
    // Create message hash matching what frontend signs
    const messageHash = ethers.solidityPackedKeccak256(
      ['string', 'address', 'address', 'uint256'],
      ['REVOKE_DELEGATION', delegator, delegate || ethers.ZeroAddress, timestamp]
    );

    // Verify signature (ethers adds prefix)
    const recoveredAddress = ethers.verifyMessage(ethers.getBytes(messageHash), signature);

    if (recoveredAddress.toLowerCase() !== delegator.toLowerCase()) {
      console.log(`[DelegationV2] Revocation signature mismatch: recovered ${recoveredAddress}, expected ${delegator}`);
      return false;
    }

    return true;
  } catch (error) {
    console.error('[DelegationV2] Error verifying revocation signature:', error);
    return false;
  }
}

/**
 * Revoke delegation(s) for a delegator.
 * If delegate is null, revokes ALL delegations from delegator.
 * If delegate is specified, revokes only that delegation.
 * Sets revoked_at timestamp (doesn't delete).
 * Returns count of revoked delegations.
 */
export async function revokeDelegation(
  delegator: string,
  delegate: string | null
): Promise<number> {
  let result;

  if (delegate === null) {
    // Revoke all delegations from this delegator
    result = await query(`
      UPDATE delegations
      SET revoked_at = NOW()
      WHERE LOWER(delegator) = LOWER($1)
        AND revoked_at IS NULL
    `, [delegator]);
  } else {
    // Revoke specific delegation
    result = await query(`
      UPDATE delegations
      SET revoked_at = NOW()
      WHERE LOWER(delegator) = LOWER($1)
        AND LOWER(delegate) = LOWER($2)
        AND revoked_at IS NULL
    `, [delegator, delegate]);
  }

  const count = result.rowCount || 0;
  if (count > 0) {
    console.log(`[DelegationV2] Revoked ${count} delegation(s) for ${delegator.slice(0, 10)}...${delegate ? ` -> ${delegate.slice(0, 10)}...` : ' (all)'}`);
  }

  return count;
}

// ============================================================
// Stats
// ============================================================

/**
 * Get delegation statistics for monitoring.
 */
export async function getDelegationStats(): Promise<{
  totalDelegations: number;
  activeDelegations: number;
  uniqueDelegators: number;
  uniqueDelegates: number;
}> {
  const [totalResult, activeResult, delegatorsResult, delegatesResult] = await Promise.all([
    query('SELECT COUNT(*) as count FROM delegations'),
    query('SELECT COUNT(*) as count FROM delegations WHERE revoked_at IS NULL AND expiry > NOW()'),
    query('SELECT COUNT(DISTINCT delegator) as count FROM delegations WHERE revoked_at IS NULL AND expiry > NOW()'),
    query('SELECT COUNT(DISTINCT delegate) as count FROM delegations WHERE revoked_at IS NULL AND expiry > NOW()'),
  ]);

  return {
    totalDelegations: parseInt(totalResult.rows[0].count),
    activeDelegations: parseInt(activeResult.rows[0].count),
    uniqueDelegators: parseInt(delegatorsResult.rows[0].count),
    uniqueDelegates: parseInt(delegatesResult.rows[0].count),
  };
}

// ============================================================
// Eligible Delegates Query
// ============================================================

export interface EligibleDelegate {
  address: string;
  stakedRose: string;
  votingPower: string;
}

/**
 * Get all eligible delegates (users who can receive delegations).
 * Queries stakers table and filters by canReceiveDelegation() on-chain.
 * This combines opt-in status + stake requirement.
 */
export async function getEligibleDelegates(): Promise<EligibleDelegate[]> {
  // Get all active stakers from the indexed database
  const stakers = await getActiveStakers();

  if (stakers.length === 0) {
    return [];
  }

  const governance = getGovernanceContract();
  const eligibleDelegates: EligibleDelegate[] = [];

  // Check canReceiveDelegation for each staker
  // This function returns true if: isDelegateOptedIn[user] && stakedRose[user] > 0
  for (const staker of stakers) {
    try {
      const canReceive = await governance.canReceiveDelegation(staker.address);
      if (canReceive) {
        eligibleDelegates.push({
          address: staker.address,
          stakedRose: staker.stakedRose.toString(),
          votingPower: staker.votingPower.toString(),
        });
      }
    } catch (error) {
      // Log but don't fail - skip this staker
      console.warn(`[DelegationV2] Error checking canReceiveDelegation for ${staker.address}:`, error);
    }
  }

  return eligibleDelegates;
}

// ============================================================
// EIP-712 Domain Export (for frontend)
// ============================================================

/**
 * Get EIP-712 domain and types for frontend signature generation.
 */
export function getEIP712Config(chainId: number) {
  return {
    domain: getDomain(chainId),
    types: DELEGATION_TYPES,
  };
}
