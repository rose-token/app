/**
 * Agents Service
 *
 * Business logic for agent registration, profile management, and lookups.
 * Agents authenticate via API keys (sha256 hashed in the database).
 * Economic sybil resistance via staking replaces Gitcoin Passport for agents.
 */

import { randomBytes, createHash } from 'crypto';
import { ethers } from 'ethers';
import { query } from '../db/pool';

// ============================================================
// Types
// ============================================================

export interface AgentProfile {
  id: number;
  walletAddress: string;
  name: string | null;
  bio: string | null;
  specialties: string[];
  agentType: string;
  contactMethods: Record<string, unknown>;
  stakeAmount: string;
  reputationScore: number;
  tasksCompleted: number;
  tasksPosted: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AgentPublicProfile {
  walletAddress: string;
  name: string | null;
  bio: string | null;
  specialties: string[];
  agentType: string;
  contactMethods: Record<string, unknown>;
  reputationScore: number;
  tasksCompleted: number;
  tasksPosted: number;
  createdAt: string;
}

export interface AgentListParams {
  page?: number;
  limit?: number;
  specialties?: string[];
  activeOnly?: boolean;
}

export interface AgentListResponse {
  agents: AgentPublicProfile[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

// ============================================================
// Helpers
// ============================================================

/**
 * Generate a cryptographically secure API key.
 * Format: rose_agent_<32 random hex bytes> (prefixed for easy identification)
 */
function generateApiKey(): string {
  const random = randomBytes(32).toString('hex');
  return `rose_agent_${random}`;
}

/**
 * Hash an API key using SHA-256.
 */
function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex');
}

/**
 * Map a database row to an AgentProfile.
 */
function rowToProfile(row: {
  id: number;
  wallet_address: string;
  name: string | null;
  bio: string | null;
  specialties: string[] | null;
  agent_type: string;
  contact_methods: Record<string, unknown> | null;
  stake_amount: string;
  reputation_score: number;
  tasks_completed: number;
  tasks_posted: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}): AgentProfile {
  return {
    id: row.id,
    walletAddress: row.wallet_address,
    name: row.name,
    bio: row.bio,
    specialties: row.specialties || [],
    agentType: row.agent_type,
    contactMethods: row.contact_methods || {},
    stakeAmount: row.stake_amount,
    reputationScore: row.reputation_score,
    tasksCompleted: row.tasks_completed,
    tasksPosted: row.tasks_posted,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Map a database row to an AgentPublicProfile (no sensitive fields).
 */
function rowToPublicProfile(row: {
  wallet_address: string;
  name: string | null;
  bio: string | null;
  specialties: string[] | null;
  agent_type: string;
  contact_methods: Record<string, unknown> | null;
  reputation_score: number;
  tasks_completed: number;
  tasks_posted: number;
  created_at: string;
}): AgentPublicProfile {
  return {
    walletAddress: row.wallet_address,
    name: row.name,
    bio: row.bio,
    specialties: row.specialties || [],
    agentType: row.agent_type,
    contactMethods: row.contact_methods || {},
    reputationScore: row.reputation_score,
    tasksCompleted: row.tasks_completed,
    tasksPosted: row.tasks_posted,
    createdAt: row.created_at,
  };
}

// ============================================================
// Service Functions
// ============================================================

/**
 * Register a new agent.
 * Verifies wallet ownership via signature, creates the agent record,
 * and returns the plaintext API key (only shown once).
 */
export async function registerAgent(
  walletAddress: string,
  signature: string,
  name?: string,
  contactMethods?: Record<string, unknown>
): Promise<{ apiKey: string; agent: AgentProfile }> {
  // Validate address format
  if (!ethers.isAddress(walletAddress)) {
    throw new Error('Invalid wallet address');
  }

  // Verify wallet ownership: agent signs the message "register-agent:<address>"
  const message = `register-agent:${walletAddress.toLowerCase()}`;
  let recovered: string;
  try {
    recovered = ethers.verifyMessage(message, signature);
  } catch {
    throw new Error('Invalid signature format');
  }

  if (recovered.toLowerCase() !== walletAddress.toLowerCase()) {
    throw new Error('Signature does not match wallet address');
  }

  // Check if agent already exists
  const existing = await query<{ id: number }>(
    'SELECT id FROM agents WHERE wallet_address = $1',
    [walletAddress.toLowerCase()]
  );

  if (existing.rows.length > 0) {
    throw new Error('Agent already registered for this wallet address');
  }

  // Generate API key and hash it
  const apiKey = generateApiKey();
  const apiKeyHash = hashApiKey(apiKey);

  // Validate contact methods if provided
  if (contactMethods !== undefined) {
    if (typeof contactMethods !== 'object' || contactMethods === null || Array.isArray(contactMethods)) {
      throw new Error('contactMethods must be an object');
    }
    if (Object.keys(contactMethods).length > 10) {
      throw new Error('contactMethods can have at most 10 keys');
    }
  }

  // Insert agent record
  const result = await query<{
    id: number;
    wallet_address: string;
    name: string | null;
    bio: string | null;
    specialties: string[] | null;
    agent_type: string;
    contact_methods: Record<string, unknown> | null;
    stake_amount: string;
    reputation_score: number;
    tasks_completed: number;
    tasks_posted: number;
    is_active: boolean;
    created_at: string;
    updated_at: string;
  }>(
    `INSERT INTO agents (wallet_address, api_key_hash, name, contact_methods)
     VALUES ($1, $2, $3, $4)
     RETURNING id, wallet_address, name, bio, specialties, agent_type,
               contact_methods, stake_amount::text, reputation_score,
               tasks_completed, tasks_posted, is_active,
               created_at::text, updated_at::text`,
    [walletAddress.toLowerCase(), apiKeyHash, name || null, JSON.stringify(contactMethods || {})]
  );

  return {
    apiKey, // Plaintext - only returned once
    agent: rowToProfile(result.rows[0]),
  };
}

/**
 * Get agent profile by ID (authenticated - returns full profile).
 */
export async function getAgentById(agentId: number): Promise<AgentProfile | null> {
  const result = await query<{
    id: number;
    wallet_address: string;
    name: string | null;
    bio: string | null;
    specialties: string[] | null;
    agent_type: string;
    contact_methods: Record<string, unknown> | null;
    stake_amount: string;
    reputation_score: number;
    tasks_completed: number;
    tasks_posted: number;
    is_active: boolean;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT id, wallet_address, name, bio, specialties, agent_type,
            contact_methods, stake_amount::text, reputation_score,
            tasks_completed, tasks_posted, is_active,
            created_at::text, updated_at::text
     FROM agents WHERE id = $1`,
    [agentId]
  );

  if (result.rows.length === 0) return null;
  return rowToProfile(result.rows[0]);
}

/**
 * Get agent public profile by wallet address.
 */
export async function getAgentByAddress(walletAddress: string): Promise<AgentPublicProfile | null> {
  if (!ethers.isAddress(walletAddress)) {
    throw new Error('Invalid wallet address');
  }

  const result = await query<{
    wallet_address: string;
    name: string | null;
    bio: string | null;
    specialties: string[] | null;
    agent_type: string;
    contact_methods: Record<string, unknown> | null;
    reputation_score: number;
    tasks_completed: number;
    tasks_posted: number;
    created_at: string;
  }>(
    `SELECT wallet_address, name, bio, specialties, agent_type,
            contact_methods, reputation_score, tasks_completed,
            tasks_posted, created_at::text
     FROM agents WHERE wallet_address = $1 AND is_active = true`,
    [walletAddress.toLowerCase()]
  );

  if (result.rows.length === 0) return null;
  return rowToPublicProfile(result.rows[0]);
}

/**
 * Update agent profile (name, bio, specialties).
 */
export async function updateAgentProfile(
  agentId: number,
  updates: { name?: string; bio?: string; specialties?: string[]; contactMethods?: Record<string, unknown> }
): Promise<AgentProfile> {
  // Build dynamic UPDATE query
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (updates.name !== undefined) {
    if (updates.name && updates.name.length > 100) {
      throw new Error('Name must be 100 characters or less');
    }
    setClauses.push(`name = $${paramIndex++}`);
    values.push(updates.name);
  }

  if (updates.bio !== undefined) {
    if (updates.bio && updates.bio.length > 1000) {
      throw new Error('Bio must be 1000 characters or less');
    }
    setClauses.push(`bio = $${paramIndex++}`);
    values.push(updates.bio);
  }

  if (updates.specialties !== undefined) {
    if (updates.specialties.length > 20) {
      throw new Error('Maximum 20 specialties allowed');
    }
    setClauses.push(`specialties = $${paramIndex++}`);
    values.push(updates.specialties);
  }

  if (updates.contactMethods !== undefined) {
    if (typeof updates.contactMethods !== 'object' || updates.contactMethods === null || Array.isArray(updates.contactMethods)) {
      throw new Error('contactMethods must be an object');
    }
    if (Object.keys(updates.contactMethods).length > 10) {
      throw new Error('contactMethods can have at most 10 keys');
    }
    setClauses.push(`contact_methods = $${paramIndex++}`);
    values.push(JSON.stringify(updates.contactMethods));
  }

  if (setClauses.length === 0) {
    throw new Error('No valid fields to update');
  }

  setClauses.push(`updated_at = NOW()`);
  values.push(agentId);

  const result = await query<{
    id: number;
    wallet_address: string;
    name: string | null;
    bio: string | null;
    specialties: string[] | null;
    agent_type: string;
    contact_methods: Record<string, unknown> | null;
    stake_amount: string;
    reputation_score: number;
    tasks_completed: number;
    tasks_posted: number;
    is_active: boolean;
    created_at: string;
    updated_at: string;
  }>(
    `UPDATE agents SET ${setClauses.join(', ')}
     WHERE id = $${paramIndex}
     RETURNING id, wallet_address, name, bio, specialties, agent_type,
               contact_methods, stake_amount::text, reputation_score,
               tasks_completed, tasks_posted, is_active,
               created_at::text, updated_at::text`,
    values
  );

  if (result.rows.length === 0) {
    throw new Error('Agent not found');
  }

  return rowToProfile(result.rows[0]);
}

/**
 * List agents with pagination and optional filtering.
 */
export async function listAgents(params: AgentListParams): Promise<AgentListResponse> {
  const {
    page = 1,
    limit = 20,
    specialties,
    activeOnly = true,
  } = params;

  const conditions: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (activeOnly) {
    conditions.push(`is_active = true`);
  }

  if (specialties && specialties.length > 0) {
    conditions.push(`specialties && $${paramIndex++}`);
    values.push(specialties);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Count total
  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM agents ${whereClause}`,
    values
  );
  const total = parseInt(countResult.rows[0]?.count || '0', 10);

  // Fetch agents
  const limitValue = Math.min(Math.max(limit, 1), 100);
  const offset = (page - 1) * limitValue;

  const agentsResult = await query<{
    wallet_address: string;
    name: string | null;
    bio: string | null;
    specialties: string[] | null;
    agent_type: string;
    contact_methods: Record<string, unknown> | null;
    reputation_score: number;
    tasks_completed: number;
    tasks_posted: number;
    created_at: string;
  }>(
    `SELECT wallet_address, name, bio, specialties, agent_type,
            contact_methods, reputation_score, tasks_completed,
            tasks_posted, created_at::text
     FROM agents ${whereClause}
     ORDER BY reputation_score DESC, created_at ASC
     LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
    [...values, limitValue, offset]
  );

  const totalPages = Math.ceil(total / limitValue);

  return {
    agents: agentsResult.rows.map(rowToPublicProfile),
    pagination: {
      page,
      limit: limitValue,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
  };
}

/**
 * Rotate an agent's API key.
 * Generates a new key, updates the hash, returns the new plaintext key.
 */
export async function rotateApiKey(agentId: number): Promise<string> {
  const apiKey = generateApiKey();
  const apiKeyHash = hashApiKey(apiKey);

  const result = await query(
    `UPDATE agents SET api_key_hash = $1, updated_at = NOW() WHERE id = $2`,
    [apiKeyHash, agentId]
  );

  if (result.rowCount === 0) {
    throw new Error('Agent not found');
  }

  return apiKey;
}
