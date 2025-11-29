import { ethers } from 'ethers';
import { query } from '../db/pool';
import { config } from '../config';
import { verifyProfileSignature, isTimestampValid } from './eip712';
import { validateSkills, MAX_SKILLS } from '../constants/skills';
import { ProfileMessage, ProfileData } from '../types';

// Field length limits
const LIMITS = {
  name: 100,
  bio: 1000,
  avatar: 200,
  github: 100,
  twitter: 100,
  website: 200,
};

interface ValidationResult {
  valid: boolean;
  error?: string;
  details?: Record<string, string>;
  invalid?: string[];
}

function validateFieldLengths(message: ProfileMessage): ValidationResult {
  const details: Record<string, string> = {};

  if (message.name.length > LIMITS.name) {
    details.name = `Name must be ${LIMITS.name} characters or less`;
  }
  if (message.bio.length > LIMITS.bio) {
    details.bio = `Bio must be ${LIMITS.bio} characters or less`;
  }
  if (message.avatar.length > LIMITS.avatar) {
    details.avatar = `Avatar must be ${LIMITS.avatar} characters or less`;
  }
  if (message.github.length > LIMITS.github) {
    details.github = `GitHub must be ${LIMITS.github} characters or less`;
  }
  if (message.twitter.length > LIMITS.twitter) {
    details.twitter = `Twitter must be ${LIMITS.twitter} characters or less`;
  }
  if (message.website.length > LIMITS.website) {
    details.website = `Website must be ${LIMITS.website} characters or less`;
  }

  if (Object.keys(details).length > 0) {
    return { valid: false, error: 'Validation failed', details };
  }

  return { valid: true };
}

function validateProfileMessage(message: ProfileMessage): ValidationResult {
  // Validate address format
  if (!ethers.isAddress(message.address)) {
    return { valid: false, error: 'Invalid address format' };
  }

  // Validate name is not empty
  if (!message.name || message.name.trim().length === 0) {
    return { valid: false, error: 'Name is required' };
  }

  // Validate field lengths
  const lengthResult = validateFieldLengths(message);
  if (!lengthResult.valid) {
    return lengthResult;
  }

  // Validate skills
  let skills: string[];
  try {
    skills = JSON.parse(message.skills);
    if (!Array.isArray(skills)) {
      return { valid: false, error: 'Skills must be an array' };
    }
  } catch {
    return { valid: false, error: 'Invalid skills format' };
  }

  if (skills.length > MAX_SKILLS) {
    return { valid: false, error: `Maximum ${MAX_SKILLS} skills allowed` };
  }

  const skillsResult = validateSkills(skills);
  if (!skillsResult.valid) {
    return { valid: false, error: 'Invalid skills', invalid: skillsResult.invalid };
  }

  // Validate timestamp
  if (!isTimestampValid(message.timestamp)) {
    return { valid: false, error: 'Signature expired' };
  }

  return { valid: true };
}

interface DbProfile {
  address: string;
  name: string;
  bio: string | null;
  avatar: string | null;
  skills: string[] | null;
  github: string | null;
  twitter: string | null;
  website: string | null;
  signature: string;
  signed_at: Date;
  created_at: Date;
  updated_at: Date;
}

function dbToProfileData(row: DbProfile): ProfileData {
  return {
    address: row.address,
    name: row.name,
    bio: row.bio,
    avatar: row.avatar,
    skills: row.skills || [],
    github: row.github,
    twitter: row.twitter,
    website: row.website,
    signature: row.signature,
    signedAt: row.signed_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function createOrUpdateProfile(
  message: ProfileMessage,
  signature: string
): Promise<{ success: boolean; profile?: ProfileData; error?: string; details?: Record<string, string>; invalid?: string[] }> {
  // Debug: Log incoming request
  console.log('[Profile Service] Create/update request:', {
    address: message.address,
    name: message.name,
    timestamp: message.timestamp,
    signaturePrefix: signature.substring(0, 20) + '...',
  });

  // Validate message
  const validation = validateProfileMessage(message);
  console.log('[Profile Service] Validation result:', {
    valid: validation.valid,
    error: validation.error,
  });

  if (!validation.valid) {
    return {
      success: false,
      error: validation.error,
      details: validation.details,
      invalid: validation.invalid,
    };
  }

  // Verify signature against allowed chain IDs
  console.log('[Profile Service] Verifying signature with chainIds:', config.profile.chainIds);

  let recoveredAddress: string;
  try {
    recoveredAddress = verifyProfileSignature(message, signature, config.profile.chainIds);
  } catch (err) {
    console.log('[Profile Service] Signature verification failed:', (err as Error).message);
    return { success: false, error: 'Invalid signature' };
  }

  // Debug: Log recovered vs expected address
  console.log('[Profile Service] Signature verification result:', {
    recoveredAddress,
    expectedAddress: message.address,
    match: recoveredAddress.toLowerCase() === message.address.toLowerCase(),
  });

  // Check recovered address matches message address
  if (recoveredAddress.toLowerCase() !== message.address.toLowerCase()) {
    console.log('[Profile Service] Address mismatch - returning Invalid signature');
    return { success: false, error: 'Invalid signature' };
  }

  // Parse skills
  const skills: string[] = JSON.parse(message.skills);

  // Upsert profile
  const signedAt = new Date(message.timestamp * 1000);
  const normalizedAddress = message.address.toLowerCase();

  const result = await query<DbProfile>(
    `
    INSERT INTO profiles (address, name, bio, avatar, skills, github, twitter, website, signature, signed_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
    ON CONFLICT (address) DO UPDATE SET
      name = EXCLUDED.name,
      bio = EXCLUDED.bio,
      avatar = EXCLUDED.avatar,
      skills = EXCLUDED.skills,
      github = EXCLUDED.github,
      twitter = EXCLUDED.twitter,
      website = EXCLUDED.website,
      signature = EXCLUDED.signature,
      signed_at = EXCLUDED.signed_at,
      updated_at = NOW()
    RETURNING *
    `,
    [
      normalizedAddress,
      message.name.trim(),
      message.bio || null,
      message.avatar || null,
      skills,
      message.github || null,
      message.twitter || null,
      message.website || null,
      signature,
      signedAt,
    ]
  );

  return {
    success: true,
    profile: dbToProfileData(result.rows[0]),
  };
}

export async function getProfile(address: string): Promise<ProfileData | null> {
  if (!ethers.isAddress(address)) {
    return null;
  }

  const normalizedAddress = address.toLowerCase();

  const result = await query<DbProfile>(
    'SELECT * FROM profiles WHERE address = $1',
    [normalizedAddress]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return dbToProfileData(result.rows[0]);
}

export async function getProfiles(addresses: string[]): Promise<Record<string, ProfileData | null>> {
  // Filter valid addresses and normalize
  const validAddresses = addresses
    .filter((addr) => ethers.isAddress(addr))
    .map((addr) => addr.toLowerCase());

  if (validAddresses.length === 0) {
    return {};
  }

  // Build result object with nulls for all requested addresses
  const result: Record<string, ProfileData | null> = {};
  for (const addr of addresses) {
    if (ethers.isAddress(addr)) {
      result[addr.toLowerCase()] = null;
    }
  }

  // Query database
  const placeholders = validAddresses.map((_, i) => `$${i + 1}`).join(', ');
  const dbResult = await query<DbProfile>(
    `SELECT * FROM profiles WHERE address IN (${placeholders})`,
    validAddresses
  );

  // Populate found profiles
  for (const row of dbResult.rows) {
    result[row.address] = dbToProfileData(row);
  }

  return result;
}
