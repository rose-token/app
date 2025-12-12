-- Migration 010: Stakers Cache Table
-- Materialized cache of stakers, updated by Deposited/Withdrawn event watchers
-- Events are source of truth, cache is for performance

CREATE TABLE IF NOT EXISTS stakers (
    address VARCHAR(42) PRIMARY KEY,
    staked_rose NUMERIC(78,0) NOT NULL DEFAULT 0,
    voting_power NUMERIC(78,0) NOT NULL DEFAULT 0,   -- Cached VP (may be stale if reputation changed)
    reputation INTEGER NOT NULL DEFAULT 60,          -- Cached reputation score (0-100)
    first_deposit_block INTEGER NOT NULL,
    last_updated_block INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for active stakers (those with stake > 0)
CREATE INDEX IF NOT EXISTS idx_stakers_active
    ON stakers(address) WHERE staked_rose > 0;

-- Index for finding stakers by first deposit block (for snapshot queries)
CREATE INDEX IF NOT EXISTS idx_stakers_first_deposit
    ON stakers(first_deposit_block);

-- ============================================================
-- TRIGGER: Auto-update updated_at on stakers
-- ============================================================

CREATE OR REPLACE FUNCTION update_stakers_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stakers_updated ON stakers;
CREATE TRIGGER trg_stakers_updated
    BEFORE UPDATE ON stakers
    FOR EACH ROW
    EXECUTE FUNCTION update_stakers_updated_at();

-- ============================================================
-- TABLE: Staker validation log for weekly reconciliation
-- ============================================================

CREATE TABLE IF NOT EXISTS staker_validations (
    id SERIAL PRIMARY KEY,
    address VARCHAR(42) NOT NULL,
    cached_staked_rose NUMERIC(78,0) NOT NULL,
    onchain_staked_rose NUMERIC(78,0) NOT NULL,
    was_mismatch BOOLEAN NOT NULL DEFAULT FALSE,
    validated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for finding mismatches
CREATE INDEX IF NOT EXISTS idx_staker_validations_mismatch
    ON staker_validations(validated_at DESC) WHERE was_mismatch = TRUE;
