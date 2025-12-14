/**
 * Delegation hook for managing VP delegation (off-chain EIP-712 signatures)
 *
 * Uses V2 off-chain delegation system:
 * - Delegations are EIP-712 signed messages stored in backend database
 * - Delegations are applied during VP snapshot computation for Fast Track proposals
 * - Delegates must opt-in on-chain via setDelegateOptIn(true)
 *
 * Eligibility to receive delegations requires BOTH:
 * - 90%+ reputation + 10 completed tasks (from RoseReputation.canDelegate)
 * - Opt-in enabled (isDelegateOptedIn on RoseGovernance)
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useAccount, useReadContracts, useWriteContract, usePublicClient, useSignTypedData, useSignMessage, useChainId } from 'wagmi';
import { formatUnits, parseUnits, keccak256, encodePacked, toBytes, getAddress } from 'viem';
import RoseGovernanceABI from '../contracts/RoseGovernanceABI.json';
import RoseReputationABI from '../contracts/RoseReputationABI.json';
import { CONTRACTS } from '../constants/contracts';
import { GAS_SETTINGS } from '../constants/gas';

// Backend signer URL
const SIGNER_URL = import.meta.env.VITE_PASSPORT_SIGNER_URL || 'http://localhost:3001';

// Default delegation expiry (30 days in seconds)
const DEFAULT_DELEGATION_EXPIRY_SECONDS = 30 * 24 * 60 * 60;

/**
 * Hook for managing VP delegation (off-chain EIP-712)
 * @returns {Object} Delegation state and actions
 */
