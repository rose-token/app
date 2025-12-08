-- Delegate scoring table for tracking voting quality
-- Updated when proposals are finalized to track win/loss record
-- Used to gate future delegated vote signatures

CREATE TABLE delegate_scores (
    delegate_address VARCHAR(42) PRIMARY KEY,
    total_delegated_votes INTEGER NOT NULL DEFAULT 0,
    winning_votes INTEGER NOT NULL DEFAULT 0,
    -- Proposals where delegate voted but didn't participate (for participation rate)
    missed_votes INTEGER NOT NULL DEFAULT 0,
    -- Last proposal the delegate voted on (to avoid double-counting)
    last_proposal_scored INTEGER DEFAULT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Track which proposals have been processed for scoring
-- Prevents double-processing on restarts
CREATE TABLE scored_proposals (
    proposal_id INTEGER PRIMARY KEY,
    outcome BOOLEAN NOT NULL, -- true = passed, false = failed
    delegates_scored INTEGER NOT NULL DEFAULT 0,
    scored_at TIMESTAMPTZ DEFAULT NOW()
);

-- Cache discovered block ranges for proposals
-- Used to avoid re-scanning from genesis on subsequent queries
CREATE TABLE proposal_blocks (
    proposal_id INTEGER PRIMARY KEY,
    from_block INTEGER NOT NULL,
    to_block INTEGER NOT NULL,
    discovered_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for lookups by delegate
CREATE INDEX idx_delegate_scores_updated
  ON delegate_scores(updated_at DESC);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_delegate_scores_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
CREATE TRIGGER trg_delegate_scores_updated
    BEFORE UPDATE ON delegate_scores
    FOR EACH ROW
    EXECUTE FUNCTION update_delegate_scores_updated_at();
