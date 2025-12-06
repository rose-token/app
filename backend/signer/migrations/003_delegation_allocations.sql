-- Cache for per-delegator vote allocations
-- Source of truth for current delegation state is on-chain
-- This table caches per-proposal allocations for incremental votes + claims

CREATE TABLE delegation_allocations (
    id SERIAL PRIMARY KEY,
    proposal_id INTEGER NOT NULL,
    delegate VARCHAR(42) NOT NULL,
    delegator VARCHAR(42) NOT NULL,
    power_used NUMERIC(78,0) NOT NULL,
    support BOOLEAN NOT NULL,
    allocations_hash VARCHAR(66) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(proposal_id, delegate, delegator)
);

-- Index for vote signature lookups (delegate voting on proposal)
CREATE INDEX idx_delegation_allocations_lookup
  ON delegation_allocations(proposal_id, delegate);

-- Index for claim lookups (delegator checking their contribution)
CREATE INDEX idx_delegation_allocations_delegator
  ON delegation_allocations(delegator, proposal_id);
