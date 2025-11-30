/**
 * Proposals hook for fetching, filtering, and interacting with governance proposals
 * Handles proposal lifecycle: create, vote, finalize, execute
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useAccount, useReadContract, useReadContracts, useWriteContract, usePublicClient, useWatchContractEvent } from 'wagmi';
import { formatUnits, parseUnits } from 'viem';
import RoseGovernanceABI from '../contracts/RoseGovernanceABI.json';
import { CONTRACTS, ProposalStatus } from '../constants/contracts';
import { uploadProposalToIPFS, fetchProposalFromIPFS } from '../utils/ipfs/pinataService';
import { usePassportVerify } from './usePassportVerify';

/**
 * Hook for fetching and managing governance proposals
 * @param {Object} options - Options
 * @param {number} options.proposalId - Specific proposal ID to fetch (optional)
 * @returns {Object} Proposals state and actions
 */
export const useProposals = (options = {}) => {
  const { proposalId: specificProposalId } = options;
  const { address: account, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { getSignature } = usePassportVerify();

  const [proposals, setProposals] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionLoading, setActionLoading] = useState({});

  // Get proposal counter
  const { data: proposalCounter, refetch: refetchCounter } = useReadContract({
    address: CONTRACTS.GOVERNANCE,
    abi: RoseGovernanceABI,
    functionName: 'proposalCounter',
    query: {
      enabled: !!CONTRACTS.GOVERNANCE,
    },
  });

  // Generate contract calls for all proposals (or specific one)
  const proposalContracts = useMemo(() => {
    if (!CONTRACTS.GOVERNANCE) return [];

    if (specificProposalId) {
      return [{
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'proposals',
        args: [BigInt(specificProposalId)],
      }];
    }

    const count = proposalCounter ? Number(proposalCounter) : 0;
    if (count === 0) return [];

    return Array.from({ length: count }, (_, i) => ({
      address: CONTRACTS.GOVERNANCE,
      abi: RoseGovernanceABI,
      functionName: 'proposals',
      args: [BigInt(i + 1)],
    }));
  }, [CONTRACTS.GOVERNANCE, proposalCounter, specificProposalId]);

  // Batch fetch proposals
  const { data: proposalsData, refetch: refetchProposals, isLoading: isFetchingProposals } = useReadContracts({
    contracts: proposalContracts,
    allowSparse: true,
    query: {
      enabled: proposalContracts.length > 0,
    },
  });

  // Generate vote check contracts for user
  const voteContracts = useMemo(() => {
    if (!CONTRACTS.GOVERNANCE || !account || !proposalsData) return [];

    return proposalsData
      .filter(r => r?.status === 'success')
      .map((_, index) => ({
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'votes',
        args: [BigInt(specificProposalId || index + 1), account],
      }));
  }, [CONTRACTS.GOVERNANCE, account, proposalsData, specificProposalId]);

  // Batch fetch user votes
  const { data: votesData, refetch: refetchVotes } = useReadContracts({
    contracts: voteContracts,
    allowSparse: true,
    query: {
      enabled: voteContracts.length > 0 && !!account,
    },
  });

  // Process proposals data
  useEffect(() => {
    const processProposals = async () => {
      if (!proposalsData) {
        setProposals([]);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);

      try {
        const processed = await Promise.all(
          proposalsData.map(async (result, index) => {
            if (result.status !== 'success' || !result.result) return null;

            const p = result.result;
            const proposalId = specificProposalId || index + 1;

            // Parse proposal tuple
            const [
              proposer,
              title,
              descriptionHash,
              value,
              deadline,
              deliverables,
              createdAt,
              votingEndsAt,
              yayVotes,
              nayVotes,
              totalAllocated,
              status,
              editCount,
              taskId,
            ] = Array.isArray(p) ? p : [
              p.proposer,
              p.title,
              p.descriptionHash,
              p.value,
              p.deadline,
              p.deliverables,
              p.createdAt,
              p.votingEndsAt,
              p.yayVotes,
              p.nayVotes,
              p.totalAllocated,
              p.status,
              p.editCount,
              p.taskId,
            ];

            // Get user's vote for this proposal
            const userVote = votesData?.[index]?.status === 'success' ? votesData[index].result : null;
            const hasVoted = userVote ? userVote[0] : false;
            const voteSupport = userVote ? userVote[1] : null;
            const votePower = userVote ? userVote[2] : 0n;
            const allocatedAmount = userVote ? userVote[3] : 0n;

            // Calculate vote percentages
            const totalVotes = yayVotes + nayVotes;
            const yayPercent = totalVotes > 0n ? Number((yayVotes * 10000n) / totalVotes) / 100 : 0;
            const nayPercent = totalVotes > 0n ? Number((nayVotes * 10000n) / totalVotes) / 100 : 0;

            // Calculate time remaining
            const now = Math.floor(Date.now() / 1000);
            const endsAt = Number(votingEndsAt);
            const timeRemaining = endsAt - now;
            const isExpired = timeRemaining <= 0;

            // Fetch description from IPFS if it's a hash
            let description = '';
            if (descriptionHash && descriptionHash.startsWith('Qm')) {
              try {
                const ipfsData = await fetchProposalFromIPFS(descriptionHash);
                description = ipfsData?.description || ipfsData || '';
              } catch (e) {
                console.warn('Failed to fetch IPFS description:', e);
                description = descriptionHash;
              }
            } else {
              description = descriptionHash || '';
            }

            return {
              id: proposalId,
              proposer,
              title,
              description,
              descriptionHash,
              value: formatUnits(value, 18),
              valueRaw: value,
              deadline: Number(deadline),
              deliverables,
              createdAt: Number(createdAt),
              votingEndsAt: endsAt,
              timeRemaining,
              isExpired,
              yayVotes: formatUnits(yayVotes, 18),
              yayVotesRaw: yayVotes,
              nayVotes: formatUnits(nayVotes, 18),
              nayVotesRaw: nayVotes,
              totalAllocated: formatUnits(totalAllocated, 18),
              totalAllocatedRaw: totalAllocated,
              yayPercent,
              nayPercent,
              status: Number(status),
              editCount: Number(editCount),
              taskId: Number(taskId),
              // User's vote info
              userVote: hasVoted ? {
                support: voteSupport,
                votePower: formatUnits(votePower, 18),
                votePowerRaw: votePower,
                allocatedAmount: formatUnits(allocatedAmount, 18),
                allocatedAmountRaw: allocatedAmount,
              } : null,
              hasVoted,
              isProposer: proposer?.toLowerCase() === account?.toLowerCase(),
            };
          })
        );

        setProposals(processed.filter(p => p !== null));
      } catch (err) {
        console.error('Error processing proposals:', err);
        setError('Failed to load proposals');
      } finally {
        setIsLoading(false);
      }
    };

    processProposals();
  }, [proposalsData, votesData, account, specificProposalId]);

  // Watch for proposal events
  useWatchContractEvent({
    address: CONTRACTS.GOVERNANCE,
    abi: RoseGovernanceABI,
    eventName: 'ProposalCreated',
    onLogs: () => {
      refetchCounter();
      refetchProposals();
    },
    enabled: !!CONTRACTS.GOVERNANCE,
  });

  useWatchContractEvent({
    address: CONTRACTS.GOVERNANCE,
    abi: RoseGovernanceABI,
    eventName: 'VoteCast',
    onLogs: () => {
      refetchProposals();
      refetchVotes();
    },
    enabled: !!CONTRACTS.GOVERNANCE,
  });

  useWatchContractEvent({
    address: CONTRACTS.GOVERNANCE,
    abi: RoseGovernanceABI,
    eventName: 'ProposalFinalized',
    onLogs: () => {
      refetchProposals();
    },
    enabled: !!CONTRACTS.GOVERNANCE,
  });

  /**
   * Vote on a proposal
   * @param {number} proposalId - Proposal ID
   * @param {string} amount - Amount of ROSE to allocate
   * @param {boolean} support - true for Yay, false for Nay
   */
  const vote = useCallback(async (proposalId, amount, support) => {
    if (!isConnected || !CONTRACTS.GOVERNANCE) {
      throw new Error('Not connected');
    }

    setActionLoading(prev => ({ ...prev, [`vote-${proposalId}`]: true }));
    setError(null);

    try {
      const amountWei = parseUnits(amount, 18);

      console.log(`Voting ${support ? 'Yay' : 'Nay'} with ${amount} ROSE on proposal ${proposalId}...`);
      const hash = await writeContractAsync({
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'allocateToProposal',
        args: [BigInt(proposalId), amountWei, support],
      });

      await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: 1,
      });

      console.log('Vote cast successfully!');
      await refetchProposals();
      await refetchVotes();
      return { success: true, hash };
    } catch (err) {
      console.error('Vote error:', err);
      const message = err.message.includes('User rejected')
        ? 'Transaction rejected'
        : err.message.includes('AlreadyVoted')
        ? 'You have already voted on this proposal'
        : err.message.includes('CannotVoteOnOwnProposal')
        ? 'You cannot vote on your own proposal'
        : err.message.includes('IneligibleToVote')
        ? 'You are not eligible to vote (check reputation requirements)'
        : err.message.includes('ProposalNotActive')
        ? 'Proposal is no longer active'
        : 'Failed to cast vote';
      setError(message);
      throw new Error(message);
    } finally {
      setActionLoading(prev => ({ ...prev, [`vote-${proposalId}`]: false }));
    }
  }, [isConnected, writeContractAsync, publicClient, refetchProposals, refetchVotes]);

  /**
   * Unallocate vote from a proposal
   * @param {number} proposalId - Proposal ID
   */
  const unvote = useCallback(async (proposalId) => {
    if (!isConnected || !CONTRACTS.GOVERNANCE) {
      throw new Error('Not connected');
    }

    setActionLoading(prev => ({ ...prev, [`unvote-${proposalId}`]: true }));
    setError(null);

    try {
      console.log(`Unallocating vote from proposal ${proposalId}...`);
      const hash = await writeContractAsync({
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'unallocateFromProposal',
        args: [BigInt(proposalId)],
      });

      await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: 1,
      });

      console.log('Vote unallocated successfully!');
      await refetchProposals();
      await refetchVotes();
      return { success: true, hash };
    } catch (err) {
      console.error('Unvote error:', err);
      const message = err.message.includes('User rejected')
        ? 'Transaction rejected'
        : 'Failed to unallocate vote';
      setError(message);
      throw new Error(message);
    } finally {
      setActionLoading(prev => ({ ...prev, [`unvote-${proposalId}`]: false }));
    }
  }, [isConnected, writeContractAsync, publicClient, refetchProposals, refetchVotes]);

  /**
   * Create a new proposal
   * @param {Object} proposalData - Proposal data
   */
  const createProposal = useCallback(async (proposalData) => {
    if (!isConnected || !CONTRACTS.GOVERNANCE) {
      throw new Error('Not connected');
    }

    setActionLoading(prev => ({ ...prev, create: true }));
    setError(null);

    try {
      const { title, description, value, deadline, deliverables, skills } = proposalData;

      // Upload description to IPFS
      console.log('Uploading proposal description to IPFS...');
      const ipfsData = {
        title,
        description,
        skills: skills || [],
        createdAt: Date.now(),
      };
      const descriptionHash = await uploadProposalToIPFS(ipfsData);
      console.log('IPFS hash:', descriptionHash);

      const valueWei = parseUnits(value.toString(), 18);
      const deadlineTimestamp = Math.floor(new Date(deadline).getTime() / 1000);

      // Get passport signature from backend signer
      console.log('Getting passport signature...');
      const { expiry, signature } = await getSignature('propose');

      console.log('Creating proposal...');
      const hash = await writeContractAsync({
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'propose',
        args: [title, descriptionHash, valueWei, BigInt(deadlineTimestamp), deliverables, BigInt(expiry), signature],
      });

      await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: 1,
      });

      console.log('Proposal created successfully!');
      await refetchCounter();
      await refetchProposals();
      return { success: true, hash };
    } catch (err) {
      console.error('Create proposal error:', err);
      const message = err.message.includes('User rejected')
        ? 'Transaction rejected'
        : err.message.includes('IneligibleToPropose')
        ? 'You are not eligible to propose (check reputation requirements)'
        : err.message.includes('ProposalValueExceedsTreasury')
        ? 'Proposal value exceeds treasury balance'
        : err.message.includes('Passport score too low')
        ? 'Your Gitcoin Passport score is too low (25+ required to propose)'
        : err.message.includes('InvalidSignature')
        ? 'Passport signature verification failed'
        : 'Failed to create proposal';
      setError(message);
      throw new Error(message);
    } finally {
      setActionLoading(prev => ({ ...prev, create: false }));
    }
  }, [isConnected, writeContractAsync, publicClient, refetchCounter, refetchProposals]);

  /**
   * Finalize a proposal (after voting period ends)
   * @param {number} proposalId - Proposal ID
   */
  const finalizeProposal = useCallback(async (proposalId) => {
    if (!isConnected || !CONTRACTS.GOVERNANCE) {
      throw new Error('Not connected');
    }

    setActionLoading(prev => ({ ...prev, [`finalize-${proposalId}`]: true }));
    setError(null);

    try {
      console.log(`Finalizing proposal ${proposalId}...`);
      const hash = await writeContractAsync({
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'finalizeProposal',
        args: [BigInt(proposalId)],
      });

      await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: 1,
      });

      console.log('Proposal finalized successfully!');
      await refetchProposals();
      return { success: true, hash };
    } catch (err) {
      console.error('Finalize error:', err);
      const message = err.message.includes('User rejected')
        ? 'Transaction rejected'
        : err.message.includes('ProposalNotEnded')
        ? 'Voting period has not ended yet'
        : 'Failed to finalize proposal';
      setError(message);
      throw new Error(message);
    } finally {
      setActionLoading(prev => ({ ...prev, [`finalize-${proposalId}`]: false }));
    }
  }, [isConnected, writeContractAsync, publicClient, refetchProposals]);

  /**
   * Execute a passed proposal (creates marketplace task)
   * @param {number} proposalId - Proposal ID
   */
  const executeProposal = useCallback(async (proposalId) => {
    if (!isConnected || !CONTRACTS.GOVERNANCE) {
      throw new Error('Not connected');
    }

    setActionLoading(prev => ({ ...prev, [`execute-${proposalId}`]: true }));
    setError(null);

    try {
      console.log(`Executing proposal ${proposalId}...`);
      const hash = await writeContractAsync({
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'executeProposal',
        args: [BigInt(proposalId)],
      });

      await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: 1,
      });

      console.log('Proposal executed successfully!');
      await refetchProposals();
      return { success: true, hash };
    } catch (err) {
      console.error('Execute error:', err);
      const message = err.message.includes('User rejected')
        ? 'Transaction rejected'
        : 'Failed to execute proposal';
      setError(message);
      throw new Error(message);
    } finally {
      setActionLoading(prev => ({ ...prev, [`execute-${proposalId}`]: false }));
    }
  }, [isConnected, writeContractAsync, publicClient, refetchProposals]);

  /**
   * Cancel a proposal (proposer only)
   * @param {number} proposalId - Proposal ID
   */
  const cancelProposal = useCallback(async (proposalId) => {
    if (!isConnected || !CONTRACTS.GOVERNANCE) {
      throw new Error('Not connected');
    }

    setActionLoading(prev => ({ ...prev, [`cancel-${proposalId}`]: true }));
    setError(null);

    try {
      console.log(`Cancelling proposal ${proposalId}...`);
      const hash = await writeContractAsync({
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'cancelProposal',
        args: [BigInt(proposalId)],
      });

      await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: 1,
      });

      console.log('Proposal cancelled successfully!');
      await refetchProposals();
      return { success: true, hash };
    } catch (err) {
      console.error('Cancel error:', err);
      const message = err.message.includes('User rejected')
        ? 'Transaction rejected'
        : err.message.includes('OnlyProposerCanCancel')
        ? 'Only the proposer can cancel'
        : 'Failed to cancel proposal';
      setError(message);
      throw new Error(message);
    } finally {
      setActionLoading(prev => ({ ...prev, [`cancel-${proposalId}`]: false }));
    }
  }, [isConnected, writeContractAsync, publicClient, refetchProposals]);

  // Filtered proposals by status
  const activeProposals = useMemo(() =>
    proposals.filter(p => p.status === ProposalStatus.Active),
  [proposals]);

  const passedProposals = useMemo(() =>
    proposals.filter(p => p.status === ProposalStatus.Passed),
  [proposals]);

  const executedProposals = useMemo(() =>
    proposals.filter(p => p.status === ProposalStatus.Executed),
  [proposals]);

  const failedProposals = useMemo(() =>
    proposals.filter(p => p.status === ProposalStatus.Failed || p.status === ProposalStatus.Cancelled),
  [proposals]);

  return {
    // Data
    proposals,
    activeProposals,
    passedProposals,
    executedProposals,
    failedProposals,
    proposalCount: Number(proposalCounter || 0),
    // Single proposal (when specificProposalId is provided)
    proposal: specificProposalId ? proposals[0] : null,
    // State
    isLoading: isLoading || isFetchingProposals,
    error,
    actionLoading,
    setError,
    // Actions
    vote,
    unvote,
    createProposal,
    finalizeProposal,
    executeProposal,
    cancelProposal,
    refetch: async () => {
      await refetchCounter();
      await refetchProposals();
      await refetchVotes();
    },
  };
};

export default useProposals;
