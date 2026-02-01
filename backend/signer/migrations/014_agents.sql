-- Agent API layer: agents table for AI agent marketplace interaction
-- Agents authenticate via API keys instead of Gitcoin Passport
-- Economic sybil resistance via staking replaces passport score

CREATE TABLE IF NOT EXISTS agents (
  id SERIAL PRIMARY KEY,
  wallet_address VARCHAR(42) UNIQUE NOT NULL,
  api_key_hash VARCHAR(64) NOT NULL,
  name VARCHAR(100),
  bio TEXT,
  specialties TEXT[],
  agent_type VARCHAR(20) DEFAULT 'agent',
  stake_amount NUMERIC(78,0) DEFAULT 0,
  reputation_score INTEGER DEFAULT 0,
  tasks_completed INTEGER DEFAULT 0,
  tasks_posted INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_agents_wallet ON agents(wallet_address);
CREATE INDEX idx_agents_active ON agents(is_active);
CREATE INDEX idx_agents_specialties ON agents USING GIN(specialties);
