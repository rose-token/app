/**
 * Profile hook with Ceramic/ComposeDB integration
 * Manages user profile state with decentralized storage
 */

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAccount } from 'wagmi';
import { useCeramicSession } from './useCeramicSession';
import {
  getOwnProfile,
  getProfileByAddress,
  upsertProfile,
} from '../services/ceramic/profileService';
import {
  getCachedOwnProfile,
  setCachedOwnProfile,
  invalidateOwnProfileCache,
  getCachedProfile,
  setCachedProfile,
} from '../services/ceramic/profileCache';
import { isCeramicAvailable } from '../services/ceramic/client';

const ProfileContext = createContext();

/**
 * Default profile structure
 */
const getDefaultProfile = (address) => ({
  displayName: '',
  bio: '',
  avatarUrl: '',
  skills: [],
  website: '',
  twitter: '',
  github: '',
  walletAddress: address || '',
  joinedAt: null,
  lastActiveAt: null,
  // Legacy fields for backward compatibility
  username: '',
  address: address || '',
});

/**
 * Profile Provider component
 */
export const ProfileProvider = ({ children }) => {
  const { address: account, isConnected } = useAccount();
  const {
    session,
    isAuthenticated,
    setHasProfile,
    isCeramicAvailable: ceramicAvailable,
  } = useCeramicSession();

  const [profile, setProfile] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  /**
   * Load profile from Ceramic
   */
  const loadProfile = useCallback(async () => {
    if (!account || !isConnected) {
      setProfile(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Try cache first
      const cached = getCachedOwnProfile(account);
      if (cached) {
        setProfile(cached);
        setHasProfile(true);
        setIsLoading(false);
        return;
      }

      // Try Ceramic if available and authenticated
      if (ceramicAvailable && isAuthenticated && session) {
        const ceramicProfile = await getOwnProfile(session);

        if (ceramicProfile) {
          // Map to include legacy fields
          const mappedProfile = {
            ...ceramicProfile,
            username: ceramicProfile.displayName, // Legacy mapping
            address: ceramicProfile.walletAddress,
          };

          setProfile(mappedProfile);
          setCachedOwnProfile(account, mappedProfile);
          setHasProfile(true);
          setIsLoading(false);
          return;
        }
      }

      // Try by address (for unauthenticated or first-time users)
      if (ceramicAvailable) {
        const addressProfile = await getProfileByAddress(account);

        if (addressProfile) {
          const mappedProfile = {
            ...addressProfile,
            username: addressProfile.displayName,
            address: addressProfile.walletAddress,
          };

          setProfile(mappedProfile);
          setCachedOwnProfile(account, mappedProfile);
          setHasProfile(true);
          setIsLoading(false);
          return;
        }
      }

      // No profile found - set default
      setProfile(getDefaultProfile(account));
      setHasProfile(false);
    } catch (err) {
      console.error('Error loading profile:', err);
      setError('Failed to load profile');
      setProfile(getDefaultProfile(account));
      setHasProfile(false);
    } finally {
      setIsLoading(false);
    }
  }, [account, isConnected, session, isAuthenticated, ceramicAvailable, setHasProfile]);

  /**
   * Update profile on Ceramic
   * Supports both legacy (username, bio) and new format
   */
  const updateProfile = useCallback(
    async (profileData, bioOrUndefined) => {
      if (!account || !isConnected) {
        setError('Please connect your wallet first');
        return null;
      }

      if (!isAuthenticated || !session) {
        setError('Please authenticate to update your profile');
        return null;
      }

      setIsLoading(true);
      setError(null);

      try {
        // Handle legacy call format: updateProfile(username, bio)
        let updates;
        if (typeof profileData === 'string') {
          updates = {
            displayName: profileData,
            bio: bioOrUndefined || '',
            walletAddress: account.toLowerCase(),
          };
        } else {
          // New format: updateProfile({ displayName, bio, skills, ... })
          updates = {
            ...profileData,
            walletAddress: account.toLowerCase(),
          };
        }

        const result = await upsertProfile(session, updates);

        // Map result to include legacy fields
        const mappedProfile = {
          ...result,
          username: result.displayName,
          address: result.walletAddress,
        };

        setProfile(mappedProfile);
        invalidateOwnProfileCache(account);
        setCachedOwnProfile(account, mappedProfile);
        setHasProfile(true);

        return result.streamId;
      } catch (err) {
        console.error('Error updating profile:', err);
        setError(err.message || 'Failed to update profile');
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [account, isConnected, session, isAuthenticated, setHasProfile]
  );

  /**
   * Get another user's profile
   */
  const getProfile = useCallback(async (address) => {
    if (!address) return null;

    // Check cache first
    const cached = getCachedProfile(address);
    if (cached) {
      return cached;
    }

    // Fetch from Ceramic
    if (!isCeramicAvailable()) {
      return null;
    }

    try {
      const profile = await getProfileByAddress(address);

      if (profile) {
        setCachedProfile(address, profile);
      }

      return profile;
    } catch (err) {
      console.error('Error fetching profile:', err);
      return null;
    }
  }, []);

  /**
   * Refresh profile from Ceramic
   */
  const refreshProfile = useCallback(async () => {
    if (account) {
      invalidateOwnProfileCache(account);
    }
    await loadProfile();
  }, [account, loadProfile]);

  // Load profile when account or session changes
  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const value = {
    profile,
    isLoading,
    error,
    updateProfile,
    getProfile,
    refreshProfile,
    isAuthenticated,
  };

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
};

/**
 * Hook to access profile state and methods
 */
export const useProfile = () => {
  const context = useContext(ProfileContext);

  if (!context) {
    throw new Error('useProfile must be used within a ProfileProvider');
  }

  return context;
};

export default useProfile;
