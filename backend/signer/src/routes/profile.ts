import { Router, Request, Response } from 'express';
import { ethers } from 'ethers';
import { createOrUpdateProfile, getProfile, getProfiles } from '../services/profile';
import { ProfileRequest } from '../types';

const router = Router();

// POST /api/profile - Create or update profile
router.post('/', async (req: Request, res: Response) => {
  try {
    const body = req.body as ProfileRequest;

    // Debug: Log incoming request
    console.log('[Profile Route] POST /api/profile - Request body:', {
      hasMessage: !!body.message,
      hasSignature: !!body.signature,
      messageKeys: body.message ? Object.keys(body.message) : [],
    });

    // Basic request validation
    if (!body.message || !body.signature) {
      console.log('[Profile Route] Missing message or signature');
      return res.status(400).json({ error: 'Missing message or signature' });
    }

    const { message, signature } = body;

    // Validate required fields exist
    if (!message.address || !message.name || message.timestamp === undefined) {
      console.log('[Profile Route] Missing required fields:', {
        hasAddress: !!message.address,
        hasName: !!message.name,
        hasTimestamp: message.timestamp !== undefined,
      });
      return res.status(400).json({ error: 'Missing required fields' });
    }

    console.log('[Profile Route] Processing profile for:', message.address);

    // Create or update profile
    const result = await createOrUpdateProfile(message, signature);

    console.log('[Profile Route] Service result:', {
      success: result.success,
      error: result.error,
      hasProfile: !!result.profile,
    });

    if (!result.success) {
      const status = result.error === 'Invalid signature' || result.error === 'Signature expired' ? 401 : 400;
      return res.status(status).json({
        error: result.error,
        invalid: result.invalid,
        details: result.details,
      });
    }

    return res.json({
      success: true,
      profile: result.profile,
    });
  } catch (err) {
    console.error('Error creating/updating profile:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/profile/:address - Get single profile
router.get('/:address', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;

    if (!ethers.isAddress(address)) {
      return res.status(400).json({ error: 'Invalid address' });
    }

    const profile = await getProfile(address);

    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    return res.json(profile);
  } catch (err) {
    console.error('Error fetching profile:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/profiles?addresses=0x...,0x... - Batch fetch profiles
router.get('/', async (req: Request, res: Response) => {
  try {
    const addressesParam = req.query.addresses as string;

    if (!addressesParam) {
      return res.status(400).json({ error: 'Missing addresses parameter' });
    }

    const addresses = addressesParam.split(',').map((a) => a.trim()).filter(Boolean);

    if (addresses.length === 0) {
      return res.status(400).json({ error: 'No valid addresses provided' });
    }

    // Limit batch size to prevent abuse
    if (addresses.length > 100) {
      return res.status(400).json({ error: 'Maximum 100 addresses per request' });
    }

    const profiles = await getProfiles(addresses);

    return res.json({ profiles });
  } catch (err) {
    console.error('Error fetching profiles:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
