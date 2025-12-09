-- Migration 005: Auction bids and tasks for reverse auction system
-- Stores off-chain bids and tracks auction task state

-- Auction tasks registry (tracks auction-specific metadata)
CREATE TABLE IF NOT EXISTS auction_tasks (
    task_id INTEGER PRIMARY KEY,
    max_budget NUMERIC(78,0) NOT NULL,
    bid_count INTEGER DEFAULT 0,
    winner_address VARCHAR(42),
    winning_bid NUMERIC(78,0),
    concluded_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for active auctions (no winner yet)
CREATE INDEX IF NOT EXISTS idx_auction_tasks_active
    ON auction_tasks(task_id) WHERE winner_address IS NULL;

-- Auction bids table (one bid per worker per task)
CREATE TABLE IF NOT EXISTS auction_bids (
    id SERIAL PRIMARY KEY,
    task_id INTEGER NOT NULL,
    worker_address VARCHAR(42) NOT NULL,
    bid_amount NUMERIC(78,0) NOT NULL,
    message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(task_id, worker_address)
);

-- Index for fetching all bids for a task (sorted by amount)
CREATE INDEX IF NOT EXISTS idx_auction_bids_task_amount
    ON auction_bids(task_id, bid_amount ASC);

-- Index for worker bid lookup
CREATE INDEX IF NOT EXISTS idx_auction_bids_worker
    ON auction_bids(LOWER(worker_address), task_id);

-- Trigger to update bid_count in auction_tasks when bids change
CREATE OR REPLACE FUNCTION update_auction_bid_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE auction_tasks
        SET bid_count = bid_count + 1
        WHERE task_id = NEW.task_id;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE auction_tasks
        SET bid_count = bid_count - 1
        WHERE task_id = OLD.task_id;
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if exists (for idempotency) and create
DROP TRIGGER IF EXISTS auction_bid_count_trigger ON auction_bids;
CREATE TRIGGER auction_bid_count_trigger
    AFTER INSERT OR DELETE ON auction_bids
    FOR EACH ROW
    EXECUTE FUNCTION update_auction_bid_count();

-- Trigger to update updated_at on bid changes
CREATE OR REPLACE FUNCTION update_auction_bid_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS auction_bid_timestamp_trigger ON auction_bids;
CREATE TRIGGER auction_bid_timestamp_trigger
    BEFORE UPDATE ON auction_bids
    FOR EACH ROW
    EXECUTE FUNCTION update_auction_bid_timestamp();
