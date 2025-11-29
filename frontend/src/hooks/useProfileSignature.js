/**
 * EIP-712 Profile Signing Hook
 * Signs profile data using wallet for backend verification
 */

import { useSignTypedData, useChainId } from 'wagmi';
import { useCallback } from 'react';

// EIP-712 Domain - must match backend
const getDomain = (chainId) => ({
  name: 'Rose Token',
  version: '1',
  chainId: chainId,
});

// EIP-712 Types - must match backend
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

/**
 * Hook for signing profile data with EIP-712
 * @returns {Object} { signProfile, isLoading, error }
 */
export function useProfileSignature() {
  const chainId = useChainId();
  const { signTypedDataAsync, isPending, error } = useSignTypedData();

  /**
   * Sign profile data
   * @param {Object} profileData - Profile data to sign
   * @param {string} profileData.address - Wallet address
   * @param {string} profileData.name - Display name
   * @param {string} profileData.bio - Bio text
   * @param {string} profileData.avatar - Avatar URL/CID
   * @param {string[]} profileData.skills - Array of skill IDs
   * @param {string} profileData.github - GitHub username
   * @param {string} profileData.twitter - Twitter username
   * @param {string} profileData.website - Website URL
   * @returns {Promise<{message: Object, signature: string}>}
   */
  const signProfile = useCallback(
    async (profileData) => {
      const timestamp = Math.floor(Date.now() / 1000);

      const message = {
        address: profileData.address,
        name: profileData.name || '',
        bio: profileData.bio || '',
        avatar: profileData.avatar || '',
        skills: JSON.stringify(profileData.skills || []),
        github: profileData.github || '',
        twitter: profileData.twitter || '',
        website: profileData.website || '',
        timestamp: BigInt(timestamp),
      };

      const signature = await signTypedDataAsync({
        domain: getDomain(chainId),
        types: PROFILE_TYPES,
        primaryType: 'Profile',
        message,
      });

      // Convert BigInt to number for JSON serialization
      return {
        message: {
          ...message,
          timestamp: timestamp,
        },
        signature,
      };
    },
    [chainId, signTypedDataAsync]
  );

  return {
    signProfile,
    isLoading: isPending,
    error,
  };
}

export default useProfileSignature;
