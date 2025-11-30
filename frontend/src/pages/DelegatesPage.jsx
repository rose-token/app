/**
 * DelegatesPage - Browse and manage vote delegation
 * Shows eligible delegates and current delegation status
 */

import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAccount, usePublicClient } from 'wagmi';
import { parseAbiItem } from 'viem';
import { CONTRACTS } from '../constants/contracts';
import useDelegation from '../hooks/useDelegation';
import useGovernance from '../hooks/useGovernance';
import DelegateCard from '../components/governance/DelegateCard';
import ReputationBadge from '../components/governance/ReputationBadge';
import WalletNotConnected from '../components/wallet/WalletNotConnected';

const DelegatesPage = () => {
  const { address: account, isConnected } = useAccount();
  const publicClient = usePublicClient();

  const {
    delegatedTo,
    delegatedAmount,
    isDelegating,
    totalDelegatedPower,
    canDelegate,
    myDelegators,
    delegatorCount,
    actionLoading,
    error,
    setError,
    delegateTo,
    undelegate,
  } = useDelegation();

  const { reputation, userStats } = useGovernance();

  const [potentialDelegates, setPotentialDelegates] = useState([]);
  const [isLoadingDelegates, setIsLoadingDelegates] = useState(true);
  const [searchAddress, setSearchAddress] = useState('');

  // Fetch potential delegates from on-chain events
  useEffect(() => {
    const fetchDelegates = async () => {
      if (!CONTRACTS.GOVERNANCE || !publicClient) return;

      setIsLoadingDelegates(true);
      try {
        // Get addresses that have staked (potential delegates)
        const depositEvents = await publicClient.getLogs({
          address: CONTRACTS.GOVERNANCE,
          event: parseAbiItem('event Deposited(address indexed user, uint256 amount)'),
          fromBlock: 'earliest',
          toBlock: 'latest',
        });

        // Get unique addresses
        const addresses = [...new Set(depositEvents.map(e => e.args.user))];

        // Filter out current user
        const filtered = addresses.filter(
          addr => addr && addr.toLowerCase() !== account?.toLowerCase()
        );

        setPotentialDelegates(filtered);
      } catch (err) {
        console.error('Error fetching potential delegates:', err);
      } finally {
        setIsLoadingDelegates(false);
      }
    };

    fetchDelegates();
  }, [CONTRACTS.GOVERNANCE, publicClient, account]);

  const handleDelegate = async (address, amount) => {
    try {
      await delegateTo(address, amount);
    } catch (err) {
      console.error('Delegation failed:', err);
    }
  };

  const handleUndelegate = async () => {
    try {
      await undelegate();
    } catch (err) {
      console.error('Undelegation failed:', err);
    }
  };

  // Search for specific address
  const handleSearch = (e) => {
    e.preventDefault();
    if (searchAddress && searchAddress.startsWith('0x') && searchAddress.length === 42) {
      if (!potentialDelegates.includes(searchAddress)) {
        setPotentialDelegates(prev => [searchAddress, ...prev]);
      }
    }
    setSearchAddress('');
  };

  if (!isConnected) {
    return (
      <div className="animate-fade-in">
        <WalletNotConnected />
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      {/* Back Link */}
      <Link
        to="/governance"
        className="inline-flex items-center gap-1 text-sm mb-6 hover:text-accent transition-colors"
        style={{ color: 'var(--text-muted)' }}
      >
        &larr; Back to Governance
      </Link>

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Delegation</h1>
        <p style={{ color: 'var(--text-muted)' }}>
          Delegate your voting power or receive delegations from others
        </p>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Current Delegation Status */}
          {isDelegating && (
            <div
              className="card"
              style={{ backgroundColor: 'rgba(212, 175, 140, 0.1)', borderColor: 'var(--accent)' }}
            >
              <h3 className="font-semibold mb-3">Currently Delegating</h3>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Delegating to</p>
                  <p className="font-mono text-sm">
                    {delegatedTo?.slice(0, 6)}...{delegatedTo?.slice(-4)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Amount</p>
                  <p className="font-semibold">{parseFloat(delegatedAmount).toLocaleString()} ROSE</p>
                </div>
              </div>
              <button
                onClick={handleUndelegate}
                disabled={actionLoading.undelegate}
                className="btn-secondary w-full"
              >
                {actionLoading.undelegate ? 'Undelegating...' : 'Remove Delegation'}
              </button>
            </div>
          )}

          {/* Error Display */}
          {error && (
            <div
              className="p-4 rounded-lg flex justify-between items-center"
              style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: 'var(--error)' }}
            >
              <span>{error}</span>
              <button onClick={() => setError(null)} className="font-bold">&times;</button>
            </div>
          )}

          {/* Search */}
          <div className="card">
            <h3 className="font-semibold mb-3">Find Delegate</h3>
            <form onSubmit={handleSearch} className="flex gap-2">
              <input
                type="text"
                value={searchAddress}
                onChange={(e) => setSearchAddress(e.target.value)}
                placeholder="Enter wallet address (0x...)"
                className="flex-1 px-4 py-2 rounded-lg"
                style={{
                  backgroundColor: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-color)',
                }}
              />
              <button type="submit" className="btn-primary">
                Search
              </button>
            </form>
          </div>

          {/* Potential Delegates List */}
          <div>
            <h3 className="text-lg font-semibold mb-4">Available Delegates</h3>

            {isLoadingDelegates ? (
              <div className="text-center py-8">
                <div className="animate-spin w-8 h-8 border-2 border-accent border-t-transparent rounded-full mx-auto mb-4" />
                <p style={{ color: 'var(--text-muted)' }}>Loading delegates...</p>
              </div>
            ) : potentialDelegates.length === 0 ? (
              <div className="card text-center py-8">
                <p style={{ color: 'var(--text-muted)' }}>
                  No eligible delegates found. Users need 90%+ reputation to receive delegation.
                </p>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-4">
                {potentialDelegates.map(address => (
                  <DelegateCard
                    key={address}
                    address={address}
                    onDelegate={handleDelegate}
                    loading={actionLoading.delegate}
                    isCurrentDelegate={delegatedTo?.toLowerCase() === address?.toLowerCase()}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Your Delegation Stats */}
          <div className="card">
            <h3 className="text-lg font-semibold mb-4">Your Delegation Status</h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span style={{ color: 'var(--text-muted)' }}>Can Receive Delegation</span>
                <span style={{ color: canDelegate ? 'var(--success)' : 'var(--text-muted)' }}>
                  {canDelegate ? 'Yes' : 'No'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span style={{ color: 'var(--text-muted)' }}>Your Reputation</span>
                <ReputationBadge
                  score={reputation || 60}
                  tasksCompleted={userStats?.tasksCompleted}
                  disputes={userStats?.disputes}
                  failedProposals={userStats?.failedProposals}
                />
              </div>
              <div className="flex justify-between items-center">
                <span style={{ color: 'var(--text-muted)' }}>Delegators to You</span>
                <span className="font-semibold">{delegatorCount}</span>
              </div>
              <div className="flex justify-between items-center">
                <span style={{ color: 'var(--text-muted)' }}>Power Received</span>
                <span className="font-semibold">{parseFloat(totalDelegatedPower).toLocaleString()}</span>
              </div>
            </div>

            {!canDelegate && (
              <div
                className="mt-4 p-3 rounded-lg text-sm"
                style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-muted)' }}
              >
                Earn 90%+ reputation to receive delegations from others.
              </div>
            )}
          </div>

          {/* Your Delegators */}
          {delegatorCount > 0 && (
            <div className="card">
              <h3 className="text-lg font-semibold mb-4">Your Delegators</h3>
              <div className="space-y-2">
                {myDelegators.map(addr => (
                  <div
                    key={addr}
                    className="p-2 rounded-lg text-sm font-mono"
                    style={{ backgroundColor: 'var(--bg-secondary)' }}
                  >
                    {addr.slice(0, 6)}...{addr.slice(-4)}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Info Box */}
          <div className="card text-sm" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-muted)' }}>
            <strong>How Delegation Works:</strong>
            <ul className="mt-2 list-disc list-inside space-y-1">
              <li>Allocate staked ROSE to a delegate</li>
              <li>Delegate votes on your behalf</li>
              <li>Your reputation amplifies delegated power</li>
              <li>Can undelegate anytime</li>
              <li>No chaining (delegates can't re-delegate)</li>
              <li>90%+ reputation required to receive delegation</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DelegatesPage;
