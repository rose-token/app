/**
 * Governance hook for staking ROSE, managing vROSE, and governance state
 * Handles deposit/withdraw operations and tracks user's governance position
 */

import { useState, useCallback, useMemo, useRef } from 'react';
import { useAccount, useReadContract, useReadContracts, useWriteContract, usePublicClient } from 'wagmi';
import { formatUnits, parseUnits } from 'viem';
import RoseGovernanceABI from '../contracts/RoseGovernanceABI.json';
import vROSEABI from '../contracts/vROSEABI.json';
import RoseTokenABI from '../contracts/RoseTokenABI.json';
import { CONTRACTS } from '../constants/contracts';

/**
 * Parse simulation errors into user-friendly messages
 */
function parseSimulationError(err) {
  const msg = err?.message || err?.shortMessage || '';

  // Custom errors from RoseGovernance/vROSE
  if (msg.includes('NotGovernance')) {
    return 'vROSE contract not configured - governance address not set on vROSE contract';
  }
  if (msg.includes('ZeroAmount')) {
    return 'Amount cannot be zero';
  }
  if (msg.includes('InsufficientBalance') || msg.includes('transfer amount exceeds balance')) {
    return 'Insufficient ROSE balance';
  }
  if (msg.includes('InsufficientAllowance') || msg.includes('allowance')) {
    return 'Token approval required';
  }
  if (msg.includes('InsufficientUnallocated')) {
    return 'Insufficient unallocated ROSE - unallocate from votes/delegation first';
  }
  if (msg.includes('InsufficientVRose')) {
    return 'Insufficient vROSE balance - may be locked in marketplace tasks';
  }

  // Return original message if no match
  return msg || 'Transaction simulation failed';
}

/**
 * Parse transaction errors into user-friendly messages
 */
