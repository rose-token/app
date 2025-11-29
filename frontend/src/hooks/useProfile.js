/**
 * Profile hook - Full API integration with EIP-712 signing
 * Connects to PostgreSQL backend via passport-signer service
 */

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAccount } from 'wagmi';
import { useProfileSignature } from './useProfileSignature';

const ProfileContext = createContext();

const API_URL = import.meta.env.VITE_PASSPORT_SIGNER_URL || 'http://localhost:3000';

/**
 * Default profile structure for display
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
 * Convert API profile to frontend format
 */
const apiToFrontendProfile = (apiProfile) => {
  if (!apiProfile) return null;

  return {
    displayName: apiProfile.name || '',
    bio: apiProfile.bio || '',
    avatarUrl: apiProfile.avatar || '',
    skills: apiProfile.skills || [],
    website: apiProfile.website || '',
    twitter: apiProfile.twitter || '',
    github: apiProfile.github || '',
    walletAddress: apiProfile.address || '',
    joinedAt: apiProfile.createdAt || null,
    lastActiveAt: apiProfile.updatedAt || null,
    // Legacy fields
    username: apiProfile.name || '',
    address: apiProfile.address || '',
  };
};

/**
 * Profile Provider component
 * Provides profile state and methods to the app
 */
export const ProfileProvider = ({ children }) => {
  const { address: account, isConnected } = useAccount();
  const { signProfile, isLoading: signingLoading } = useProfileSignature();
  const [profile, setProfile] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  /**
   * Fetch profile from API
   */
  const fetchProfile = useCallback(async (address) => {
    if (!address) return null;

    try {
      const response = await fetch(`${API_URL}/api/profile/${address}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        throw new Error('Failed to fetch profile');
      }

      const data = await response.json();
      return apiToFrontendProfile(data);
    } catch (err) {
      console.error('Error fetching profile:', err);
      return null;
    }
  }, []);

  /**
   * Load own profile when account connects
   */
  useEffect(() => {
    const loadProfile = async () => {
      if (account && isConnected) {
        setIsLoading(true);
        setError(null);

        const existingProfile = await fetchProfile(account);

        if (existingProfile) {
          setProfile(existingProfile);
        } else {
          // No profile yet, use default
          setProfile(getDefaultProfile(account));
        }

        setIsLoading(false);
      } else {
        setProfile(null);
      }
    };

    loadProfile();
  }, [account, isConnected, fetchProfile]);

  /**
   * Update profile - signs with EIP-712 and saves to backend
   * @param {Object} profileData - Profile data to save
   * @returns {Object|null} Updated profile or null on error
   */
  const updateProfile = useCallback(
    async (profileData) => {
      if (!account) {
        setError('Wallet not connected');
        return null;
      }

      setIsLoading(true);
      setError(null);

      try {
        // Prepare profile data for signing
        const dataToSign = {
          address: account,
          name: profileData.displayName || profileData.name || '',
          bio: profileData.bio || '',
          avatar: profileData.avatarUrl || profileData.avatar || '',
          skills: profileData.skills || [],
          github: profileData.github || '',
          twitter: profileData.twitter || '',
          website: profileData.website || '',
        };

        // Sign with EIP-712
        const { message, signature } = await signProfile(dataToSign);

        // Send to backend
        const response = await fetch(`${API_URL}/api/profile`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ message, signature }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Failed to save profile');
        }

        // Update local state
        const updatedProfile = apiToFrontendProfile(data.profile);
        setProfile(updatedProfile);

        return updatedProfile;
      } catch (err) {
        console.error('Error updating profile:', err);
        setError(err.message || 'Failed to save profile');
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [account, signProfile]
  );

  /**
   * Get another user's profile
   * @param {string} address - Wallet address
   * @returns {Object|null} Profile or null if not found
   */
  const getProfile = useCallback(
    async (address) => {
      if (!address) return null;
      return await fetchProfile(address);
    },
    [fetchProfile]
  );

  /**
   * Refresh own profile from backend
   */
  const refreshProfile = useCallback(async () => {
    if (!account) return;

    setIsLoading(true);
    const refreshedProfile = await fetchProfile(account);

    if (refreshedProfile) {
      setProfile(refreshedProfile);
    }

    setIsLoading(false);
  }, [account, fetchProfile]);

  const value = {
    profile,
    isLoading: isLoading || signingLoading,
    error,
    updateProfile,
    getProfile,
    refreshProfile,
    isAuthenticated: isConnected && !!account,
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
