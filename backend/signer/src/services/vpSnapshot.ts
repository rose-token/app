import { ethers } from 'ethers';
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import { config } from '../config';
import { query } from '../db/pool';
import { getStakersAtBlock, StakerData } from './stakerIndexer';
import { getReputationNew } from './governance';

// Types
export interface VPLeaf {
  address: string;
  effectiveVP: bigint;      // VP after delegations applied
  baseVP: bigint;           // VP from staking (before delegations)
  delegatedTo: string | null;  // Primary delegate (for UI display)
  delegatedAmount: bigint;  // Amount delegated out
}

export interface DelegationRecord {
  delegator: string;
  delegate: string;
  vpAmount: bigint;         // 0 = full delegation
  nonce: number;
  expiry: Date;
}

export interface VPSnapshot {
  proposalId: number;
  snapshotBlock: number;
  merkleRoot: string;
  totalVP: bigint;
  leaves: VPLeaf[];
  tree: StandardMerkleTree<[string, bigint]>;
}

export interface MerkleProofResult {
  address: string;
  effectiveVP: string;
  baseVP: string;
  delegatedTo: string | null;
  delegatedAmount: string;
  proof: string[];
}

// ============================================================
// Core VP Snapshot Functions
// ============================================================

/**
 * Get active delegations at a point in time
 * Active = not revoked and not expired
 */
export async function getActiveDelegations(): Promise<DelegationRecord[]> {
  const result = await query(`
    SELECT delegator, delegate, vp_amount, nonce, expiry
    FROM delegations
    WHERE revoked_at IS NULL
      AND expiry > NOW()
    ORDER BY delegator, created_at DESC
  `);

  return result.rows.map((row) => ({
    delegator: row.delegator.toLowerCase(),
    delegate: row.delegate.toLowerCase(),
    vpAmount: BigInt(row.vp_amount),
    nonce: parseInt(row.nonce),
    expiry: new Date(row.expiry),
  }));
}

/**
 * Build a map of delegations: delegator -> list of (delegate, amount)
 */
function buildDelegationMap(delegations: DelegationRecord[]): Map<string, { delegate: string; amount: bigint }[]> {
  const delegationMap = new Map<string, { delegate: string; amount: bigint }[]>();

  for (const d of delegations) {
    if (!delegationMap.has(d.delegator)) {
      delegationMap.set(d.delegator, []);
    }
    delegationMap.get(d.delegator)!.push({
      delegate: d.delegate,
      amount: d.vpAmount,
    });
  }

  return delegationMap;
}

/**
 * Calculate voting power: sqrt(stakedRose) * (reputation / 100)
 */
function calculateVP(stakedRose: bigint, reputation: number): bigint {
  if (stakedRose === 0n || reputation === 0) return 0n;
  const sqrtAmount = sqrt(stakedRose);
  return (sqrtAmount * BigInt(reputation)) / 100n;
}

function sqrt(x: bigint): bigint {
  if (x === 0n) return 0n;
  let z = (x + 1n) / 2n;
  let y = x;
  while (z < y) {
    y = z;
    z = (x / z + z) / 2n;
  }
  return y;
}

/**
 * Compute effective VP for all stakers, applying delegations
 *
 * For each staker:
 * 1. baseVP = sqrt(stakedRose) * (reputation / 100)
 * 2. delegatedOut = sum of VP delegated to others
 * 3. delegatedIn = sum of VP delegated from others
 * 4. effectiveVP = baseVP - delegatedOut + delegatedIn
 */
