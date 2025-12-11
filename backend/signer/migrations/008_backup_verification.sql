-- Create backup_verification table for tracking backup timestamps
-- This table stores a single row (id=1) that gets updated before each backup
-- After restore, we can query this to verify when the backup was created

CREATE TABLE IF NOT EXISTS backup_verification (
  id INTEGER PRIMARY KEY DEFAULT 1,
  backed_up_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT single_row CHECK (id = 1)
);

-- Insert the initial row (will fail silently if already exists due to migration re-run)
INSERT INTO backup_verification (id, backed_up_at)
VALUES (1, NOW())
ON CONFLICT (id) DO NOTHING;
