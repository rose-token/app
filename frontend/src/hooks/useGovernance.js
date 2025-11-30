/**
 * Governance hook for staking ROSE, managing vROSE, and governance state
 * Handles deposit/withdraw operations and tracks user's governance position
 */

import { useState, useCallback, useMemo } from 'react';
import { useAccount, useReadContract, useReadContracts, useWriteContract, usePublicClient } from 'wagmi';
import { formatUnits, parseUnits } from 'viem';
import RoseGovernanceABI from '../contracts/RoseGovernanceABI.json';
import vROSEABI from '../contracts/vROSEABI.json';
import RoseTokenABI from '../contracts/RoseTokenABI.json';
import { CONTRACTS } from '../constants/contracts';

/**
 * Hook for governance staking and vROSE management
 * @returns {Object} Governance state and actions
 */
export const useGovernance = () => {
  const { address: account, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [loading, setLoading] = useState({
    deposit: false,
    withdraw: false,
  });
  const [error, setError] = useState(null);

  // Batch read governance state
  const { data: governanceData, refetch: refetchGovernance } = useReadContracts({
    contracts: [
      // User's staked ROSE in governance
      {
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'stakedRose',
        args: [account],
      },
      // User's allocated ROSE (locked in votes/delegation)
      {
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'allocatedRose',
        args: [account],
      },
      // User's vROSE balance
      {
        address: CONTRACTS.VROSE,
        abi: vROSEABI,
        functionName: 'balanceOf',
        args: [account],
      },
      // User's ROSE balance (for deposits)
      {
        address: CONTRACTS.TOKEN,
        abi: RoseTokenABI,
        functionName: 'balanceOf',
        args: [account],
      },
      // User's reputation score
      {
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'getReputation',
        args: [account],
      },
      // User's delegation target
      {
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'delegatedTo',
        args: [account],
      },
      // User's delegated amount
      {
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'delegatedAmount',
        args: [account],
      },
      // Total staked ROSE in governance
      {
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'totalStakedRose',
      },
      // User's pending rewards
      {
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'pendingRewards',
        args: [account],
      },
      // User stats
      {
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'userStats',
        args: [account],
      },
      // Total delegated power received
      {
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'totalDelegatedPower',
        args: [account],
      },
      // Check if user can propose
      {
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'canPropose',
        args: [account],
      },
      // Check if user can vote
      {
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'canVote',
        args: [account],
      },
      // Check if user can be a delegate
      {
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'canDelegate',
        args: [account],
      },
    ],
    query: {
      enabled: isConnected && !!account && !!CONTRACTS.GOVERNANCE && !!CONTRACTS.VROSE,
    },
  });

  // Parse governance data
  const parsed = useMemo(() => {
    if (!governanceData) return null;

    const getResult = (index) => {
      const result = governanceData[index];
      return result?.status === 'success' ? result.result : null;
    };

    const stakedRose = getResult(0) || 0n;
    const allocatedRose = getResult(1) || 0n;
    const vRoseBalance = getResult(2) || 0n;
    const roseBalance = getResult(3) || 0n;
    const reputation = getResult(4) || 6000n; // Default 60%
    const delegatedTo = getResult(5);
    const delegatedAmount = getResult(6) || 0n;
    const totalStakedRose = getResult(7) || 0n;
    const pendingRewards = getResult(8) || 0n;
    const userStats = getResult(9);
    const totalDelegatedPower = getResult(10) || 0n;
    const canPropose = getResult(11) || false;
    const canVote = getResult(12) || false;
    const canDelegate = getResult(13) || false;

    // Calculate unallocated ROSE (available for new votes/delegation)
    const unallocatedRose = stakedRose > allocatedRose ? stakedRose - allocatedRose : 0n;

    // Parse user stats tuple
    const stats = userStats ? {
      tasksCompleted: Number(userStats[0] || 0),
      totalTaskValue: userStats[1] || 0n,
      disputes: Number(userStats[2] || 0),
      failedProposals: Number(userStats[3] || 0),
      lastTaskTimestamp: Number(userStats[4] || 0),
    } : null;

    return {
      stakedRose: formatUnits(stakedRose, 18),
      stakedRoseRaw: stakedRose,
      allocatedRose: formatUnits(allocatedRose, 18),
      allocatedRoseRaw: allocatedRose,
      unallocatedRose: formatUnits(unallocatedRose, 18),
      unallocatedRoseRaw: unallocatedRose,
      vRoseBalance: formatUnits(vRoseBalance, 18),
      vRoseBalanceRaw: vRoseBalance,
      roseBalance: formatUnits(roseBalance, 18),
      roseBalanceRaw: roseBalance,
      reputation: Number(reputation), // Contract returns 0-100 percentage
      reputationRaw: Number(reputation),
      delegatedTo: delegatedTo && delegatedTo !== '0x0000000000000000000000000000000000000000' ? delegatedTo : null,
      delegatedAmount: formatUnits(delegatedAmount, 18),
      delegatedAmountRaw: delegatedAmount,
      totalStakedRose: formatUnits(totalStakedRose, 18),
      totalStakedRoseRaw: totalStakedRose,
      pendingRewards: formatUnits(pendingRewards, 18),
      pendingRewardsRaw: pendingRewards,
      userStats: stats,
      totalDelegatedPower: formatUnits(totalDelegatedPower, 18),
      totalDelegatedPowerRaw: totalDelegatedPower,
      canPropose,
      canVote,
      canDelegate,
    };
  }, [governanceData]);

  /**
   * Deposit ROSE into governance and receive vROSE
   * @param {string} amount - Amount in ROSE (human readable)
   */
  const deposit = useCallback(async (amount) => {
    if (!isConnected || !CONTRACTS.GOVERNANCE || !CONTRACTS.TOKEN) {
      throw new Error('Not connected or contracts not configured');
    }

    setLoading(prev => ({ ...prev, deposit: true }));
    setError(null);

    try {
      const amountWei = parseUnits(amount, 18);

      // Check balance
      if (parsed && amountWei > parsed.roseBalanceRaw) {
        throw new Error('Insufficient ROSE balance');
      }

      // Step 1: Approve ROSE transfer
      console.log('Approving ROSE for governance deposit...');
      const approveHash = await writeContractAsync({
        address: CONTRACTS.TOKEN,
        abi: RoseTokenABI,
        functionName: 'approve',
        args: [CONTRACTS.GOVERNANCE, amountWei],
      });

      await publicClient.waitForTransactionReceipt({
        hash: approveHash,
        confirmations: 1,
      });

      // Small delay for RPC sync
      await new Promise(r => setTimeout(r, 1000));

      // Step 2: Deposit into governance
      console.log('Depositing ROSE into governance...');
      const depositHash = await writeContractAsync({
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'deposit',
        args: [amountWei],
      });

      await publicClient.waitForTransactionReceipt({
        hash: depositHash,
        confirmations: 1,
      });

      console.log('Deposit successful!');
      await refetchGovernance();
      return { success: true, hash: depositHash };
    } catch (err) {
      console.error('Deposit error:', err);
      const message = err.message.includes('User rejected')
        ? 'Transaction rejected'
        : err.message.includes('Insufficient')
        ? err.message
        : 'Failed to deposit ROSE';
      setError(message);
      throw new Error(message);
    } finally {
      setLoading(prev => ({ ...prev, deposit: false }));
    }
  }, [isConnected, parsed, writeContractAsync, publicClient, refetchGovernance]);

  /**
   * Withdraw ROSE from governance (burns vROSE)
   * Requires: vROSE returned + ROSE unallocated
   * @param {string} amount - Amount in ROSE (human readable)
   */
  const withdraw = useCallback(async (amount) => {
    if (!isConnected || !CONTRACTS.GOVERNANCE || !CONTRACTS.VROSE) {
      throw new Error('Not connected or contracts not configured');
    }

    setLoading(prev => ({ ...prev, withdraw: true }));
    setError(null);

    try {
      const amountWei = parseUnits(amount, 18);

      // Check requirements
      if (parsed) {
        if (amountWei > parsed.vRoseBalanceRaw) {
          throw new Error('Insufficient vROSE balance (may be locked in marketplace tasks)');
        }
        if (amountWei > parsed.unallocatedRoseRaw) {
          throw new Error('ROSE still allocated to votes or delegation. Unallocate first.');
        }
      }

      // Step 1: Approve vROSE burn
      console.log('Approving vROSE for withdrawal...');
      const approveHash = await writeContractAsync({
        address: CONTRACTS.VROSE,
        abi: vROSEABI,
        functionName: 'approve',
        args: [CONTRACTS.GOVERNANCE, amountWei],
      });

      await publicClient.waitForTransactionReceipt({
        hash: approveHash,
        confirmations: 1,
      });

      // Small delay
      await new Promise(r => setTimeout(r, 1000));

      // Step 2: Withdraw
      console.log('Withdrawing from governance...');
      const withdrawHash = await writeContractAsync({
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'withdraw',
        args: [amountWei],
      });

      await publicClient.waitForTransactionReceipt({
        hash: withdrawHash,
        confirmations: 1,
      });

      console.log('Withdrawal successful!');
      await refetchGovernance();
      return { success: true, hash: withdrawHash };
    } catch (err) {
      console.error('Withdraw error:', err);
      const message = err.message.includes('User rejected')
        ? 'Transaction rejected'
        : err.message.includes('Insufficient')
        ? err.message
        : err.message.includes('allocated')
        ? err.message
        : 'Failed to withdraw ROSE';
      setError(message);
      throw new Error(message);
    } finally {
      setLoading(prev => ({ ...prev, withdraw: false }));
    }
  }, [isConnected, parsed, writeContractAsync, publicClient, refetchGovernance]);

  return {
    // State
    isConnected,
    account,
    ...parsed,
    loading,
    error,
    setError,
    // Actions
    deposit,
    withdraw,
    refetch: refetchGovernance,
  };
};

export default useGovernance;
