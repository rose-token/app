-- Migration 011: Analytics Dashboard Tables
-- Populated by analyticsWatcher from blockchain events
-- Used by admin dashboard for platform metrics

-- ============================================================
-- TABLE 1: analytics_tasks - Task lifecycle tracking
-- ============================================================
CREATE TABLE IF NOT EXISTS analytics_tasks (
    id SERIAL PRIMARY KEY,
    task_id INTEGER NOT NULL UNIQUE,
    customer VARCHAR(42) NOT NULL,
    worker VARCHAR(42),
    stakeholder VARCHAR(42),
    deposit NUMERIC(78,0) NOT NULL,

    -- Status tracking
    status VARCHAR(32) NOT NULL DEFAULT 'Created',
    is_auction BOOLEAN NOT NULL DEFAULT FALSE,

    -- Timestamps from events
    created_at TIMESTAMPTZ NOT NULL,
    staked_at TIMESTAMPTZ,
    claimed_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    approved_at TIMESTAMPTZ,
    closed_at TIMESTAMPTZ,
    disputed_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,

    -- Block tracking
    created_block INTEGER NOT NULL,
    last_event_block INTEGER NOT NULL,

    -- Metadata
    db_created_at TIMESTAMPTZ DEFAULT NOW(),
    db_updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analytics_tasks_status ON analytics_tasks(status);
CREATE INDEX IF NOT EXISTS idx_analytics_tasks_customer ON analytics_tasks(customer);
CREATE INDEX IF NOT EXISTS idx_analytics_tasks_worker ON analytics_tasks(worker) WHERE worker IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_analytics_tasks_created ON analytics_tasks(created_at DESC);

-- ============================================================
-- TABLE 2: analytics_proposals - Governance proposal tracking
-- ============================================================
CREATE TABLE IF NOT EXISTS analytics_proposals (
    id SERIAL PRIMARY KEY,
    proposal_id INTEGER NOT NULL UNIQUE,
    proposer VARCHAR(42) NOT NULL,
    track SMALLINT NOT NULL,            -- 0=Fast, 1=Slow
    treasury_amount NUMERIC(78,0) NOT NULL DEFAULT 0,

    -- Status tracking
    status VARCHAR(32) NOT NULL DEFAULT 'Created',

    -- Vote aggregates (updated on each vote event)
    total_votes INTEGER NOT NULL DEFAULT 0,
    yay_votes INTEGER NOT NULL DEFAULT 0,
    nay_votes INTEGER NOT NULL DEFAULT 0,
    total_vp NUMERIC(78,0) NOT NULL DEFAULT 0,
    yay_vp NUMERIC(78,0) NOT NULL DEFAULT 0,
    nay_vp NUMERIC(78,0) NOT NULL DEFAULT 0,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL,
    finalized_at TIMESTAMPTZ,

    -- Block tracking
    created_block INTEGER NOT NULL,
    last_event_block INTEGER NOT NULL,

    -- Metadata
    db_created_at TIMESTAMPTZ DEFAULT NOW(),
    db_updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analytics_proposals_status ON analytics_proposals(status);
CREATE INDEX IF NOT EXISTS idx_analytics_proposals_track ON analytics_proposals(track);
CREATE INDEX IF NOT EXISTS idx_analytics_proposals_created ON analytics_proposals(created_at DESC);

-- ============================================================
-- TABLE 3: analytics_treasury - Daily NAV snapshots
-- ============================================================
CREATE TABLE IF NOT EXISTS analytics_treasury (
    id SERIAL PRIMARY KEY,
    snapshot_date DATE NOT NULL UNIQUE,

    -- NAV data
    rose_price_usd NUMERIC(20,8) NOT NULL,
    total_hard_assets_usd NUMERIC(30,6) NOT NULL,
    circulating_rose NUMERIC(78,0) NOT NULL,

    -- Asset breakdown (basis points, 10000 = 100%)
    btc_bps INTEGER NOT NULL DEFAULT 0,
    gold_bps INTEGER NOT NULL DEFAULT 0,
    usdc_bps INTEGER NOT NULL DEFAULT 0,
    rose_bps INTEGER NOT NULL DEFAULT 0,

    -- Activity aggregates for the day
    deposits_count INTEGER NOT NULL DEFAULT 0,
    deposits_usdc NUMERIC(30,6) NOT NULL DEFAULT 0,
    redemptions_count INTEGER NOT NULL DEFAULT 0,
    redemptions_usdc NUMERIC(30,6) NOT NULL DEFAULT 0,

    -- Block reference
    snapshot_block INTEGER,

    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analytics_treasury_date ON analytics_treasury(snapshot_date DESC);

-- ============================================================
-- TABLE 4: analytics_users - Aggregated user activity
-- ============================================================
CREATE TABLE IF NOT EXISTS analytics_users (
    id SERIAL PRIMARY KEY,
    address VARCHAR(42) NOT NULL UNIQUE,

    -- Marketplace activity
    tasks_created INTEGER NOT NULL DEFAULT 0,
    tasks_completed_as_worker INTEGER NOT NULL DEFAULT 0,
    tasks_staked INTEGER NOT NULL DEFAULT 0,
    total_earned_wei NUMERIC(78,0) NOT NULL DEFAULT 0,
    total_spent_wei NUMERIC(78,0) NOT NULL DEFAULT 0,

    -- Governance activity
    proposals_created INTEGER NOT NULL DEFAULT 0,
    votes_cast INTEGER NOT NULL DEFAULT 0,
    total_vp_used NUMERIC(78,0) NOT NULL DEFAULT 0,
    staked_rose NUMERIC(78,0) NOT NULL DEFAULT 0,
    voting_power NUMERIC(78,0) NOT NULL DEFAULT 0,

    -- Treasury activity
    deposits_count INTEGER NOT NULL DEFAULT 0,
    deposits_usdc NUMERIC(30,6) NOT NULL DEFAULT 0,
    redemptions_count INTEGER NOT NULL DEFAULT 0,
    redemptions_usdc NUMERIC(30,6) NOT NULL DEFAULT 0,

    -- Timestamps
    first_seen_at TIMESTAMPTZ NOT NULL,
    last_active_at TIMESTAMPTZ NOT NULL,

    -- Metadata
    db_created_at TIMESTAMPTZ DEFAULT NOW(),
    db_updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analytics_users_active ON analytics_users(last_active_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_users_staked ON analytics_users(staked_rose DESC) WHERE staked_rose > 0;

-- ============================================================
-- TABLE 5: analytics_daily - Daily aggregates for charts
-- ============================================================
CREATE TABLE IF NOT EXISTS analytics_daily (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL UNIQUE,

    -- Marketplace metrics
    tasks_created INTEGER NOT NULL DEFAULT 0,
    tasks_completed INTEGER NOT NULL DEFAULT 0,
    tasks_disputed INTEGER NOT NULL DEFAULT 0,
    tasks_cancelled INTEGER NOT NULL DEFAULT 0,
    task_volume_wei NUMERIC(78,0) NOT NULL DEFAULT 0,

    -- Governance metrics
    proposals_created INTEGER NOT NULL DEFAULT 0,
    proposals_finalized INTEGER NOT NULL DEFAULT 0,
    votes_cast INTEGER NOT NULL DEFAULT 0,
    total_vp_voted NUMERIC(78,0) NOT NULL DEFAULT 0,
    stakes_deposited NUMERIC(78,0) NOT NULL DEFAULT 0,
    stakes_withdrawn NUMERIC(78,0) NOT NULL DEFAULT 0,

    -- Treasury metrics
    deposits_count INTEGER NOT NULL DEFAULT 0,
    deposits_usdc NUMERIC(30,6) NOT NULL DEFAULT 0,
    redemptions_count INTEGER NOT NULL DEFAULT 0,
    redemptions_usdc NUMERIC(30,6) NOT NULL DEFAULT 0,
    rose_minted NUMERIC(78,0) NOT NULL DEFAULT 0,
    rose_burned NUMERIC(78,0) NOT NULL DEFAULT 0,

    -- User metrics
    new_users INTEGER NOT NULL DEFAULT 0,
    active_users INTEGER NOT NULL DEFAULT 0,

    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analytics_daily_date ON analytics_daily(date DESC);

-- ============================================================
-- TRIGGERS: Auto-update updated_at timestamps
-- ============================================================

CREATE OR REPLACE FUNCTION update_analytics_db_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.db_updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_analytics_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_analytics_tasks_updated ON analytics_tasks;
CREATE TRIGGER trg_analytics_tasks_updated
    BEFORE UPDATE ON analytics_tasks
    FOR EACH ROW
    EXECUTE FUNCTION update_analytics_db_updated_at();

DROP TRIGGER IF EXISTS trg_analytics_proposals_updated ON analytics_proposals;
CREATE TRIGGER trg_analytics_proposals_updated
    BEFORE UPDATE ON analytics_proposals
    FOR EACH ROW
    EXECUTE FUNCTION update_analytics_db_updated_at();

DROP TRIGGER IF EXISTS trg_analytics_treasury_updated ON analytics_treasury;
CREATE TRIGGER trg_analytics_treasury_updated
    BEFORE UPDATE ON analytics_treasury
    FOR EACH ROW
    EXECUTE FUNCTION update_analytics_updated_at();

DROP TRIGGER IF EXISTS trg_analytics_users_updated ON analytics_users;
CREATE TRIGGER trg_analytics_users_updated
    BEFORE UPDATE ON analytics_users
    FOR EACH ROW
    EXECUTE FUNCTION update_analytics_db_updated_at();

DROP TRIGGER IF EXISTS trg_analytics_daily_updated ON analytics_daily;
CREATE TRIGGER trg_analytics_daily_updated
    BEFORE UPDATE ON analytics_daily
    FOR EACH ROW
    EXECUTE FUNCTION update_analytics_updated_at();