export const useDelegation = () => {
  const { address: account, isConnected } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { signTypedDataAsync } = useSignTypedData();
  const { signMessageAsync } = useSignMessage();

  // V2 delegation state (from backend)
  const [delegations, setDelegations] = useState([]);
  const [receivedDelegations, setReceivedDelegations] = useState([]);
  const [isOptedIn, setIsOptedIn] = useState(false);

  // EIP-712 config (fetched from backend)
  const [eip712Config, setEip712Config] = useState(null);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionLoading, setActionLoading] = useState({
    delegate: false,
    revoke: false,
    revokeAll: false,
    toggleOptIn: false,
    claimRewards: false,
  });

  // Claimable rewards state
  const [claimableRewards, setClaimableRewards] = useState(null);
  const [claimableLoading, setClaimableLoading] = useState(false);

  // VP data from backend (VP is computed off-chain, not stored in contract)
  const [vpData, setVpData] = useState(null);

  // Get user's delegation eligibility info from contract
  // Note: votingPower is computed off-chain and fetched from backend API
  const { data: contractData, refetch: refetchContract } = useReadContracts({
    contracts: [
      // User's staked ROSE (on-chain)
      {
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'stakedRose',
        args: [account],
      },
      // Check if user can be a delegate (from RoseReputation - 90%+ rep + 10 tasks)
      {
        address: CONTRACTS.REPUTATION,
        abi: RoseReputationABI,
        functionName: 'canDelegate',
        args: [account],
      },
      // User's reputation (from RoseReputation)
      {
        address: CONTRACTS.REPUTATION,
        abi: RoseReputationABI,
        functionName: 'getReputation',
        args: [account],
      },
      // User's opt-in status for receiving delegations
      {
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'isDelegateOptedIn',
        args: [account],
      },
      // Combined eligibility check (reputation + opt-in + stake)
      {
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'canReceiveDelegation',
        args: [account],
      },
    ],
    query: {
      enabled: isConnected && !!account && !!CONTRACTS.GOVERNANCE && !!CONTRACTS.REPUTATION,
    },
  });

  /**
   * Fetch EIP-712 configuration from backend
   */
  const fetchEIP712Config = useCallback(async () => {
    if (!chainId) return;

    try {
      const response = await fetch(`${SIGNER_URL}/api/delegation/v2/eip712-config/${chainId}`);
      if (response.ok) {
        const config = await response.json();
        setEip712Config(config);
      }
    } catch (err) {
      console.error('Failed to fetch EIP-712 config:', err);
    }
  }, [chainId]);

  /**
   * Fetch user's delegations from V2 backend API
   */
  const fetchDelegations = useCallback(async () => {
    if (!account) return;

    try {
      const response = await fetch(`${SIGNER_URL}/api/delegation/v2/user/${account}`);
      if (response.ok) {
        const data = await response.json();
        // Transform to match existing format
        const formatted = (data.delegations || []).map(d => ({
          delegate: d.delegate,
          vpAmount: d.vpAmount, // Keep as string
          nonce: d.nonce,
          expiry: d.expiry,
        }));
        setDelegations(formatted);
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
      const response = await fetch(`${SIGNER_URL}/api/delegation/v2/received/${account}`);
      if (response.ok) {
        const data = await response.json();
        // Transform to match existing format
        const formatted = (data.delegations || []).map(d => ({
          delegator: d.delegator,
          vpAmount: d.vpAmount, // Keep as string
          nonce: d.nonce,
          expiry: d.expiry,
        }));
        setReceivedDelegations(formatted);
      }
    } catch (err) {
      console.error('Failed to fetch received delegations:', err);
    }
  }, [account]);

  /**
   * Fetch user's opt-in status from V2 backend
   */
  const fetchOptInStatus = useCallback(async () => {
    if (!account) return;

    try {
      const response = await fetch(`${SIGNER_URL}/api/delegation/v2/opt-in/${account}`);
      if (response.ok) {
        const data = await response.json();
        setIsOptedIn(data.optedIn || false);
      }
    } catch (err) {
      console.error('Failed to fetch opt-in status:', err);
    }
  }, [account]);

  /**
   * Fetch VP data from backend API
   * VP is computed off-chain and stored in the stakers table
   */
  const fetchVPData = useCallback(async () => {
    if (!account) return;

    try {
      const response = await fetch(`${SIGNER_URL}/api/governance/vp/${account}`);
      if (response.ok) {
        const data = await response.json();
        setVpData(data);
      }
    } catch (err) {
      console.error('Failed to fetch VP data:', err);
    }
  }, [account]);

  // Fetch all delegation data on mount and account/chain change
  useEffect(() => {
    if (account && chainId) {
      Promise.all([
        fetchEIP712Config(),
        fetchDelegations(),
        fetchReceivedDelegations(),
        fetchOptInStatus(),
        fetchVPData(),
      ]).finally(() => setIsLoading(false));
    }
  }, [account, chainId, fetchEIP712Config, fetchDelegations, fetchReceivedDelegations, fetchOptInStatus, fetchVPData]);

  // Parse contract and backend data
  const parsedData = useMemo(() => {
    if (!contractData) return null;

    const getResult = (index) => {
      const result = contractData[index];
      return result?.status === 'success' ? result.result : null;
    };

    // Contract data (indices shifted since we removed votingPower)
    const stakedRose = getResult(0) || 0n;
    const canDelegateRep = getResult(1) || false; // From RoseReputation
    const reputation = getResult(2) || 6000n;
    const isDelegateOptedInContract = getResult(3) || false;
    const canReceiveDelegation = getResult(4) || false; // Combined check

    // VP from backend API (computed off-chain, stored in stakers table)
    // vpData has: votingPower, availableVP, delegatedOut, proposalVPLocked
    const votingPower = vpData?.votingPower ? BigInt(vpData.votingPower) : 0n;

    // Calculate total delegated out from V2 delegations
    const totalDelegatedOutRaw = delegations.reduce(
      (sum, d) => sum + BigInt(d.vpAmount || '0'),
      0n
    );

    // Calculate total received VP
    const totalReceivedVPRaw = receivedDelegations.reduce(
      (sum, d) => sum + BigInt(d.vpAmount || '0'),
      0n
    );

    // Available VP = voting power - delegated out
    const availableVPRaw = votingPower > totalDelegatedOutRaw
      ? votingPower - totalDelegatedOutRaw
      : 0n;

    return {
      // VP data (VP has 9 decimals from sqrt calculation)
      votingPower: formatUnits(votingPower, 9),
      votingPowerRaw: votingPower,
      availableVP: formatUnits(availableVPRaw, 9),
      availableVPRaw: availableVPRaw,
      totalDelegatedOut: formatUnits(totalDelegatedOutRaw, 9),
      totalDelegatedOutRaw: totalDelegatedOutRaw,
      totalReceivedVP: formatUnits(totalReceivedVPRaw, 9),
      totalReceivedVPRaw: totalReceivedVPRaw,

      // Staking data
      stakedRose: formatUnits(stakedRose, 18),
      stakedRoseRaw: stakedRose,

      // Eligibility (combined: reputation + opt-in)
      canDelegate: canDelegateRep, // Reputation-based eligibility
      canReceiveDelegation, // Combined eligibility (reputation + opt-in + stake)
      reputation: Number(reputation),
      reputationRaw: Number(reputation),
      isDelegateOptedIn: isDelegateOptedInContract,

      // Delegation arrays
      delegations, // Outgoing delegations
      receivedDelegations, // Incoming delegations
      delegatorCount: receivedDelegations.length,

      // Legacy compatibility
      isDelegating: delegations.length > 0,
    };
  }, [contractData, delegations, receivedDelegations, vpData]);

  /**
   * Fetch signed reputation attestation from backend
   * @returns {Promise<{reputation: number, expiry: number, signature: string}>}
   */
  const fetchReputationAttestation = useCallback(async () => {
    const response = await fetch(`${SIGNER_URL}/api/governance/reputation-signed/${account}`);
    if (!response.ok) {
      throw new Error('Failed to fetch reputation attestation');
    }
    return response.json();
  }, [account]);

  /**
   * Delegate VP to another user using EIP-712 off-chain signature
   * @param {string} delegateAddress - Address to delegate to
   * @param {string} vpAmount - Amount of VP to delegate (human-readable)
   */
  const delegateTo = useCallback(async (delegateAddress, vpAmount) => {
    if (!isConnected || !account || !eip712Config) {
      throw new Error('Not connected or EIP-712 config not loaded');
    }

    setActionLoading(prev => ({ ...prev, delegate: true }));
    setError(null);

    try {
      const vpWei = parseUnits(vpAmount, 9);

      // Validate
      if (delegateAddress.toLowerCase() === account.toLowerCase()) {
        throw new Error('Cannot delegate to yourself');
      }

      if (vpWei <= 0n) {
        throw new Error('VP amount must be greater than 0');
      }

      if (parsedData && vpWei > parsedData.availableVPRaw) {
        throw new Error('Insufficient available VP');
      }

      // 1. Fetch next nonce from backend
      console.log('Fetching next nonce...');
      const nonceResponse = await fetch(`${SIGNER_URL}/api/delegation/v2/nonce/${account}`);
      if (!nonceResponse.ok) {
        throw new Error('Failed to fetch nonce');
      }
      const { nextNonce } = await nonceResponse.json();
      console.log('Next nonce:', nextNonce);

      // 2. Calculate expiry (30 days from now)
      const expiry = Math.floor(Date.now() / 1000) + DEFAULT_DELEGATION_EXPIRY_SECONDS;

      // 3. Sign EIP-712 typed data
      console.log('Signing delegation...');
      const signature = await signTypedDataAsync({
        domain: eip712Config.domain,
        types: eip712Config.types,
        primaryType: 'Delegation',
        message: {
          delegator: getAddress(account),
          delegate: getAddress(delegateAddress),
          vpAmount: vpWei,
          nonce: BigInt(nextNonce),
          expiry: BigInt(expiry),
        },
      });
      console.log('Signature obtained');

      // 4. Store delegation via V2 API
      console.log('Storing delegation...');
      const storeResponse = await fetch(`${SIGNER_URL}/api/delegation/v2/store`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          delegator: account,
          delegate: delegateAddress,
          vpAmount: vpWei.toString(),
          nonce: nextNonce,
          expiry,
          signature,
        }),
      });

      if (!storeResponse.ok) {
        const errorData = await storeResponse.json().catch(() => ({}));
        throw new Error(errorData.error || `Backend error: ${storeResponse.status}`);
      }

      console.log('Delegation stored successfully!');

      // 5. Refresh delegation state
      await Promise.all([
        fetchDelegations(),
        fetchVPData(),
        refetchContract(),
      ]);

      return { success: true };
    } catch (err) {
      console.error('Delegate error:', err);
      const message = err.message.includes('User rejected')
        ? 'Signature rejected'
        : err.message.includes('Cannot delegate to yourself')
        ? 'Cannot delegate to yourself'
        : err.message.includes('Insufficient available VP')
        ? 'Insufficient available VP'
        : err.message.includes('not opted in')
        ? 'Delegate has not opted in to receive delegations'
        : err.message.includes('Invalid nonce')
        ? 'Please try again (nonce conflict)'
        : err.message;
      setError(message);
      throw new Error(message);
    } finally {
      setActionLoading(prev => ({ ...prev, delegate: false }));
    }
  }, [isConnected, account, eip712Config, parsedData, signTypedDataAsync, fetchDelegations, fetchVPData, refetchContract]);

  /**
   * Revoke delegation to a specific delegate using signed revocation
   * @param {string} delegateAddress - Address to revoke delegation from
   */
  const revokeDelegation = useCallback(async (delegateAddress) => {
    if (!isConnected || !account) {
      throw new Error('Not connected');
    }

    setActionLoading(prev => ({ ...prev, [`revoke-${delegateAddress}`]: true }));
    setError(null);

    try {
      const timestamp = Math.floor(Date.now() / 1000);

      // Sign revocation message: keccak256("REVOKE_DELEGATION", delegator, delegate, timestamp)
      console.log('Signing revocation...');
      const messageHash = keccak256(
        encodePacked(
          ['string', 'address', 'address', 'uint256'],
          ['REVOKE_DELEGATION', account, delegateAddress, BigInt(timestamp)]
        )
      );

      const signature = await signMessageAsync({
        message: { raw: toBytes(messageHash) },
      });
      console.log('Revocation signature obtained');

      // Call V2 revoke API
      console.log('Revoking delegation...');
      const response = await fetch(`${SIGNER_URL}/api/delegation/v2/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          delegator: account,
          delegate: delegateAddress,
          timestamp,
          signature,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Backend error: ${response.status}`);
      }

      console.log('Delegation revoked successfully!');

      // Refresh delegation state
      await Promise.all([
        fetchDelegations(),
        refetchContract(),
      ]);

      return { success: true };
    } catch (err) {
      console.error('Revoke error:', err);
      const message = err.message.includes('User rejected')
        ? 'Signature rejected'
        : err.message.includes('Signature expired')
        ? 'Signature expired - please try again'
        : err.message;
      setError(message);
      throw new Error(message);
    } finally {
      setActionLoading(prev => ({ ...prev, [`revoke-${delegateAddress}`]: false }));
    }
  }, [isConnected, account, signMessageAsync, fetchDelegations, refetchContract]);

  /**
   * Revoke all delegations using signed revocation
   */
  const revokeAllDelegations = useCallback(async () => {
    if (!isConnected || !account) {
      throw new Error('Not connected');
    }

    setActionLoading(prev => ({ ...prev, revokeAll: true }));
    setError(null);

    try {
      const timestamp = Math.floor(Date.now() / 1000);

      // Sign revocation message with null delegate (revoke all)
      // Backend treats ZeroAddress as "revoke all"
      const zeroAddress = '0x0000000000000000000000000000000000000000';
      console.log('Signing revoke-all...');
      const messageHash = keccak256(
        encodePacked(
          ['string', 'address', 'address', 'uint256'],
          ['REVOKE_DELEGATION', account, zeroAddress, BigInt(timestamp)]
        )
      );

      const signature = await signMessageAsync({
        message: { raw: toBytes(messageHash) },
      });

      // Call V2 revoke API with null delegate
      console.log('Revoking all delegations...');
      const response = await fetch(`${SIGNER_URL}/api/delegation/v2/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          delegator: account,
          delegate: null,
          timestamp,
          signature,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Backend error: ${response.status}`);
      }

      const result = await response.json();
      console.log(`Revoked ${result.revokedCount} delegation(s)`);

      // Refresh delegation state
      await Promise.all([
        fetchDelegations(),
        refetchContract(),
      ]);

      return { success: true, revokedCount: result.revokedCount };
    } catch (err) {
      console.error('Revoke all error:', err);
      const message = err.message.includes('User rejected')
        ? 'Signature rejected'
        : err.message;
      setError(message);
      throw new Error(message);
    } finally {
      setActionLoading(prev => ({ ...prev, revokeAll: false }));
    }
  }, [isConnected, account, signMessageAsync, fetchDelegations, refetchContract]);

  /**
   * Toggle opt-in status for receiving delegations (on-chain transaction)
   * @param {boolean} optIn - True to opt in, false to opt out
   */
  const toggleOptIn = useCallback(async (optIn) => {
    if (!isConnected || !CONTRACTS.GOVERNANCE) {
      throw new Error('Not connected');
    }

    setActionLoading(prev => ({ ...prev, toggleOptIn: true }));
    setError(null);

    try {
      console.log(`Setting delegate opt-in to ${optIn}...`);
      const hash = await writeContractAsync({
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'setDelegateOptIn',
        args: [optIn],
        ...GAS_SETTINGS,
      });

      await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: 1,
      });

      console.log('Opt-in status updated!');

      // Update local state immediately
      setIsOptedIn(optIn);

      // Refresh contract data
      await refetchContract();

      return { success: true, hash };
    } catch (err) {
      console.error('Toggle opt-in error:', err);
      const message = err.message.includes('User rejected')
        ? 'Transaction rejected'
        : err.message;
      setError(message);
      throw new Error(message);
    } finally {
      setActionLoading(prev => ({ ...prev, toggleOptIn: false }));
    }
  }, [isConnected, writeContractAsync, publicClient, refetchContract]);

  // ============================================================
  // Rewards Logic (KEPT FROM ORIGINAL)
  // ============================================================

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
   * Requires reputation attestation for VP recalculation
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

      // Fetch reputation attestation from backend
      console.log('Fetching reputation attestation...');
      const repAttestation = await fetchReputationAttestation();
      console.log('Reputation:', repAttestation.reputation, 'Expiry:', repAttestation.expiry);

      console.log(`Claiming ${claims.length} reward(s)...`);

      // Call contract with reputation attestation
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
          BigInt(repAttestation.reputation),
          BigInt(repAttestation.expiry),
          repAttestation.signature,
        ],
        ...GAS_SETTINGS,
      });

      await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: 1,
      });

      console.log('Rewards claimed successfully!');

      await fetchClaimableRewards();
      await refetchContract();

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
  }, [isConnected, account, writeContractAsync, publicClient, fetchClaimableRewards, refetchContract, fetchReputationAttestation]);

  return {
    // State
    isConnected,
    account,
    ...parsedData,
    // Always return state arrays (override parsedData to ensure defined)
    delegations,
    receivedDelegations,
    isOptedIn,
    isLoading,
    error,
    actionLoading,
    setError,
    // Claimable rewards
    claimableRewards,
    claimableLoading,
    // Actions
    delegateTo,
    revokeDelegation,
    revokeAllDelegations,
    toggleOptIn,
    fetchClaimableRewards,
    claimAllRewards,
    refetch: async () => {
      await Promise.all([
        fetchDelegations(),
        fetchReceivedDelegations(),
        fetchOptInStatus(),
        fetchVPData(),
        refetchContract(),
      ]);
    },
  };
};

