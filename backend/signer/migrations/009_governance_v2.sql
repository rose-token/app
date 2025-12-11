-- Migration 009: Governance V2 - Two-Track System
-- Replaces on-chain delegation tracking with off-chain delegation + merkle proofs
-- Adds VP snapshots for proposals and slow track allocation tracking

-- ============================================================
-- DROP OLD DELEGATION TABLES (replaced by off-chain system)
-- ============================================================

-- Drop indexes first
DROP INDEX IF EXISTS idx_delegation_allocations_lookup;
DROP INDEX IF EXISTS idx_delegation_allocations_delegator;

-- Drop old table
DROP TABLE IF EXISTS delegation_allocations;

-- ============================================================
-- TABLE 1: Off-chain delegations (EIP-712 signed)
-- ============================================================
-- Users sign delegations off-chain, backend stores them
-- Supports partial delegations (delegate specific VP amount to multiple delegates)
-- Revocations tracked via revoked_at timestamp for history

CREATE TABLE IF NOT EXISTS delegations (
    id SERIAL PRIMARY KEY,
    delegator VARCHAR(42) NOT NULL,
    delegate VARCHAR(42) NOT NULL,
    vp_amount NUMERIC(78,0) NOT NULL,  -- VP amount to delegate (0 = full delegation)
    nonce INTEGER NOT NULL,            -- EIP-712 nonce, per delegator
    expiry TIMESTAMPTZ NOT NULL,       -- When this delegation signature expires
    signature TEXT NOT NULL,           -- EIP-712 signature
    created_at TIMESTAMPTZ DEFAULT NOW(),
    revoked_at TIMESTAMPTZ,            -- NULL = active, set when revoked
    UNIQUE(delegator, nonce)           -- Each nonce can only be used once per delegator
);

-- Index for finding all active delegations TO a delegate (for snapshot computation)
CREATE INDEX IF NOT EXISTS idx_delegations_delegate
    ON delegations(LOWER(delegate)) WHERE revoked_at IS NULL;

-- Index for finding all active delegations FROM a delegator (for user's delegation status)
CREATE INDEX IF NOT EXISTS idx_delegations_delegator
    ON delegations(LOWER(delegator)) WHERE revoked_at IS NULL;

-- Index for finding latest delegation by delegator (for nonce validation)
CREATE INDEX IF NOT EXISTS idx_delegations_delegator_nonce
    ON delegations(LOWER(delegator), nonce DESC);

-- ============================================================
-- TABLE 2: VP Snapshots for proposals (Merkle trees)
-- ============================================================
-- Backend computes VP snapshot at proposal snapshot block
-- Stores merkle root on-chain, full tree data in DB for proof generation
-- One snapshot per proposal

CREATE TABLE IF NOT EXISTS vp_snapshots (
    id SERIAL PRIMARY KEY,
    proposal_id INTEGER NOT NULL UNIQUE,
    snapshot_block INTEGER NOT NULL,
    merkle_root VARCHAR(66) NOT NULL,   -- bytes32 as hex (0x + 64 chars)
    total_vp NUMERIC(78,0) NOT NULL,    -- Total VP in the snapshot
    tree_data JSONB NOT NULL,           -- Array of leaf data for proof generation
    -- tree_data format: [{
    --   "address": "0x...",
    --   "effectiveVP": "1000000000",   -- VP after delegations (9 decimals)
    --   "baseVP": "1500000000",        -- VP from staking (before delegations)
    --   "delegatedTo": "0x..." or null, -- Who they delegated to (for UI)
    --   "delegatedAmount": "500000000" -- Amount delegated out
    -- }]
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for block lookups (finding snapshot by block number)
CREATE INDEX IF NOT EXISTS idx_vp_snapshots_block
    ON vp_snapshots(snapshot_block);

-- ============================================================
-- TABLE 3: Slow track VP allocations
-- ============================================================
-- Tracks how much VP each user has allocated to slow track proposals
-- Used to compute available VP for attestations
-- VP is a budget: total_effectiveVP - sum(allocations) = available

CREATE TABLE IF NOT EXISTS vp_allocations (
    id SERIAL PRIMARY KEY,
    user_address VARCHAR(42) NOT NULL,
    proposal_id INTEGER NOT NULL,
    vp_amount NUMERIC(78,0) NOT NULL,   -- Amount of VP allocated to this proposal
    support BOOLEAN NOT NULL,           -- true = for, false = against
    deadline TIMESTAMPTZ NOT NULL,      -- When this proposal ends (for cleanup)
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_address, proposal_id)   -- One allocation per user per proposal
);

-- Index for finding all allocations by user (for available VP calculation)
CREATE INDEX IF NOT EXISTS idx_vp_allocations_user
    ON vp_allocations(LOWER(user_address));

-- Index for finding active allocations by user (deadline not passed)
CREATE INDEX IF NOT EXISTS idx_vp_allocations_user_active
    ON vp_allocations(LOWER(user_address), deadline DESC)
    WHERE deadline > NOW();

-- Index for finding all allocations for a proposal (for analytics)
CREATE INDEX IF NOT EXISTS idx_vp_allocations_proposal
    ON vp_allocations(proposal_id);

-- ============================================================
-- TRIGGER: Auto-update updated_at on vp_allocations
-- ============================================================

CREATE OR REPLACE FUNCTION update_vp_allocations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_vp_allocations_updated ON vp_allocations;
CREATE TRIGGER trg_vp_allocations_updated
    BEFORE UPDATE ON vp_allocations
    FOR EACH ROW
    EXECUTE FUNCTION update_vp_allocations_updated_at();
