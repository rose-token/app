-- Migration 013: GitHub Repository Authorization
-- Implements customer-verified repository authorization for GitHub auto-merge
-- Prevents arbitrary PR merges to any repository where the Rose Protocol GitHub App is installed

-- ============================================================
-- GitHub account links (wallet <-> GitHub identity)
-- ============================================================

CREATE TABLE IF NOT EXISTS github_links (
  id SERIAL PRIMARY KEY,
  wallet_address VARCHAR(42) NOT NULL UNIQUE,
  github_user_id BIGINT NOT NULL,
  github_username VARCHAR(255) NOT NULL,
  access_token_encrypted TEXT,  -- Optional: for checking repo ownership
  linked_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_github_links_wallet ON github_links(wallet_address);

-- ============================================================
-- Authorized repositories for GitHub auto-merge
-- Customers must register repos before the bot will merge to them
-- ============================================================

CREATE TABLE IF NOT EXISTS authorized_repos (
  id SERIAL PRIMARY KEY,
  wallet_address VARCHAR(42) NOT NULL,
  github_username VARCHAR(255) NOT NULL,  -- Verified GitHub account
  repo_owner VARCHAR(255) NOT NULL,
  repo_name VARCHAR(255) NOT NULL,
  authorized_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(wallet_address, repo_owner, repo_name)
);

CREATE INDEX IF NOT EXISTS idx_authorized_repos_wallet ON authorized_repos(wallet_address);
CREATE INDEX IF NOT EXISTS idx_authorized_repos_repo ON authorized_repos(repo_owner, repo_name);

-- ============================================================
-- Trigger for updated_at on github_links
-- ============================================================

CREATE OR REPLACE FUNCTION update_github_links_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS github_links_updated_at ON github_links;
CREATE TRIGGER github_links_updated_at
  BEFORE UPDATE ON github_links
  FOR EACH ROW
  EXECUTE FUNCTION update_github_links_updated_at();
