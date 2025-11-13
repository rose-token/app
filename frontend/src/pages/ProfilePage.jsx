import React, { useState, useEffect } from 'react';
import { useProfile } from '../hooks/useProfile';
import { useEthereum } from '../hooks/useEthereum';
import WalletNotConnected from '../components/wallet/WalletNotConnected';

const ProfilePage = () => {
  const { profile, isLoading, error, updateProfile } = useProfile();
  const { account, isConnected } = useEthereum();
  
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [updateError, setUpdateError] = useState('');
  const [updateSuccess, setUpdateSuccess] = useState(false);
  
  useEffect(() => {
    if (profile) {
      setUsername(profile.username || '');
      setBio(profile.bio || '');
    }
  }, [profile]);
  
  const handleEdit = () => {
    setIsEditing(true);
    setUpdateError('');
    setUpdateSuccess(false);
  };
  
  const handleCancel = () => {
    setIsEditing(false);
    setUsername(profile?.username || '');
    setBio(profile?.bio || '');
    setUpdateError('');
  };
  
  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    setUpdateError('');
    setUpdateSuccess(false);
    
    try {
      const result = await updateProfile(username, bio);
      if (result) {
        setIsEditing(false);
        setUpdateSuccess(true);
        
        setTimeout(() => {
          setUpdateSuccess(false);
        }, 3000);
      } else {
        setUpdateError('Failed to update profile');
      }
    } catch (err) {
      console.error('Error saving profile:', err);
      setUpdateError('Error saving profile: ' + (err.message || 'Unknown error'));
    } finally {
      setIsSaving(false);
    }
  };
  
  if (!isConnected) {
    return (
      <div>
        <h1 className="text-3xl font-bold mb-6">User Profile</h1>
        <WalletNotConnected />
      </div>
    );
  }
  
  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">User Profile</h1>
      
      {isLoading && !profile ? (
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="animate-pulse">
            <div className="h-4 bg-muted rounded w-1/4 mb-4"></div>
            <div className="h-4 bg-muted rounded w-1/2 mb-6"></div>
            <div className="h-4 bg-muted rounded w-3/4 mb-2"></div>
            <div className="h-4 bg-muted rounded w-1/2 mb-2"></div>
          </div>
        </div>
      ) : error ? (
        <div className="bg-destructive/10 text-destructive p-4 rounded-md mb-6">
          {error}
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          {!isEditing ? (
            <div>
              <div className="mb-6">
                <h2 className="text-xl font-semibold mb-2">Wallet Address</h2>
                <p className="text-foreground break-all">
                  {account}
                </p>
              </div>

              <div className="mb-6">
                <h2 className="text-xl font-semibold mb-2">Username</h2>
                <p className="text-foreground">
                  {profile?.username || <span className="text-muted-foreground italic">Not set</span>}
                </p>
              </div>

              <div className="mb-6">
                <h2 className="text-xl font-semibold mb-2">Bio</h2>
                <p className="text-foreground whitespace-pre-wrap">
                  {profile?.bio || <span className="text-muted-foreground italic">Not set</span>}
                </p>
              </div>

              {updateSuccess && (
                <div className="mb-4 p-3 bg-accent/10 text-accent rounded-md">
                  Profile updated successfully!
                </div>
              )}
              
              <div className="flex justify-end">
                <button
                  onClick={handleEdit}
                  className="bg-primary text-white py-2 px-4 rounded-md hover:bg-primary/90"
                >
                  Edit Profile
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <div className="mb-4">
                <label className="block text-foreground text-sm font-bold mb-2" htmlFor="username">
                  Username
                </label>
                <input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full px-3 py-2 border border-rose-tan rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="Enter your username"
                />
              </div>

              <div className="mb-4">
                <label className="block text-foreground text-sm font-bold mb-2" htmlFor="bio">
                  Bio
                </label>
                <textarea
                  id="bio"
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  className="w-full px-3 py-2 border border-rose-tan rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                  rows="4"
                  placeholder="Tell us about yourself"
                />
              </div>

              {updateError && (
                <div className="mb-4 p-3 bg-destructive/10 text-destructive rounded-md">
                  {updateError}
                </div>
              )}

              <div className="flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={handleCancel}
                  className="bg-muted text-foreground py-2 px-4 rounded-md hover:bg-muted/80"
                  disabled={isSaving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={`bg-primary text-white py-2 px-4 rounded-md ${
                    isSaving ? 'opacity-70 cursor-not-allowed' : 'hover:bg-primary/90'
                  }`}
                  disabled={isSaving}
                >
                  {isSaving ? 'Saving...' : 'Save Profile'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
};

export default ProfilePage;
