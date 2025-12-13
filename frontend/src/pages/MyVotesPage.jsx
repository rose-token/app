/**
 * MyVotesPage - Personal governance dashboard
 * Shows user's voting history, allocations, and rewards
 */

import React, { useMemo, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAccount, usePublicClient } from 'wagmi';
import { parseAbiItem, formatUnits } from 'viem';
import { CONTRACTS, ProposalStatus, ProposalStatusLabels, formatVotePower } from '../constants/contracts';
import useProposals from '../hooks/useProposals';
import useGovernance from '../hooks/useGovernance';
import useDelegation from '../hooks/useDelegation';
import ReputationBadge from '../components/governance/ReputationBadge';
import WalletNotConnected from '../components/wallet/WalletNotConnected';

const MyVotesPage = () => {
  const { address: account, isConnected } = useAccount();
  const publicClient = usePublicClient();

  const { proposals, isLoading: proposalsLoading } = useProposals();
  const {
    stakedRose,
    allocatedRose,
    unallocatedRose,
    vRoseBalance,
    reputation,
    pendingRewards,
    userStats,
    canPropose,
    canVote,
  } = useGovernance();

  const {
    delegatedTo,
    delegatedAmount,
    isDelegating,
    totalDelegatedPower,
    canDelegate,
    myDelegators,
    delegatorCount,
  } = useDelegation();

  const [rewardHistory, setRewardHistory] = useState([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);

  // Filter proposals user has voted on or created
  const myVotedProposals = useMemo(() =>
    proposals.filter(p => p.hasVoted),
  [proposals]);

  const myCreatedProposals = useMemo(() =>
    proposals.filter(p => p.isProposer),
  [proposals]);

  // Fetch reward claim history
  useEffect(() => {
    const fetchRewardHistory = async () => {
      if (!CONTRACTS.GOVERNANCE || !publicClient || !account) return;

      setIsLoadingHistory(true);
      try {
        const events = await publicClient.getLogs({
          address: CONTRACTS.GOVERNANCE,
          event: parseAbiItem('event RewardClaimed(address indexed user, uint256 amount)'),
          args: { user: account },
          fromBlock: 'earliest',
          toBlock: 'latest',
        });

        const rewards = events.map(e => ({
          amount: formatUnits(e.args.amount, 18),
          blockNumber: Number(e.blockNumber),
          transactionHash: e.transactionHash,
        }));

        setRewardHistory(rewards.reverse());
      } catch (err) {
        console.error('Error fetching reward history:', err);
      } finally {
        setIsLoadingHistory(false);
      }
    };

    fetchRewardHistory();
  }, [CONTRACTS.GOVERNANCE, publicClient, account]);

  // Calculate total rewards claimed
  const totalRewardsClaimed = useMemo(() =>
    rewardHistory.reduce((sum, r) => sum + parseFloat(r.amount), 0),
  [rewardHistory]);

  if (!isConnected) {
    return (
      <div className="animate-page-entrance">
        <WalletNotConnected />
      </div>
    );
  }

  return (
    <div className="animate-page-entrance">
      {/* Back Link */}
      <Link
        to="/governance"
        className="btn-secondary inline-flex items-center gap-1 text-sm mb-6"
      >
        &larr; Back to Governance
      </Link>

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">My Governance</h1>
        <p style={{ color: 'var(--text-muted)' }}>
          Track your voting activity, allocations, and rewards
        </p>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="card text-center py-4">
          <p className="text-2xl font-bold">{myVotedProposals.length}</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Proposals Voted</p>
        </div>
        <div className="card text-center py-4">
          <p className="text-2xl font-bold">{myCreatedProposals.length}</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Proposals Created</p>
        </div>
        <div className="card text-center py-4">
          <p className="text-2xl font-bold gradient-text">
            {parseFloat(pendingRewards || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Pending Rewards</p>
        </div>
        <div className="card text-center py-4">
          <p className="text-2xl font-bold">
            {totalRewardsClaimed.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Total Claimed</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* ROSE Allocation */}
          <div className="card">
            <h3 className="text-lg font-semibold mb-4">ROSE Allocation</h3>
            <div className="mb-4">
              <div className="flex justify-between text-sm mb-2">
                <span style={{ color: 'var(--text-muted)' }}>Total Staked</span>
                <span className="font-semibold">{parseFloat(stakedRose || 0).toLocaleString()} ROSE</span>
              </div>

              {/* Allocation Bar */}
              <div className="h-4 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                <div className="h-full flex">
                  <div
                    className="h-full"
                    style={{
                      width: `${parseFloat(stakedRose) > 0 ? (parseFloat(allocatedRose) / parseFloat(stakedRose)) * 100 : 0}%`,
                      backgroundColor: 'var(--accent)',
                    }}
                    title="Allocated"
                  />
                </div>
              </div>

              <div className="flex justify-between text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
                <span>Allocated: {parseFloat(allocatedRose || 0).toLocaleString()}</span>
                <span>Available: {parseFloat(unallocatedRose || 0).toLocaleString()}</span>
              </div>
            </div>

            {/* Delegation Status */}
            {isDelegating && (
              <div
                className="p-3 rounded-lg mb-4"
                style={{ backgroundColor: 'rgba(212, 175, 140, 0.1)' }}
              >
                <div className="flex justify-between items-center">
                  <span className="text-sm">Delegating to</span>
                  <span className="font-mono text-sm">
                    {delegatedTo?.slice(0, 6)}...{delegatedTo?.slice(-4)}
                  </span>
                </div>
                <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                  {parseFloat(delegatedAmount).toLocaleString()} ROSE delegated
                </p>
              </div>
            )}

            {/* vROSE Status */}
            <div className="p-3 rounded-lg" style={{ backgroundColor: 'var(--bg-secondary)' }}>
              <div className="flex justify-between items-center">
                <span className="text-sm">vROSE Balance</span>
                <span className="font-semibold">{parseFloat(vRoseBalance || 0).toLocaleString()}</span>
              </div>
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                Used for stakeholder collateral in tasks
              </p>
            </div>
          </div>

          {/* My Votes */}
          <div className="card">
            <h3 className="text-lg font-semibold mb-4">My Votes</h3>

            {proposalsLoading ? (
              <div className="text-center py-8">
                <div className="animate-spin w-6 h-6 border-2 border-accent border-t-transparent rounded-full mx-auto" />
              </div>
            ) : myVotedProposals.length === 0 ? (
              <div className="text-center py-8" style={{ color: 'var(--text-muted)' }}>
                <p className="mb-3">You haven't voted on any proposals yet.</p>
                <Link to="/governance" className="btn-secondary">
                  Browse active proposals &rarr;
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {myVotedProposals.map(proposal => (
                  <Link
                    key={proposal.id}
                    to={`/governance/${proposal.id}`}
                    className="block p-3 rounded-lg hover:bg-bg-tertiary transition-colors"
                    style={{ backgroundColor: 'var(--bg-secondary)' }}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{proposal.title}</p>
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          Proposal #{proposal.id} &middot; {ProposalStatusLabels[proposal.status]}
                        </p>
                      </div>
                      <div className="text-right ml-4">
                        <span
                          className="text-sm font-medium"
                          style={{ color: proposal.userVote?.support ? 'var(--success)' : 'var(--error)' }}
                        >
                          {proposal.userVote?.support ? 'Yay' : 'Nay'}
                        </span>
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          {formatVotePower(parseFloat(proposal.userVote?.votePower || 0))} power
                        </p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* My Proposals */}
          <div className="card">
            <h3 className="text-lg font-semibold mb-4">My Proposals</h3>

            {myCreatedProposals.length === 0 ? (
              <div className="text-center py-8" style={{ color: 'var(--text-muted)' }}>
                <p className="mb-3">You haven't created any proposals yet.</p>
                {canPropose && (
                  <Link to="/governance/propose" className="btn-primary">
                    Create your first proposal &rarr;
                  </Link>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {myCreatedProposals.map(proposal => (
                  <Link
                    key={proposal.id}
                    to={`/governance/${proposal.id}`}
                    className="block p-3 rounded-lg hover:bg-bg-tertiary transition-colors"
                    style={{ backgroundColor: 'var(--bg-secondary)' }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{proposal.title}</p>
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          {parseFloat(proposal.value).toLocaleString()} ROSE
                        </p>
                      </div>
                      <span
                        className="px-2 py-1 rounded text-xs font-medium"
                        style={{
                          backgroundColor: proposal.status === ProposalStatus.Executed
                            ? 'rgba(16, 185, 129, 0.2)'
                            : proposal.status === ProposalStatus.Failed
                            ? 'rgba(239, 68, 68, 0.2)'
                            : 'rgba(212, 175, 140, 0.2)',
                          color: proposal.status === ProposalStatus.Executed
                            ? 'var(--success)'
                            : proposal.status === ProposalStatus.Failed
                            ? 'var(--error)'
                            : 'var(--accent)',
                        }}
                      >
                        {ProposalStatusLabels[proposal.status]}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Eligibility Status */}
          <div className="card">
            <h3 className="text-lg font-semibold mb-4">Eligibility</h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span style={{ color: 'var(--text-muted)' }}>Reputation</span>
                <ReputationBadge
                  score={reputation || 60}
                  tasksCompleted={userStats?.tasksCompleted}
                  disputes={userStats?.disputes}
                  failedProposals={userStats?.failedProposals}
                />
              </div>
              <div className="flex justify-between items-center">
                <span style={{ color: 'var(--text-muted)' }}>Can Vote</span>
                <span style={{ color: canVote ? 'var(--success)' : 'var(--text-muted)' }}>
                  {canVote ? 'Yes' : 'No (70%+ rep needed)'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span style={{ color: 'var(--text-muted)' }}>Can Propose</span>
                <span style={{ color: canPropose ? 'var(--success)' : 'var(--text-muted)' }}>
                  {canPropose ? 'Yes' : 'No (90%+ rep needed)'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span style={{ color: 'var(--text-muted)' }}>Can Receive Delegation</span>
                <span style={{ color: canDelegate ? 'var(--success)' : 'var(--text-muted)' }}>
                  {canDelegate ? 'Yes' : 'No (90%+ rep needed)'}
                </span>
              </div>
            </div>
          </div>

          {/* Delegation Received */}
          {delegatorCount > 0 && (
            <div className="card">
              <h3 className="text-lg font-semibold mb-4">Delegations Received</h3>
              <div className="mb-3">
                <p className="text-2xl font-bold">
                  {formatVotePower(parseFloat(totalDelegatedPower))}
                </p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  from {delegatorCount} delegator{delegatorCount > 1 ? 's' : ''}
                </p>
              </div>
              <div className="space-y-2">
                {myDelegators.slice(0, 5).map(addr => (
                  <div
                    key={addr}
                    className="p-2 rounded text-xs font-mono"
                    style={{ backgroundColor: 'var(--bg-secondary)' }}
                  >
                    {addr.slice(0, 6)}...{addr.slice(-4)}
                  </div>
                ))}
                {delegatorCount > 5 && (
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    +{delegatorCount - 5} more
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Reward History */}
          <div className="card">
            <h3 className="text-lg font-semibold mb-4">Reward History</h3>

            {isLoadingHistory ? (
              <div className="text-center py-4">
                <div className="animate-spin w-5 h-5 border-2 border-accent border-t-transparent rounded-full mx-auto" />
              </div>
            ) : rewardHistory.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                No rewards claimed yet. Vote on passing proposals to earn rewards!
              </p>
            ) : (
              <div className="space-y-2">
                {rewardHistory.slice(0, 5).map((reward, i) => (
                  <div
                    key={i}
                    className="flex justify-between items-center p-2 rounded text-sm"
                    style={{ backgroundColor: 'var(--bg-secondary)' }}
                  >
                    <span style={{ color: 'var(--success)' }}>
                      +{parseFloat(reward.amount).toLocaleString()}
                    </span>
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      Block {reward.blockNumber}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default MyVotesPage;
