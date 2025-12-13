/**
 * GovernancePage - Main governance dashboard
 * Lists proposals, shows governance stats, and provides quick access to key actions
 */

import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { ProposalStatus } from '../constants/contracts';
import useProposals from '../hooks/useProposals';
import useGovernance from '../hooks/useGovernance';
import ProposalCard from '../components/governance/ProposalCard';
import ProposalFilters from '../components/governance/ProposalFilters';
import StakingPanel from '../components/governance/StakingPanel';
import ClaimRewardsPanel from '../components/governance/ClaimRewardsPanel';
import ReputationBadge from '../components/governance/ReputationBadge';
import VPAllocationDashboard from '../components/governance/VPAllocationDashboard';
import WalletNotConnected from '../components/wallet/WalletNotConnected';
import { usePassport } from '../hooks/usePassport';
import { PASSPORT_THRESHOLDS } from '../constants/passport';

const GovernancePage = () => {
  const { isConnected } = useAccount();
  const {
    proposals,
    proposalCount,
    activeProposals,
    passedProposals,
    executedProposals,
    failedProposals,
    isLoading,
    error,
  } = useProposals();

  const {
    stakedRose,
    reputation,
    canPropose,
    userStats,
  } = useGovernance();

  const { score: passportScore, loading: passportLoading } = usePassport();

  // Combined eligibility: must have 90%+ reputation AND 25+ passport score
  const meetsPassportThreshold = passportScore !== null && passportScore >= PASSPORT_THRESHOLDS.PROPOSE;
  const canCreateProposal = canPropose && meetsPassportThreshold;

  const [filters, setFilters] = useState({
    status: 'all',
    sort: 'newest',
    myProposals: false,
    myVotes: false,
  });

  // Filter and sort proposals
  const filteredProposals = useMemo(() => {
    let result = [...proposals];

    // Filter by status
    if (filters.status !== 'all') {
      result = result.filter(p => p.status === filters.status);
    }

    // Filter by user involvement
    if (filters.myProposals) {
      result = result.filter(p => p.isProposer);
    }
    if (filters.myVotes) {
      result = result.filter(p => p.hasVoted);
    }

    // Sort
    switch (filters.sort) {
      case 'oldest':
        result.sort((a, b) => a.createdAt - b.createdAt);
        break;
      case 'valueHigh':
        result.sort((a, b) => parseFloat(b.value) - parseFloat(a.value));
        break;
      case 'valueLow':
        result.sort((a, b) => parseFloat(a.value) - parseFloat(b.value));
        break;
      case 'endingSoon':
        result.sort((a, b) => {
          if (a.status !== ProposalStatus.Active) return 1;
          if (b.status !== ProposalStatus.Active) return -1;
          return a.timeRemaining - b.timeRemaining;
        });
        break;
      default: // newest
        result.sort((a, b) => b.createdAt - a.createdAt);
    }

    return result;
  }, [proposals, filters]);

  // Calculate governance stats
  const totalValue = proposals.reduce((sum, p) => sum + parseFloat(p.value), 0);
  const passRate = proposalCount > 0
    ? ((executedProposals.length / proposalCount) * 100).toFixed(0)
    : 0;

  return (
    <div className="animate-page-entrance">
      {/* Header */}
      <div className="mb-8 text-center">
        <h1 className="font-display text-4xl font-medium tracking-tight mb-2" style={{ letterSpacing: '-0.03em' }}>
          Liquid Democratic <span className="gradient-text">Governance</span>
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '1.0625rem' }}>
          Shape the Future of the Rose Token Ecosystem
        </p>
      </div>

      {!isConnected ? (
        <WalletNotConnected />
      ) : (
        <div className="grid lg:grid-cols-3 gap-6">
          {/* Main Content - Proposals List */}
          <div className="lg:col-span-2 space-y-6">
            {/* Stats Bar */}
            <div className="grid grid-cols-4 gap-4">
              <div className="card text-center py-4">
                <p className="text-2xl font-bold">{activeProposals.length}</p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Active</p>
              </div>
              <div className="card text-center py-4">
                <p className="text-2xl font-bold">{proposalCount}</p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Total</p>
              </div>
              <div className="card text-center py-4">
                <p className="text-2xl font-bold">{passRate}%</p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Pass Rate</p>
              </div>
              <div className="card text-center py-4">
                <p className="text-2xl font-bold gradient-text">
                  {totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>ROSE Value</p>
              </div>
            </div>

            {/* Create Proposal CTA */}
            <div
              className="card flex items-center justify-between"
              style={{
                    background: 'var(--card-accent-bg)',
                    border: '1px solid var(--card-accent-border)'
                    }}
            >
              <div>
                <h3 className="font-semibold mb-1" style={{ color: 'var(--rose-gold-light)'}} >Have an idea?</h3>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  {canCreateProposal
                    ? 'Create a proposal to fund work from the DAO treasury'
                    : !canPropose
                      ? 'Earn 90%+ reputation to create proposals'
                      : 'Build your Passport score to 25+ to create proposals'}
                </p>
              </div>
              <Link
                to="/governance/propose"
                className={`btn-primary ${!canCreateProposal ? 'opacity-50 cursor-not-allowed' : ''}`}
                onClick={(e) => !canCreateProposal && e.preventDefault()}
              >
                {passportLoading ? 'Checking...' : 'Create Proposal'}
              </Link>
            </div>

            {/* Filters */}
            <ProposalFilters filters={filters} setFilters={setFilters} />

            {/* Proposals List */}
            {isLoading ? (
              <div className="text-center py-12">
                <div className="animate-spin w-8 h-8 border-2 border-accent border-t-transparent rounded-full mx-auto mb-4" />
                <p style={{ color: 'var(--text-muted)' }}>Loading proposals...</p>
              </div>
            ) : error ? (
              <div className="card text-center py-8" style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)' }}>
                <p style={{ color: 'var(--error)' }}>{error}</p>
              </div>
            ) : filteredProposals.length === 0 ? (
              <div className="card text-center py-8">
                <p className="mb-2">No proposals found</p>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  {proposals.length === 0
                    ? 'Be the first to create a proposal!'
                    : 'Try adjusting your filters'}
                </p>
              </div>
            ) : (
              <div className="grid gap-4">
                {filteredProposals.map(proposal => (
                  <ProposalCard key={proposal.id} proposal={proposal} />
                ))}
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* User's Governance Position */}
            <div className="card">
              <h3 className="text-lg font-semibold mb-4">Your Position</h3>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span style={{ color: 'var(--text-muted)' }}>Staked ROSE</span>
                  <span className="font-semibold">
                    {parseFloat(stakedRose || 0).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span style={{ color: 'var(--text-muted)' }}>Reputation</span>
                  <ReputationBadge
                    score={reputation || 60}
                    size="sm"
                    tasksCompleted={userStats?.tasksCompleted}
                    disputes={userStats?.disputes}
                    failedProposals={userStats?.failedProposals}
                  />
                </div>
                <div className="flex justify-between items-center">
                  <span style={{ color: 'var(--text-muted)' }}>Can Propose</span>
                  <span style={{ color: canPropose ? 'var(--success)' : 'var(--text-muted)' }}>
                    {canPropose ? 'Yes' : 'No'}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span style={{ color: 'var(--text-muted)' }}>Passport Score</span>
                  <span style={{ color: meetsPassportThreshold ? 'var(--success)' : 'var(--text-muted)' }}>
                    {passportLoading ? '...' : passportScore !== null ? passportScore.toFixed(1) : 'N/A'}
                  </span>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--border-color)' }}>
                <Link
                  to="/governance/my-votes"
                  className="btn-secondary text-sm w-full"
                >
                  View My Votes &rarr;
                </Link>
              </div>
            </div>

            {/* VP Allocation Dashboard (Slow Track) */}
            <VPAllocationDashboard />

            {/* Staking Panel */}
            <StakingPanel />

            {/* Claim Rewards Panel */}
            <ClaimRewardsPanel />

            {/* Quick Links */}
            <div className="card">
              <h3 className="text-lg font-semibold mb-4">Quick Links</h3>
              <div className="space-y-3">
                <Link
                  to="/delegates"
                  className="btn-secondary w-full text-left"
                >
                  Browse Delegates &rarr;
                </Link>
                <Link
                  to="/governance/my-votes"
                  className="btn-secondary w-full text-left"
                >
                  My Votes &rarr;
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default GovernancePage;