export async function computeEffectiveVP(
  stakers: StakerData[],
  delegations: DelegationRecord[]
): Promise<VPLeaf[]> {
  // Build base VP for all stakers
  const vpMap = new Map<string, VPLeaf>();

  for (const staker of stakers) {
    // Refresh reputation to get accurate VP
    const reputation = await getReputationNew(staker.address);
    const baseVP = calculateVP(staker.stakedRose, reputation);

    vpMap.set(staker.address, {
      address: staker.address,
      effectiveVP: baseVP,
      baseVP: baseVP,
      delegatedTo: null,
      delegatedAmount: 0n,
    });
  }

  // Build delegation map
  const delegationMap = buildDelegationMap(delegations);

  // Apply delegations
  for (const [delegator, delegateList] of delegationMap) {
    const delegatorLeaf = vpMap.get(delegator);
    if (!delegatorLeaf) continue;

    for (const { delegate, amount } of delegateList) {
      // Determine delegation amount
      // If amount = 0, it's a full delegation
      const delegationAmount = amount === 0n ? delegatorLeaf.baseVP : amount;

      // Cap delegation at available VP
      const actualDelegation = delegationAmount > delegatorLeaf.effectiveVP
        ? delegatorLeaf.effectiveVP
        : delegationAmount;

      if (actualDelegation === 0n) continue;

      // Subtract from delegator
      delegatorLeaf.effectiveVP -= actualDelegation;
      delegatorLeaf.delegatedAmount += actualDelegation;
      if (!delegatorLeaf.delegatedTo) {
        delegatorLeaf.delegatedTo = delegate; // Track first delegate for UI
      }

      // Add to delegate
      let delegateLeaf = vpMap.get(delegate);
      if (!delegateLeaf) {
        // Delegate might not have staked themselves
        // Create a leaf for them with 0 base VP
        delegateLeaf = {
          address: delegate,
          effectiveVP: 0n,
          baseVP: 0n,
          delegatedTo: null,
          delegatedAmount: 0n,
        };
        vpMap.set(delegate, delegateLeaf);
      }
      delegateLeaf.effectiveVP += actualDelegation;
    }
  }

  // Convert to array and filter out zero VP
  return Array.from(vpMap.values()).filter((leaf) => leaf.effectiveVP > 0n);
}

/**
 * Build merkle tree from VP leaves
 * Uses OpenZeppelin format: double-hashed leaves
 * Leaf: keccak256(bytes.concat(keccak256(abi.encode(address, vpAmount))))
 */
export function buildMerkleTree(leaves: VPLeaf[]): StandardMerkleTree<[string, bigint]> {
  // Sort leaves by address for deterministic tree
  const sortedLeaves = [...leaves].sort((a, b) =>
    a.address.toLowerCase().localeCompare(b.address.toLowerCase())
  );

  // Build tree with [address, effectiveVP] tuples
  const treeData: [string, bigint][] = sortedLeaves.map((leaf) => [
    ethers.getAddress(leaf.address), // Checksum address
    leaf.effectiveVP,
  ]);

  // StandardMerkleTree handles the double-hashing
  return StandardMerkleTree.of(treeData, ['address', 'uint256']);
}

/**
 * Get merkle proof for a specific address
 */
export function getMerkleProof(
  tree: StandardMerkleTree<[string, bigint]>,
  leaves: VPLeaf[],
  address: string
): MerkleProofResult | null {
  const normalizedAddress = address.toLowerCase();
  const leaf = leaves.find((l) => l.address.toLowerCase() === normalizedAddress);

  if (!leaf) return null;

  // Find index in tree
  const checksumAddress = ethers.getAddress(normalizedAddress);
  let proof: string[] = [];

  for (const [i, [treeAddress]] of tree.entries()) {
    if (treeAddress.toLowerCase() === normalizedAddress) {
      proof = tree.getProof(i);
      break;
    }
  }

  return {
    address: checksumAddress,
    effectiveVP: leaf.effectiveVP.toString(),
    baseVP: leaf.baseVP.toString(),
    delegatedTo: leaf.delegatedTo ? ethers.getAddress(leaf.delegatedTo) : null,
    delegatedAmount: leaf.delegatedAmount.toString(),
    proof,
  };
}

/**
 * Compute full VP snapshot for a proposal
 */
export async function computeVPSnapshot(
  proposalId: number,
  snapshotBlock: number
): Promise<VPSnapshot> {
  console.log(`[VPSnapshot] Computing snapshot for proposal ${proposalId} at block ${snapshotBlock}`);

  // Get stakers at snapshot block
  const stakers = await getStakersAtBlock(snapshotBlock);
  console.log(`[VPSnapshot] Found ${stakers.length} stakers`);

  // Get active delegations
  const delegations = await getActiveDelegations();
  console.log(`[VPSnapshot] Found ${delegations.length} active delegations`);

  // Compute effective VP
  const leaves = await computeEffectiveVP(stakers, delegations);
  console.log(`[VPSnapshot] Computed ${leaves.length} leaves with VP`);

  // Build merkle tree
  const tree = buildMerkleTree(leaves);
  const merkleRoot = tree.root;
  const totalVP = leaves.reduce((sum, leaf) => sum + leaf.effectiveVP, 0n);

  console.log(`[VPSnapshot] Merkle root: ${merkleRoot}`);
  console.log(`[VPSnapshot] Total VP: ${totalVP}`);

  return {
    proposalId,
    snapshotBlock,
    merkleRoot,
    totalVP,
    leaves,
    tree,
  };
}

