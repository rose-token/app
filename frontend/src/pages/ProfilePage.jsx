import React, { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { useProfile } from '../hooks/useProfile';
import WalletNotConnected from '../components/wallet/WalletNotConnected';

const ProfilePage = () => {
  const { profile, isLoading, error, updateProfile } = useProfile();
  const { address: account, isConnected } = useAccount();
  
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
        <div
          className="rounded-[20px] backdrop-blur-[20px] p-6 mb-6"
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-subtle)',
            boxShadow: 'var(--shadow-card)'
          }}
        >
          <div className="animate-pulse">
            <div className="h-4 rounded w-1/4 mb-4" style={{ background: 'var(--border-subtle)' }}></div>
            <div className="h-4 rounded w-1/2 mb-6" style={{ background: 'var(--border-subtle)' }}></div>
            <div className="h-4 rounded w-3/4 mb-2" style={{ background: 'var(--border-subtle)' }}></div>
            <div className="h-4 rounded w-1/2 mb-2" style={{ background: 'var(--border-subtle)' }}></div>
          </div>
        </div>
      ) : error ? (
        <div
          className="p-4 rounded-xl mb-6"
          style={{
            background: 'var(--error-bg)',
            border: '1px solid rgba(248, 113, 113, 0.3)',
            color: 'var(--error)'
          }}
        >
          {error}
        </div>
      ) : (
        <div
          className="rounded-[20px] backdrop-blur-[20px] p-6 mb-6"
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-subtle)',
            boxShadow: 'var(--shadow-card)'
          }}
        >
          {!isEditing ? (
            <div>
              <div className="mb-6">
                <h2 className="font-display text-xl font-medium mb-2" style={{ color: 'var(--text-primary)' }}>Wallet Address</h2>
                <p className="break-all font-mono text-sm" style={{ color: 'var(--text-secondary)' }}>
                  {account}
                </p>
              </div>

              <div className="mb-6">
                <h2 className="font-display text-xl font-medium mb-2" style={{ color: 'var(--text-primary)' }}>Username</h2>
                <p style={{ color: 'var(--text-secondary)' }}>
                  {profile?.username || <span style={{ color: 'var(--text-muted)' }} className="italic">Not set</span>}
                </p>
              </div>

              <div className="mb-6">
                <h2 className="font-display text-xl font-medium mb-2" style={{ color: 'var(--text-primary)' }}>Bio</h2>
                <p className="whitespace-pre-wrap" style={{ color: 'var(--text-secondary)' }}>
                  {profile?.bio || <span style={{ color: 'var(--text-muted)' }} className="italic">Not set</span>}
                </p>
              </div>

              {updateSuccess && (
                <div
                  className="mb-4 p-3 rounded-xl"
                  style={{
                    background: 'var(--success-bg)',
                    border: '1px solid rgba(74, 222, 128, 0.3)',
                    color: 'var(--success)'
                  }}
                >
                  Profile updated successfully!
                </div>
              )}

              <div className="flex justify-end">
                <button
                  onClick={handleEdit}
                  className="py-2 px-4 rounded-xl font-semibold transition-all duration-300 hover:-translate-y-0.5"
                  style={{
                    background: 'linear-gradient(135deg, var(--rose-pink) 0%, var(--rose-gold) 100%)',
                    color: 'var(--bg-primary)',
                    boxShadow: '0 4px 16px rgba(212, 165, 165, 0.3)'
                  }}
                >
                  Edit Profile
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <div className="mb-4">
                <label
                  className="block text-xs uppercase tracking-widest font-medium mb-2"
                  style={{ color: 'var(--text-muted)' }}
                  htmlFor="username"
                >
                  Username
                </label>
                <input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl"
                  style={{
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-primary)'
                  }}
                  placeholder="Enter your username"
                />
              </div>

              <div className="mb-4">
                <label
                  className="block text-xs uppercase tracking-widest font-medium mb-2"
                  style={{ color: 'var(--text-muted)' }}
                  htmlFor="bio"
                >
                  Bio
                </label>
                <textarea
                  id="bio"
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl resize-y"
                  style={{
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-primary)'
                  }}
                  rows="4"
                  placeholder="Tell us about yourself"
                />
              </div>

              {updateError && (
                <div
                  className="mb-4 p-3 rounded-xl"
                  style={{
                    background: 'var(--error-bg)',
                    border: '1px solid rgba(248, 113, 113, 0.3)',
                    color: 'var(--error)'
                  }}
                >
                  {updateError}
                </div>
              )}

              <div className="flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={handleCancel}
                  className="py-2 px-4 rounded-xl font-medium transition-all duration-200"
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-secondary)'
                  }}
                  disabled={isSaving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={`py-2 px-4 rounded-xl font-semibold transition-all duration-300 ${
                    isSaving ? 'opacity-70 cursor-not-allowed' : 'hover:-translate-y-0.5'
                  }`}
                  style={{
                    background: 'linear-gradient(135deg, var(--rose-pink) 0%, var(--rose-gold) 100%)',
                    color: 'var(--bg-primary)',
                    boxShadow: '0 4px 16px rgba(212, 165, 165, 0.3)'
                  }}
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
