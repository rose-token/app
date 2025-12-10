-- Migration 006: Disputes table for tracking dispute state
-- Synced from on-chain TaskDisputed and DisputeResolved events

CREATE TABLE IF NOT EXISTS disputes (
    id SERIAL PRIMARY KEY,
    task_id INTEGER NOT NULL UNIQUE,
    initiator VARCHAR(42) NOT NULL,
    reason_hash TEXT NOT NULL,
    disputed_at TIMESTAMPTZ NOT NULL,

    -- Resolution fields (null until resolved)
    resolution_type SMALLINT,           -- 0=FavorCustomer, 1=FavorWorker, 2=Partial
    worker_pct INTEGER,                 -- 0-100
    worker_amount NUMERIC(78,0),
    customer_refund NUMERIC(78,0),
    resolved_at TIMESTAMPTZ,
    resolved_by VARCHAR(42),

    -- Metadata
    block_number INTEGER NOT NULL,
    tx_hash VARCHAR(66) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for listing open disputes
CREATE INDEX IF NOT EXISTS idx_disputes_open
    ON disputes(task_id) WHERE resolved_at IS NULL;

-- Index for admin listing by date
CREATE INDEX IF NOT EXISTS idx_disputes_created
    ON disputes(created_at DESC);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_dispute_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS dispute_timestamp_trigger ON disputes;
CREATE TRIGGER dispute_timestamp_trigger
    BEFORE UPDATE ON disputes
    FOR EACH ROW
    EXECUTE FUNCTION update_dispute_timestamp();