/**
 * Store VP snapshot in database
 */
export async function storeVPSnapshot(snapshot: VPSnapshot): Promise<void> {
  // Convert leaves to JSON-serializable format
  const treeData = snapshot.leaves.map((leaf) => ({
    address: ethers.getAddress(leaf.address),
    effectiveVP: leaf.effectiveVP.toString(),
    baseVP: leaf.baseVP.toString(),
    delegatedTo: leaf.delegatedTo ? ethers.getAddress(leaf.delegatedTo) : null,
    delegatedAmount: leaf.delegatedAmount.toString(),
  }));

  await query(`
    INSERT INTO vp_snapshots (proposal_id, snapshot_block, merkle_root, total_vp, tree_data)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (proposal_id) DO UPDATE SET
      snapshot_block = $2,
      merkle_root = $3,
      total_vp = $4,
      tree_data = $5,
      created_at = NOW()
  `, [
    snapshot.proposalId,
    snapshot.snapshotBlock,
    snapshot.merkleRoot,
    snapshot.totalVP.toString(),
    JSON.stringify(treeData),
  ]);

  console.log(`[VPSnapshot] Stored snapshot for proposal ${snapshot.proposalId}`);
}

/**
 * Load VP snapshot from database
 */
export async function loadVPSnapshot(proposalId: number): Promise<VPSnapshot | null> {
  const result = await query(`
    SELECT proposal_id, snapshot_block, merkle_root, total_vp, tree_data
    FROM vp_snapshots
    WHERE proposal_id = $1
  `, [proposalId]);

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  const treeData = row.tree_data as Array<{
    address: string;
    effectiveVP: string;
    baseVP: string;
    delegatedTo: string | null;
    delegatedAmount: string;
  }>;

  const leaves: VPLeaf[] = treeData.map((item) => ({
    address: item.address.toLowerCase(),
    effectiveVP: BigInt(item.effectiveVP),
    baseVP: BigInt(item.baseVP),
    delegatedTo: item.delegatedTo?.toLowerCase() || null,
    delegatedAmount: BigInt(item.delegatedAmount),
  }));

  const tree = buildMerkleTree(leaves);

  return {
    proposalId: parseInt(row.proposal_id),
    snapshotBlock: parseInt(row.snapshot_block),
    merkleRoot: row.merkle_root,
    totalVP: BigInt(row.total_vp),
    leaves,
    tree,
  };
}

/**
 * Get merkle proof for a user from stored snapshot
 */
export async function getStoredMerkleProof(
  proposalId: number,
  address: string
): Promise<MerkleProofResult | null> {
  const snapshot = await loadVPSnapshot(proposalId);
  if (!snapshot) return null;

  return getMerkleProof(snapshot.tree, snapshot.leaves, address);
}

// ============================================================
// Signing Functions
// ============================================================

/**
 * Sign merkle root for on-chain setVPMerkleRoot call
 * Message format: keccak256(abi.encodePacked("setVPMerkleRoot", proposalId, merkleRoot, totalVP, expiry))
 */
export async function signMerkleRoot(
  proposalId: number,
  merkleRoot: string,
  totalVP: bigint,
  expiry: number
): Promise<string> {
  const wallet = new ethers.Wallet(config.signer.privateKey);

  const messageHash = ethers.solidityPackedKeccak256(
    ['string', 'uint256', 'bytes32', 'uint256', 'uint256'],
    ['setVPMerkleRoot', proposalId, merkleRoot, totalVP, expiry]
  );

  const signature = await wallet.signMessage(ethers.getBytes(messageHash));
  return signature;
}

/**
 * Get signed merkle root data for submitting to contract
 */
export interface SignedMerkleRootData {
  proposalId: number;
  merkleRoot: string;
  totalVP: string;
  expiry: number;
  signature: string;
}

export async function getSignedMerkleRoot(proposalId: number): Promise<SignedMerkleRootData | null> {
  const snapshot = await loadVPSnapshot(proposalId);
  if (!snapshot) return null;

  const expiry = Math.floor(Date.now() / 1000) + config.signatureTtl;
  const signature = await signMerkleRoot(proposalId, snapshot.merkleRoot, snapshot.totalVP, expiry);

  return {
    proposalId,
    merkleRoot: snapshot.merkleRoot,
    totalVP: snapshot.totalVP.toString(),
    expiry,
    signature,
  };
}
