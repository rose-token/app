/**
 * ProfileCard component
 * Full profile display with avatar, name, bio, skills, and social links
 */

import React, { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { useProfile } from '../../hooks/useProfile';
import { SkillBadgeList } from './SkillBadge';
import ReputationStats from './ReputationStats';
import { ExternalLink, Github, Twitter, Globe, Copy, Check, Edit2 } from 'lucide-react';
import { getGatewayUrl } from '../../utils/ipfs/pinataService';

/**
 * Generate a deterministic color from an address
 */
const getAddressColor = (address) => {
  if (!address) return 'hsl(0, 0%, 50%)';

  let hash = 0;
  for (let i = 0; i < address.length; i++) {
    hash = address.charCodeAt(i) + ((hash << 5) - hash);
  }

  const h = Math.abs(hash % 360);
  return `hsl(${h}, 70%, 60%)`;
};

/**
 * Generate initials from display name or address
 */
const getInitials = (name, address) => {
  if (name && name.trim()) {
    const words = name.trim().split(/\s+/);
    if (words.length >= 2) {
      return (words[0][0] + words[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }

  if (address) {
    return address.slice(2, 4).toUpperCase();
  }

  return '??';
};

/**
 * Truncate address for display
 */
const truncateAddress = (address) => {
  if (!address) return '';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
};

/**
 * ProfileCard - Full profile display
 * @param {Object} props
 * @param {string} props.address - Ethereum address to display
 * @param {Object} props.profileData - Optional pre-loaded profile data
 * @param {boolean} props.showReputation - Whether to show reputation stats (default: true)
 * @param {Function} props.onEdit - Callback for edit button (shows if provided and is own profile)
 */
const ProfileCard = ({ address, profileData, showReputation = true, onEdit }) => {
  const { address: connectedAddress } = useAccount();
  const { getProfile, profile: ownProfile } = useProfile();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const isOwnProfile = connectedAddress?.toLowerCase() === address?.toLowerCase();

  // Load profile
  useEffect(() => {
    let cancelled = false;

    const loadProfile = async () => {
      // Use provided data if available
      if (profileData) {
        setProfile(profileData);
        setLoading(false);
        return;
      }

      // Use own profile from context if this is connected user
      if (isOwnProfile && ownProfile) {
        setProfile(ownProfile);
        setLoading(false);
        return;
      }

      // Fetch from Ceramic
      if (address) {
        setLoading(true);
        try {
          const result = await getProfile(address);
          if (!cancelled) {
            setProfile(result);
          }
        } catch (err) {
          console.error('Error loading profile:', err);
        } finally {
          if (!cancelled) {
            setLoading(false);
          }
        }
      }
    };

    loadProfile();

    return () => {
      cancelled = true;
    };
  }, [address, profileData, isOwnProfile, ownProfile, getProfile]);

  const handleCopyAddress = () => {
    if (address) {
      navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (loading) {
    return <ProfileCardSkeleton />;
  }

  const displayName = profile?.displayName || profile?.username;
  const avatarUrl = profile?.avatarUrl;
  const bio = profile?.bio;
  const skills = profile?.skills || [];
  const website = profile?.website;
  const twitter = profile?.twitter;
  const github = profile?.github;
  const color = getAddressColor(address);
  const initials = getInitials(displayName, address);

  const hasSocialLinks = website || twitter || github;

  return (
    <div className="space-y-4">
      {/* Header with avatar and name */}
      <div className="flex items-start gap-4">
        {/* Avatar */}
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden"
          style={{ backgroundColor: avatarUrl ? 'transparent' : color }}
        >
          {avatarUrl ? (
            <img
              src={
                avatarUrl.startsWith('ipfs://')
                  ? getGatewayUrl(avatarUrl.replace('ipfs://', ''))
                  : avatarUrl
              }
              alt={displayName || 'Profile'}
              className="w-full h-full object-cover"
            />
          ) : (
            <span className="text-xl font-semibold text-white">{initials}</span>
          )}
        </div>

        {/* Name and address */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2
              className="text-xl font-bold truncate"
              style={{ color: 'var(--text-primary)' }}
            >
              {displayName || truncateAddress(address)}
            </h2>
            {isOwnProfile && onEdit && (
              <button
                type="button"
                onClick={onEdit}
                className="p-1.5 rounded-lg transition-colors hover:bg-[var(--bg-tertiary)]"
                title="Edit profile"
              >
                <Edit2 className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
              </button>
            )}
          </div>

          {/* Address with copy */}
          <button
            type="button"
            onClick={handleCopyAddress}
            className="flex items-center gap-1.5 mt-1 text-sm hover:opacity-80 transition-opacity"
            style={{ color: 'var(--text-secondary)' }}
          >
            <span className="font-mono">{truncateAddress(address)}</span>
            {copied ? (
              <Check className="w-3.5 h-3.5" style={{ color: 'var(--success)' }} />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* Bio */}
      {bio && (
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          {bio}
        </p>
      )}

      {/* Skills */}
      {skills.length > 0 && (
        <div>
          <h3
            className="text-xs font-semibold uppercase tracking-wide mb-2"
            style={{ color: 'var(--text-secondary)' }}
          >
            Skills
          </h3>
          <SkillBadgeList skills={skills} size="md" />
        </div>
      )}

      {/* Social Links */}
      {hasSocialLinks && (
        <div className="flex items-center gap-3 flex-wrap">
          {website && (
            <SocialLink
              href={website.startsWith('http') ? website : `https://${website}`}
              icon={<Globe className="w-4 h-4" />}
              label="Website"
            />
          )}
          {github && (
            <SocialLink
              href={`https://github.com/${github.replace('@', '')}`}
              icon={<Github className="w-4 h-4" />}
              label={github}
            />
          )}
          {twitter && (
            <SocialLink
              href={`https://twitter.com/${twitter.replace('@', '')}`}
              icon={<Twitter className="w-4 h-4" />}
              label={twitter}
            />
          )}
        </div>
      )}

      {/* Reputation Stats */}
      {showReputation && <ReputationStats address={address} variant="card" />}

      {/* No profile message */}
      {!displayName && !bio && skills.length === 0 && !hasSocialLinks && (
        <div
          className="text-center py-6 rounded-xl"
          style={{
            backgroundColor: 'var(--bg-secondary)',
            color: 'var(--text-secondary)',
          }}
        >
          <p className="text-sm">No profile information available</p>
          {isOwnProfile && onEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="mt-2 text-sm font-medium hover:underline"
              style={{ color: 'var(--rose-pink)' }}
            >
              Create your profile
            </button>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * Social link component
 */
const SocialLink = ({ href, icon, label }) => {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors hover:bg-[var(--bg-tertiary)]"
      style={{ color: 'var(--text-secondary)' }}
    >
      {icon}
      <span>{label}</span>
      <ExternalLink className="w-3 h-3" />
    </a>
  );
};

/**
 * Loading skeleton
 */
const ProfileCardSkeleton = () => {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-4">
        <div
          className="w-16 h-16 rounded-full animate-pulse"
          style={{ backgroundColor: 'var(--bg-tertiary)' }}
        />
        <div className="flex-1 space-y-2">
          <div
            className="h-6 w-32 rounded animate-pulse"
            style={{ backgroundColor: 'var(--bg-tertiary)' }}
          />
          <div
            className="h-4 w-24 rounded animate-pulse"
            style={{ backgroundColor: 'var(--bg-tertiary)' }}
          />
        </div>
      </div>
      <div
        className="h-16 rounded-xl animate-pulse"
        style={{ backgroundColor: 'var(--bg-tertiary)' }}
      />
    </div>
  );
};

export default ProfileCard;
