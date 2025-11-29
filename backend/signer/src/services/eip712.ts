import { ethers } from 'ethers';
import { config } from '../config';
import { ProfileMessage } from '../types';

// EIP-712 Domain for Rose Token profiles
const getDomain = (chainId: number) => ({
  name: 'Rose Token',
  version: '1',
  chainId,
});

// EIP-712 Types for Profile struct
const PROFILE_TYPES = {
  Profile: [
    { name: 'address', type: 'address' },
    { name: 'name', type: 'string' },
    { name: 'bio', type: 'string' },
    { name: 'avatar', type: 'string' },
    { name: 'skills', type: 'string' },
    { name: 'github', type: 'string' },
    { name: 'twitter', type: 'string' },
    { name: 'website', type: 'string' },
    { name: 'timestamp', type: 'uint256' },
  ],
};

export function verifyProfileSignature(
  message: ProfileMessage,
  signature: string,
  allowedChainIds: number[]
): string {
  // Reconstruct the typed data value
  const value = {
    address: message.address,
    name: message.name,
    bio: message.bio,
    avatar: message.avatar,
    skills: message.skills,
    github: message.github,
    twitter: message.twitter,
    website: message.website,
    timestamp: message.timestamp,
  };

  // Try each allowed chainId
  for (const chainId of allowedChainIds) {
    try {
      const domain = getDomain(chainId);
      const recoveredAddress = ethers.verifyTypedData(domain, PROFILE_TYPES, value, signature);
      return recoveredAddress;
    } catch {
      // Try next chainId
      continue;
    }
  }

  throw new Error('Invalid signature for all allowed chain IDs');
}

export function isTimestampValid(timestamp: number): boolean {
  const now = Math.floor(Date.now() / 1000);
  const age = now - timestamp;

  // Timestamp must be within TTL (default 5 minutes)
  // Also reject future timestamps (more than 60 seconds ahead)
  return age >= -60 && age <= config.profile.timestampTtl;
}

export { getDomain, PROFILE_TYPES };
