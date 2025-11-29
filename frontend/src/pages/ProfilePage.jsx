import React, { useState } from 'react';
import { useAccount } from 'wagmi';
import { useProfile } from '../hooks/useProfile';
import WalletNotConnected from '../components/wallet/WalletNotConnected';
import PassportStatus from '../components/passport/PassportStatus';
import ProfileCard from '../components/profile/ProfileCard';
import ProfileModal from '../components/profile/ProfileModal';
import { PASSPORT_THRESHOLDS } from '../constants/passport';
import { Loader2, AlertCircle } from 'lucide-react';

const ProfilePage = () => {
  const { profile, isLoading, error, refreshProfile } = useProfile();
  const { address: account, isConnected } = useAccount();

  const [editModalOpen, setEditModalOpen] = useState(false);

  if (!isConnected) {
    return (
      <div>
        <h1
          className="font-display text-3xl font-medium mb-6"
          style={{ color: 'var(--text-primary)', letterSpacing: '-0.02em' }}
        >
          User Profile
        </h1>
        <WalletNotConnected />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1
        className="font-display text-3xl font-medium mb-6"
        style={{ color: 'var(--text-primary)', letterSpacing: '-0.02em' }}
      >
        User Profile
      </h1>

      {/* Profile Card */}
      {isLoading && !profile ? (
        <div
          className="rounded-[20px] backdrop-blur-[20px] p-6 mb-6"
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-subtle)',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          <div className="animate-pulse space-y-4">
            <div className="flex items-center gap-4">
              <div
                className="w-16 h-16 rounded-full"
                style={{ background: 'var(--border-subtle)' }}
              />
              <div className="flex-1 space-y-2">
                <div
                  className="h-5 rounded w-32"
                  style={{ background: 'var(--border-subtle)' }}
                />
                <div
                  className="h-4 rounded w-24"
                  style={{ background: 'var(--border-subtle)' }}
                />
              </div>
            </div>
            <div
              className="h-20 rounded-xl"
              style={{ background: 'var(--border-subtle)' }}
            />
          </div>
        </div>
      ) : error ? (
        <div
          className="p-4 rounded-xl mb-6 flex items-center gap-3"
          style={{
            background: 'var(--error-bg)',
            border: '1px solid rgba(248, 113, 113, 0.3)',
            color: 'var(--error)',
          }}
        >
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      ) : (
        <div
          className="rounded-[20px] backdrop-blur-[20px] p-6 mb-6"
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-subtle)',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          <ProfileCard
            address={account}
            showReputation={true}
            onEdit={() => setEditModalOpen(true)}
          />
        </div>
      )}

      {/* Gitcoin Passport Section */}
      <div className="mt-6">
        <h2
          className="font-display text-xl font-medium mb-4"
          style={{ color: 'var(--text-primary)' }}
        >
          Sybil Resistance
        </h2>
        <PassportStatus threshold={PASSPORT_THRESHOLDS.CREATE_TASK} />
      </div>

      {/* Edit Profile Modal */}
      <ProfileModal
        isOpen={editModalOpen}
        onClose={() => {
          setEditModalOpen(false);
          refreshProfile();
        }}
        mode="edit"
      />
    </div>
  );
};

export default ProfilePage;
