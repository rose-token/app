-- GitHub merge log table for tracking PR auto-approvals and merges
-- Records all GitHub bot actions triggered by TaskReadyForPayment events

CREATE TABLE IF NOT EXISTS github_merge_log (
  id SERIAL PRIMARY KEY,
  task_id INTEGER NOT NULL,
  pr_url VARCHAR(500) NOT NULL,
  action VARCHAR(50) NOT NULL,  -- 'approve', 'merge', 'approve_and_merge'
  success BOOLEAN NOT NULL,
  error_message TEXT,
  pr_owner VARCHAR(255),        -- GitHub repo owner
  pr_repo VARCHAR(255),         -- GitHub repo name
  pr_number INTEGER,            -- PR number
  merge_sha VARCHAR(64),        -- Merge commit SHA if successful
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for querying by task
CREATE INDEX IF NOT EXISTS idx_github_merge_log_task_id ON github_merge_log(task_id);

-- Index for querying failures
CREATE INDEX IF NOT EXISTS idx_github_merge_log_success ON github_merge_log(success);

-- Index for time-based queries
CREATE INDEX IF NOT EXISTS idx_github_merge_log_created_at ON github_merge_log(created_at);
