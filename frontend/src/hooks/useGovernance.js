/**
 * Governance hook for staking ROSE, managing vROSE, and governance state
 * Handles deposit/withdraw operations and tracks user's VP (Voting Power) position
 *
 * VP-centric model: VP is calculated at deposit time and stored on-chain.
 * VP = sqrt(stakedRose) * (reputation / 100)
 */

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useAccount, useReadContracts, useWriteContract, usePublicClient } from 'wagmi';
import { formatUnits, parseUnits } from 'viem';
import RoseGovernanceABI from '../contracts/RoseGovernanceABI.json';
import RoseReputationABI from '../contracts/RoseReputationABI.json';
import vROSEABI from '../contracts/vROSEABI.json';
import RoseTokenABI from '../contracts/RoseTokenABI.json';
import { CONTRACTS } from '../constants/contracts';
import { GAS_SETTINGS } from '../constants/gas';

// Backend API URL for VP data
const API_URL = import.meta.env.VITE_PASSPORT_SIGNER_URL || 'http://localhost:3001';

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
  if (msg.includes('VPLocked') || msg.includes('VP locked')) {
    return 'VP is locked in delegation or proposals. Free VP first.';
  }

  return 'Transaction failed - please try again. Check MetaMask for transaction status.';
}

/**
 * Hook for governance staking and VP management
 * @returns {Object} Governance state and actions
 */
