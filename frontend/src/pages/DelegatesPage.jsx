/**
 * DelegatesPage - Browse and manage vote delegation
 * Shows eligible delegates, current delegations (multi-delegation), and delegation status
 *
 * VP-centric model: Users delegate VP directly (not ROSE)
 * Multi-delegation: Can delegate to multiple delegates simultaneously
 */

import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAccount, usePublicClient } from 'wagmi';
import { parseAbiItem, formatUnits } from 'viem';
import { CONTRACTS, formatVotePower } from '../constants/contracts';
import RoseGovernanceABI from '../contracts/RoseGovernanceABI.json';
import useDelegation from '../hooks/useDelegation';
import useGovernance from '../hooks/useGovernance';
import DelegateCard from '../components/governance/DelegateCard';
import ReputationBadge from '../components/governance/ReputationBadge';
import WalletNotConnected from '../components/wallet/WalletNotConnected';

const DelegatesPage = () => {
  const { address: account, isConnected } = useAccount();
  const publicClient = usePublicClient();

  const {
    delegations,            // Array of {delegate, vpAmount}
    receivedDelegations,    // Array of {delegator, vpAmount}
    totalReceivedVP,        // Total VP received as delegate
    actionLoading: delegationLoading,
    error,
    setError,
    delegateTo,
    undelegateFrom,
    undelegateAll,
    refetch: refetchDelegations,
  } = useDelegation();

  const {
    availableVP,
    votingPower,
    delegatedOut,
    canDelegate,
    reputation,
    userStats,
  } = useGovernance();

  const [potentialDelegates, setPotentialDelegates] = useState([]);
  const [isLoadingDelegates, setIsLoadingDelegates] = useState(true);
  const [searchAddress, setSearchAddress] = useState('');

  // Calculate total delegated out VP
  const totalDelegatedOutVP = delegations.reduce(
    (sum, d) => sum + parseFloat(d.vpAmount || '0'),
    0
  );

  // Calculate total received VP
  const totalReceivedVPNum = parseFloat(totalReceivedVP || '0');

  // Available VP for delegation
  const availableForDelegation = parseFloat(availableVP || '0');

  // Fetch potential delegates from on-chain events
  useEffect(() => {
    const fetchDelegates = async () => {
      if (!CONTRACTS.GOVERNANCE || !publicClient) return;

      setIsLoadingDelegates(true);
      try {
        // Get addresses that have VP (from VotingPowerChanged events)
        const vpEvents = await publicClient.getLogs({
          address: CONTRACTS.GOVERNANCE,
          event: parseAbiItem('event VotingPowerChanged(address indexed user, uint256 stakedRose, uint256 votingPower, uint256 reputation)'),
          fromBlock: 'earliest',
          toBlock: 'latest',
        });

        // Get unique addresses with VP > 0
        const addressMap = new Map();
        vpEvents.forEach(e => {
          const addr = e.args.user;
          const vp = e.args.votingPower;
          // Only include if VP > 0 (not withdrawn)
          if (vp && vp > 0n) {
            addressMap.set(addr.toLowerCase(), addr);
          } else {
            addressMap.delete(addr.toLowerCase());
          }
        });

        const addresses = [...addressMap.values()];

        // Filter out current user
        const filtered = addresses.filter(
          addr => addr && addr.toLowerCase() !== account?.toLowerCase()
        );

        // Check canDelegate for each address
        const canDelegateResults = await publicClient.multicall({
          contracts: filtered.map(addr => ({
            address: CONTRACTS.GOVERNANCE,
            abi: RoseGovernanceABI,
            functionName: 'canDelegate',
            args: [addr],
          })),
        });

        // Keep only addresses that can receive delegation
        const eligibleDelegates = filtered.filter((addr, index) => {
          return canDelegateResults[index].result === true;
        });

        setPotentialDelegates(eligibleDelegates);
      } catch (err) {
        console.error('Error fetching potential delegates:', err);
        // Fallback: try to get from Deposited events if VotingPowerChanged doesn't exist yet
        try {
          const depositEvents = await publicClient.getLogs({
            address: CONTRACTS.GOVERNANCE,
            event: parseAbiItem('event Deposited(address indexed user, uint256 amount)'),
            fromBlock: 'earliest',
            toBlock: 'latest',
          });

          const addresses = [...new Set(depositEvents.map(e => e.args.user))];
          const filtered = addresses.filter(
            addr => addr && addr.toLowerCase() !== account?.toLowerCase()
          );
          setPotentialDelegates(filtered);
        } catch (fallbackErr) {
          console.error('Fallback also failed:', fallbackErr);
        }
      } finally {
        setIsLoadingDelegates(false);
      }
    };

    fetchDelegates();
  }, [CONTRACTS.GOVERNANCE, publicClient, account]);

  // Get user's delegation to a specific delegate
  const getDelegationToDelegate = (delegateAddr) => {
    const delegation = (delegations || []).find(
      d => d.delegate?.toLowerCase() === delegateAddr.toLowerCase()
    );
    return delegation?.vpAmount || '0';
  };

  const handleDelegate = async (address, vpAmount) => {
    try {
      await delegateTo(address, vpAmount);
      await refetchDelegations();
    } catch (err) {
      console.error('Delegation failed:', err);
    }
  };

  const handleUndelegate = async (address, vpAmount) => {
    try {
      await undelegateFrom(address, vpAmount);
      await refetchDelegations();
    } catch (err) {
      console.error('Undelegation failed:', err);
    }
  };

  const handleUndelegateAll = async () => {
    try {
      await undelegateAll();
      await refetchDelegations();
    } catch (err) {
      console.error('Undelegate all failed:', err);
    }
  };

  // Search for specific address
  const handleSearch = (e) => {
    e.preventDefault();
    if (searchAddress && searchAddress.startsWith('0x') && searchAddress.length === 42) {
      const lowerSearch = searchAddress.toLowerCase();
      if (!potentialDelegates.some(addr => addr.toLowerCase() === lowerSearch)) {
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
          Delegate your VP to trusted community members or receive delegations
        </p>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Current Delegations Summary */}
          {delegations.length > 0 && (
            <div className="card">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-semibold">Your Active Delegations</h3>
                {delegations.length > 1 && (
                  <button
                    onClick={handleUndelegateAll}
                    disabled={delegationLoading?.undelegateAll}
                    className="text-sm px-3 py-1 rounded"
                    style={{
                      backgroundColor: 'rgba(239, 68, 68, 0.1)',
                      color: 'var(--error)',
                    }}
                  >
                    {delegationLoading?.undelegateAll ? 'Removing...' : 'Remove All'}
                  </button>
                )}
              </div>

              <div className="space-y-3">
                {(delegations || []).filter(d => d && d.delegate).map(({ delegate, vpAmount }) => (
                  <div
                    key={delegate}
                    className="p-3 rounded-lg flex items-center justify-between"
                    style={{ backgroundColor: 'var(--bg-secondary)' }}
                  >
                    <div>
                      <p className="font-mono text-sm">
                        {delegate?.slice(0, 6)}...{delegate?.slice(-4)}
                      </p>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {formatVotePower(parseFloat(vpAmount))} VP delegated
                      </p>
                    </div>
                    <button
                      onClick={() => handleUndelegate(delegate, vpAmount)}
                      disabled={delegationLoading?.undelegate}
                      className="text-xs px-2 py-1 rounded"
                      style={{
                        backgroundColor: 'rgba(239, 68, 68, 0.1)',
                        color: 'var(--error)',
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>

              <div className="mt-4 pt-4 border-t flex justify-between" style={{ borderColor: 'var(--border-color)' }}>
                <span style={{ color: 'var(--text-muted)' }}>Total Delegated Out</span>
                <span className="font-semibold">{formatVotePower(totalDelegatedOutVP)} VP</span>
              </div>
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
                  No eligible delegates found. Users need 90%+ reputation and 10+ completed tasks.
                </p>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-4">
                {potentialDelegates.map(address => (
                  <DelegateCard
                    key={address}
                    address={address}
                    onDelegate={handleDelegate}
                    onUndelegate={handleUndelegate}
                    loading={delegationLoading?.delegate || delegationLoading?.undelegate}
                    currentDelegatedVP={getDelegationToDelegate(address)}
                    availableVP={availableForDelegation.toString()}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Your VP Summary */}
          <div className="card">
            <h3 className="text-lg font-semibold mb-4">Your VP Summary</h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span style={{ color: 'var(--text-muted)' }}>Total VP</span>
                <span className="font-semibold">{formatVotePower(parseFloat(votingPower || '0'))} VP</span>
              </div>
              <div className="flex justify-between items-center">
                <span style={{ color: 'var(--text-muted)' }}>Delegated Out</span>
                <span className="text-yellow-500">{formatVotePower(parseFloat(delegatedOut || '0'))} VP</span>
              </div>
              <div className="flex justify-between items-center">
                <span style={{ color: 'var(--text-muted)' }}>Available</span>
                <span className="text-green-500">{formatVotePower(availableForDelegation)} VP</span>
              </div>
            </div>
          </div>

          {/* Your Delegation Status */}
          <div className="card">
            <h3 className="text-lg font-semibold mb-4">Delegate Status</h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span style={{ color: 'var(--text-muted)' }}>Can Receive</span>
                <span style={{ color: canDelegate ? 'var(--success)' : 'var(--text-muted)' }}>
                  {canDelegate ? 'Yes' : 'No'}
                </span>
              </div>
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
                <span style={{ color: 'var(--text-muted)' }}>Delegators</span>
                <span className="font-semibold">{receivedDelegations.length}</span>
              </div>
              <div className="flex justify-between items-center">
                <span style={{ color: 'var(--text-muted)' }}>Received VP</span>
                <span className="text-green-500 font-semibold">{formatVotePower(totalReceivedVPNum)} VP</span>
              </div>
            </div>

            {!canDelegate && (
              <div
                className="mt-4 p-3 rounded-lg text-sm"
                style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-muted)' }}
              >
                Need 90%+ reputation and 10+ completed tasks to receive delegations.
              </div>
            )}
          </div>

          {/* Your Delegators */}
          {receivedDelegations.length > 0 && (
            <div className="card">
              <h3 className="text-lg font-semibold mb-4">Your Delegators</h3>
              <div className="space-y-2">
                {(receivedDelegations || []).filter(d => d && d.delegator).map(({ delegator, vpAmount }) => (
                  <div
                    key={delegator}
                    className="p-2 rounded-lg flex justify-between items-center text-sm"
                    style={{ backgroundColor: 'var(--bg-secondary)' }}
                  >
                    <span className="font-mono">
                      {delegator?.slice(0, 6)}...{delegator?.slice(-4)}
                    </span>
                    <span className="text-green-500">
                      {formatVotePower(parseFloat(vpAmount))} VP
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Info Box */}
          <div className="card text-sm" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-muted)' }}>
            <strong>How Delegation Works:</strong>
            <ul className="mt-2 list-disc list-inside space-y-1">
              <li>Delegate VP to trusted community members</li>
              <li>Can delegate to multiple delegates</li>
              <li>Delegates vote on proposals using received VP</li>
              <li>Rewards go to delegators (you), not delegates</li>
              <li>Can add or remove VP anytime</li>
              <li>90%+ rep + 10 tasks to receive delegation</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DelegatesPage;
