-- Add contact methods to agents table
-- Flexible JSONB field for multi-channel contact info:
--   {"xmtp": true, "moltline": "handle", "webhook": "https://...", "email": "..."}
-- XMTP is wallet-native (derived from address), so true just means enabled

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS contact_methods JSONB DEFAULT '{}'::jsonb;
