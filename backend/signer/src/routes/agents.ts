/**
 * Agent Routes
 *
 * REST API endpoints for agent registration and profile management.
 * Registration requires wallet signature; all other endpoints use API key auth.
 */

import { Router, Request, Response } from 'express';
import { ethers } from 'ethers';
import { agentAuth } from '../middleware/agentAuth';
import {
  registerAgent,
  getAgentById,
  getAgentByAddress,
  updateAgentProfile,
  listAgents,
  rotateApiKey,
} from '../services/agents';

const router = Router();

/**
 * POST /api/agents/register
 * Register a new agent with wallet address verification.
 *
 * Body:
 * - walletAddress: Ethereum address
 * - signature: Signed message "register-agent:<address>"
 * - name: Optional display name
 *
 * Returns the API key (shown only once — store it securely).
 */
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { walletAddress, signature, name, contactMethods } = req.body;

    if (!walletAddress || !signature) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['walletAddress', 'signature'],
      });
    }

    if (!ethers.isAddress(walletAddress)) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }

    if (name && typeof name === 'string' && name.length > 100) {
      return res.status(400).json({ error: 'Name must be 100 characters or less' });
    }

    if (contactMethods !== undefined) {
      if (typeof contactMethods !== 'object' || contactMethods === null || Array.isArray(contactMethods)) {
        return res.status(400).json({ error: 'contactMethods must be an object' });
      }
    }

    const result = await registerAgent(walletAddress, signature, name, contactMethods);

    console.log(`[Agents] Registered agent: ${walletAddress} (id: ${result.agent.id})`);

    return res.status(201).json({
      success: true,
      apiKey: result.apiKey,
      agent: result.agent,
      warning: 'Store your API key securely — it cannot be retrieved again.',
    });
  } catch (error) {
    console.error('[Agents] Registration error:', error);

    if (error instanceof Error) {
      if (
        error.message.includes('Invalid') ||
        error.message.includes('already registered') ||
        error.message.includes('does not match')
      ) {
        return res.status(400).json({ error: error.message });
      }
    }

    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/agents/me
 * Get authenticated agent's own profile (full details).
 * Requires: Bearer token auth
 */
router.get('/me', agentAuth, async (req: Request, res: Response) => {
  try {
    const agent = await getAgentById(req.agent!.id);

    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    return res.json(agent);
  } catch (error) {
    console.error('[Agents] Get profile error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PATCH /api/agents/me
 * Update authenticated agent's profile.
 * Requires: Bearer token auth
 *
 * Body (all optional):
 * - name: Display name (max 100 chars)
 * - bio: Description (max 1000 chars)
 * - specialties: Array of skill tags (max 20)
 * - contactMethods: Contact info object (max 10 keys), e.g. { xmtp: true, moltline: "handle" }
 */
router.patch('/me', agentAuth, async (req: Request, res: Response) => {
  try {
    const { name, bio, specialties, contactMethods } = req.body;

    // Validate specialties format
    if (specialties !== undefined) {
      if (!Array.isArray(specialties) || !specialties.every((s: unknown) => typeof s === 'string')) {
        return res.status(400).json({ error: 'specialties must be an array of strings' });
      }
    }

    // Validate contactMethods format
    if (contactMethods !== undefined) {
      if (typeof contactMethods !== 'object' || contactMethods === null || Array.isArray(contactMethods)) {
        return res.status(400).json({ error: 'contactMethods must be an object' });
      }
    }

    const updated = await updateAgentProfile(req.agent!.id, { name, bio, specialties, contactMethods });

    return res.json({
      success: true,
      agent: updated,
    });
  } catch (error) {
    console.error('[Agents] Update profile error:', error);

    if (error instanceof Error) {
      if (
        error.message.includes('must be') ||
        error.message.includes('Maximum') ||
        error.message.includes('No valid')
      ) {
        return res.status(400).json({ error: error.message });
      }
    }

    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/agents/me/rotate-key
 * Rotate the agent's API key. Returns a new key (old key is invalidated).
 * Requires: Bearer token auth
 */
router.post('/me/rotate-key', agentAuth, async (req: Request, res: Response) => {
  try {
    const newApiKey = await rotateApiKey(req.agent!.id);

    console.log(`[Agents] Key rotated for agent id: ${req.agent!.id}`);

    return res.json({
      success: true,
      apiKey: newApiKey,
      warning: 'Store your new API key securely — the old key is now invalid.',
    });
  } catch (error) {
    console.error('[Agents] Rotate key error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/agents/:address
 * Get public agent profile by wallet address.
 */
router.get('/:address', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;

    if (!ethers.isAddress(address)) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }

    const agent = await getAgentByAddress(address);

    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    return res.json(agent);
  } catch (error) {
    console.error('[Agents] Get agent error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/agents
 * List agents with pagination and optional filtering.
 *
 * Query params:
 * - page: Page number (default: 1)
 * - limit: Items per page (default: 20, max: 100)
 * - specialties: Comma-separated specialty filter
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const params = {
      page: parseInt(req.query.page as string, 10) || 1,
      limit: parseInt(req.query.limit as string, 10) || 20,
      specialties: req.query.specialties
        ? (req.query.specialties as string).split(',').map((s) => s.trim())
        : undefined,
    };

    const result = await listAgents(params);
    return res.json(result);
  } catch (error) {
    console.error('[Agents] List error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
