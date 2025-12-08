/**
 * Proposals hook for fetching, filtering, and interacting with governance proposals
 * Handles proposal lifecycle: create, vote, finalize, execute
 */

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useAccount, useReadContract, useReadContracts, useWriteContract, usePublicClient, useWatchContractEvent } from 'wagmi';
import { formatUnits, parseUnits } from 'viem';
import RoseGovernanceABI from '../contracts/RoseGovernanceABI.json';
import { CONTRACTS, ProposalStatus } from '../constants/contracts';
import { uploadProposalToIPFS, fetchProposalFromIPFS } from '../utils/ipfs/pinataService';
import { usePassportVerify } from './usePassportVerify';
import { GAS_SETTINGS } from '../constants/gas';

// Backend signer URL
const SIGNER_URL = import.meta.env.VITE_PASSPORT_SIGNER_URL || 'http://localhost:3001';

// Need RoseTokenABI for debug logging
import RoseTokenABI from '../contracts/RoseTokenABI.json';
import RoseReputationABI from '../contracts/RoseReputationABI.json';

/**
 * Parse transaction errors into user-friendly messages
 */
function parseTransactionError(err) {
  const msg = err?.message || '';

  if (msg.includes('User rejected') || msg.includes('user rejected')) {
    return 'Transaction rejected';
  }
  if (msg.includes('nonce too low')) {
    return 'Transaction conflict - please refresh the page and try again';
  }
  if (msg.includes('replacement transaction underpriced')) {
    return 'Pending transaction conflict - wait for it to complete or cancel in wallet';
  }
  if (msg.includes('32603') || msg.includes('Internal JSON-RPC')) {
    return 'Transaction failed - if you have pending transactions, wait for them to complete';
  }
  if (msg.includes('Insufficient') || msg.includes('insufficient')) {
    return msg;
  }
  if (msg.includes('already in progress')) {
    return msg;
  }
  if (msg.includes('IneligibleToPropose')) {
    return 'You are not eligible to propose (check reputation requirements)';
  }
  if (msg.includes('ProposalValueExceedsTreasury')) {
    return 'Proposal value exceeds treasury balance';
  }
  if (msg.includes('Passport score too low')) {
    return 'Your Gitcoin Passport score is too low (25+ required to propose)';
  }
  if (msg.includes('InvalidSignature')) {
    return 'Passport signature verification failed';
  }

  return 'Transaction failed - please try again';
}

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

  // Mutex refs to prevent concurrent transactions (nonce conflict prevention)
  const createProposalInProgress = useRef(false);
  const voteCombinedInProgress = useRef(false);

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

            // Extract proposal fields using direct property access
            // This ensures correct values regardless of how viem returns the struct
            const proposer = p.proposer;
            const title = p.title;
            const descriptionHash = p.descriptionHash;
            const value = p.value;
            const deadline = p.deadline;
            const deliverables = p.deliverables;
            const createdAt = p.createdAt;
            const votingEndsAt = p.votingEndsAt;
            const yayVotes = p.yayVotes;
            const nayVotes = p.nayVotes;
            const totalAllocated = p.totalAllocated;
            const status = p.status;
            const editCount = p.editCount;
            const taskId = p.taskId;

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

  // Debounced refetch to prevent multiple rapid refetches from events
  const refetchTimeoutRef = useRef(null);
  const debouncedRefetch = useCallback((includeCounter = false, includeVotes = false) => {
    // Skip if voteCombined is in progress - will refetch at the end
    if (voteCombinedInProgress.current) {
      return;
    }

    if (refetchTimeoutRef.current) {
      clearTimeout(refetchTimeoutRef.current);
    }
    refetchTimeoutRef.current = setTimeout(() => {
      // Double-check flag inside timeout in case voting started during debounce
      if (voteCombinedInProgress.current) {
        refetchTimeoutRef.current = null;
        return;
      }
      if (includeCounter) refetchCounter();
      refetchProposals();
      if (includeVotes) refetchVotes();
      refetchTimeoutRef.current = null;
    }, 500); // 500ms debounce
  }, [refetchCounter, refetchProposals, refetchVotes]);

  // Cleanup debounce timeout on unmount
  useEffect(() => {
    return () => {
      if (refetchTimeoutRef.current) {
        clearTimeout(refetchTimeoutRef.current);
      }
    };
  }, []);

  // Watch for proposal events (all using debounced refetch)
  useWatchContractEvent({
    address: CONTRACTS.GOVERNANCE,
    abi: RoseGovernanceABI,
    eventName: 'ProposalCreated',
    onLogs: () => debouncedRefetch(true, false),
    enabled: !!CONTRACTS.GOVERNANCE,
  });

  useWatchContractEvent({
    address: CONTRACTS.GOVERNANCE,
    abi: RoseGovernanceABI,
    eventName: 'VoteCast',
    onLogs: () => debouncedRefetch(false, true),
    enabled: !!CONTRACTS.GOVERNANCE,
  });

  useWatchContractEvent({
    address: CONTRACTS.GOVERNANCE,
    abi: RoseGovernanceABI,
    eventName: 'ProposalFinalized',
    onLogs: () => debouncedRefetch(false, false),
    enabled: !!CONTRACTS.GOVERNANCE,
  });

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
   * Vote on a proposal with VP (requires passport signature + reputation attestation)
   * VP-centric model: vote with VP, not ROSE amounts
   * @param {number} proposalId - Proposal ID
   * @param {string} vpAmount - Amount of VP to vote with
   * @param {boolean} support - true for Yay, false for Nay
   */
  const vote = useCallback(async (proposalId, vpAmount, support) => {
    if (!isConnected || !CONTRACTS.GOVERNANCE) {
      throw new Error('Not connected');
    }

    setActionLoading(prev => ({ ...prev, [`vote-${proposalId}`]: true }));
    setError(null);

    try {
      const vpWei = parseUnits(vpAmount, 18);

      console.log(`Requesting vote signature for ${vpAmount} VP on proposal ${proposalId}...`);

      // Get passport signature from backend
      const response = await fetch(`${SIGNER_URL}/api/governance/vote-signature`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          voter: account,
          proposalId: Number(proposalId),
          vpAmount: vpWei.toString(),
          support,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        if (errorData.error?.includes('Insufficient passport score')) {
          throw new Error(`Passport score too low (${errorData.score}/${errorData.threshold} required)`);
        }
        throw new Error(errorData.error || `Backend error: ${response.status}`);
      }

      const signatureData = await response.json();
      console.log('Got vote signature from backend');

      // Fetch reputation attestation from backend
      console.log('Fetching reputation attestation...');
      const repAttestation = await fetchReputationAttestation();
      console.log('Reputation:', repAttestation.reputation, 'Expiry:', repAttestation.expiry);

      console.log(`Voting ${support ? 'Yay' : 'Nay'} with ${vpAmount} VP on proposal ${proposalId}...`);
      const hash = await writeContractAsync({
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'vote',
        args: [
          BigInt(proposalId),
          BigInt(signatureData.vpAmount),
          support,
          BigInt(signatureData.expiry),
          signatureData.signature,
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

      console.log('Vote cast successfully!');
      await refetchProposals();
      await refetchVotes();
      return { success: true, hash };
    } catch (err) {
      console.error('Vote error:', err);
      const message = err.message.includes('User rejected')
        ? 'Transaction rejected'
        : err.message.includes('CannotVoteOnOwnProposal')
        ? 'You cannot vote on your own proposal'
        : err.message.includes('IneligibleToVote')
        ? 'You are not eligible to vote (check reputation requirements)'
        : err.message.includes('ProposalNotActive')
        ? 'Proposal is no longer active'
        : err.message.includes('VPLockedToAnotherProposal')
        ? 'Your VP is locked to another proposal'
        : err.message.includes('InsufficientAvailableVP')
        ? 'Insufficient available VP'
        : err.message.includes('Passport score too low')
        ? err.message
        : 'Failed to cast vote';
      setError(message);
      throw new Error(message);
    } finally {
      setActionLoading(prev => ({ ...prev, [`vote-${proposalId}`]: false }));
    }
  }, [isConnected, account, writeContractAsync, publicClient, refetchProposals, refetchVotes, fetchReputationAttestation]);

  /**
   * Free VP from a resolved proposal
   * VP can only be freed after proposal is no longer active (passed/failed)
   * @param {number} proposalId - Proposal ID
   */
  const freeVP = useCallback(async (proposalId) => {
    if (!isConnected || !CONTRACTS.GOVERNANCE) {
      throw new Error('Not connected');
    }

    setActionLoading(prev => ({ ...prev, [`freeVP-${proposalId}`]: true }));
    setError(null);

    try {
      console.log(`Freeing VP from proposal ${proposalId}...`);
      const hash = await writeContractAsync({
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'freeVP',
        args: [BigInt(proposalId)],
        ...GAS_SETTINGS,
      });

      await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: 1,
      });

      console.log('VP freed successfully!');
      await refetchProposals();
      await refetchVotes();
      return { success: true, hash };
    } catch (err) {
      console.error('Free VP error:', err);
      const message = err.message.includes('User rejected')
        ? 'Transaction rejected'
        : err.message.includes('ProposalStillActive')
        ? 'Proposal is still active - VP can only be freed after voting ends'
        : 'Failed to free VP';
      setError(message);
      throw new Error(message);
    } finally {
      setActionLoading(prev => ({ ...prev, [`freeVP-${proposalId}`]: false }));
    }
  }, [isConnected, writeContractAsync, publicClient, refetchProposals, refetchVotes]);

  /**
   * Combined vote using both own VP and delegated VP
   * Auto-splits: uses own VP first, then delegated VP
   * @param {number} proposalId - Proposal ID
   * @param {string} totalVP - Total VP to vote with
   * @param {boolean} support - true for Yay, false for Nay
   * @param {string} ownAvailable - Available own VP
   * @param {string} delegatedAvailable - Available delegated VP for this proposal
   */
  const voteCombined = useCallback(async (proposalId, totalVP, support, ownAvailable, delegatedAvailable) => {
    // Prevent concurrent voting (nonce conflict prevention)
    if (voteCombinedInProgress.current) {
      throw new Error('Vote transaction already in progress');
    }

    if (!isConnected || !CONTRACTS.GOVERNANCE) {
      throw new Error('Not connected');
    }

    voteCombinedInProgress.current = true;
    setActionLoading(prev => ({ ...prev, [`vote-${proposalId}`]: true }));
    setError(null);

    // Track successful transactions outside try block for finally cleanup
    const results = [];

    try {
      const totalWei = parseUnits(totalVP.toString(), 9);
      const ownAvailableWei = parseUnits(ownAvailable.toString(), 9);
      const delegatedAvailableWei = parseUnits(delegatedAvailable.toString(), 9);

      // Calculate split: use own VP first, then delegated
      let ownToUse = 0n;
      let delegatedToUse = 0n;

      if (totalWei <= ownAvailableWei) {
        ownToUse = totalWei;
      } else {
        ownToUse = ownAvailableWei;
        delegatedToUse = totalWei - ownAvailableWei;

        if (delegatedToUse > delegatedAvailableWei) {
          throw new Error('Insufficient total voting power');
        }
      }

      // Vote with own VP if any (requires passport signature + reputation attestation)
      if (ownToUse > 0n) {
        console.log(`Requesting vote signature for ${formatUnits(ownToUse, 9)} own VP...`);

        // Get passport signature from backend
        const voteResponse = await fetch(`${SIGNER_URL}/api/governance/vote-signature`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            voter: account,
            proposalId: Number(proposalId),
            vpAmount: ownToUse.toString(),
            support,
          }),
        });

        if (!voteResponse.ok) {
          const errorData = await voteResponse.json().catch(() => ({}));
          throw new Error(errorData.error || `Backend error: ${voteResponse.status}`);
        }

        const voteSignatureData = await voteResponse.json();
        console.log('Got vote signature from backend');

        // Fetch reputation attestation from backend
        console.log('Fetching reputation attestation...');
        const repAttestation = await fetchReputationAttestation();
        console.log('Reputation:', repAttestation.reputation, 'Expiry:', repAttestation.expiry);

        console.log(`Voting with ${formatUnits(ownToUse, 9)} own VP...`);
        const ownHash = await writeContractAsync({
          address: CONTRACTS.GOVERNANCE,
          abi: RoseGovernanceABI,
          functionName: 'vote',
          args: [
            BigInt(proposalId),
            BigInt(voteSignatureData.vpAmount),
            support,
            BigInt(voteSignatureData.expiry),
            voteSignatureData.signature,
            BigInt(repAttestation.reputation),
            BigInt(repAttestation.expiry),
            repAttestation.signature,
          ],
          ...GAS_SETTINGS,
        });

        await publicClient.waitForTransactionReceipt({
          hash: ownHash,
          confirmations: 1,
        });
        results.push({ type: 'own', hash: ownHash, amount: formatUnits(ownToUse, 9) });

        // Delay between transactions to allow nonce refresh
        if (delegatedToUse > 0n) {
          await new Promise(r => setTimeout(r, 1000));
        }
      }

      // Vote with delegated VP if any (uses backend signing)
      if (delegatedToUse > 0n) {
        console.log(`Requesting delegated vote signature for ${formatUnits(delegatedToUse, 9)} VP...`);

        // Get signature from backend
        const response = await fetch(`${SIGNER_URL}/api/delegation/vote-signature`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            delegate: account,
            proposalId: Number(proposalId),
            amount: delegatedToUse.toString(),
            support,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `Backend error: ${response.status}`);
        }

        const signatureData = await response.json();
        console.log('Got delegation signature from backend');

        // Store allocations for future payout reference
        try {
          const storageKey = `delegatedVoteAllocations_${proposalId}_${account}`;
          localStorage.setItem(storageKey, JSON.stringify(signatureData.allocations));
        } catch (storageErr) {
          console.warn('Failed to store allocations:', storageErr);
        }

        console.log(`Voting with ${formatUnits(delegatedToUse, 9)} delegated VP...`);
        const delegatedHash = await writeContractAsync({
          address: CONTRACTS.GOVERNANCE,
          abi: RoseGovernanceABI,
          functionName: 'castDelegatedVote',
          args: [
            BigInt(proposalId),
            BigInt(signatureData.amount),
            support,
            signatureData.allocationsHash,
            signatureData.allocations.map(a => [a.delegator, BigInt(a.powerUsed)]),
            BigInt(signatureData.nonce),
            BigInt(signatureData.expiry),
            signatureData.signature,
          ],
          ...GAS_SETTINGS,
        });

        await publicClient.waitForTransactionReceipt({
          hash: delegatedHash,
          confirmations: 1,
        });
        results.push({ type: 'delegated', hash: delegatedHash, amount: formatUnits(delegatedToUse, 9) });

        // Confirm vote with backend for reward tracking
        try {
          await fetch(`${SIGNER_URL}/api/delegation/confirm-vote`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              delegate: account,
              proposalId: Number(proposalId),
              allocations: signatureData.allocations,
            }),
          });
          console.log('Delegated vote confirmed with backend');
        } catch (confirmErr) {
          // Non-fatal: vote succeeded on-chain, just won't be tracked for rewards
          console.warn('Failed to confirm delegated vote (non-fatal):', confirmErr);
        }
      }

      console.log('Combined vote successful!');
      return { success: true, results };
    } catch (err) {
      console.error('Combined vote error:', err);
      const message = parseTransactionError(err);
      setError(message);
      throw new Error(message);
    } finally {
      voteCombinedInProgress.current = false;
      setActionLoading(prev => ({ ...prev, [`vote-${proposalId}`]: false }));
      // Always refetch if any transaction succeeded (handles partial success case)
      if (results.length > 0) {
        await refetchProposals();
        await refetchVotes();
      }
    }
  }, [isConnected, account, writeContractAsync, publicClient, refetchProposals, refetchVotes, fetchReputationAttestation]);

  /**
   * Create a new proposal
   * @param {Object} proposalData - Proposal data
   */
  const createProposal = useCallback(async (proposalData) => {
    // Prevent concurrent proposal creation (nonce conflict prevention)
    if (createProposalInProgress.current) {
      throw new Error('Proposal creation already in progress');
    }

    if (!isConnected || !CONTRACTS.GOVERNANCE) {
      throw new Error('Not connected');
    }

    createProposalInProgress.current = true;
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

      // ========== DEBUG LOGGING ==========
      console.log('=== CREATE PROPOSAL DEBUG ===');
      console.log('Account:', account);
      console.log('Title:', title);
      console.log('Value:', value, 'ROSE');
      console.log('Value Wei:', valueWei.toString());
      console.log('Deadline timestamp:', deadlineTimestamp);
      console.log('Deliverables:', deliverables);
      console.log('IPFS Hash:', descriptionHash);
      console.log('Signature expiry:', expiry, '(', new Date(Number(expiry) * 1000).toISOString(), ')');
      console.log('Signature:', signature);

      // Check 1: canPropose (from RoseReputation contract)
      const canProposeResult = await publicClient.readContract({
        address: CONTRACTS.REPUTATION,
        abi: RoseReputationABI,
        functionName: 'canPropose',
        args: [account],
      });
      console.log('canPropose:', canProposeResult);

      // Check 2: Reputation (from RoseReputation contract)
      const reputation = await publicClient.readContract({
        address: CONTRACTS.REPUTATION,
        abi: RoseReputationABI,
        functionName: 'getReputation',
        args: [account],
      });
      console.log('Reputation:', Number(reputation), '%');

      // Check 3: User stats (tasks completed) (from RoseReputation contract)
      const userStats = await publicClient.readContract({
        address: CONTRACTS.REPUTATION,
        abi: RoseReputationABI,
        functionName: 'userStats',
        args: [account],
      });
      console.log('Tasks completed:', Number(userStats.tasksCompleted));
      console.log('Total task value:', formatUnits(userStats.totalTaskValue, 18));

      // Check 4: Treasury balance
      const treasuryBalance = await publicClient.readContract({
        address: CONTRACTS.TOKEN,
        abi: RoseTokenABI,
        functionName: 'balanceOf',
        args: [CONTRACTS.TREASURY],
      });
      console.log('Treasury balance:', formatUnits(treasuryBalance, 18), 'ROSE');
      console.log('Requested value:', value, 'ROSE');
      const valueExceedsTreasury = valueWei > treasuryBalance;
      console.log('Value exceeds treasury:', valueExceedsTreasury);

      // Check 5: Passport signer address
      const passportSigner = await publicClient.readContract({
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'passportSigner',
      });
      console.log('Contract passportSigner:', passportSigner);

      // Fetch reputation attestation from backend
      console.log('Fetching reputation attestation...');
      const repAttestation = await fetchReputationAttestation();
      console.log('Reputation:', repAttestation.reputation, 'Expiry:', repAttestation.expiry);

      // ========== END DEBUG LOGGING ==========

      console.log('Creating proposal...');
      const hash = await writeContractAsync({
        address: CONTRACTS.GOVERNANCE,
        abi: RoseGovernanceABI,
        functionName: 'propose',
        args: [
          title,
          descriptionHash,
          valueWei,
          BigInt(deadlineTimestamp),
          deliverables,
          BigInt(expiry),
          signature,
          BigInt(repAttestation.reputation),
          BigInt(repAttestation.expiry),
          repAttestation.signature,
        ],
        ...GAS_SETTINGS,
      });

      // Wait for 2 confirmations
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
      const message = parseTransactionError(err);
      setError(message);
      throw new Error(message);
    } finally {
      createProposalInProgress.current = false;
      setActionLoading(prev => ({ ...prev, create: false }));
    }
  }, [isConnected, writeContractAsync, publicClient, refetchCounter, refetchProposals, getSignature, account, fetchReputationAttestation]);

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
        ...GAS_SETTINGS,
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
        ...GAS_SETTINGS,
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
        ...GAS_SETTINGS,
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
    voteCombined,
    freeVP,
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