export const useGovernance = () => {
  const { address: account, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [loading, setLoading] = useState({
    deposit: false,
    withdraw: false,
    vpFetch: false,
  });
  const [error, setError] = useState(null);

  // VP data from backend API
  // Note: delegatedOut, proposalVPLocked, activeProposal removed - use useDelegation and useAvailableVP
  const [vpData, setVpData] = useState({
    stakedRose: '0',
    votingPower: '0',
    availableVP: '0',
  });

  // Total system VP from backend
  const [totalSystemVP, setTotalSystemVP] = useState('0');

  // Deposit step tracking for UI progress indicator
  const [depositStep, setDepositStep] = useState(null);

  // Mutex refs to prevent concurrent transactions
  const depositInProgress = useRef(false);
  const withdrawInProgress = useRef(false);

  /**
   * Fetch VP data from backend API
   */
  const fetchVPData = useCallback(async () => {
    if (!account) return;

    setLoading(prev => ({ ...prev, vpFetch: true }));
    try {
      const response = await fetch(`${API_URL}/api/governance/vp/${account}`);
      if (response.ok) {
        const data = await response.json();
        setVpData(data);
      }
    } catch (err) {
      console.error('Failed to fetch VP data:', err);
    } finally {
      setLoading(prev => ({ ...prev, vpFetch: false }));
    }
  }, [account]);

  /**
   * Fetch total system VP from backend
   */
  const fetchTotalVP = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/api/governance/total-vp`);
      if (response.ok) {
        const data = await response.json();
        setTotalSystemVP(data.totalVP);
      }
    } catch (err) {
      console.error('Failed to fetch total VP:', err);
    }
  }, []);

  // Fetch VP data on mount and when account changes
  useEffect(() => {
    if (account) {
      fetchVPData();
      fetchTotalVP();
    }
  }, [account, fetchVPData, fetchTotalVP]);

  // Batch read basic token balances and eligibility from contracts
  const { data: governanceData, refetch: refetchGovernance } = useReadContracts({
    contracts: [
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
      // User's reputation score (from RoseReputation contract)
      {
        address: CONTRACTS.REPUTATION,
        abi: RoseReputationABI,
        functionName: 'getReputation',
        args: [account],
      },
      // Total staked ROSE in governance (for reference)
      {
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'totalStakedRose',
      },
      // User stats (from RoseReputation contract)
      {
        address: CONTRACTS.REPUTATION,
        abi: RoseReputationABI,
        functionName: 'userStats',
        args: [account],
      },
      // Check if user can propose (from RoseReputation contract)
      {
        address: CONTRACTS.REPUTATION,
        abi: RoseReputationABI,
        functionName: 'canPropose',
        args: [account],
      },
      // Check if user can vote (from RoseReputation contract)
      {
        address: CONTRACTS.REPUTATION,
        abi: RoseReputationABI,
        functionName: 'canVote',
        args: [account],
      },
      // Check if user can be a delegate (from RoseReputation contract)
      {
        address: CONTRACTS.REPUTATION,
        abi: RoseReputationABI,
        functionName: 'canDelegate',
        args: [account],
      },
      // Total delegated VP received (for delegates) - stays on Governance
      {
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'totalDelegatedIn',
        args: [account],
      },
    ],
    query: {
      enabled: isConnected && !!account && !!CONTRACTS.GOVERNANCE && !!CONTRACTS.VROSE && !!CONTRACTS.REPUTATION,
    },
  });

  // Parse governance data
  const parsed = useMemo(() => {
    if (!governanceData) return null;

    const getResult = (index) => {
      const result = governanceData[index];
      return result?.status === 'success' ? result.result : null;
    };

    const vRoseBalance = getResult(0) || 0n;
    const roseBalance = getResult(1) || 0n;
    const reputation = getResult(2) || 6000n; // Default 60%
    const totalStakedRose = getResult(3) || 0n;
    const userStats = getResult(4);
    const canPropose = getResult(5) || false;
    const canVote = getResult(6) || false;
    const canDelegate = getResult(7) || false;
    const totalDelegatedIn = getResult(8) || 0n;

    // Parse user stats struct
    const stats = userStats ? {
      tasksCompleted: Number(userStats.tasksCompleted || 0),
      totalTaskValue: userStats.totalTaskValue || 0n,
      disputes: Number(userStats.disputes || 0),
      failedProposals: Number(userStats.failedProposals || 0),
      lastTaskTimestamp: Number(userStats.lastTaskTimestamp || 0),
    } : null;

    // Parse VP data from backend
    const stakedRoseRaw = BigInt(vpData.stakedRose || '0');
    const votingPowerRaw = BigInt(vpData.votingPower || '0');
    const availableVPRaw = BigInt(vpData.availableVP || '0');

    return {
      // VP data from backend
      stakedRose: formatUnits(stakedRoseRaw, 18),
      stakedRoseRaw,
      votingPower: formatUnits(votingPowerRaw, 9),
      votingPowerRaw,
      availableVP: formatUnits(availableVPRaw, 9),
      availableVPRaw,

      // Token balances from contract
      vRoseBalance: formatUnits(vRoseBalance, 18),
      vRoseBalanceRaw: vRoseBalance,
      roseBalance: formatUnits(roseBalance, 18),
      roseBalanceRaw: roseBalance,

      // Reputation
      reputation: Number(reputation),
      reputationRaw: Number(reputation),

      // System totals
      totalStakedRose: formatUnits(totalStakedRose, 18),
      totalStakedRoseRaw: totalStakedRose,
      totalSystemVP: formatUnits(BigInt(totalSystemVP || '0'), 9),
      totalSystemVPRaw: BigInt(totalSystemVP || '0'),

      // Delegation (received)
      totalDelegatedIn: formatUnits(totalDelegatedIn, 9),
      totalDelegatedInRaw: totalDelegatedIn,

      // Eligibility
      userStats: stats,
      canPropose,
      canVote,
      canDelegate,
    };
  }, [governanceData, vpData, totalSystemVP]);

  /**
   * Deposit ROSE into governance and receive vROSE
   * VP is calculated at deposit time: sqrt(totalStaked) * (reputation/100)
   * @param {string} amount - Amount in ROSE (human readable)
   */
  const deposit = useCallback(async (amount) => {
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

      console.log('=== DEPOSIT DEBUG ===');
      console.log('Amount:', amount);
      console.log('Amount Wei:', amountWei.toString());
      console.log('Account:', account);

      // Check ROSE balance
      const roseBalance = await publicClient.readContract({
        address: CONTRACTS.TOKEN,
        abi: RoseTokenABI,
        functionName: 'balanceOf',
        args: [account],
      });
      console.log('ROSE Balance:', formatUnits(roseBalance, 18));

      if (amountWei > roseBalance) {
        throw new Error('Insufficient ROSE balance');
      }

      // Check current allowance
      const currentAllowance = await publicClient.readContract({
        address: CONTRACTS.TOKEN,
        abi: RoseTokenABI,
        functionName: 'allowance',
        args: [account, CONTRACTS.GOVERNANCE],
      });
      console.log('Current ROSE Allowance:', formatUnits(currentAllowance, 18));

      const needsApproval = currentAllowance < amountWei;

      // Step 1: Approve if needed
      if (needsApproval) {
        setDepositStep('approving');
        console.log('Approving ROSE for governance deposit...');

        const approveHash = await writeContractAsync({
          address: CONTRACTS.TOKEN,
          abi: RoseTokenABI,
          functionName: 'approve',
          args: [CONTRACTS.GOVERNANCE, amountWei],
          ...GAS_SETTINGS,
        });
        console.log('Approve tx hash:', approveHash);

        await publicClient.waitForTransactionReceipt({
          hash: approveHash,
          confirmations: 1,
        });
        console.log('Approve confirmed');
        setDepositStep('approved');

        await new Promise(r => setTimeout(r, 1000));
      }

      // Step 2: Deposit ROSE into governance
      setDepositStep('depositing');
      console.log('Depositing ROSE into governance...');

      const depositHash = await writeContractAsync({
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'deposit',
        args: [amountWei],
        ...GAS_SETTINGS,
      });
      console.log('Deposit tx hash:', depositHash);

      await publicClient.waitForTransactionReceipt({
        hash: depositHash,
        confirmations: 1,
      });

      console.log('Deposit successful!');
      setDepositStep('complete');

      // Refresh data from both contract and backend
      await Promise.all([
        refetchGovernance(),
        fetchVPData(),
        fetchTotalVP(),
      ]);

      return { success: true, hash: depositHash };
    } catch (err) {
      console.error('Deposit error:', err);
      const message = parseTransactionError(err);
      setError(message);
      throw new Error(message);
    } finally {
      depositInProgress.current = false;
      setLoading(prev => ({ ...prev, deposit: false }));
      setTimeout(() => setDepositStep(null), 2000);
    }
  }, [isConnected, writeContractAsync, publicClient, refetchGovernance, fetchVPData, fetchTotalVP, account]);

  /**
   * Withdraw ROSE from governance (burns vROSE)
   * Requires: vROSE returned + VP available (not delegated or on proposals)
   * @param {string} amount - Amount in ROSE (human readable)
   */
  const withdraw = useCallback(async (amount) => {
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

      // Check vROSE balance
      if (parsed && amountWei > parsed.vRoseBalanceRaw) {
        throw new Error('Insufficient vROSE balance (may be locked in marketplace tasks)');
      }

      // The contract will check if VP is available for withdrawal
      // VP locked in delegation or proposals cannot be withdrawn

      // Step 1: Approve vROSE burn
      console.log('Approving vROSE for withdrawal...');
      const approveHash = await writeContractAsync({
        address: CONTRACTS.VROSE,
        abi: vROSEABI,
        functionName: 'approve',
        args: [CONTRACTS.GOVERNANCE, amountWei],
        ...GAS_SETTINGS,
      });

      await publicClient.waitForTransactionReceipt({
        hash: approveHash,
        confirmations: 1,
      });

      await new Promise(r => setTimeout(r, 1000));

      // Step 2: Withdraw ROSE from governance
      console.log('Withdrawing from governance...');
      const withdrawHash = await writeContractAsync({
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'withdraw',
        args: [amountWei],
        ...GAS_SETTINGS,
      });

      await publicClient.waitForTransactionReceipt({
        hash: withdrawHash,
        confirmations: 1,
      });

      console.log('Withdrawal successful!');

      // Refresh data from both contract and backend
      await Promise.all([
        refetchGovernance(),
        fetchVPData(),
        fetchTotalVP(),
      ]);

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
  }, [isConnected, parsed, writeContractAsync, publicClient, refetchGovernance, fetchVPData, fetchTotalVP]);

  /**
   * Refresh all governance data
   */
  const refetch = useCallback(async () => {
    await Promise.all([
      refetchGovernance(),
      fetchVPData(),
      fetchTotalVP(),
    ]);
  }, [refetchGovernance, fetchVPData, fetchTotalVP]);

  return {
    // State
    isConnected,
    account,
    ...parsed,
    loading,
    error,
    setError,
    depositStep,
    // Actions
    deposit,
    withdraw,
    refetch,
  };
};

export default useGovernance;
