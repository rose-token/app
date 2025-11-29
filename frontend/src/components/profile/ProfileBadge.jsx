/**
 * ProfileBadge component
 * Mini profile display (avatar + name) for inline use
 * Clickable to open ProfileViewModal
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useProfile } from '../../hooks/useProfile';
import { User } from 'lucide-react';
import ProfileViewModal from './ProfileViewModal';

/**
 * Generate a deterministic color from an address
 * @param {string} address - Ethereum address
 * @returns {string} HSL color string
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
 * @param {string} name - Display name
 * @param {string} address - Ethereum address
 * @returns {string} Initials (1-2 chars)
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
 * @param {string} address - Full Ethereum address
 * @returns {string} Truncated address (0x1234...5678)
 */
const truncateAddress = (address) => {
  if (!address) return '';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
};

/**
 * ProfileBadge - Mini profile display with avatar and name
 * @param {Object} props
 * @param {string} props.address - Ethereum address
 * @param {string} props.size - Size variant: 'sm' | 'md' | 'lg' (default: 'sm')
 * @param {boolean} props.showName - Whether to show name (default: true)
 * @param {boolean} props.clickable - Whether badge is clickable (default: true)
 */
const ProfileBadge = ({ address, size = 'sm', showName = true, clickable = true }) => {
  const { getProfile } = useProfile();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);

  // Fetch profile
  useEffect(() => {
    let cancelled = false;

    const loadProfile = async () => {
      if (!address) {
        setLoading(false);
        return;
      }

      setLoading(true);

      try {
        const result = await getProfile(address);

        if (!cancelled) {
          setProfile(result);
        }
      } catch (err) {
        console.error('Error loading profile for badge:', err);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadProfile();

    return () => {
      cancelled = true;
    };
  }, [address, getProfile]);

  const handleClick = useCallback(() => {
    if (clickable && address) {
      setModalOpen(true);
    }
  }, [clickable, address]);

  const sizeConfig = {
    sm: {
      avatar: 'w-6 h-6',
      avatarText: 'text-[10px]',
      name: 'text-sm',
      gap: 'gap-1.5',
    },
    md: {
      avatar: 'w-8 h-8',
      avatarText: 'text-xs',
      name: 'text-sm',
      gap: 'gap-2',
    },
    lg: {
      avatar: 'w-10 h-10',
      avatarText: 'text-sm',
      name: 'text-base',
      gap: 'gap-2.5',
    },
  };

  const config = sizeConfig[size] || sizeConfig.sm;
  const displayName = profile?.displayName || profile?.username;
  const avatarUrl = profile?.avatarUrl;
  const color = getAddressColor(address);
  const initials = getInitials(displayName, address);

  const BadgeContent = (
    <div
      className={`inline-flex items-center ${config.gap} ${
        clickable ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''
      }`}
    >
      {/* Avatar */}
      <div
        className={`${config.avatar} rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden`}
        style={{
          backgroundColor: avatarUrl ? 'transparent' : color,
        }}
      >
        {loading ? (
          // Loading skeleton
          <div
            className="w-full h-full animate-pulse"
            style={{ backgroundColor: 'var(--bg-tertiary)' }}
          />
        ) : avatarUrl ? (
          // Profile image
          <img
            src={avatarUrl.startsWith('ipfs://')
              ? `https://gateway.pinata.cloud/ipfs/${avatarUrl.replace('ipfs://', '')}`
              : avatarUrl
            }
            alt={displayName || 'Profile'}
            className="w-full h-full object-cover"
            onError={(e) => {
              // Fallback to initials on error
              e.target.style.display = 'none';
              e.target.parentElement.innerHTML = `<span class="${config.avatarText} font-semibold text-white">${initials}</span>`;
            }}
          />
        ) : (
          // Initials fallback
          <span className={`${config.avatarText} font-semibold text-white`}>
            {initials}
          </span>
        )}
      </div>

      {/* Name/Address */}
      {showName && (
        <span
          className={`${config.name} font-medium truncate`}
          style={{ color: 'var(--text-primary)', maxWidth: '120px' }}
        >
          {loading ? (
            <span
              className="inline-block w-16 h-4 rounded animate-pulse"
              style={{ backgroundColor: 'var(--bg-tertiary)' }}
            />
          ) : displayName ? (
            displayName
          ) : (
            truncateAddress(address)
          )}
        </span>
      )}
    </div>
  );

  return (
    <>
      {clickable ? (
        <button
          type="button"
          onClick={handleClick}
          className="inline-block text-left"
        >
          {BadgeContent}
        </button>
      ) : (
        BadgeContent
      )}

      {/* Profile View Modal */}
      {clickable && (
        <ProfileViewModal
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          address={address}
        />
      )}
    </>
  );
};

export default ProfileBadge;
