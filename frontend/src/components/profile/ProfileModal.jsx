/**
 * ProfileModal component
 * Modal for creating/editing user profile
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useAccount } from 'wagmi';
import { useProfile } from '../../hooks/useProfile';
import SkillSelect from './SkillSelect';
import { X, Upload, Loader2, AlertCircle, Camera, Info } from 'lucide-react';
import { uploadFileToIPFS } from '../../utils/ipfs/pinataService';

/**
 * ProfileModal - Modal for creating/editing profile
 * @param {Object} props
 * @param {boolean} props.isOpen - Whether modal is open
 * @param {Function} props.onClose - Close callback
 * @param {string} props.mode - Mode: 'create' | 'edit' (default: 'edit')
 */
const ProfileModal = ({ isOpen, onClose, mode = 'edit' }) => {
  const { address } = useAccount();
  const { profile, updateProfile, isLoading: profileLoading } = useProfile();
  // Profile editing is now enabled with PostgreSQL backend
  const isEditingDisabled = false;

  const [formData, setFormData] = useState({
    displayName: '',
    bio: '',
    avatarUrl: '',
    skills: [],
    website: '',
    twitter: '',
    github: '',
  });
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  // Initialize form with existing profile data
  useEffect(() => {
    if (profile && mode === 'edit') {
      setFormData({
        displayName: profile.displayName || profile.username || '',
        bio: profile.bio || '',
        avatarUrl: profile.avatarUrl || '',
        skills: profile.skills || [],
        website: profile.website || '',
        twitter: profile.twitter || '',
        github: profile.github || '',
      });
    }
  }, [profile, mode, isOpen]);

  // Reset on close
  useEffect(() => {
    if (!isOpen) {
      setAvatarFile(null);
      setAvatarPreview(null);
      setError(null);
      setSuccess(false);
    }
  }, [isOpen]);

  const handleChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setError(null);
  };

  const handleAvatarChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file');
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      setError('Image must be less than 5MB');
      return;
    }

    setAvatarFile(file);

    // Create preview
    const reader = new FileReader();
    reader.onloadend = () => {
      setAvatarPreview(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSaving(true);

    try {
      // Profile editing is disabled until PostgreSQL backend is integrated
      if (isEditingDisabled) {
        setError('Profile editing coming soon');
        setSaving(false);
        return;
      }

      // Upload avatar if changed
      let avatarUrl = formData.avatarUrl;
      if (avatarFile) {
        try {
          const result = await uploadFileToIPFS(avatarFile);
          avatarUrl = `ipfs://${result.IpfsHash}`;
        } catch (err) {
          console.error('Error uploading avatar:', err);
          setError('Failed to upload avatar image');
          setSaving(false);
          return;
        }
      }

      // Save profile
      const result = await updateProfile({
        ...formData,
        avatarUrl,
      });

      if (result) {
        setSuccess(true);
        setTimeout(() => {
          onClose();
        }, 1500);
      } else {
        setError('Failed to save profile');
      }
    } catch (err) {
      console.error('Error saving profile:', err);
      setError(err.message || 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  };

  const handleSkip = () => {
    onClose();
  };

  if (!isOpen) return null;

  const isSubmitting = saving || profileLoading;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl shadow-xl"
        style={{
          backgroundColor: 'var(--bg-card)',
          border: '1px solid var(--border-color)',
        }}
      >
        {/* Header */}
        <div
          className="sticky top-0 flex items-center justify-between p-4 z-10"
          style={{
            backgroundColor: 'var(--bg-card)',
            borderBottom: '1px solid var(--border-color)',
          }}
        >
          <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
            {mode === 'create' ? 'Create Your Profile' : 'Edit Profile'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg transition-colors hover:bg-[var(--bg-secondary)]"
          >
            <X className="w-5 h-5" style={{ color: 'var(--text-secondary)' }} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Coming Soon Notice */}
          {isEditingDisabled && (
            <div
              className="flex items-center gap-2 p-3 rounded-xl text-sm"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--info) 15%, transparent)',
                color: 'var(--info)',
              }}
            >
              <Info className="w-4 h-4 flex-shrink-0" />
              <span>Profile editing coming soon. You can view your profile but changes cannot be saved yet.</span>
            </div>
          )}

          {/* Avatar Upload */}
          <div className="flex justify-center">
            <label className="relative cursor-pointer group">
              <div
                className="w-24 h-24 rounded-full flex items-center justify-center overflow-hidden"
                style={{
                  backgroundColor: 'var(--bg-secondary)',
                  border: '2px dashed var(--border-color)',
                }}
              >
                {avatarPreview || formData.avatarUrl ? (
                  <img
                    src={
                      avatarPreview ||
                      (formData.avatarUrl.startsWith('ipfs://')
                        ? `https://gateway.pinata.cloud/ipfs/${formData.avatarUrl.replace('ipfs://', '')}`
                        : formData.avatarUrl)
                    }
                    alt="Avatar preview"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <Camera className="w-8 h-8" style={{ color: 'var(--text-secondary)' }} />
                )}
                <div className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <Upload className="w-6 h-6 text-white" />
                </div>
              </div>
              <input
                type="file"
                accept="image/*"
                onChange={handleAvatarChange}
                className="hidden"
                disabled={isSubmitting}
              />
            </label>
          </div>
          <p className="text-center text-xs" style={{ color: 'var(--text-secondary)' }}>
            Click to upload avatar (optional)
          </p>

          {/* Display Name */}
          <div>
            <label
              className="block text-sm font-medium mb-1.5"
              style={{ color: 'var(--text-primary)' }}
            >
              Display Name <span style={{ color: 'var(--error)' }}>*</span>
            </label>
            <input
              type="text"
              value={formData.displayName}
              onChange={(e) => handleChange('displayName', e.target.value)}
              maxLength={100}
              required
              disabled={isSubmitting}
              className="w-full px-4 py-2.5 rounded-xl text-sm outline-none transition-colors"
              style={{
                backgroundColor: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                color: 'var(--text-primary)',
              }}
              placeholder="Enter your display name"
            />
          </div>

          {/* Bio */}
          <div>
            <label
              className="block text-sm font-medium mb-1.5"
              style={{ color: 'var(--text-primary)' }}
            >
              Bio
            </label>
            <textarea
              value={formData.bio}
              onChange={(e) => handleChange('bio', e.target.value)}
              maxLength={500}
              rows={3}
              disabled={isSubmitting}
              className="w-full px-4 py-2.5 rounded-xl text-sm outline-none transition-colors resize-none"
              style={{
                backgroundColor: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                color: 'var(--text-primary)',
              }}
              placeholder="Tell us about yourself..."
            />
            <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
              {formData.bio.length}/500
            </p>
          </div>

          {/* Skills */}
          <div>
            <label
              className="block text-sm font-medium mb-1.5"
              style={{ color: 'var(--text-primary)' }}
            >
              Skills
            </label>
            <SkillSelect
              selected={formData.skills}
              onChange={(skills) => handleChange('skills', skills)}
              disabled={isSubmitting}
            />
          </div>

          {/* Social Links */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                className="block text-sm font-medium mb-1.5"
                style={{ color: 'var(--text-primary)' }}
              >
                Website
              </label>
              <input
                type="url"
                value={formData.website}
                onChange={(e) => handleChange('website', e.target.value)}
                disabled={isSubmitting}
                className="w-full px-4 py-2.5 rounded-xl text-sm outline-none transition-colors"
                style={{
                  backgroundColor: 'var(--bg-secondary)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-primary)',
                }}
                placeholder="https://..."
              />
            </div>
            <div>
              <label
                className="block text-sm font-medium mb-1.5"
                style={{ color: 'var(--text-primary)' }}
              >
                GitHub
              </label>
              <input
                type="text"
                value={formData.github}
                onChange={(e) => handleChange('github', e.target.value)}
                disabled={isSubmitting}
                className="w-full px-4 py-2.5 rounded-xl text-sm outline-none transition-colors"
                style={{
                  backgroundColor: 'var(--bg-secondary)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-primary)',
                }}
                placeholder="username"
              />
            </div>
            <div className="sm:col-span-2">
              <label
                className="block text-sm font-medium mb-1.5"
                style={{ color: 'var(--text-primary)' }}
              >
                Twitter/X
              </label>
              <input
                type="text"
                value={formData.twitter}
                onChange={(e) => handleChange('twitter', e.target.value)}
                disabled={isSubmitting}
                className="w-full px-4 py-2.5 rounded-xl text-sm outline-none transition-colors"
                style={{
                  backgroundColor: 'var(--bg-secondary)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-primary)',
                }}
                placeholder="@username"
              />
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div
              className="flex items-center gap-2 p-3 rounded-xl text-sm"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--error) 15%, transparent)',
                color: 'var(--error)',
              }}
            >
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Success Message */}
          {success && (
            <div
              className="flex items-center gap-2 p-3 rounded-xl text-sm"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--success) 15%, transparent)',
                color: 'var(--success)',
              }}
            >
              <span>Profile saved successfully!</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between gap-3 pt-2">
            {mode === 'create' && (
              <button
                type="button"
                onClick={handleSkip}
                disabled={isSubmitting}
                className="px-4 py-2.5 rounded-xl text-sm font-medium transition-colors"
                style={{ color: 'var(--text-secondary)' }}
              >
                Skip for now
              </button>
            )}

            <div className={`flex items-center gap-3 ${mode === 'edit' ? 'w-full' : 'ml-auto'}`}>
              {mode === 'edit' && (
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isSubmitting}
                  className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors"
                  style={{
                    backgroundColor: 'var(--bg-secondary)',
                    color: 'var(--text-primary)',
                  }}
                >
                  Cancel
                </button>
              )}

              <button
                type="submit"
                disabled={isSubmitting || !formData.displayName.trim()}
                className={`${mode === 'edit' ? 'flex-1' : ''} flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200`}
                style={{
                  backgroundColor: 'var(--rose-pink)',
                  color: 'var(--bg-primary)',
                  opacity: isSubmitting || !formData.displayName.trim() ? 0.6 : 1,
                }}
              >
                {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                {mode === 'create' ? 'Create Profile' : 'Save Changes'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ProfileModal;
