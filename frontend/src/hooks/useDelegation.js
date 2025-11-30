/**
 * Delegation hook for managing vote delegation
 * Handles delegating to others and receiving delegations
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useAccount, useReadContract, useReadContracts, useWriteContract, usePublicClient, useWatchContractEvent } from 'wagmi';
import { formatUnits, parseUnits } from 'viem';
import RoseGovernanceABI from '../contracts/RoseGovernanceABI.json';
import { CONTRACTS } from '../constants/contracts';

/**
 * Hook for managing vote delegation
 * @returns {Object} Delegation state and actions
 */
export const useDelegation = () => {
  const { address: account, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [delegates, setDelegates] = useState([]);
  const [myDelegators, setMyDelegators] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionLoading, setActionLoading] = useState({});

  // Get user's delegation info
  const { data: delegationData, refetch: refetchDelegation } = useReadContracts({
    contracts: [
      // Who user delegates to
      {
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'delegatedTo',
        args: [account],
      },
      // Amount delegated
      {
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'delegatedAmount',
        args: [account],
      },
      // Cached vote power from delegation
      {
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'cachedVotePower',
        args: [account],
      },
      // Total power delegated to user
      {
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'totalDelegatedPower',
        args: [account],
      },
      // User's staked ROSE
      {
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'stakedRose',
        args: [account],
      },
      // User's allocated ROSE
      {
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'allocatedRose',
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
    ],
    query: {
      enabled: isConnected && !!account && !!CONTRACTS.GOVERNANCE,
    },
  });

  // Get list of delegators to the user
  const { data: delegatorsData, refetch: refetchDelegators } = useReadContract({
    address: CONTRACTS.GOVERNANCE,
    abi: RoseGovernanceABI,
    functionName: 'delegators',
    args: [account],
    query: {
      enabled: isConnected && !!account && !!CONTRACTS.GOVERNANCE,
    },
  });

  // Parse delegation data
  const parsedDelegation = useMemo(() => {
    if (!delegationData) return null;

    const getResult = (index) => {
      const result = delegationData[index];
      return result?.status === 'success' ? result.result : null;
    };

    const delegatedTo = getResult(0);
    const delegatedAmount = getResult(1) || 0n;
    const cachedVotePower = getResult(2) || 0n;
    const totalDelegatedPower = getResult(3) || 0n;
    const stakedRose = getResult(4) || 0n;
    const allocatedRose = getResult(5) || 0n;
    const canDelegate = getResult(6) || false;
    const reputation = getResult(7) || 6000n;

    const unallocatedRose = stakedRose > allocatedRose ? stakedRose - allocatedRose : 0n;

    // Contract stores totalDelegatedPower in sqrt(wei) units, divide by 1e9 to match frontend VP units
    const totalDelegatedPowerVP = (Number(totalDelegatedPower) / 1e9).toString();

    return {
      delegatedTo: delegatedTo && delegatedTo !== '0x0000000000000000000000000000000000000000' ? delegatedTo : null,
      delegatedAmount: formatUnits(delegatedAmount, 18),
      delegatedAmountRaw: delegatedAmount,
      cachedVotePower: formatUnits(cachedVotePower, 18),
      cachedVotePowerRaw: cachedVotePower,
      totalDelegatedPower: totalDelegatedPowerVP,
      totalDelegatedPowerRaw: totalDelegatedPower,
      stakedRose: formatUnits(stakedRose, 18),
      stakedRoseRaw: stakedRose,
      allocatedRose: formatUnits(allocatedRose, 18),
      allocatedRoseRaw: allocatedRose,
      unallocatedRose: formatUnits(unallocatedRose, 18),
      unallocatedRoseRaw: unallocatedRose,
      canDelegate,
      reputation: Number(reputation) / 100,
      reputationRaw: Number(reputation),
      isDelegating: !!delegatedTo && delegatedTo !== '0x0000000000000000000000000000000000000000',
    };
  }, [delegationData]);

  // Process delegators list
  useEffect(() => {
    if (delegatorsData && Array.isArray(delegatorsData)) {
      setMyDelegators(delegatorsData.filter(
        addr => addr && addr !== '0x0000000000000000000000000000000000000000'
      ));
    } else {
      setMyDelegators([]);
    }
    setIsLoading(false);
  }, [delegatorsData]);

  // Watch for delegation events
  useWatchContractEvent({
    address: CONTRACTS.GOVERNANCE,
    abi: RoseGovernanceABI,
    eventName: 'DelegatedTo',
    onLogs: () => {
      refetchDelegation();
      refetchDelegators();
    },
    enabled: !!CONTRACTS.GOVERNANCE,
  });

  useWatchContractEvent({
    address: CONTRACTS.GOVERNANCE,
    abi: RoseGovernanceABI,
    eventName: 'Undelegated',
    onLogs: () => {
      refetchDelegation();
      refetchDelegators();
    },
    enabled: !!CONTRACTS.GOVERNANCE,
  });

  /**
   * Delegate voting power to another user
   * @param {string} delegateAddress - Address to delegate to
   * @param {string} amount - Amount of ROSE to delegate
   */
  const delegateTo = useCallback(async (delegateAddress, amount) => {
    if (!isConnected || !CONTRACTS.GOVERNANCE) {
      throw new Error('Not connected');
    }

    setActionLoading(prev => ({ ...prev, delegate: true }));
    setError(null);

    try {
      const amountWei = parseUnits(amount, 18);

      // Validate
      if (delegateAddress.toLowerCase() === account.toLowerCase()) {
        throw new Error('Cannot delegate to yourself');
      }

      // Allow increasing allocation to same delegate, block different delegate
      if (parsedDelegation?.isDelegating &&
          parsedDelegation.delegatedTo.toLowerCase() !== delegateAddress.toLowerCase()) {
        throw new Error('Already delegating to someone else. Undelegate first.');
      }

      if (parsedDelegation && amountWei > parsedDelegation.unallocatedRoseRaw) {
        throw new Error('Insufficient unallocated ROSE');
      }

      console.log(`Delegating ${amount} ROSE to ${delegateAddress}...`);
      const hash = await writeContractAsync({
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'allocateToDelegate',
        args: [delegateAddress, amountWei],
      });

      await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: 1,
      });

      console.log('Delegation successful!');
      await refetchDelegation();
      return { success: true, hash };
    } catch (err) {
      console.error('Delegate error:', err);
      const message = err.message.includes('User rejected')
        ? 'Transaction rejected'
        : err.message.includes('CannotDelegateToSelf')
        ? 'Cannot delegate to yourself'
        : err.message.includes('AlreadyDelegating')
        ? 'Already delegating to someone. Undelegate first.'
        : err.message.includes('DelegationChainNotAllowed')
        ? 'Cannot delegate to someone who is also delegating (no chains)'
        : err.message.includes('IneligibleToDelegate')
        ? 'Target user is not eligible to receive delegation'
        : err.message;
      setError(message);
      throw new Error(message);
    } finally {
      setActionLoading(prev => ({ ...prev, delegate: false }));
    }
  }, [isConnected, account, parsedDelegation, writeContractAsync, publicClient, refetchDelegation]);

  /**
   * Remove delegation
   */
  const undelegate = useCallback(async () => {
    if (!isConnected || !CONTRACTS.GOVERNANCE) {
      throw new Error('Not connected');
    }

    setActionLoading(prev => ({ ...prev, undelegate: true }));
    setError(null);

    try {
      if (!parsedDelegation?.isDelegating) {
        throw new Error('Not currently delegating');
      }

      console.log('Undelegating...');
      const hash = await writeContractAsync({
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'unallocateFromDelegate',
        args: [],
      });

      await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: 1,
      });

      console.log('Undelegation successful!');
      await refetchDelegation();
      return { success: true, hash };
    } catch (err) {
      console.error('Undelegate error:', err);
      const message = err.message.includes('User rejected')
        ? 'Transaction rejected'
        : err.message.includes('NotDelegating')
        ? 'Not currently delegating'
        : err.message;
      setError(message);
      throw new Error(message);
    } finally {
      setActionLoading(prev => ({ ...prev, undelegate: false }));
    }
  }, [isConnected, parsedDelegation, writeContractAsync, publicClient, refetchDelegation]);

  /**
   * Cast delegated votes on a proposal
   * @param {number} proposalId - Proposal ID
   * @param {boolean} support - true for Yay, false for Nay
   */
  const castDelegatedVote = useCallback(async (proposalId, support) => {
    if (!isConnected || !CONTRACTS.GOVERNANCE) {
      throw new Error('Not connected');
    }

    setActionLoading(prev => ({ ...prev, [`delegatedVote-${proposalId}`]: true }));
    setError(null);

    try {
      console.log(`Casting delegated vote ${support ? 'Yay' : 'Nay'} on proposal ${proposalId}...`);
      const hash = await writeContractAsync({
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'castDelegatedVote',
        args: [BigInt(proposalId), support],
      });

      await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: 1,
      });

      console.log('Delegated vote cast successfully!');
      await refetchDelegation();
      return { success: true, hash };
    } catch (err) {
      console.error('Delegated vote error:', err);
      const message = err.message.includes('User rejected')
        ? 'Transaction rejected'
        : 'Failed to cast delegated vote';
      setError(message);
      throw new Error(message);
    } finally {
      setActionLoading(prev => ({ ...prev, [`delegatedVote-${proposalId}`]: false }));
    }
  }, [isConnected, writeContractAsync, publicClient, refetchDelegation]);

  /**
   * Refresh delegation power (recalculates based on current reputation)
   * @param {string} userAddress - Address to refresh
   */
  const refreshDelegation = useCallback(async (userAddress) => {
    if (!isConnected || !CONTRACTS.GOVERNANCE) {
      throw new Error('Not connected');
    }

    setActionLoading(prev => ({ ...prev, refresh: true }));
    setError(null);

    try {
      console.log(`Refreshing delegation for ${userAddress}...`);
      const hash = await writeContractAsync({
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'refreshDelegation',
        args: [userAddress],
      });

      await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: 1,
      });

      console.log('Delegation refreshed successfully!');
      await refetchDelegation();
      await refetchDelegators();
      return { success: true, hash };
    } catch (err) {
      console.error('Refresh error:', err);
      const message = err.message.includes('User rejected')
        ? 'Transaction rejected'
        : 'Failed to refresh delegation';
      setError(message);
      throw new Error(message);
    } finally {
      setActionLoading(prev => ({ ...prev, refresh: false }));
    }
  }, [isConnected, writeContractAsync, publicClient, refetchDelegation, refetchDelegators]);

  return {
    // State
    isConnected,
    account,
    ...parsedDelegation,
    myDelegators,
    delegatorCount: myDelegators.length,
    isLoading,
    error,
    actionLoading,
    setError,
    // Actions
    delegateTo,
    undelegate,
    castDelegatedVote,
    refreshDelegation,
    refetch: async () => {
      await refetchDelegation();
      await refetchDelegators();
    },
  };
};

export default useDelegation;
