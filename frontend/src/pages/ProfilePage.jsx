import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { useProfile } from '../hooks/useProfile';
import useGovernance from '../hooks/useGovernance';
import useDelegation from '../hooks/useDelegation';
import WalletNotConnected from '../components/wallet/WalletNotConnected';
import PassportStatus from '../components/passport/PassportStatus';
import ProfileCard from '../components/profile/ProfileCard';
import ProfileModal from '../components/profile/ProfileModal';
import ReputationBadge from '../components/governance/ReputationBadge';
import { PASSPORT_THRESHOLDS } from '../constants/passport';
import { Loader2, AlertCircle } from 'lucide-react';

const ProfilePage = () => {
  const { profile, isLoading, error, refreshProfile } = useProfile();
  const { address: account, isConnected } = useAccount();
  const {
    stakedRose,
    vRoseBalance,
    reputation,
    pendingRewards,
    userStats,
    canPropose,
    canVote,
  } = useGovernance();
  const { isDelegating, delegatedTo, delegatorCount, totalDelegatedPower, canDelegate } = useDelegation();

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

      {/* Governance Stats Section */}
      <div className="mt-6">
        <h2
          className="font-display text-xl font-medium mb-4"
          style={{ color: 'var(--text-primary)' }}
        >
          Governance
        </h2>
        <div
          className="rounded-[20px] backdrop-blur-[20px] p-6"
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-subtle)',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          {/* Reputation */}
          <div className="flex items-center justify-between mb-4 pb-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Reputation Score</span>
            <ReputationBadge
              score={reputation || 60}
              tasksCompleted={userStats?.tasksCompleted}
              disputes={userStats?.disputes}
              failedProposals={userStats?.failedProposals}
            />
          </div>

          {/* Staking Stats */}
          <div className="grid grid-cols-2 gap-4 mb-4 pb-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            <div>
              <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Staked ROSE</p>
              <p className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                {parseFloat(stakedRose || 0).toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>vROSE Balance</p>
              <p className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                {parseFloat(vRoseBalance || 0).toLocaleString()}
              </p>
            </div>
          </div>

          {/* Eligibility */}
          <div className="space-y-2 mb-4 pb-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            <div className="flex justify-between items-center">
              <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Can Vote</span>
              <span
                className="text-sm font-medium"
                style={{ color: canVote ? 'var(--success)' : 'var(--text-muted)' }}
              >
                {canVote ? 'Yes' : 'No (70%+ rep needed)'}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Can Propose</span>
              <span
                className="text-sm font-medium"
                style={{ color: canPropose ? 'var(--success)' : 'var(--text-muted)' }}
              >
                {canPropose ? 'Yes' : 'No (90%+ rep needed)'}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Can Receive Delegation</span>
              <span
                className="text-sm font-medium"
                style={{ color: canDelegate ? 'var(--success)' : 'var(--text-muted)' }}
              >
                {canDelegate ? 'Yes' : 'No (90%+ rep needed)'}
              </span>
            </div>
          </div>

          {/* Delegation Status */}
          {isDelegating && (
            <div
              className="p-3 rounded-xl mb-4"
              style={{ background: 'rgba(212, 175, 140, 0.1)' }}
            >
              <div className="flex justify-between items-center">
                <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Delegating to</span>
                <span className="font-mono text-sm" style={{ color: 'var(--text-primary)' }}>
                  {delegatedTo?.slice(0, 6)}...{delegatedTo?.slice(-4)}
                </span>
              </div>
            </div>
          )}

          {delegatorCount > 0 && (
            <div
              className="p-3 rounded-xl mb-4"
              style={{ background: 'rgba(212, 175, 140, 0.1)' }}
            >
              <div className="flex justify-between items-center">
                <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Delegations Received</span>
                <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {parseFloat(totalDelegatedPower || 0).toLocaleString()} power from {delegatorCount} delegator{delegatorCount > 1 ? 's' : ''}
                </span>
              </div>
            </div>
          )}

          {/* Pending Rewards */}
          {parseFloat(pendingRewards || 0) > 0 && (
            <div
              className="p-3 rounded-xl mb-4"
              style={{ background: 'rgba(16, 185, 129, 0.1)' }}
            >
              <div className="flex justify-between items-center">
                <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Pending Rewards</span>
                <span className="text-sm font-semibold" style={{ color: 'var(--success)' }}>
                  {parseFloat(pendingRewards).toLocaleString(undefined, { maximumFractionDigits: 2 })} ROSE
                </span>
              </div>
            </div>
          )}

          {/* Quick Links */}
          <div className="flex gap-3 mt-4">
            <Link
              to="/governance"
              className="flex-1 text-center py-2 px-4 rounded-xl text-sm font-medium transition-all"
              style={{
                background: 'linear-gradient(135deg, var(--rose-pink) 0%, var(--rose-gold) 100%)',
                color: 'var(--bg-primary)',
              }}
            >
              Governance
            </Link>
            <Link
              to="/governance/my-votes"
              className="flex-1 text-center py-2 px-4 rounded-xl text-sm font-medium transition-all"
              style={{
                background: 'var(--bg-tertiary)',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              My Votes
            </Link>
            <Link
              to="/delegates"
              className="flex-1 text-center py-2 px-4 rounded-xl text-sm font-medium transition-all"
              style={{
                background: 'var(--bg-tertiary)',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              Delegates
            </Link>
          </div>
        </div>
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
