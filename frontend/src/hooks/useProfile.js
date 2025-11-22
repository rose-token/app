import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAccount } from 'wagmi';
import { uploadProfileToIPFS, fetchProfileFromIPFS } from '../utils/ipfs/profileService';

const ProfileContext = createContext();

export const ProfileProvider = ({ children }) => {
  const { address: account, isConnected } = useAccount();
  const [profile, setProfile] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const loadProfile = async () => {
      if (!account || !isConnected) {
        setProfile(null);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const profileData = await fetchProfileFromIPFS(account);
        setProfile(profileData || { username: '', bio: '', address: account });
      } catch (err) {
        console.error('Error loading profile:', err);
        setError('Failed to load profile');
        setProfile({ username: '', bio: '', address: account });
      } finally {
        setIsLoading(false);
      }
    };

    loadProfile();
  }, [account, isConnected]);

  const updateProfile = useCallback(async (username, bio) => {
    if (!account || !isConnected) {
      setError('Please connect your wallet first');
      return null;
    }

    setIsLoading(true);
    setError(null);

    try {
      const profileData = {
        username,
        bio,
      };

      const cid = await uploadProfileToIPFS(profileData, account);
      setProfile({ ...profileData, address: account, updatedAt: Date.now() });
      return cid;
    } catch (err) {
      console.error('Error updating profile:', err);
      setError('Failed to update profile');
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [account, isConnected]);

  const value = {
    profile,
    isLoading,
    error,
    updateProfile,
  };

  return (
    <ProfileContext.Provider value={value}>
      {children}
    </ProfileContext.Provider>
  );
};

export const useProfile = () => {
  const context = useContext(ProfileContext);
  if (!context) {
    throw new Error('useProfile must be used within a ProfileProvider');
  }
  return context;
};
