import React, { useState } from 'react';
import { useAccount } from 'wagmi';
import { useProfile } from '../hooks/useProfile';
import { useCeramicSession } from '../hooks/useCeramicSession';
import WalletNotConnected from '../components/wallet/WalletNotConnected';
import PassportStatus from '../components/passport/PassportStatus';
import ProfileCard from '../components/profile/ProfileCard';
import ProfileModal from '../components/profile/ProfileModal';
import { PASSPORT_THRESHOLDS } from '../constants/passport';
import { Loader2, AlertCircle, Lock } from 'lucide-react';

const ProfilePage = () => {
  const { profile, isLoading, error, refreshProfile } = useProfile();
  const { address: account, isConnected } = useAccount();
  const { isAuthenticated, authenticate, loading: authLoading } = useCeramicSession();

  const [editModalOpen, setEditModalOpen] = useState(false);

  const handleAuthenticate = async () => {
    await authenticate();
  };

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

      {/* Authentication Status */}
      {!isAuthenticated && (
        <div
          className="rounded-xl p-4 mb-6 flex items-center justify-between"
          style={{
            background: 'color-mix(in srgb, var(--warning) 10%, transparent)',
            border: '1px solid color-mix(in srgb, var(--warning) 30%, transparent)',
          }}
        >
          <div className="flex items-center gap-3">
            <Lock className="w-5 h-5" style={{ color: 'var(--warning)' }} />
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                Authenticate to edit your profile
              </p>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                Sign a message with your wallet to enable profile editing
              </p>
            </div>
          </div>
          <button
            onClick={handleAuthenticate}
            disabled={authLoading}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all"
            style={{
              background: 'var(--warning)',
              color: 'var(--bg-primary)',
              opacity: authLoading ? 0.7 : 1,
            }}
          >
            {authLoading && <Loader2 className="w-4 h-4 animate-spin" />}
            {authLoading ? 'Signing...' : 'Authenticate'}
          </button>
        </div>
      )}

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
            onEdit={isAuthenticated ? () => setEditModalOpen(true) : undefined}
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