/**
 * Hook for proposal-specific delegation data
 * Returns available delegated power for a specific proposal (from merkle tree)
 * @param {number} proposalId - Proposal ID
 * @returns {Object} Proposal-specific delegation state
 */
export const useDelegationForProposal = (proposalId) => {
  const { address: account, isConnected } = useAccount();

  const [availablePower, setAvailablePower] = useState('0');
  const [proofData, setProofData] = useState(null);

  // Fetch merkle proof and effective VP from backend
  const fetchProofData = useCallback(async () => {
    if (!account || !proposalId) return;

    try {
      const res = await fetch(`${SIGNER_URL}/api/governance/proposals/${proposalId}/proof/${account}`);
      if (res.ok) {
        const data = await res.json();
        setProofData(data);
        // Effective VP is the VP after delegations applied (from merkle tree)
        setAvailablePower(formatUnits(BigInt(data.effectiveVP || '0'), 9));
      } else {
        // User not in snapshot or no snapshot yet
        setAvailablePower('0');
        setProofData(null);
      }
    } catch (err) {
      console.error('Failed to fetch proof data:', err);
      setAvailablePower('0');
      setProofData(null);
    }
  }, [account, proposalId]);

  // Fetch on mount and when account/proposalId changes
  useEffect(() => {
    fetchProofData();
  }, [fetchProofData]);

  return {
    availableDelegatedPower: availablePower,
    availableDelegatedPowerRaw: parseUnits(availablePower || '0', 9),
    proofData,
    hasMerkleProof: !!proofData?.proof?.length,
    refetch: fetchProofData,
  };
};

export default useDelegation;
