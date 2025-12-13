-- Migration 012: Task Table Pagination Support
-- Extends analytics_tasks with additional fields for full task data
-- Enables backend pagination API for scalable task table

-- ============================================================
-- ADD MISSING COLUMNS to analytics_tasks
-- ============================================================

-- Task content fields
ALTER TABLE analytics_tasks
ADD COLUMN IF NOT EXISTS title VARCHAR(255),
ADD COLUMN IF NOT EXISTS detailed_description_hash VARCHAR(66);

-- Stakeholder deposit (10% collateral)
ALTER TABLE analytics_tasks
ADD COLUMN IF NOT EXISTS stakeholder_deposit NUMERIC(78,0) NOT NULL DEFAULT 0;

-- Approval tracking
ALTER TABLE analytics_tasks
ADD COLUMN IF NOT EXISTS customer_approval BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS stakeholder_approval BOOLEAN NOT NULL DEFAULT FALSE;

-- Task completion
ALTER TABLE analytics_tasks
ADD COLUMN IF NOT EXISTS pr_url VARCHAR(512);

-- Task source (0=Customer, 1=DAO)
ALTER TABLE analytics_tasks
ADD COLUMN IF NOT EXISTS source SMALLINT NOT NULL DEFAULT 0;

-- DAO proposal reference (if source=1)
ALTER TABLE analytics_tasks
ADD COLUMN IF NOT EXISTS proposal_id INTEGER;

-- Auction winning bid
ALTER TABLE analytics_tasks
ADD COLUMN IF NOT EXISTS winning_bid NUMERIC(78,0) NOT NULL DEFAULT 0;

-- ============================================================
-- ADD INDEXES for common queries
-- ============================================================

-- Filter by auction status
CREATE INDEX IF NOT EXISTS idx_analytics_tasks_is_auction ON analytics_tasks(is_auction);

-- Sort by deposit amount
CREATE INDEX IF NOT EXISTS idx_analytics_tasks_deposit ON analytics_tasks(deposit DESC);

-- Composite for status + date filtering (most common query)
CREATE INDEX IF NOT EXISTS idx_analytics_tasks_status_created ON analytics_tasks(status, created_at DESC);

-- Filter by stakeholder
CREATE INDEX IF NOT EXISTS idx_analytics_tasks_stakeholder ON analytics_tasks(stakeholder) WHERE stakeholder IS NOT NULL;

-- Filter by source (Customer vs DAO)
CREATE INDEX IF NOT EXISTS idx_analytics_tasks_source ON analytics_tasks(source);
