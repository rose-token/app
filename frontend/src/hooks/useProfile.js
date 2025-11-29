/**
 * Profile hook - display-only stub
 * Profile editing will be available when PostgreSQL backend is integrated
 */

import { createContext, useContext, useState, useEffect } from 'react';
import { useAccount } from 'wagmi';

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
 * Currently provides display-only functionality
 */
export const ProfileProvider = ({ children }) => {
  const { address: account, isConnected } = useAccount();
  const [profile, setProfile] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // Load default profile when account connects
  useEffect(() => {
    if (account && isConnected) {
      setProfile(getDefaultProfile(account));
    } else {
      setProfile(null);
    }
  }, [account, isConnected]);

  /**
   * Update profile - currently disabled
   * @returns {null} Always returns null until backend is ready
   */
  const updateProfile = async () => {
    setError('Profile editing coming soon');
    return null;
  };

  /**
   * Get another user's profile - currently disabled
   * @returns {null} Always returns null until backend is ready
   */
  const getProfile = async () => null;

  /**
   * Refresh profile - currently no-op
   */
  const refreshProfile = async () => {};

  const value = {
    profile,
    isLoading,
    error,
    updateProfile,
    getProfile,
    refreshProfile,
    isAuthenticated: false,
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
