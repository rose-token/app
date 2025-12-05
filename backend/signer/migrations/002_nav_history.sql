-- NAV snapshots table for time-series price and allocation data
CREATE TABLE IF NOT EXISTS nav_snapshots (
    id SERIAL PRIMARY KEY,

    -- Timestamp (indexed for range queries)
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Asset values in USD (6 decimals, stored as NUMERIC for precision)
    btc_value_usd NUMERIC(24, 6) NOT NULL,
    gold_value_usd NUMERIC(24, 6) NOT NULL,
    usdc_value_usd NUMERIC(24, 6) NOT NULL,
    rose_value_usd NUMERIC(24, 6) NOT NULL,
    total_hard_assets_usd NUMERIC(24, 6) NOT NULL,

    -- ROSE price and supply
    rose_price_usd NUMERIC(24, 6) NOT NULL,
    circulating_rose NUMERIC(36, 18) NOT NULL,

    -- Allocation percentages (basis points, 10000 = 100%)
    target_btc_bps INTEGER NOT NULL,
    target_gold_bps INTEGER NOT NULL,
    target_usdc_bps INTEGER NOT NULL,
    target_rose_bps INTEGER NOT NULL,
    actual_btc_bps INTEGER NOT NULL,
    actual_gold_bps INTEGER NOT NULL,
    actual_usdc_bps INTEGER NOT NULL,
    actual_rose_bps INTEGER NOT NULL,

    -- Raw Chainlink prices (8 decimals)
    btc_chainlink_price NUMERIC(18, 8),
    gold_chainlink_price NUMERIC(18, 8),

    -- Metadata
    rebalance_needed BOOLEAN NOT NULL DEFAULT FALSE,
    block_number BIGINT NOT NULL
);

-- Index for time-series queries (most recent first)
CREATE INDEX IF NOT EXISTS idx_nav_snapshots_recorded_at ON nav_snapshots(recorded_at DESC);

-- Index for block lookups
CREATE INDEX IF NOT EXISTS idx_nav_snapshots_block ON nav_snapshots(block_number);

-- Rebalance events table for tracking contract rebalance executions
CREATE TABLE IF NOT EXISTS rebalance_events (
    id SERIAL PRIMARY KEY,

    -- Event identification
    tx_hash VARCHAR(66) NOT NULL UNIQUE,
    block_number BIGINT NOT NULL,
    log_index INTEGER NOT NULL,

    -- Event data (from Rebalanced event, 6 decimals USD)
    btc_value_usd NUMERIC(24, 6) NOT NULL,
    gold_value_usd NUMERIC(24, 6) NOT NULL,
    usdc_value_usd NUMERIC(24, 6) NOT NULL,
    rose_value_usd NUMERIC(24, 6) NOT NULL,
    total_hard_assets_usd NUMERIC(24, 6) NOT NULL,

    -- Timestamp (from block)
    rebalanced_at TIMESTAMPTZ NOT NULL,

    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for time-series queries
CREATE INDEX IF NOT EXISTS idx_rebalance_events_rebalanced_at ON rebalance_events(rebalanced_at DESC);

-- Index for block lookups
CREATE INDEX IF NOT EXISTS idx_rebalance_events_block ON rebalance_events(block_number);