function parseTransactionError(err) {
  const msg = err?.message || '';
  const shortMsg = err?.shortMessage || '';
  const cause = err?.cause?.message || '';

  // Log full error for debugging
  console.log('Parsing transaction error:', { msg, shortMsg, cause, fullError: err });

  if (msg.includes('User rejected') || msg.includes('user rejected')) {
    return 'Transaction rejected by user';
  }
  if (msg.includes('nonce too low')) {
    return 'Nonce conflict - please refresh the page and wait 30 seconds before trying again';
  }
  if (msg.includes('replacement transaction underpriced')) {
    return 'Pending transaction conflict - wait for previous transaction to complete or speed up/cancel in MetaMask';
  }
  if (msg.includes('32603') || msg.includes('Internal JSON-RPC')) {
    // Try to extract more specific info
    if (cause.includes('insufficient funds')) {
      return 'Insufficient ETH for gas fees';
    }
    if (cause.includes('execution reverted')) {
      return 'Transaction would fail - contract rejected the call';
    }
    return 'RPC error - try refreshing the page, waiting 30 seconds, and trying again. If the issue persists, the network may be congested.';
  }
  if (msg.includes('insufficient funds') || msg.includes('Insufficient funds')) {
    return 'Insufficient ETH for gas fees';
  }
  if (msg.includes('Insufficient') || msg.includes('insufficient')) {
    return msg;
  }
  if (msg.includes('already in progress')) {
    return msg;
  }
  if (msg.includes('timeout') || msg.includes('Timeout')) {
    return 'Request timed out - network may be slow. Please check your transaction history in MetaMask.';
  }

  return 'Transaction failed - please try again. Check MetaMask for transaction status.';
}

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

  // Deposit step tracking for UI progress indicator
  // Steps: null, 'checking', 'simulating', 'approving', 'approved', 'depositing', 'complete'
  const [depositStep, setDepositStep] = useState(null);

  // Mutex refs to prevent concurrent transactions
  const depositInProgress = useRef(false);
  const withdrawInProgress = useRef(false);

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

    // Parse user stats struct
    const stats = userStats ? {
      tasksCompleted: Number(userStats.tasksCompleted || 0),
      totalTaskValue: userStats.totalTaskValue || 0n,
      disputes: Number(userStats.disputes || 0),
      failedProposals: Number(userStats.failedProposals || 0),
      lastTaskTimestamp: Number(userStats.lastTaskTimestamp || 0),
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
    // Prevent concurrent deposit transactions (nonce conflict prevention)
    if (depositInProgress.current) {
      throw new Error('Deposit transaction already in progress');
    }

    if (!isConnected || !CONTRACTS.GOVERNANCE || !CONTRACTS.TOKEN) {
      throw new Error('Not connected or contracts not configured');
    }

    depositInProgress.current = true;
    setLoading(prev => ({ ...prev, deposit: true }));
    setError(null);
    setDepositStep('checking');

    try {
      const amountWei = parseUnits(amount, 18);

      // ========== DEBUG LOGGING ==========
      console.log('=== DEPOSIT DEBUG ===');
      console.log('Amount:', amount);
      console.log('Amount Wei:', amountWei.toString());
      console.log('Account:', account);
      console.log('Governance contract:', CONTRACTS.GOVERNANCE);
      console.log('Token contract:', CONTRACTS.TOKEN);
      console.log('vROSE contract:', CONTRACTS.VROSE);

      // Check nonce for debugging
      const initialNonce = await publicClient.getTransactionCount({ address: account });
      console.log('Initial nonce:', initialNonce);

      // Check 1: ROSE balance
      const roseBalance = await publicClient.readContract({
        address: CONTRACTS.TOKEN,
        abi: RoseTokenABI,
        functionName: 'balanceOf',
        args: [account],
      });
      console.log('ROSE Balance:', formatUnits(roseBalance, 18));

      // Check 2: Current ROSE allowance for governance
      const currentAllowance = await publicClient.readContract({
        address: CONTRACTS.TOKEN,
        abi: RoseTokenABI,
        functionName: 'allowance',
        args: [account, CONTRACTS.GOVERNANCE],
      });
      console.log('Current ROSE Allowance for Governance:', formatUnits(currentAllowance, 18));

      // Check 3: vROSE governance address (CRITICAL!)
      const vRoseGovernance = await publicClient.readContract({
        address: CONTRACTS.VROSE,
        abi: vROSEABI,
        functionName: 'governance',
      });
      console.log('vROSE governance address:', vRoseGovernance);
      console.log('Expected governance:', CONTRACTS.GOVERNANCE);
      const governanceMatch = vRoseGovernance?.toLowerCase() === CONTRACTS.GOVERNANCE?.toLowerCase();
      console.log('Governance addresses match:', governanceMatch);

      if (!governanceMatch) {
        console.error('CRITICAL: vROSE governance address mismatch! Deposit will fail.');
        throw new Error('vROSE contract not configured - governance address not set. Contact admin.');
      }
      // ========== END DEBUG LOGGING ==========

      // ========== PRE-FLIGHT SIMULATION ==========
      // Simulate BOTH transactions before executing either to catch issues early
      setDepositStep('simulating');
      const needsApproval = currentAllowance < amountWei;
      console.log('Needs approval:', needsApproval, '(current:', formatUnits(currentAllowance, 18), ', needed:', amount, ')');

      if (needsApproval) {
        console.log('Simulating approve transaction...');
        try {
          await publicClient.simulateContract({
            address: CONTRACTS.TOKEN,
            abi: RoseTokenABI,
            functionName: 'approve',
            args: [CONTRACTS.GOVERNANCE, amountWei],
            account: account,
          });
          console.log('Approve simulation passed!');
        } catch (simError) {
          console.error('Approve simulation FAILED:', simError);
          throw new Error('Approval would fail: ' + parseSimulationError(simError));
        }
      }

// Deposit simulation moved to after approval (when needed)
      // ========== END PRE-FLIGHT SIMULATION ==========

      // Check balance
      if (parsed && amountWei > parsed.roseBalanceRaw) {
        throw new Error('Insufficient ROSE balance');
      }

      // Step 1: Approve ROSE transfer (skip if allowance already sufficient)
      if (needsApproval) {
        setDepositStep('approving');
        console.log('Approving ROSE for governance deposit...');
        const nonceBeforeApprove = await publicClient.getTransactionCount({ address: account });
        console.log('Nonce before approve:', nonceBeforeApprove);

        const approveHash = await writeContractAsync({
          address: CONTRACTS.TOKEN,
          abi: RoseTokenABI,
          functionName: 'approve',
          args: [CONTRACTS.GOVERNANCE, amountWei],
        });
        console.log('Approve tx hash:', approveHash);

        // Wait for 2 confirmations to ensure nonce is updated
        await publicClient.waitForTransactionReceipt({
          hash: approveHash,
          confirmations: 2,
        });
        console.log('Approve confirmed');
        setDepositStep('approved');

        const nonceAfterApprove = await publicClient.getTransactionCount({ address: account });
        console.log('Nonce after approve:', nonceAfterApprove);

        // Longer delay for RPC state sync and nonce refresh
        await new Promise(r => setTimeout(r, 2000));

        // Now simulate deposit with the new allowance
        console.log('Simulating deposit transaction (post-approval)...');
        try {
          await publicClient.simulateContract({
            address: CONTRACTS.GOVERNANCE,
            abi: RoseGovernanceABI,
            functionName: 'deposit',
            args: [amountWei],
            account: account,
          });
          console.log('Deposit simulation passed!');
        } catch (simError) {
          console.error('Deposit simulation FAILED:', simError);
          throw new Error(parseSimulationError(simError));
        }
      } else {
        // No approval needed - simulate deposit now
        console.log('Simulating deposit transaction...');
        try {
          await publicClient.simulateContract({
            address: CONTRACTS.GOVERNANCE,
            abi: RoseGovernanceABI,
            functionName: 'deposit',
            args: [amountWei],
            account: account,
          });
          console.log('Deposit simulation passed!');
        } catch (simError) {
          console.error('Deposit simulation FAILED:', simError);
          throw new Error(parseSimulationError(simError));
        }
      }

      // Step 2: Deposit into governance
      setDepositStep('depositing');
      console.log('Depositing ROSE into governance...');
      const nonceBeforeDeposit = await publicClient.getTransactionCount({ address: account });
      console.log('Nonce before deposit:', nonceBeforeDeposit);

      const depositHash = await writeContractAsync({
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'deposit',
        args: [amountWei],
      });
      console.log('Deposit tx hash:', depositHash);

      await publicClient.waitForTransactionReceipt({
        hash: depositHash,
        confirmations: 2,
      });

      const nonceAfterDeposit = await publicClient.getTransactionCount({ address: account });
      console.log('Nonce after deposit:', nonceAfterDeposit);
      console.log('Deposit successful!');
      setDepositStep('complete');
      await refetchGovernance();
      return { success: true, hash: depositHash };
    } catch (err) {
      console.error('Deposit error:', err);
      const message = parseTransactionError(err);
      setError(message);
      throw new Error(message);
    } finally {
      depositInProgress.current = false;
      setLoading(prev => ({ ...prev, deposit: false }));
      // Clear step after a short delay so user can see 'complete' or error
      setTimeout(() => setDepositStep(null), 2000);
    }
  }, [isConnected, parsed, writeContractAsync, publicClient, refetchGovernance, account]);

  /**
   * Withdraw ROSE from governance (burns vROSE)
   * Requires: vROSE returned + ROSE unallocated
   * @param {string} amount - Amount in ROSE (human readable)
   */
  const withdraw = useCallback(async (amount) => {
    // Prevent concurrent withdraw transactions (nonce conflict prevention)
    if (withdrawInProgress.current) {
      throw new Error('Withdraw transaction already in progress');
    }

    if (!isConnected || !CONTRACTS.GOVERNANCE || !CONTRACTS.VROSE) {
      throw new Error('Not connected or contracts not configured');
    }

    withdrawInProgress.current = true;
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

      // Wait for 2 confirmations to ensure nonce is updated
      await publicClient.waitForTransactionReceipt({
        hash: approveHash,
        confirmations: 2,
      });

      // Longer delay for RPC state sync and nonce refresh
      await new Promise(r => setTimeout(r, 2000));

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
        confirmations: 2,
      });

      console.log('Withdrawal successful!');
      await refetchGovernance();
      return { success: true, hash: withdrawHash };
    } catch (err) {
      console.error('Withdraw error:', err);
      const message = parseTransactionError(err);
      setError(message);
      throw new Error(message);
    } finally {
      withdrawInProgress.current = false;
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
    depositStep, // Current step: null, 'checking', 'simulating', 'approving', 'approved', 'depositing', 'complete'
    // Actions
    deposit,
    withdraw,
    refetch: refetchGovernance,
  };
};

export default useGovernance;
