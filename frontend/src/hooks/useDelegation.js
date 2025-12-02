/**
 * Delegation hook for managing VP delegation (multi-delegation support)
 * Handles delegating VP to multiple delegates and receiving delegations
 *
 * VP-centric model: Users delegate VP (not ROSE). VP can be split across
 * multiple delegates. Each delegator-delegate pair has its own VP amount.
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useAccount, useReadContracts, useWriteContract, usePublicClient, useWatchContractEvent } from 'wagmi';
import { formatUnits, parseUnits } from 'viem';
import RoseGovernanceABI from '../contracts/RoseGovernanceABI.json';
import { CONTRACTS } from '../constants/contracts';
import { GAS_SETTINGS } from '../constants/gas';

// Backend signer URL
const SIGNER_URL = import.meta.env.VITE_PASSPORT_SIGNER_URL || 'http://localhost:3001';

/**
 * Hook for managing VP delegation (multi-delegation)
 * @returns {Object} Delegation state and actions
 */
export const useDelegation = () => {
  const { address: account, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  // Multi-delegation: array of {delegate, vpAmount}
  const [delegations, setDelegations] = useState([]);
  // Delegators who delegated to this user: array of {delegator, vpAmount}
  const [receivedDelegations, setReceivedDelegations] = useState([]);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionLoading, setActionLoading] = useState({});

  // Claimable rewards state
  const [claimableRewards, setClaimableRewards] = useState(null);
  const [claimableLoading, setClaimableLoading] = useState(false);

  // Get user's VP and delegation info from contract
  const { data: delegationData, refetch: refetchDelegation } = useReadContracts({
    contracts: [
      // User's voting power
      {
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'votingPower',
        args: [account],
      },
      // Total VP delegated out by user
      {
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'totalDelegatedOut',
        args: [account],
      },
      // Total VP delegated TO user (received)
      {
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'totalDelegatedIn',
        args: [account],
      },
      // User's available VP
      {
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'getAvailableVP',
        args: [account],
      },
      // User's staked ROSE
      {
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'stakedRose',
        args: [account],
      },
      // Check if user can be a delegate
      {
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'canDelegate',
        args: [account],
      },
      // User's reputation
      {
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'getReputation',
        args: [account],
      },
      // VP locked to proposal
      {
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'proposalVPLocked',
        args: [account],
      },
    ],
    query: {
      enabled: isConnected && !!account && !!CONTRACTS.GOVERNANCE,
    },
  });

  /**
   * Fetch user's delegations from backend API
   */
  const fetchDelegations = useCallback(async () => {
    if (!account) return;

    try {
      const response = await fetch(`${SIGNER_URL}/api/governance/delegations/${account}`);
      if (response.ok) {
        const data = await response.json();
        setDelegations(data.delegations || []);
      }
    } catch (err) {
      console.error('Failed to fetch delegations:', err);
    }
  }, [account]);

  /**
   * Fetch delegations received by user (if they're a delegate)
   */
  const fetchReceivedDelegations = useCallback(async () => {
    if (!account) return;

    try {
      const response = await fetch(`${SIGNER_URL}/api/governance/received/${account}`);
      if (response.ok) {
        const data = await response.json();
        setReceivedDelegations(data.delegators || []);
      }
    } catch (err) {
      console.error('Failed to fetch received delegations:', err);
    }
  }, [account]);

  // Fetch delegations on mount and account change
  useEffect(() => {
    if (account) {
      fetchDelegations();
      fetchReceivedDelegations();
      setIsLoading(false);
    }
  }, [account, fetchDelegations, fetchReceivedDelegations]);

  // Parse delegation data from contract
  const parsedDelegation = useMemo(() => {
    if (!delegationData) return null;

    const getResult = (index) => {
      const result = delegationData[index];
      return result?.status === 'success' ? result.result : null;
    };

    const votingPower = getResult(0) || 0n;
    const totalDelegatedOut = getResult(1) || 0n;
    const totalDelegatedIn = getResult(2) || 0n;
    const availableVP = getResult(3) || 0n;
    const stakedRose = getResult(4) || 0n;
    const canDelegate = getResult(5) || false;
    const reputation = getResult(6) || 6000n;
    const proposalVPLocked = getResult(7) || 0n;

    // Calculate total received VP (for display)
    const totalReceivedVP = receivedDelegations.reduce(
      (sum, d) => sum + BigInt(d.vpAmount || '0'),
      0n
    );

    return {
      // VP data
      votingPower: formatUnits(votingPower, 18),
      votingPowerRaw: votingPower,
      availableVP: formatUnits(availableVP, 18),
      availableVPRaw: availableVP,
      totalDelegatedOut: formatUnits(totalDelegatedOut, 18),
      totalDelegatedOutRaw: totalDelegatedOut,
      totalDelegatedIn: formatUnits(totalDelegatedIn, 18),
      totalDelegatedInRaw: totalDelegatedIn,
      proposalVPLocked: formatUnits(proposalVPLocked, 18),
      proposalVPLockedRaw: proposalVPLocked,

      // Staking data
      stakedRose: formatUnits(stakedRose, 18),
      stakedRoseRaw: stakedRose,

      // Eligibility
      canDelegate,
      reputation: Number(reputation),
      reputationRaw: Number(reputation),

      // Delegation arrays
      delegations, // Outgoing delegations
      receivedDelegations, // Incoming delegations
      totalReceivedVP: formatUnits(totalReceivedVP, 18),
      totalReceivedVPRaw: totalReceivedVP,
      delegatorCount: receivedDelegations.length,

      // Legacy compatibility
      isDelegating: delegations.length > 0,
    };
  }, [delegationData, delegations, receivedDelegations]);

  // Watch for delegation events
  useWatchContractEvent({
    address: CONTRACTS.GOVERNANCE,
    abi: RoseGovernanceABI,
    eventName: 'DelegationChanged',
    onLogs: () => {
      refetchDelegation();
      fetchDelegations();
      fetchReceivedDelegations();
    },
    enabled: !!CONTRACTS.GOVERNANCE,
  });

  /**
   * Delegate VP to another user (multi-delegation)
   * @param {string} delegateAddress - Address to delegate to
   * @param {string} vpAmount - Amount of VP to delegate
   */
  const delegateTo = useCallback(async (delegateAddress, vpAmount) => {
    if (!isConnected || !CONTRACTS.GOVERNANCE) {
      throw new Error('Not connected');
    }

    setActionLoading(prev => ({ ...prev, delegate: true }));
    setError(null);

    try {
      const vpWei = parseUnits(vpAmount, 18);

      // Validate
      if (delegateAddress.toLowerCase() === account.toLowerCase()) {
        throw new Error('Cannot delegate to yourself');
      }

      if (parsedDelegation && vpWei > parsedDelegation.availableVPRaw) {
        throw new Error('Insufficient available VP');
      }

      console.log(`Delegating ${vpAmount} VP to ${delegateAddress}...`);
      const hash = await writeContractAsync({
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'delegate',
        args: [delegateAddress, vpWei],
        ...GAS_SETTINGS,
      });

      await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: 1,
      });

      console.log('Delegation successful!');
      await Promise.all([
        refetchDelegation(),
        fetchDelegations(),
      ]);
      return { success: true, hash };
    } catch (err) {
      console.error('Delegate error:', err);
      const message = err.message.includes('User rejected')
        ? 'Transaction rejected'
        : err.message.includes('CannotDelegateToSelf')
        ? 'Cannot delegate to yourself'
        : err.message.includes('InsufficientAvailableVP')
        ? 'Insufficient available VP'
        : err.message.includes('IneligibleToDelegate')
        ? 'Target user is not eligible to receive delegation'
        : err.message.includes('DelegateIneligible')
        ? 'Target has insufficient reputation to be a delegate'
        : err.message;
      setError(message);
      throw new Error(message);
    } finally {
      setActionLoading(prev => ({ ...prev, delegate: false }));
    }
  }, [isConnected, account, parsedDelegation, writeContractAsync, publicClient, refetchDelegation, fetchDelegations]);

  /**
   * Remove delegation from a specific delegate (partial undelegate)
   * @param {string} delegateAddress - Address to undelegate from
   * @param {string} vpAmount - Amount of VP to undelegate
   */
  const undelegateFrom = useCallback(async (delegateAddress, vpAmount) => {
    if (!isConnected || !CONTRACTS.GOVERNANCE) {
      throw new Error('Not connected');
    }

    setActionLoading(prev => ({ ...prev, [`undelegate-${delegateAddress}`]: true }));
    setError(null);

    try {
      const vpWei = parseUnits(vpAmount, 18);

      console.log(`Undelegating ${vpAmount} VP from ${delegateAddress}...`);
      const hash = await writeContractAsync({
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'undelegate',
        args: [delegateAddress, vpWei],
        ...GAS_SETTINGS,
      });

      await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: 1,
      });

      console.log('Undelegation successful!');
      await Promise.all([
        refetchDelegation(),
        fetchDelegations(),
      ]);
      return { success: true, hash };
    } catch (err) {
      console.error('Undelegate error:', err);
      const message = err.message.includes('User rejected')
        ? 'Transaction rejected'
        : err.message.includes('InsufficientDelegated')
        ? 'Insufficient delegated amount to undelegate'
        : err.message;
      setError(message);
      throw new Error(message);
    } finally {
      setActionLoading(prev => ({ ...prev, [`undelegate-${delegateAddress}`]: false }));
    }
  }, [isConnected, writeContractAsync, publicClient, refetchDelegation, fetchDelegations]);

  /**
   * Remove all delegation to a delegate
   * @param {string} delegateAddress - Address to fully undelegate from
   */
  const undelegateAll = useCallback(async (delegateAddress) => {
    // Find the delegation to this delegate
    const delegation = delegations.find(
      d => d.delegate.toLowerCase() === delegateAddress.toLowerCase()
    );

    if (!delegation) {
      throw new Error('No delegation found to this delegate');
    }

    return undelegateFrom(delegateAddress, formatUnits(BigInt(delegation.vpAmount), 18));
  }, [delegations, undelegateFrom]);

  /**
   * Cast delegated votes on a proposal
   * Uses backend signing for allocation computation
   * @param {number} proposalId - Proposal ID
   * @param {string} vpAmount - Amount of delegated VP to use
   * @param {boolean} support - true for Yay, false for Nay
   */
  const castDelegatedVote = useCallback(async (proposalId, vpAmount, support) => {
    if (!isConnected || !CONTRACTS.GOVERNANCE) {
      throw new Error('Not connected');
    }

    setActionLoading(prev => ({ ...prev, [`delegatedVote-${proposalId}`]: true }));
    setError(null);

    try {
      const vpWei = parseUnits(vpAmount, 18);

      console.log(`Requesting delegated vote signature for ${vpAmount} VP on proposal ${proposalId}...`);

      // Step 1: Get signature from backend
      const response = await fetch(`${SIGNER_URL}/api/delegation/vote-signature`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          delegate: account,
          proposalId: Number(proposalId),
          amount: vpWei.toString(),
          support,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Backend error: ${response.status}`);
      }

      const signatureData = await response.json();
      console.log('Got signature from backend:', signatureData);

      // Store allocations for reference
      try {
        const storageKey = `delegatedVoteAllocations_${proposalId}_${account}`;
        localStorage.setItem(storageKey, JSON.stringify(signatureData.allocations));
      } catch (storageErr) {
        console.warn('Failed to store allocations:', storageErr);
      }

      // Step 2: Call contract with signature
      console.log(`Casting delegated vote ${support ? 'Yay' : 'Nay'} with ${vpAmount} VP...`);
      const hash = await writeContractAsync({
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'castDelegatedVote',
        args: [
          BigInt(proposalId),
          BigInt(signatureData.amount),
          support,
          signatureData.allocationsHash,
          BigInt(signatureData.expiry),
          signatureData.signature,
        ],
        ...GAS_SETTINGS,
      });

      await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: 1,
      });

      console.log('Delegated vote cast successfully!');
      await refetchDelegation();
      return { success: true, hash, allocations: signatureData.allocations };
    } catch (err) {
      console.error('Delegated vote error:', err);
      const message = err.message.includes('User rejected')
        ? 'Transaction rejected'
        : err.message.includes('InsufficientDelegatedPower')
        ? 'Insufficient delegated VP available'
        : err.message.includes('CannotChangeVoteDirection')
        ? 'Cannot change vote direction on existing vote'
        : err.message.includes('Proposal is not active')
        ? 'Proposal is not active or voting has ended'
        : err.message.includes('InvalidDelegationSignature')
        ? 'Invalid signature - please try again'
        : err.message.includes('SignatureExpired')
        ? 'Signature expired - please try again'
        : err.message || 'Failed to cast delegated vote';
      setError(message);
      throw new Error(message);
    } finally {
      setActionLoading(prev => ({ ...prev, [`delegatedVote-${proposalId}`]: false }));
    }
  }, [isConnected, account, writeContractAsync, publicClient, refetchDelegation]);

  /**
   * Fetch claimable voter rewards from backend
   */
  const fetchClaimableRewards = useCallback(async () => {
    if (!account) return;

    setClaimableLoading(true);
    try {
      const res = await fetch(`${SIGNER_URL}/api/delegation/claimable/${account}`);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to fetch claimable rewards');
      }
      const data = await res.json();
      setClaimableRewards(data);
    } catch (error) {
      console.error('Failed to fetch claimable rewards:', error);
      setClaimableRewards(null);
    } finally {
      setClaimableLoading(false);
    }
  }, [account]);

  /**
   * Claim all pending voter rewards
   */
  const claimAllRewards = useCallback(async () => {
    if (!isConnected || !account) {
      throw new Error('Not connected');
    }

    setActionLoading(prev => ({ ...prev, claimRewards: true }));
    setError(null);

    try {
      console.log('Requesting claim signature from backend...');

      // Get signature from backend
      const response = await fetch(`${SIGNER_URL}/api/delegation/claim-signature`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: account }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to get claim signature');
      }

      const { claims, expiry, signature } = await response.json();

      if (!claims || claims.length === 0) {
        throw new Error('No rewards to claim');
      }

      console.log(`Claiming ${claims.length} reward(s)...`);

      // Call contract
      const hash = await writeContractAsync({
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'claimVoterRewards',
        args: [
          claims.map(c => ({
            proposalId: BigInt(c.proposalId),
            claimType: c.claimType,
            delegate: c.delegate,
            votePower: BigInt(c.votePower),
          })),
          BigInt(expiry),
          signature,
        ],
        ...GAS_SETTINGS,
      });

      await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: 1,
      });

      console.log('Rewards claimed successfully!');

      await fetchClaimableRewards();
      await refetchDelegation();

      return { success: true, hash };
    } catch (err) {
      console.error('Claim rewards error:', err);
      const message = err.message.includes('User rejected')
        ? 'Transaction rejected'
        : err.message.includes('NoRewardsToClaim')
        ? 'No rewards available to claim'
        : err.message.includes('SignatureExpired')
        ? 'Signature expired - please try again'
        : err.message || 'Failed to claim rewards';
      setError(message);
      throw new Error(message);
    } finally {
      setActionLoading(prev => ({ ...prev, claimRewards: false }));
    }
  }, [isConnected, account, writeContractAsync, publicClient, fetchClaimableRewards, refetchDelegation]);

  return {
    // State
    isConnected,
    account,
    ...parsedDelegation,
    // Always return state arrays (override parsedDelegation to ensure defined)
    delegations,
    receivedDelegations,
    isLoading,
    error,
    actionLoading,
    setError,
    // Claimable rewards
    claimableRewards,
    claimableLoading,
    // Actions
    delegateTo,
    undelegateFrom,
    undelegateAll,
    castDelegatedVote,
    fetchClaimableRewards,
    claimAllRewards,
    refetch: async () => {
      await Promise.all([
        refetchDelegation(),
        fetchDelegations(),
        fetchReceivedDelegations(),
      ]);
    },
  };
};

/**
 * Hook for proposal-specific delegation data
 * Returns available delegated power and existing delegated vote for a specific proposal
 * @param {number} proposalId - Proposal ID
 * @returns {Object} Proposal-specific delegation state
 */
export const useDelegationForProposal = (proposalId) => {
  const { address: account, isConnected } = useAccount();

  const { data, refetch } = useReadContracts({
    contracts: [
      // Existing delegated vote record
      {
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'delegatedVotes',
        args: [BigInt(proposalId || 0), account],
      },
      // Total delegated VP received (for display)
      {
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'totalDelegatedIn',
        args: [account],
      },
    ],
    query: {
      enabled: isConnected && !!account && !!proposalId && !!CONTRACTS.GOVERNANCE,
    },
  });

  const [availablePower, setAvailablePower] = useState('0');

  // Fetch available power from backend (accounts for already used power)
  useEffect(() => {
    if (!account || !proposalId) return;

    fetch(`${SIGNER_URL}/api/delegation/available-power/${account}/${proposalId}`)
      .then(res => res.json())
      .then(data => {
        setAvailablePower(formatUnits(BigInt(data.availablePower || '0'), 18));
      })
      .catch(err => {
        console.error('Failed to fetch available power:', err);
      });
  }, [account, proposalId]);

  const delegatedVoteRecord = useMemo(() => {
    if (!data?.[0] || data[0].status !== 'success' || !data[0].result) return null;
    const result = data[0].result;
    return {
      hasVoted: result.hasVoted || false,
      support: result.support || false,
      totalPowerUsed: formatUnits(result.totalPowerUsed || 0n, 18),
      totalPowerUsedRaw: result.totalPowerUsed || 0n,
    };
  }, [data]);

  const totalDelegatedIn = useMemo(() => {
    if (!data?.[1] || data[1].status !== 'success') return '0';
    return formatUnits(data[1].result || 0n, 18);
  }, [data]);

  const totalDelegatedInRaw = useMemo(() => {
    if (!data?.[1] || data[1].status !== 'success') return 0n;
    return data[1].result || 0n;
  }, [data]);

  return {
    availableDelegatedPower: availablePower,
    availableDelegatedPowerRaw: parseUnits(availablePower || '0', 18),
    delegatedVoteRecord,
    hasDelegatedVote: delegatedVoteRecord?.hasVoted || false,
    totalDelegatedIn,
    totalDelegatedInRaw,
    refetch,
  };
};

export default useDelegation;
