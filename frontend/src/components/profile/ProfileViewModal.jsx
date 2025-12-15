/**
 * ProfileViewModal component
 * Read-only modal for viewing any user's profile
 */

import React, { useState } from 'react';
import { useAccount } from 'wagmi';
import ProfileCard from './ProfileCard';
import ProfileModal from './ProfileModal';
import { X } from 'lucide-react';

/**
 * ProfileViewModal - Modal for viewing a user's profile
 * @param {Object} props
 * @param {boolean} props.isOpen - Whether modal is open
 * @param {Function} props.onClose - Close callback
 * @param {string} props.address - Ethereum address to display
 */
const ProfileViewModal = ({ isOpen, onClose, address }) => {
  const { address: connectedAddress } = useAccount();
  const [editModalOpen, setEditModalOpen] = useState(false);

  const isOwnProfile = connectedAddress?.toLowerCase() === address?.toLowerCase();

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={onClose}
        />

        {/* Modal */}
        <div
          className="relative w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl shadow-xl"
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
              Profile
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg transition-colors hover:bg-[var(--bg-secondary)]"
            >
              <X className="w-5 h-5" style={{ color: 'var(--text-secondary)' }} />
            </button>
          </div>

          {/* Content */}
          <div className="p-4">
            <ProfileCard
              address={address}
              showReputation={true}
              onEdit={isOwnProfile ? () => setEditModalOpen(true) : undefined}
            />
          </div>
        </div>
      </div>

      {/* Edit Modal (only for own profile) */}
      {isOwnProfile && (
        <ProfileModal
          isOpen={editModalOpen}
          onClose={() => setEditModalOpen(false)}
          mode="edit"
        />
      )}
    </>
  );
};

export default ProfileViewModal;
